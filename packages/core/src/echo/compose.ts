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

type ChannelStats = { mean: [number, number, number]; std: [number, number, number] };

/** BT.601 YCbCr (chroma centred on 0) – a cheap, linear space that separates tone from colour. */
function toYcc(r: number, g: number, b: number): [number, number, number] {
  return [0.299 * r + 0.587 * g + 0.114 * b, -0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b];
}

function yccStats(rgb: Buffer): ChannelStats {
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  const n = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    const c = toYcc(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!);
    for (let k = 0; k < 3; k++) {
      sum[k]! += c[k]!;
      sq[k]! += c[k]! * c[k]!;
    }
  }
  const mean = sum.map((v) => v / n) as [number, number, number];
  const std = sq.map((v, k) => Math.sqrt(Math.max(0, v / n - mean[k]! ** 2))) as [number, number, number];
  return { mean, std };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Reinhard-style statistics transfer so AI areas share the print's tonality: chroma is matched fully
 * (B&W print → grey panorama, sepia → sepia, photochrom → its palette), luminance only gently
 * (the panorama legitimately contains more sky and ground than the photo).
 */
export async function matchTone(pano: Buffer, photo: Buffer): Promise<Buffer> {
  const ref = await sharp(photo).resize(256, 256, { fit: 'inside' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const src = yccStats(ref);
  const { data, info } = await sharp(pano).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const dst = yccStats(data);

  const kY = clamp(src.std[0] / (dst.std[0] || 1), 0.8, 1.25);
  const mY = dst.mean[0] + 0.5 * (src.mean[0] - dst.mean[0]);
  const kC = [1, 2].map((k) => clamp(src.std[k]! / (dst.std[k]! || 1), 0, 1.5));

  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 3) {
    const [y, cb, cr] = toYcc(data[i]!, data[i + 1]!, data[i + 2]!);
    const Y = (y - dst.mean[0]) * kY + mY;
    const Cb = (cb - dst.mean[1]) * kC[0]! + src.mean[1];
    const Cr = (cr - dst.mean[2]) * kC[1]! + src.mean[2];
    out[i] = clamp(Math.round(Y + 1.402 * Cr), 0, 255);
    out[i + 1] = clamp(Math.round(Y - 0.344136 * Cb - 0.714136 * Cr), 0, 255);
    out[i + 2] = clamp(Math.round(Y + 1.772 * Cb), 0, 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
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

async function grayRaw(img: Buffer | ReturnType<typeof sharp>, width: number, height: number): Promise<Float32Array> {
  const s = Buffer.isBuffer(img) ? sharp(img) : img;
  const raw = await s.resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer();
  return Float32Array.from(raw);
}

/**
 * The model re-renders the whole canvas and may shift/scale the scene by a few percent, which makes the re-pasted
 * archival frame ghost. Find where the scene "expects" the photo (multi-scale normalised cross-correlation on a
 * downscaled grayscale) and return the corrected rect. Archival pixels stay untouched – only their placement moves.
 */
export async function alignToPano(pano: Buffer, photo: Buffer, rect: Rect, opts = { margin: 0.15, scales: [0.88, 0.92, 0.96, 1, 1.04, 1.08, 1.12], factor: 0.25 }): Promise<{ rect: Rect; score: number }> {
  const meta = await sharp(pano).metadata();
  const f = opts.factor;
  const mx = Math.round(rect.w * opts.margin);
  const my = Math.round(rect.h * opts.margin);
  const rx = Math.max(0, rect.x - mx);
  const ry = Math.max(0, rect.y - my);
  const rw = Math.min(meta.width! - rx, rect.w + 2 * mx);
  const rh = Math.min(meta.height! - ry, rect.h + 2 * my);
  const RW = Math.round(rw * f);
  const RH = Math.round(rh * f);
  const region = await grayRaw(sharp(pano).extract({ left: rx, top: ry, width: rw, height: rh }), RW, RH);

  // Summed-area tables give the mean/variance of every candidate window in O(1).
  const sat = new Float64Array((RW + 1) * (RH + 1));
  const sat2 = new Float64Array((RW + 1) * (RH + 1));
  for (let y = 0; y < RH; y++) {
    let row = 0;
    let row2 = 0;
    for (let x = 0; x < RW; x++) {
      const v = region[y * RW + x]!;
      row += v;
      row2 += v * v;
      sat[(y + 1) * (RW + 1) + x + 1] = sat[y * (RW + 1) + x + 1]! + row;
      sat2[(y + 1) * (RW + 1) + x + 1] = sat2[y * (RW + 1) + x + 1]! + row2;
    }
  }
  const boxSum = (t: Float64Array, x: number, y: number, w: number, h: number) =>
    t[(y + h) * (RW + 1) + x + w]! - t[y * (RW + 1) + x + w]! - t[(y + h) * (RW + 1) + x]! + t[y * (RW + 1) + x]!;

  let best = { score: -1, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  for (const s of opts.scales) {
    const TW = Math.round(rect.w * s * f);
    const TH = Math.round(rect.h * s * f);
    if (TW >= RW || TH >= RH || TW < 8 || TH < 8) continue;
    const tpl = await grayRaw(photo, TW, TH);
    const n = TW * TH;
    let mean = 0;
    for (const v of tpl) mean += v;
    mean /= n;
    let norm = 0;
    for (let i = 0; i < n; i++) {
      tpl[i] = tpl[i]! - mean;
      norm += tpl[i]! * tpl[i]!;
    }
    norm = Math.sqrt(norm) || 1;
    for (let oy = 0; oy + TH <= RH; oy++) {
      for (let ox = 0; ox + TW <= RW; ox++) {
        const sum = boxSum(sat, ox, oy, TW, TH);
        const varR = boxSum(sat2, ox, oy, TW, TH) - (sum * sum) / n;
        if (varR <= 1e-6) continue;
        let dot = 0;
        for (let ty = 0; ty < TH; ty++) {
          const rOff = (oy + ty) * RW + ox;
          const tOff = ty * TW;
          for (let tx = 0; tx < TW; tx++) dot += tpl[tOff + tx]! * region[rOff + tx]!;
        }
        const score = dot / (norm * Math.sqrt(varR));
        if (score > best.score) best = { score, x: rx + ox / f, y: ry + oy / f, w: TW / f, h: TH / f };
      }
    }
  }
  return { rect: { x: Math.round(best.x), y: Math.round(best.y), w: Math.round(best.w), h: Math.round(best.h) }, score: best.score };
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
