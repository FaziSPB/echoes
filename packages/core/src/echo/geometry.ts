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

/**
 * Progressive outpainting, step 1: the photo fills `fill` of a wider context canvas, so the model
 * extends it while keeping the scale. Returns where the photo sits and how many degrees the canvas covers.
 */
export function contextLayout(
  canvas: StripSpec,
  photo: { width: number; height: number; hfovDeg: number; pitchDeg?: number },
  fill = 0.5,
  maxHeightFraction = 0.8,
): { rect: Rect; coverageDeg: number } {
  let w = canvas.width * fill;
  let h = (w * photo.height) / photo.width;
  if (h > canvas.height * maxHeightFraction) {
    w *= (canvas.height * maxHeightFraction) / h;
    h = canvas.height * maxHeightFraction;
  }
  const coverageDeg = (photo.hfovDeg * canvas.width) / w;
  const ppd = canvas.width / coverageDeg;
  const y = Math.min(Math.max(canvas.height / 2 - (photo.pitchDeg ?? 0) * ppd - h / 2, 0), canvas.height - h);
  return { rect: { x: Math.round((canvas.width - w) / 2), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, coverageDeg };
}

/** Step 2: where the context canvas lands inside the 360° strip (centred, at its true angular size). */
export function contextRectInStrip(strip: StripSpec, canvas: StripSpec, coverageDeg: number): Rect {
  let w = coverageDeg * pxPerDeg(strip);
  let h = (w * canvas.height) / canvas.width;
  if (h > strip.height) {
    w *= strip.height / h;
    h = strip.height;
  }
  return { x: Math.round((strip.width - w) / 2), y: Math.round((strip.height - h) / 2), w: Math.round(w), h: Math.round(h) };
}

/** Map a rect measured inside a frame onto that frame's placement `outer` (frame scaled uniformly). */
export function mapRectInto(inner: Rect, frame: StripSpec, outer: Rect): Rect {
  const sx = outer.w / frame.width;
  const sy = outer.h / frame.height;
  return {
    x: Math.round(outer.x + inner.x * sx),
    y: Math.round(outer.y + inner.y * sy),
    w: Math.round(inner.w * sx),
    h: Math.round(inner.h * sy),
  };
}
