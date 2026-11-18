// =============================================================================
// WHAT THIS FILE IS
//   The drawing half of the room "atmosphere": when you step inside a star,
//   the dark all round takes on a colour and a few wide, soft lights drift
//   slowly through it, so each room feels like its own place. Only loaded
//   when the `rooms` and `atmosphere` flags are both on.
//
// HOW TO READ IT
//   It is one very large ball drawn from the inside, so it surrounds the
//   viewer on a screen and in the headset alike, and costs one draw. Its
//   colour is worked out at each corner of the ball (cheap enough for the
//   headset) from the recipe in atmosphere.js. `enter` fades it in, `leave`
//   fades it out, and once it has gone it is taken away completely, so the
//   sky is left exactly as it was. It cannot be pointed at, and it sits
//   behind everything else. Nothing flashes: fades take over a second and
//   the lights take a minute or more to swing.
// =============================================================================
import * as THREE from 'three';
import { ATMOSPHERE, basisFrom, lightDirection } from './atmosphere.js';

const N = ATMOSPHERE.maxLights;

const VERTEX = /* glsl */ `
  uniform vec3 uWash;
  uniform vec3 uLight[LIGHTS];
  uniform vec3 uDir[LIGHTS];
  uniform float uSize[LIGHTS];
  varying vec3 vColor;
  void main() {
    vec3 d = normalize(position);
    // The wash is fullest round the horizon and deeper overhead and underfoot.
    vec3 col = uWash * mix(1.0, 0.45, smoothstep(0.0, 0.9, abs(d.y)));
    for (int i = 0; i < LIGHTS; i++) {
      // How far this point is from the light's middle, as a share of the light's width (0 middle, 1 rim).
      float x = acos(clamp(dot(d, uDir[i]), -1.0, 1.0)) / uSize[i];
      // A small bright heart inside a wide, faint halo, fading to nothing at the rim: a glow, with no disc and no edge.
      float g = (0.6 * exp(-x * x * 10.3) + 0.4 * exp(-x * x * 2.0)) * (1.0 - smoothstep(0.7, 1.0, x));
      col += uLight[i] * g;
    }
    // Each light is already under the cap (atmosphere.js). Where lights overlap they add up, so this is the
    // last guard: never brighter than the cap, dimmed evenly so the colour stays true.
    float top = max(col.r, max(col.g, col.b));
    vColor = col * min(1.0, CAP / max(top, 0.0001));
    // The ball turns with the view but never gets nearer or farther: it is always all round you.
    gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  }
`;
const FRAGMENT = /* glsl */ `
  uniform float uLevel;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, uLevel);
    #include <colorspace_fragment>
    // A fixed, very fine grain, so the dark shades into itself without visible steps. It does not move.
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor.rgb += (grain - 0.5) / 255.0;
  }
`;

/**
 * @param scene          the scene; the surround is added to it while a room is open, and removed afterwards
 * @param reducedMotion  true when the viewer has asked for less motion: the lights then stay still
 */
export function buildAtmosphere({ scene, reducedMotion = false }) {
  let mesh = null;
  let spec = null; // the recipe now showing
  let pending = null; // a different room entered while the last one was still fading out
  let basis = basisFrom([0, 0, -1]);
  let level = 0; // 0 gone, 1 fully there
  let target = 0;
  let startedAt = null;

  function build() {
    const material = new THREE.ShaderMaterial({
      defines: { LIGHTS: N, CAP: ATMOSPHERE.cap.toFixed(4) },
      uniforms: {
        uWash: { value: new THREE.Vector3() },
        uLight: { value: Array.from({ length: N }, () => new THREE.Vector3()) },
        uDir: { value: Array.from({ length: N }, () => new THREE.Vector3(0, 1, 0)) },
        uSize: { value: new Array(N).fill(1) },
        uLevel: { value: 0 },
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, side: THREE.BackSide,
    });
    mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 128, 64), material);
    mesh.name = 'room atmosphere';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000; // drawn first, so everything else is in front of it
    mesh.raycast = () => {}; // it can never be pointed at
    scene.add(mesh);
  }

  function apply(next) {
    spec = next.spec;
    basis = next.basis;
    startedAt = null;
    const u = mesh.material.uniforms;
    u.uWash.value.fromArray(spec.wash);
    for (let i = 0; i < N; i++) {
      const light = spec.lights[i];
      u.uLight.value[i].fromArray(light ? light.color : [0, 0, 0]);
      u.uSize.value[i] = light ? light.size : 1;
    }
    place(0);
  }

  function place(seconds) {
    const dirs = mesh.material.uniforms.uDir.value;
    spec.lights.forEach((light, i) => dirs[i].fromArray(lightDirection(light, seconds, spec.pace, basis)));
  }

  function remove() {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh = null;
    spec = null;
    pending = null;
    level = 0;
    target = 0;
  }

  return {
    /**
     * Fade the surround in for a room.
     * @param roomSpec  from moodSpec
     * @param forward   the direction the viewer is facing, [x, y, z]; the first two lights sit either side of it
     * @param level     true in the headset: keep the lights level with the floor
     */
    enter(roomSpec, forward = [0, 0, -1], { level: keepLevel = false } = {}) {
      const next = { spec: roomSpec, basis: basisFrom(forward, { level: keepLevel }) };
      if (!mesh) build();
      // Another room's surround is still fading out: let it finish, then bring this one in. Nothing jumps.
      if (spec && spec.id !== roomSpec.id && level > 0) { pending = next; target = 0; return; }
      if (!spec || spec.id !== roomSpec.id) apply(next);
      pending = null;
      target = 1;
    },
    leave() { pending = null; target = 0; },
    /** `forward` (on a screen): where the viewer is facing now, so the lights stay either side of the words even while the view is still gliding. */
    tick(dt, time, forward = null) {
      if (!mesh) return;
      const step = dt / ATMOSPHERE.fadeSeconds;
      level = target > level ? Math.min(target, level + step) : Math.max(target, level - step);
      if (level === 0 && target === 0) {
        if (!pending) { remove(); return; }
        apply(pending);
        pending = null;
        target = 1;
      }
      mesh.material.uniforms.uLevel.value = level * level * (3 - 2 * level); // eases in and out
      if (forward) basis = basisFrom(forward);
      if (reducedMotion) { if (forward) place(0); return; } // the lights do not drift; they only keep their places beside the words
      if (startedAt === null) startedAt = time;
      place(time - startedAt);
    },
    /** 0 (gone) to 1 (fully there). */
    get level() { return level; },
    /** True while the surround exists at all, even part-faded. */
    get showing() { return Boolean(mesh); },
    get object() { return mesh; },
    get spec() { return spec; },
    dispose: remove,
  };
}
