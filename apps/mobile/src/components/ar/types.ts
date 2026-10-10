import type { Rect } from '@echoes/shared';
import type { RefObject } from 'react';
import type { DevicePose } from '@/hooks/use-device-pose';

export type EchoMode = 'overlay' | 'echo' | 'immersive';

/** How the virtual scene's north is tied to the real world. */
export type Alignment =
  | { kind: 'compass' } // on site: compass sets north, user can fine-tune by dragging
  | { kind: 'remote'; anchorToken: number }; // elsewhere: photo is put in front of the user (re-anchored when the token changes)

export type EchoRendererProps = {
  mode: EchoMode;
  pose: RefObject<DevicePose>;
  alignment: Alignment;
  /** Extra yaw from the user's drag calibration (degrees, positive = rotate content left). */
  manualYawDeg: number;
  opacity: number;
  highlightAi: boolean;
  photo: { url: string; width: number; height: number; hfovDeg: number; pitchDeg: number; headingDeg: number };
  echo: { panoUrl: string; panoWidth: number; panoHeight: number; photoRect: Rect; skyColor: string | null; groundColor: string | null } | null;
  /** Reports the device heading (scene frame) so the UI can draw a "turn left/right" hint. */
  onRelativeYaw?: (photoMinusViewDeg: number | null) => void;
};
