import { angleDiffDeg, normalizeDeg } from '@echoes/shared';
import { Euler, Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
const zee = new Vector3(0, 0, 1);
// Rotate -90° around X so the camera looks out of the back of the phone (as in three's DeviceOrientationControls).
const backCamera = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const euler = new Euler();
const screenQ = new Quaternion();
const forward = new Vector3();

/**
 * World frame: −Z = north (heading 0°), +X = east, +Y = up.
 * alpha/beta/gamma follow the W3C DeviceOrientation convention (radians), which expo-sensors emulates.
 */
export function deviceQuaternion(out: Quaternion, alpha: number, beta: number, gamma: number, screenOrientationDeg: number): Quaternion {
  euler.set(beta, alpha, -gamma, 'YXZ');
  out.setFromEuler(euler);
  out.multiply(backCamera);
  out.multiply(screenQ.setFromAxisAngle(zee, -screenOrientationDeg * DEG));
  return out;
}

/** Compass-style heading (0° = −Z, clockwise) of where the camera looks, or null when looking straight up/down. */
export function cameraHeadingDeg(q: Quaternion): number | null {
  forward.set(0, 0, -1).applyQuaternion(q);
  if (Math.abs(forward.y) > 0.92) return null;
  return normalizeDeg(Math.atan2(forward.x, -forward.z) / DEG);
}

/** Exponential smoothing on a circle (handles the 359°→0° wrap). */
export function smoothAngleDeg(current: number | null, target: number, k: number): number {
  if (current === null) return normalizeDeg(target);
  return normalizeDeg(current + angleDiffDeg(target, current) * k);
}

export const deg2rad = (d: number) => d * DEG;
