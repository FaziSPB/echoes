import { describe, expect, it } from 'vitest';
import { dollyCrop, frameScale, StepDetector, walkBlend } from './walk';

describe('frameScale', () => {
  it('magnifies a 28 m subject by ×1.56 after 10 m', () => {
    expect(frameScale(28, 0, 10)).toBeCloseTo(28 / 18, 5);
  });
  it('shrinks a frame that is still ahead of us', () => {
    expect(frameScale(28, 10, 5)).toBeLessThan(1);
  });
  it('is 1 when standing on the frame’s spot', () => {
    expect(frameScale(28, 6.6, 6.6)).toBeCloseTo(1, 10);
  });
});

describe('dollyCrop', () => {
  it('keeps the centre and the aspect ratio', () => {
    const c = dollyCrop(1600, 1140, 1.25);
    expect(c.width).toBe(1280);
    expect(c.height).toBe(912);
    expect(c.left + c.width / 2).toBe(800);
    expect(c.top + c.height / 2).toBe(570);
  });
});

describe('walkBlend', () => {
  const frames = [0, 3.33, 6.67, 10];
  it('shows the original at the start', () => {
    expect(walkBlend(frames, 0, 28)).toMatchObject({ a: 0, b: 1, t: 0, scaleA: 1 });
  });
  it('fades halfway between frames, enlarging the one behind and shrinking the one ahead', () => {
    const r = walkBlend(frames, 5, 28);
    expect(r.a).toBe(1);
    expect(r.b).toBe(2);
    expect(r.t).toBeCloseTo((5 - 3.33) / (6.67 - 3.33), 5);
    expect(r.scaleA).toBeGreaterThan(1);
    expect(r.scaleB).toBeLessThan(1);
  });
  it('clamps past the end of the path', () => {
    expect(walkBlend(frames, 25, 28)).toMatchObject({ a: 2, b: 3, t: 1 });
  });
});

describe('StepDetector', () => {
  it('counts ~10 steps in 5 s of 2 Hz walking with noise, and none when still', () => {
    const d = new StepDetector();
    let steps = 0;
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
    for (let i = 0; i < 300; i++) {
      const t = i * (1000 / 60);
      const bob = 2.2 * Math.max(0, Math.sin((2 * Math.PI * 2 * t) / 1000)); // one push per step
      if (d.push(noise(), bob + noise(), noise(), t)) steps++;
    }
    expect(steps).toBeGreaterThanOrEqual(9);
    expect(steps).toBeLessThanOrEqual(11);

    const still = new StepDetector();
    let ghost = 0;
    for (let i = 0; i < 300; i++) if (still.push(noise(), noise(), noise(), i * 16.7)) ghost++;
    expect(ghost).toBe(0);
  });
});
