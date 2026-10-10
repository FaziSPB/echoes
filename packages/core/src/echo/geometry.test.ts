import { describe, expect, it } from 'vitest';
import { photoRectInStrip, scaleRect, stripVfovDeg } from './geometry';

const strip = { width: 4096, height: 1024 };

describe('photoRectInStrip', () => {
  it('centres a 55° landscape photo and keeps its aspect ratio', () => {
    const r = photoRectInStrip(strip, { width: 3500, height: 2500, hfovDeg: 55 });
    expect(r.w).toBe(Math.round((55 * 4096) / 360));
    expect(Math.abs(r.x + r.w / 2 - 2048)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.y + r.h / 2 - 512)).toBeLessThanOrEqual(1);
    expect(r.w / r.h).toBeCloseTo(3500 / 2500, 1);
  });

  it('shrinks tall photos to leave room for outpainting', () => {
    const r = photoRectInStrip(strip, { width: 1000, height: 2000, hfovDeg: 80 });
    expect(r.h).toBeLessThanOrEqual(1024 * 0.8 + 1);
    expect(r.w / r.h).toBeCloseTo(0.5, 1);
  });

  it('moves the photo up when the camera pitched up, clamped to the strip', () => {
    const level = photoRectInStrip(strip, { width: 3000, height: 2000, hfovDeg: 50 });
    const up = photoRectInStrip(strip, { width: 3000, height: 2000, hfovDeg: 50, pitchDeg: 10 });
    expect(up.y).toBeLessThan(level.y);
    const wayUp = photoRectInStrip(strip, { width: 3000, height: 2000, hfovDeg: 50, pitchDeg: 80 });
    expect(wayUp.y).toBe(0);
  });
});

describe('strip helpers', () => {
  it('4:1 strip covers 90° vertically', () => {
    expect(stripVfovDeg(strip)).toBe(90);
  });
  it('scales rects between resolutions', () => {
    expect(scaleRect({ x: 100, y: 50, w: 200, h: 100 }, strip, { width: 2048, height: 512 })).toEqual({ x: 50, y: 25, w: 100, h: 50 });
  });
});
