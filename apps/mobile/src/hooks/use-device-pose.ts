import { normalizeDeg } from '@echoes/shared';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useRef } from 'react';
import { Quaternion } from 'three';
import { cameraFromDevice, OrientationFilter } from '@/lib/orientation';

/**
 * Device pose kept in refs (60 Hz updates must not re-render React).
 * - camera: fused (gyro + absolute) camera orientation in the scene frame, updated per sensor sample
 * - compassDeg: true heading from expo-location (used on iOS, where DeviceMotion yaw has an arbitrary origin)
 * - declinationDeg: true − magnetic north (Android's rotation vector is magnetic-north referenced)
 */
export type DevicePose = {
  camera: Quaternion | null;
  hasGyro: boolean;
  compassDeg: number | null;
  declinationDeg: number | null;
};

export function useDevicePose() {
  const pose = useRef<DevicePose>({ camera: null, hasGyro: false, compassDeg: null, declinationDeg: null });

  useEffect(() => {
    const filter = new OrientationFilter();
    const camera = new Quaternion();

    DeviceMotion.setUpdateInterval(16);
    const motionSub = DeviceMotion.addListener((m) => {
      if (!m.rotation) return;
      const rate = m.rotationRate;
      const device = filter.update(
        m.rotation.alpha,
        m.rotation.beta,
        m.rotation.gamma,
        rate ? { x: rate.alpha, y: rate.beta, z: rate.gamma, t: rate.timestamp } : null,
      );
      pose.current.camera = cameraFromDevice(camera, device, m.orientation ?? 0);
      pose.current.hasGyro = !!rate;
    });

    let headingSub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      headingSub = await Location.watchHeadingAsync((h) => {
        pose.current.compassDeg = normalizeDeg(h.trueHeading >= 0 ? h.trueHeading : h.magHeading);
        if (h.trueHeading >= 0) {
          let d = h.trueHeading - h.magHeading;
          if (d > 180) d -= 360;
          if (d < -180) d += 360;
          pose.current.declinationDeg = d;
        }
      });
    })();

    return () => {
      cancelled = true;
      motionSub.remove();
      headingSub?.remove();
    };
  }, []);

  return pose;
}
