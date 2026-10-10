import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { alignToPano, matchTone, repastePhoto } from './compose';

const solid = (w: number, h: number, c: { r: number; g: number; b: number }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

/** Left half one colour, right half another. */
async function split(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  return sharp(await solid(64, 64, a)).composite([{ input: await solid(32, 64, b), left: 32, top: 0 }]).png().toBuffer();
}

async function meanChroma(img: Buffer) {
  const { data } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += 3) sum += Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
  return sum / (data.length / 3);
}

describe('matchTone', () => {
  it('turns a colourised panorama grey when the archival print is black-and-white', async () => {
    const photo = await split({ r: 30, g: 30, b: 30 }, { r: 200, g: 200, b: 200 });
    const pano = await split({ r: 40, g: 120, b: 220 }, { r: 220, g: 90, b: 40 });
    expect(await meanChroma(await matchTone(pano, photo))).toBeLessThan(4);
  });
  it('keeps colour when the archival print is coloured', async () => {
    const photo = await split({ r: 150, g: 170, b: 210 }, { r: 190, g: 80, b: 60 });
    const pano = await split({ r: 140, g: 160, b: 200 }, { r: 180, g: 90, b: 70 });
    expect(await meanChroma(await matchTone(pano, photo))).toBeGreaterThan(40);
  });
});

describe('repastePhoto', () => {
  it('keeps archival pixels untouched inside the rect (away from the feather)', async () => {
    const pano = await solid(400, 100, { r: 0, g: 0, b: 255 });
    const photo = await solid(100, 50, { r: 255, g: 0, b: 0 });
    const out = await repastePhoto(pano, photo, { x: 150, y: 25, w: 100, h: 50 }, 6);
    const { data } = await sharp(out).extract({ left: 200, top: 50, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 0]);
    const outside = await sharp(out).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer();
    expect([outside[0], outside[1], outside[2]]).toEqual([0, 0, 255]);
  });
});

describe('alignToPano', () => {
  it('finds where the model drew the photo (shifted and scaled)', async () => {
    // A textured "photo" so correlation has something to lock onto.
    const svg = `<svg width="200" height="140"><rect width="200" height="140" fill="#777"/><rect x="20" y="30" width="50" height="90" fill="#eee"/><circle cx="140" cy="60" r="35" fill="#222"/><rect x="90" y="110" width="100" height="20" fill="#bbb"/></svg>`;
    const photo = await sharp(Buffer.from(svg)).png().toBuffer();
    const drawn = await sharp(photo).resize(210, 147).png().toBuffer(); // model drew it 5% bigger…
    const pano = await sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .composite([{ input: drawn, left: 318, top: 118 }]) // …and shifted it by (+18, +18)
      .png()
      .toBuffer();
    const { rect, score } = await alignToPano(pano, photo, { x: 300, y: 100, w: 200, h: 140 });
    expect(score).toBeGreaterThan(0.9);
    expect(Math.abs(rect.x - 318)).toBeLessThanOrEqual(8);
    expect(Math.abs(rect.y - 118)).toBeLessThanOrEqual(8);
    expect(Math.abs(rect.w - 210)).toBeLessThanOrEqual(10);
  });
});
