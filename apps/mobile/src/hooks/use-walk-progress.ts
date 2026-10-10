import { angleDiffDeg, StepDetector } from '@echoes/shared';
import { DeviceMotion } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { cameraHeadingDeg } from '@/lib/orientation';
import type { DevicePose } from './use-device-pose';

const STRIDE_M = 0.7;
/** Steps only count while you look roughly along the path (direction you faced when the walk started). */
const HEADING_GATE_DEG = 60;

/**
 * Pedestrian dead reckoning for a ~10 m walk: GPS is ±5–10 m, so we count steps from linear acceleration instead.
 * Works the same on site and indoors in front of the jury. `setDistanceM` is the manual fallback (slider).
 */
export function useWalkProgress(pose: RefObject<DevicePose>, active: boolean, maxM: number) {
  const [distanceM, setDistanceM] = useState(0);
  const [steps, setSteps] = useState(0);
  const direction = useRef<number | null>(null);

  const reset = useCallback(() => {
    setDistanceM(0);
    setSteps(0);
    direction.current = null;
  }, []);

  useEffect(() => {
    if (!active) return;
    const detector = new StepDetector();
    const sub = DeviceMotion.addListener((m) => {
      const a = m.acceleration;
      if (!a) return;
      const cam = pose.current?.camera;
      const heading = cam ? cameraHeadingDeg(cam) : null;
      if (direction.current === null && heading !== null) direction.current = heading;
      if (!detector.push(a.x, a.y, a.z, Date.now())) return;
      if (heading === null || direction.current === null || Math.abs(angleDiffDeg(heading, direction.current)) > HEADING_GATE_DEG) return;
      setSteps((s) => s + 1);
      setDistanceM((d) => Math.min(maxM, d + STRIDE_M));
    });
    return () => sub.remove();
  }, [active, maxM, pose]);

  return { distanceM, steps, setDistanceM, reset };
}
