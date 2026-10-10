import sharp from 'sharp';
import type { Rect } from '@echoes/shared';
import type { StripSpec } from './geometry';

export const MISSING_GRAY = { r: 128, g: 128, b: 128 };

/** Strip-sized canvas: neutral gray everywhere except the archival photo at `rect`. */
export async function buildCanvas(photo: Buffer, strip: StripSpec, rect: Rect): Promise<Buffer> {
  const resized = await sharp(photo).resize(rect.w, rect.h, { fit: 'fill' }).removeAlpha().toBuffer();
  return sharp({ create: { width: strip.width, height: strip.height, channels: 3, background: MISSING_GRAY } })
    .composite([{ input: resized, left: rect.x, top: rect.y }])
    .png()
    .toBuffer();
}

/** Model output is close to, but not exactly, the requested size – snap it back onto the strip grid. */
export async function normalizeToStrip(img: Buffer, strip: StripSpec): Promise<Buffer> {
  return sharp(img).resize(strip.width, strip.height, { fit: 'fill' }).removeAlpha().png().toBuffer();
}

/** Is the archival photo effectively monochrome (B&W or sepia)? */
export async function isMonochrome(photo: Buffer): Promise<boolean> {
  const { channels } = await sharp(photo).stats();
  if (channels.length < 3) return true;
  const [r, g, b] = channels.map((c) => c.mean) as [number, number, number];
  return Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) < 12;
}

/** Average tint of a photo, used to re-tone a monochrome panorama so AI areas match the print. */
async function averageTint(photo: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { channels } = await sharp(photo).stats();
  if (channels.length < 3) return { r: 1, g: 1, b: 1 };
  const means = channels.slice(0, 3).map((c) => c.mean);
  const avg = (means[0]! + means[1]! + means[2]!) / 3 || 1;
  return { r: means[0]! / avg, g: means[1]! / avg, b: means[2]! / avg };
}

/** For monochrome sources, force the generated panorama to the same tonality (models like to colourise). */
export async function matchTone(pano: Buffer, photo: Buffer): Promise<Buffer> {
  if (!(await isMonochrome(photo))) return pano;
  const t = await averageTint(photo);
  return sharp(pano)
    .grayscale()
    .toColourspace('srgb')
    .recomb([
      [t.r, 0, 0],
      [0, t.g, 0],
      [0, 0, t.b],
    ])
    .png()
    .toBuffer();
}

/** Soft-edged white rectangle on black, used as an alpha mask. */
async function featherMask(width: number, height: number, feather: number): Promise<Buffer> {
  const f = Math.max(1, Math.min(feather, Math.floor(Math.min(width, height) / 4)));
  const svg = `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><rect x="${f}" y="${f}" width="${width - 2 * f}" height="${height - 2 * f}" fill="white"/></svg>`;
  return sharp(Buffer.from(svg)).blur(f / 2).greyscale().toColourspace('b-w').raw().toBuffer();
}

/**
 * Paste the untouched archival pixels back over the model output (the model re-renders the whole canvas).
 * This is our provenance guarantee: inside photoRect the user sees the real archive, not a hallucination.
 */
export async function repastePhoto(pano: Buffer, photo: Buffer, rect: Rect, feather = 16): Promise<Buffer> {
  const resized = await sharp(photo).resize(rect.w, rect.h, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const mask = await featherMask(rect.w, rect.h, feather);
  const rgba = Buffer.alloc(rect.w * rect.h * 4);
  for (let i = 0; i < rect.w * rect.h; i++) {
    rgba[i * 4] = resized[i * 3]!;
    rgba[i * 4 + 1] = resized[i * 3 + 1]!;
    rgba[i * 4 + 2] = resized[i * 3 + 2]!;
    rgba[i * 4 + 3] = mask[i]!;
  }
  return sharp(pano)
    .composite([{ input: rgba, raw: { width: rect.w, height: rect.h, channels: 4 }, left: rect.x, top: rect.y }])
    .png()
    .toBuffer();
}

/** Rotate a 360° strip horizontally by `dx` pixels (wraps around). */
export async function rollX(img: Buffer, dx: number): Promise<Buffer> {
  const meta = await sharp(img).metadata();
  const w = meta.width!;
  const h = meta.height!;
  const shift = ((dx % w) + w) % w;
  if (shift === 0) return img;
  const right = await sharp(img).extract({ left: w - shift, top: 0, width: shift, height: h }).toBuffer();
  const left = await sharp(img).extract({ left: 0, top: 0, width: w - shift, height: h }).toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: MISSING_GRAY } })
    .composite([
      { input: right, left: 0, top: 0 },
      { input: left, left: shift, top: 0 },
    ])
    .png()
    .toBuffer();
}

/** Gray out a vertical band in the middle (used to ask the model to heal the 360° wrap seam). */
export async function grayBand(img: Buffer, bandWidth: number): Promise<Buffer> {
  const meta = await sharp(img).metadata();
  const band = await sharp({ create: { width: bandWidth, height: meta.height!, channels: 3, background: MISSING_GRAY } }).png().toBuffer();
  return sharp(img)
    .composite([{ input: band, left: Math.round(meta.width! / 2 - bandWidth / 2), top: 0 }])
    .png()
    .toBuffer();
}

/** Composite only the central band of `healed` onto `base` with feathered edges. */
export async function mergeBand(base: Buffer, healed: Buffer, bandWidth: number, feather = 48): Promise<Buffer> {
  const meta = await sharp(base).metadata();
  const w = Math.min(meta.width!, bandWidth + feather * 2);
  const left = Math.round(meta.width! / 2 - w / 2);
  const rect = { x: left, y: 0, w, h: meta.height! };
  const crop = await sharp(healed).extract({ left: rect.x, top: 0, width: rect.w, height: rect.h }).png().toBuffer();
  // Feather only horizontally: mask spans full height.
  const svg = `<svg width="${w}" height="${rect.h}"><rect width="100%" height="100%" fill="black"/><rect x="${feather}" y="-100" width="${w - 2 * feather}" height="${rect.h + 200}" fill="white"/></svg>`;
  const mask = await sharp(Buffer.from(svg)).blur(feather / 2).greyscale().toColourspace('b-w').raw().toBuffer();
  const rgb = await sharp(crop).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(w * rect.h * 4);
  for (let i = 0; i < w * rect.h; i++) {
    rgba[i * 4] = rgb[i * 3]!;
    rgba[i * 4 + 1] = rgb[i * 3 + 1]!;
    rgba[i * 4 + 2] = rgb[i * 3 + 2]!;
    rgba[i * 4 + 3] = mask[i]!;
  }
  return sharp(base)
    .composite([{ input: rgba, raw: { width: w, height: rect.h, channels: 4 }, left: rect.x, top: 0 }])
    .png()
    .toBuffer();
}

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** Average colour of the top and bottom rows – used to paint sky/ground caps in the viewer. */
export async function edgeColors(pano: Buffer): Promise<{ sky: string; ground: string }> {
  const meta = await sharp(pano).metadata();
  const band = Math.max(4, Math.round(meta.height! * 0.03));
  const avg = async (top: number) => {
    const { channels } = await sharp(pano).extract({ left: 0, top, width: meta.width!, height: band }).stats();
    const [r, g, b] = channels.length >= 3 ? channels : [channels[0]!, channels[0]!, channels[0]!];
    return `#${hex(r!.mean)}${hex(g!.mean)}${hex(b!.mean)}`;
  };
  return { sky: await avg(0), ground: await avg(meta.height! - band) };
}

export async function toJpeg(img: Buffer, width?: number, quality = 86): Promise<Buffer> {
  const s = sharp(img);
  return (width ? s.resize({ width }) : s).jpeg({ quality, mozjpeg: true }).toBuffer();
}
