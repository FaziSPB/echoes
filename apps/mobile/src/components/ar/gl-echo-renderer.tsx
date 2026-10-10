import { angleDiffDeg, normalizeDeg, walkBlend } from '@echoes/shared';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber/native';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { CircleGeometry, Color, CylinderGeometry, DoubleSide, LinearFilter, type Group, type Mesh, NoColorSpace, PlaneGeometry, type Texture, TextureLoader } from 'three';
import { cameraHeadingDeg, deg2rad, smoothAngleDeg } from '@/lib/orientation';
import { createEchoMaterial } from './echo-material';
import type { EchoRendererProps } from './types';

/** Vertical FOV of a typical phone main camera in portrait full-screen preview. */
const CAMERA_VFOV = 63;
const PANO_RADIUS = 10;
const PHOTO_DISTANCE = 8;

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

/** Drives the camera from the device pose and keeps the world group aligned with real north. */
function Rig({ pose, alignment, manualYawDeg, photoHeadingDeg, world, onRelativeYaw }: Pick<EchoRendererProps, 'pose' | 'alignment' | 'manualYawDeg' | 'onRelativeYaw'> & { photoHeadingDeg: number; world: React.RefObject<Group | null> }) {
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

function PhotoPlane({ photo, opacity }: { photo: EchoRendererProps['photo']; opacity: number }) {
  const tex = useRawTexture(photo.url);
  const width = 2 * PHOTO_DISTANCE * Math.tan(deg2rad(photo.hfovDeg / 2));
  const height = (width * photo.height) / photo.width;
  const geometry = useMemo(() => new PlaneGeometry(width, height), [width, height]);
  const material = useMemo(() => createEchoMaterial(tex), [tex]);
  useEffect(() => {
    material.uniforms.uOpacity!.value = opacity;
  }, [material, opacity]);
  const y = PHOTO_DISTANCE * Math.tan(deg2rad(photo.pitchDeg));
  return <mesh geometry={geometry} material={material} position={[0, y, -PHOTO_DISTANCE]} renderOrder={2} />;
}

/**
 * Walk in time: frame a (behind us, enlarged by the dolly factor) under frame b (ahead, slightly shrunk) faded in by t.
 * The displayed distance eases towards the step-counted one, so each 0.7 m step glides instead of jumping.
 */
function WalkPlanes({ photo, walk }: { photo: EchoRendererProps['photo']; walk: NonNullable<EchoRendererProps['walk']> }) {
  const textures = useRawTextures(walk.frames.map((f) => f.url));
  const width = 2 * PHOTO_DISTANCE * Math.tan(deg2rad(photo.hfovDeg / 2));
  const height = (width * photo.height) / photo.width;
  const geometry = useMemo(() => new PlaneGeometry(width, height), [width, height]);
  const materials = useMemo(() => textures.map((t) => createEchoMaterial(t)), [textures]);
  const meshes = useRef<Array<Mesh | null>>([]);
  const target = useRef(walk.distanceM);
  target.current = walk.distanceM;
  const shown = useRef(walk.distanceM);
  const distances = useMemo(() => walk.frames.map((f) => f.distanceM), [walk.frames]);
  const y = PHOTO_DISTANCE * Math.tan(deg2rad(photo.pitchDeg));

  useFrame(() => {
    shown.current += (target.current - shown.current) * 0.08;
    const blend = walkBlend(distances, shown.current, walk.subjectDistanceM);
    meshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      const isA = i === blend.a;
      const isB = i === blend.b && blend.b !== blend.a;
      mesh.visible = isA || isB;
      if (!mesh.visible) return;
      mesh.scale.setScalar(isA ? blend.scaleA : blend.scaleB);
      mesh.renderOrder = isA ? 2 : 3;
      materials[i]!.uniforms.uOpacity!.value = isA ? 1 : blend.t;
    });
  });

  return (
    <>
      {materials.map((m, i) => (
        <mesh key={i} ref={(el) => void (meshes.current[i] = el)} geometry={geometry} material={m} position={[0, y, -PHOTO_DISTANCE]} />
      ))}
    </>
  );
}

function Scene(props: EchoRendererProps) {
  const world = useRef<Group>(null);
  const { photo, echo, mode, opacity, highlightAi, walk } = props;
  const showWalk = mode === 'walk' && walk !== null;
  const showPano = !showWalk && echo !== null && mode !== 'overlay';
  return (
    <>
      <Rig {...props} photoHeadingDeg={photo.headingDeg} world={world} />
      <group ref={world}>
        {/* Content lives in "true north" space: rotate by −heading so its centre faces the photo's bearing. */}
        <group rotation={[0, -deg2rad(photo.headingDeg), 0]}>
          <Suspense fallback={null}>
            {showWalk ? (
              <WalkPlanes photo={photo} walk={walk} />
            ) : showPano ? (
              <PanoCylinder echo={echo} opacity={mode === 'immersive' ? 1 : opacity} highlightAi={highlightAi} />
            ) : (
              <PhotoPlane photo={photo} opacity={opacity} />
            )}
          </Suspense>
        </group>
      </group>
    </>
  );
}

export function GlEchoRenderer(props: EchoRendererProps) {
  return (
    <Canvas
      style={StyleSheet.absoluteFill}
      camera={{ fov: CAMERA_VFOV, near: 0.1, far: 100, position: [0, 0, 0] }}
      gl={{ alpha: true, antialias: true }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0);
        scene.background = null;
      }}>
      <Scene {...props} />
    </Canvas>
  );
}
