import { describe, expect, it } from 'vitest';
import { angleDiffDeg, bearingDeg, distanceM, normalizeDeg } from './geo';

describe('geo', () => {
  it('measures Wrocław Rynek → Plac Solny (~150 m)', () => {
    const d = distanceM(51.1108, 17.0324, 51.1099, 17.0306);
    expect(d).toBeGreaterThan(120);
    expect(d).toBeLessThan(180);
  });

  it('computes cardinal bearings', () => {
    expect(bearingDeg(51, 17, 52, 17)).toBeCloseTo(0, 1);
    expect(bearingDeg(51, 17, 51, 18)).toBeGreaterThan(89);
    expect(bearingDeg(51, 17, 51, 18)).toBeLessThan(91);
    expect(bearingDeg(51, 17, 50, 17)).toBeCloseTo(180, 1);
  });

  it('normalizes and diffs angles across 0/360', () => {
    expect(normalizeDeg(-10)).toBe(350);
    expect(angleDiffDeg(10, 350)).toBe(20);
    expect(angleDiffDeg(350, 10)).toBe(-20);
    expect(angleDiffDeg(180, 0)).toBe(180);
  });
});
