import { ShaderMaterial, type Texture } from 'three';

/**
 * Unlit material for archival imagery.
 * - `uOpacity`: the "time slider" (present ↔ past)
 * - `uHighlight`: tints everything outside `uRect` (the untouched archival pixels) so the AI reconstruction
 *   is always identifiable – our provenance guarantee in the UI.
 * Texture colour space is left raw and the shader outputs raw values, so no sRGB round-trip on expo-gl.
 */
export function createEchoMaterial(map: Texture, rect: [number, number, number, number] = [0, 0, 1, 1]) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: map },
      uOpacity: { value: 1 },
      uHighlight: { value: 0 },
      uRect: { value: rect },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      uniform float uHighlight;
      uniform vec4 uRect; // u0, v0, u1, v1
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uMap, vUv);
        bool archival = vUv.x > uRect.x && vUv.x < uRect.z && vUv.y > uRect.y && vUv.y < uRect.w;
        if (!archival && uHighlight > 0.5) {
          float stripe = step(0.5, fract((vUv.x * 900.0 + vUv.y * 220.0) * 0.5));
          c.rgb = mix(c.rgb, vec3(0.23, 0.56, 0.88), 0.38 + 0.12 * stripe);
        }
        gl_FragColor = vec4(c.rgb, c.a * uOpacity);
      }`,
  });
}
