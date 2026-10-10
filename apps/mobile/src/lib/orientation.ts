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
 * Scene frame: −Z = north (heading 0°), +X = east, +Y = up.
 * Device orientation from W3C-style alpha/beta/gamma (radians), which expo-sensors emulates.
 * The quaternion's local axes are the device axes remapped: device x → x, device y (top) → −z, device z (screen) → y.
 */
export function deviceQuaternion(out: Quaternion, alpha: number, beta: number, gamma: number): Quaternion {
  euler.set(beta, alpha, -gamma, 'YXZ');
  return out.setFromEuler(euler);
}

/** Camera looking out of the back of the device, compensated for screen rotation. */
export function cameraFromDevice(out: Quaternion, device: Quaternion, screenOrientationDeg: number): Quaternion {
  return out.copy(device).multiply(backCamera).multiply(screenQ.setFromAxisAngle(zee, -screenOrientationDeg * DEG));
}

export type GyroSample = { x: number; y: number; z: number; t: number }; // deg/s in device axes, t in seconds

/**
 * Complementary filter. Android derives alpha/beta/gamma from Euler angles that are ill-conditioned exactly when the
 * phone is held upright (the AR pose) and the rotation vector carries magnetometer noise indoors – fed straight to
 * the camera that reads as constant shaking. Here the gyroscope drives short-term motion (smooth, low latency) and
 * the absolute orientation only slowly pulls the estimate back, cancelling gyro drift.
 */
export class OrientationFilter {
  readonly q = new Quaternion();
  private readonly abs = new Quaternion();
  private readonly dq = new Quaternion();
  private readonly axis = new Vector3();
  private ready = false;
  private lastGyroT: number | null = null;

  constructor(
    private readonly opts = {
      /** Per-sample pull towards the absolute orientation when a gyro is present (~1 s time constant at 60 Hz). */
      correction: 0.015,
      /** Without a gyroscope we can only low-pass the absolute orientation. */
      correctionNoGyro: 0.1,
      /** Beyond this disagreement (rad) re-converge quickly: start-up, large drift. */
      snapAngle: 0.35,
      /** Rates below this (deg/s) are sensor noise on a still phone – ignore them to prevent creeping. */
      deadbandDegPerS: 0.7,
    },
  ) {}

  update(alpha: number, beta: number, gamma: number, gyro: GyroSample | null): Quaternion {
    deviceQuaternion(this.abs, alpha, beta, gamma);
    if (!this.ready) {
      this.q.copy(this.abs);
      this.ready = true;
      this.lastGyroT = gyro?.t ?? null;
      return this.q;
    }

    let k = this.opts.correctionNoGyro;
    if (gyro) {
      k = this.opts.correction;
      const dt = this.lastGyroT === null ? 0 : gyro.t - this.lastGyroT;
      this.lastGyroT = gyro.t;
      if (dt > 0 && dt < 0.2) {
        // Device-frame angular velocity → the quaternion's local axes (see deviceQuaternion).
        const wx = gyro.x * DEG;
        const wy = gyro.z * DEG;
        const wz = -gyro.y * DEG;
        const w = Math.hypot(wx, wy, wz);
        if (w > this.opts.deadbandDegPerS * DEG) {
          this.axis.set(wx / w, wy / w, wz / w);
          this.q.multiply(this.dq.setFromAxisAngle(this.axis, w * dt)).normalize();
        }
      }
    }
    if (this.q.angleTo(this.abs) > this.opts.snapAngle) k = 0.3;
    this.q.slerp(this.abs, k);
    return this.q;
  }
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
