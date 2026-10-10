import { normalizeDeg } from '@echoes/shared';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useRef } from 'react';

/**
 * Raw device pose kept in refs (60 Hz updates must not re-render React).
 * - rotation: W3C-style alpha/beta/gamma (radians) from DeviceMotion → camera quaternion in the GL scene
 * - compassDeg: true heading from expo-location (falls back to magnetic) → aligns the scene with the world
 */
export type DevicePose = {
  rotation: { alpha: number; beta: number; gamma: number } | null;
  screenOrientationDeg: number;
  compassDeg: number | null;
  compassAccuracy: number | null;
};

export function useDevicePose() {
  const pose = useRef<DevicePose>({ rotation: null, screenOrientationDeg: 0, compassDeg: null, compassAccuracy: null });

  useEffect(() => {
    DeviceMotion.setUpdateInterval(16);
    const motionSub = DeviceMotion.addListener((m) => {
      if (m.rotation) {
        pose.current.rotation = { alpha: m.rotation.alpha, beta: m.rotation.beta, gamma: m.rotation.gamma };
        pose.current.screenOrientationDeg = m.orientation ?? 0;
      }
    });

    let headingSub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      headingSub = await Location.watchHeadingAsync((h) => {
        const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        pose.current.compassDeg = normalizeDeg(deg);
        pose.current.compassAccuracy = h.accuracy;
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
