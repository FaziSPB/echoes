import type { Rect } from '@echoes/shared';

/**
 * Cylindrical 360° strip: x ∈ [0, W) maps linearly to yaw ∈ [-180°, 180°) relative to the photo heading,
 * so the archival photo is centred at x = W/2. y maps to height on a cylinder with the same px/deg scale.
 */
export type StripSpec = { width: number; height: number };

export function pxPerDeg(strip: StripSpec): number {
  return strip.width / 360;
}

/** Where the untouched archival photo sits in the strip, given its horizontal field of view and pitch. */
export function photoRectInStrip(
  strip: StripSpec,
  photo: { width: number; height: number; hfovDeg: number; pitchDeg?: number },
  maxHeightFraction = 0.8,
): Rect {
  let w = photo.hfovDeg * pxPerDeg(strip);
  let h = (w * photo.height) / photo.width;
  const maxH = strip.height * maxHeightFraction;
  if (h > maxH) {
    // Tall photo: shrink so the model still has sky/ground to invent.
    w *= maxH / h;
    h = maxH;
  }
  const x = strip.width / 2 - w / 2;
  const centreY = strip.height / 2 - (photo.pitchDeg ?? 0) * pxPerDeg(strip);
  const y = Math.min(Math.max(centreY - h / 2, 0), strip.height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Vertical field of view covered by a cylindrical strip (degrees, linear model). */
export function stripVfovDeg(strip: StripSpec): number {
  return (strip.height / strip.width) * 360;
}

/** Scale a rect measured in one strip resolution into another. */
export function scaleRect(r: Rect, from: StripSpec, to: StripSpec): Rect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return { x: Math.round(r.x * sx), y: Math.round(r.y * sy), w: Math.round(r.w * sx), h: Math.round(r.h * sy) };
}
