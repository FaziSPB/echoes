/**
 * "Walk in time" geometry (pinhole camera, motion along the optical axis).
 * A frame captured `frameM` metres along the path, viewed from `atM`, is magnified by (D − frameM) / (D − atM),
 * where D is the distance from the path start to the main subject. > 1 when we have walked past the frame's spot.
 */
export function frameScale(subjectDistanceM: number, frameM: number, atM: number): number {
  const remaining = Math.max(subjectDistanceM - atM, subjectDistanceM * 0.25); // never walk "through" the subject
  return (subjectDistanceM - frameM) / remaining;
}

/** Centre crop that, enlarged back to full size, simulates stepping forward by the given magnification. */
export function dollyCrop(width: number, height: number, scale: number): { left: number; top: number; width: number; height: number } {
  const w = Math.max(1, Math.round(width / scale));
  const h = Math.max(1, Math.round(height / scale));
  return { left: Math.round((width - w) / 2), top: Math.round((height - h) / 2), width: w, height: h };
}

/**
 * Which two frames to show at distance `atM`: frame `a` (behind us, enlarged) under frame `b` (ahead, slightly
 * shrunk) faded in by `t`. Frame distances must be sorted ascending.
 */
export function walkBlend(frameDistancesM: number[], atM: number, subjectDistanceM: number) {
  const last = frameDistancesM.length - 1;
  const d = Math.min(Math.max(atM, frameDistancesM[0] ?? 0), frameDistancesM[last] ?? 0);
  let a = 0;
  while (a < last - 1 && frameDistancesM[a + 1]! <= d) a++;
  const b = Math.min(a + 1, last);
  const span = frameDistancesM[b]! - frameDistancesM[a]!;
  const t = span > 0 ? Math.min(1, Math.max(0, (d - frameDistancesM[a]!) / span)) : 0;
  return {
    a,
    b,
    t,
    scaleA: frameScale(subjectDistanceM, frameDistancesM[a]!, d),
    scaleB: frameScale(subjectDistanceM, frameDistancesM[b]!, d),
  };
}

/**
 * Step detection from linear acceleration (gravity removed): a smoothed magnitude peak above `threshold`,
 * at least `minIntervalMs` after the previous step. Walking with a phone held in front gives ~1–3 m/s² peaks.
 */
export class StepDetector {
  private smoothed = 0;
  private prev = 0;
  private prev2 = 0;
  private lastStepMs = -Infinity;

  constructor(private readonly opts = { threshold: 1.0, minIntervalMs: 280, smoothing: 0.35 }) {}

  /** Returns true when this sample completes a step. */
  push(ax: number, ay: number, az: number, tMs: number): boolean {
    const magnitude = Math.hypot(ax, ay, az);
    this.smoothed += (magnitude - this.smoothed) * this.opts.smoothing;
    const isPeak = this.prev > this.prev2 && this.prev >= this.smoothed && this.prev > this.opts.threshold;
    this.prev2 = this.prev;
    this.prev = this.smoothed;
    if (isPeak && tMs - this.lastStepMs >= this.opts.minIntervalMs) {
      this.lastStepMs = tMs;
      return true;
    }
    return false;
  }
}
