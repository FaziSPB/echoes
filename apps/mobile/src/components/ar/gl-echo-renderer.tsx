import { angleDiffDeg, archivalArc, normalizeDeg, scaleArc, walkBlend, type ArchivalArc } from '@echoes/shared';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber/native';
import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { CircleGeometry, Color, CylinderGeometry, DoubleSide, LinearFilter, type Group, type Mesh, NoColorSpace, type Texture, TextureLoader } from 'three';
import { cameraHeadingDeg, deg2rad, smoothAngleDeg } from '@/lib/orientation';
import { createEchoMaterial } from './echo-material';
import type { EchoRendererProps } from './types';

/** Vertical FOV of a typical phone main camera in portrait full-screen preview. */
const CAMERA_VFOV = 63;
const PANO_RADIUS = 10;
/** Archival / walk frames sit just inside the panorama so they draw over its archival region. */
const ARC_RADIUS = PANO_RADIUS * 0.985;
/** Never let the walk dolly push the camera through the cylinder wall. */
const MAX_DOLLY = 0.6;

function makeRaw(tex: Texture) {
  tex.colorSpace = NoColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
}

function useRawTexture(url: string) {
  const tex = useLoader(TextureLoader, url);
  useMemo(() => makeRaw(tex), [tex]);
  return tex;
}

function useRawTextures(urls: string[]) {
  const textures = useLoader(TextureLoader, urls);
  useMemo(() => textures.forEach(makeRaw), [textures]);
  return textures;
}

/** A cylinder segment matching the panorama's own projection, so archival pixels land exactly where the pano has them. */
function arcGeometry(arc: ArchivalArc, radius: number): CylinderGeometry {
  // Pano u = 0.5 + deg/360 maps to theta = u·2π, i.e. π + deg (u = 0.5 faces −Z after the mirror below).
  const g = new CylinderGeometry(radius, radius, arc.height * radius, 48, 1, true, Math.PI + deg2rad(arc.centerDeg - arc.widthDeg / 2), deg2rad(arc.widthDeg));
  g.scale(-1, 1, 1); // seen from inside, un-mirrored
  g.translate(0, arc.yCenter * radius, 0);
  return g;
}

/** Drives the camera from the device pose and keeps the world group aligned with real north. */
function Rig({ pose, alignment, manualYawDeg, photoHeadingDeg, world, onRelativeYaw }: Pick<EchoRendererProps, 'pose' | 'alignment' | 'manualYawDeg' | 'onRelativeYaw'> & { photoHeadingDeg: number; world: RefObject<Group | null> }) {
  const camera = useThree((s) => s.camera);
  const offsetDeg = useRef<number | null>(null); // true heading − scene-frame heading
  const anchoredFor = useRef<number | null>(null);
  const lastReported = useRef(0);

  useFrame(() => {
    const p = pose.current;
    if (!p?.camera) return;
    camera.quaternion.copy(p.camera); // already gyro-fused and smoothed in useDevicePose

    const deviceHeading = cameraHeadingDeg(p.camera);
    if (deviceHeading !== null) {
      if (alignment.kind === 'compass') {
        if (Platform.OS === 'android') {
          // The rotation vector is already magnetic-north referenced; only correct for declination.
          // (expo-location's heading follows the phone's top edge, which is meaningless when held upright.)
          offsetDeg.current = smoothAngleDeg(offsetDeg.current, p.declinationDeg ?? 0, 0.05);
        } else if (p.compassDeg !== null) {
          // iOS: DeviceMotion yaw has an arbitrary origin – tie it to the compass, very slowly.
          offsetDeg.current = smoothAngleDeg(offsetDeg.current, p.compassDeg - deviceHeading, 0.01);
        }
      } else if (alignment.kind === 'remote' && anchoredFor.current !== alignment.anchorToken) {
        // Pretend the user is facing the photo's direction right now.
        offsetDeg.current = normalizeDeg(photoHeadingDeg - deviceHeading);
        anchoredFor.current = alignment.anchorToken;
      }
    }
    if (world.current && offsetDeg.current !== null) {
      world.current.rotation.y = deg2rad(offsetDeg.current + manualYawDeg);
    }

    if (onRelativeYaw && deviceHeading !== null && offsetDeg.current !== null) {
      const now = Date.now();
      if (now - lastReported.current > 150) {
        lastReported.current = now;
        const viewTrue = deviceHeading + offsetDeg.current + manualYawDeg;
        onRelativeYaw(angleDiffDeg(photoHeadingDeg, viewTrue));
      }
    }
  });
  return null;
}

function PanoCylinder({ echo, opacity, highlightAi }: { echo: NonNullable<EchoRendererProps['echo']>; opacity: number; highlightAi: boolean }) {
  const tex = useRawTexture(echo.panoUrl);
  const height = (2 * Math.PI * PANO_RADIUS * echo.panoHeight) / echo.panoWidth;
  const geometry = useMemo(() => {
    const g = new CylinderGeometry(PANO_RADIUS, PANO_RADIUS, height, 128, 1, true);
    g.scale(-1, 1, 1); // view from inside, un-mirrored; u = 0.5 faces −Z
    return g;
  }, [height]);
  const r = echo.photoRect;
  const material = useMemo(
    () =>
      createEchoMaterial(tex, [
        r.x / echo.panoWidth,
        1 - (r.y + r.h) / echo.panoHeight,
        (r.x + r.w) / echo.panoWidth,
        1 - r.y / echo.panoHeight,
      ]),
    [tex, r.x, r.y, r.w, r.h, echo.panoWidth, echo.panoHeight],
  );
  useEffect(() => {
    material.uniforms.uOpacity!.value = opacity;
    material.uniforms.uHighlight!.value = highlightAi ? 1 : 0;
  }, [material, opacity, highlightAi]);

  const cap = useMemo(() => new CircleGeometry(PANO_RADIUS, 64), []);
  const sky = useMemo(() => new Color(echo.skyColor ?? '#d8d2c4'), [echo.skyColor]);
  const ground = useMemo(() => new Color(echo.groundColor ?? '#5a5248'), [echo.groundColor]);

  return (
    <group>
      <mesh geometry={geometry} material={material} renderOrder={1} />
      <mesh geometry={cap} position={[0, height / 2, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={0}>
        <meshBasicMaterial color={sky} transparent opacity={opacity} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh geometry={cap} position={[0, -height / 2, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={0}>
        <meshBasicMaterial color={ground} transparent opacity={opacity} side={DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The archival photo alone (no panorama generated yet). */
function ArchivalArcMesh({ url, arc, opacity }: { url: string; arc: ArchivalArc; opacity: number }) {
  const tex = useRawTexture(url);
  const geometry = useMemo(() => arcGeometry(arc, ARC_RADIUS), [arc]);
  const material = useMemo(() => createEchoMaterial(tex), [tex]);
  useEffect(() => {
    material.uniforms.uOpacity!.value = opacity;
  }, [material, opacity]);
  return <mesh geometry={geometry} material={material} renderOrder={2} />;
}

/**
 * Walk in time, inside the 360° scene. Frame k (captured d_k along the path) is drawn on the archival arc shrunk by
 * (D − d_k)/D; the camera dolly then magnifies it back to full size exactly when we stand at d_k. Between frames the
 * one ahead fades in over the one behind, with soft edges so they melt into the panorama.
 */
function WalkFrames({ walk, arc, shownM, opacity, highlightAi }: { walk: NonNullable<EchoRendererProps['walk']>; arc: ArchivalArc; shownM: RefObject<number>; opacity: number; highlightAi: boolean }) {
  const textures = useRawTextures(walk.frames.map((f) => f.url));
  const D = walk.subjectDistanceM;
  const distances = useMemo(() => walk.frames.map((f) => f.distanceM), [walk.frames]);
  const geometries = useMemo(() => walk.frames.map((f) => arcGeometry(scaleArc(arc, D, f.distanceM), ARC_RADIUS)), [walk.frames, arc, D]);
  const materials = useMemo(
    () => textures.map((t, i) => createEchoMaterial(t, walk.frames[i]!.generated ? [0, 0, 0, 0] : [0, 0, 1, 1], 0.06)),
    [textures, walk.frames],
  );
  useEffect(() => {
    materials.forEach((m) => (m.uniforms.uHighlight!.value = highlightAi ? 1 : 0));
  }, [materials, highlightAi]);
  const meshes = useRef<Array<Mesh | null>>([]);

  useFrame(() => {
    const blend = walkBlend(distances, shownM.current, D);
    meshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      const isA = i === blend.a;
      const isB = i === blend.b && blend.b !== blend.a;
      mesh.visible = isA || (isB && blend.t > 0.001);
      materials[i]!.uniforms.uOpacity!.value = opacity * (isA ? 1 : blend.t);
      mesh.renderOrder = isA ? 2 : 3;
    });
  });

  return (
    <>
      {materials.map((m, i) => (
        <mesh key={i} ref={(el) => void (meshes.current[i] = el)} geometry={geometries[i]} material={m} />
      ))}
    </>
  );
}

function Scene(props: EchoRendererProps) {
  const world = useRef<Group>(null);
  const dolly = useRef<Group>(null);
  const shownM = useRef(0);
  const { photo, echo, opacity, highlightAi, walk } = props;
  const walking = !!walk?.active;

  const arc = useMemo(
    () => archivalArc(photo, echo ? { width: echo.panoWidth, height: echo.panoHeight, rect: echo.photoRect } : null),
    [photo, echo],
  );

  // Ease the shown distance towards the step-counted one, and move the camera forward along the photo's heading
  // (content moves towards us): the panorama and the walk frames get the same D/(D−d) magnification.
  const targetM = walking ? walk!.distanceM : 0;
  useFrame(() => {
    shownM.current += (targetM - shownM.current) * 0.08;
    if (dolly.current && walk) dolly.current.position.z = Math.min(MAX_DOLLY, shownM.current / walk.subjectDistanceM) * PANO_RADIUS;
  });

  return (
    <>
      <Rig {...props} photoHeadingDeg={photo.headingDeg} world={world} />
      <group ref={world}>
        {/* Content lives in "true north" space: rotate by −heading so its centre faces the photo's bearing. */}
        <group rotation={[0, -deg2rad(photo.headingDeg), 0]}>
          <group ref={dolly}>
            <Suspense fallback={null}>
              {echo ? <PanoCylinder echo={echo} opacity={opacity} highlightAi={highlightAi} /> : null}
              {walking ? (
                <WalkFrames walk={walk!} arc={arc} shownM={shownM} opacity={opacity} highlightAi={highlightAi} />
              ) : echo ? null : (
                <ArchivalArcMesh url={photo.url} arc={arc} opacity={opacity} />
              )}
            </Suspense>
          </group>
        </group>
      </group>
    </>
  );
}

export function GlEchoRenderer(props: EchoRendererProps) {
  return (
    <Canvas
      style={StyleSheet.absoluteFill}
      camera={{ fov: CAMERA_VFOV, near: 0.05, far: 100, position: [0, 0, 0] }}
      gl={{ alpha: true, antialias: true }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0);
        scene.background = null;
      }}>
      <Scene {...props} />
    </Canvas>
  );
}
