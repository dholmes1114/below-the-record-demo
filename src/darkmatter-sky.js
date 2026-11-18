// =============================================================================
// WHAT THIS FILE IS
//   The drawing half of "dark matter": the faint, slowly shifting haze that
//   stands for nursing work the record never holds. Only loaded when the
//   `darkMatter` flag is on in config.json.
//
// HOW TO READ IT
//   Every item in darkmatter.json becomes a few overlapping soft patches with
//   no edges, all drawn in one go. They are hidden until `setRevealed(true)`,
//   which fades them in and makes every star lean a little toward them (the
//   leaning is worked out in darkmatter.js). Pointing at a patch, or choosing
//   it, shows its label faintly. `setRevealed(false)` puts everything back.
//   Nothing flashes: the fade takes a second and a half and the drift is slow.
// =============================================================================
import * as THREE from 'three';
import { makeLabel, seeded } from './sky.js';

const SMOKE = 0xc6ccdb; // pale, almost colourless: not any school's colour
const PATCHES = 4; // soft patches per item
const LABEL_FAINT = 0.62; // "at low opacity"

const VERTEX = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aSize;
  attribute vec3 aPhase;
  attribute float aAlpha;
  uniform float uTime;
  uniform float uReveal;
  varying vec2 vAcross;
  varying float vAlpha;
  void main() {
    // Each patch wanders slowly around its place and breathes a little.
    vec3 drift = vec3(sin(uTime * 0.11 + aPhase.x * 6.2832), cos(uTime * 0.09 + aPhase.y * 6.2832), sin(uTime * 0.07 + aPhase.z * 6.2832)) * aSize * 0.24;
    vec4 mv = modelViewMatrix * vec4(position + drift, 1.0);
    float worldScale = length(modelViewMatrix[0].xyz);
    float breathe = 1.0 + 0.12 * sin(uTime * 0.13 + aPhase.z * 6.2832);
    mv.xy += aCorner * aSize * breathe * worldScale; // always faces the viewer
    vAcross = aCorner;
    vAlpha = aAlpha * uReveal;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vAcross;
  varying float vAlpha;
  void main() {
    float d = dot(vAcross, vAcross);
    float soft = max(0.0, exp(-d * 3.4) - 0.0334) / 0.9666; // thickest in the middle, nothing at the rim: no edge to see
    gl_FragColor = vec4(uColor, soft * vAlpha);
    #include <colorspace_fragment>
  }
`;

/**
 * @param items    from normalizeDarkMatter
 * @param places   from placeDarkMatter: Map of id to [x, y, z]
 * @param offsets  from bendOffsets: how far each star leans when the haze is showing
 * @param sky      the sky from buildSky; the haze is added to it so it moves and scales with the chart
 */
export function buildDarkMatter({ items, places, offsets, sky, maxAnisotropy = 4, reducedMotion = false }) {
  const group = new THREE.Group();
  group.name = 'dark matter';
  const rand = seeded(2702);

  // ---- the haze: every patch of every item in one mesh ----------------------
  const count = items.length * PATCHES;
  const position = new Float32Array(count * 12);
  const corner = new Float32Array(count * 8);
  const size = new Float32Array(count * 4);
  const phase = new Float32Array(count * 12);
  const alpha = new Float32Array(count * 4);
  const index = [];
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  let n = 0;
  for (const item of items) {
    const p = places.get(item.id);
    for (let k = 0; k < PATCHES; k++, n++) {
      const centre = [p[0] + (rand() - 0.5) * 2.6, p[1] + (rand() - 0.5) * 2.2, p[2] + (rand() - 0.5) * 1.2];
      const s = 2.3 + rand() * 1.5;
      const a = 0.09 + rand() * 0.06;
      const ph = [rand(), rand(), rand()];
      for (let v = 0; v < 4; v++) {
        position.set(centre, (n * 4 + v) * 3);
        corner.set(CORNERS[v], (n * 4 + v) * 2);
        size[n * 4 + v] = s;
        alpha[n * 4 + v] = a;
        phase.set(ph, (n * 4 + v) * 3);
      }
      index.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geometry.setIndex(index);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uColor: { value: new THREE.Color(SMOKE) } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const haze = new THREE.Mesh(geometry, material);
  haze.frustumCulled = false;
  haze.renderOrder = -1; // behind the stars and their names
  haze.visible = false;
  group.add(haze);

  // ---- one invisible click target and one faint label per item ----------------
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const byId = new Map();
  for (const item of items) {
    const p = places.get(item.id);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 8), hitMaterial);
    hit.position.set(p[0], p[1], p[2]);
    hit.userData.id = item.id;
    hit.userData.isDarkMatter = true;
    hit.layers.set(1); // not clickable until the haze is showing
    const label = makeLabel(item.label, 'darkMatter', maxAnisotropy);
    label.position.set(p[0], p[1], p[2]);
    label.material.opacity = 0;
    label.visible = false;
    group.add(hit, label);
    sky.colliders.push(hit);
    byId.set(item.id, { item, hit, label, opacity: 0, pinned: false });
  }
  sky.root.add(group);

  const state = { revealed: false, reveal: 0, from: 0, t: 1, seconds: 1.5, hover: null };

  /** Show or hide the haze. Showing it also makes every star lean toward it; hiding lets them go back. */
  function setRevealed(on, { seconds = 1.5 } = {}) {
    on = Boolean(on);
    if (on === state.revealed) return;
    state.revealed = on;
    state.from = state.reveal;
    state.t = 0;
    state.seconds = seconds;
    for (const [id, by] of offsets) sky.setOffset(id, on ? by : null, { seconds: seconds > 0 ? 2 : 0 });
    for (const entry of byId.values()) {
      entry.hit.layers.set(on ? 0 : 1);
      if (!on) entry.pinned = false;
    }
    if (!on) state.hover = null;
  }

  /** Runs every frame, like the sky's own tick. */
  function tick(dt, time) {
    if (state.t < 1) {
      state.t = reducedMotion || !(state.seconds > 0) ? 1 : Math.min(1, state.t + dt / state.seconds);
      const e = state.t * state.t * (3 - 2 * state.t); // ease in, ease out
      const goal = state.revealed ? 1 : 0;
      state.reveal = state.t >= 1 ? goal : state.from + (goal - state.from) * e;
    }
    material.uniforms.uReveal.value = state.reveal;
    material.uniforms.uTime.value = reducedMotion ? 0 : time;
    haze.visible = state.reveal > 0.001;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
    for (const [id, entry] of byId) {
      const target = state.revealed && (entry.pinned || state.hover === id) ? LABEL_FAINT : 0;
      entry.opacity = Math.abs(target - entry.opacity) < 0.001 ? target : entry.opacity + (target - entry.opacity) * k;
      entry.label.material.opacity = entry.opacity * state.reveal;
      entry.label.visible = entry.label.material.opacity > 0.02;
      const b = entry.label.userData.baseScale;
      entry.label.scale.set(b[0] * sky.labelScale, b[1] * sky.labelScale, 1);
    }
  }

  sky.onHover = (id) => { state.hover = byId.has(id) ? id : null; };

  return {
    group,
    items,
    setRevealed,
    tick,
    get revealed() { return state.revealed; },
    /** Is this id one of the dark matter items (rather than a star)? */
    owns: (id) => byId.has(id),
    /** Choosing an item keeps its label showing; choosing it again lets it fade. */
    toggleLabel(id) { const e = byId.get(id); if (e) e.pinned = !e.pinned; return Boolean(e?.pinned); },
    showLabel(id) { const e = byId.get(id); if (e) e.pinned = true; },
    /** For checks. */
    labelOpacity: (id) => byId.get(id)?.label.material.opacity ?? 0,
    get strength() { return state.reveal; },
    place: (id) => byId.get(id)?.hit.position ?? null,
    /** Take the haze out of the sky completely (used when it is rebuilt with more items). Stars go straight back. */
    dispose() {
      for (const [id] of offsets) sky.setOffset(id, null, { seconds: 0 });
      for (const entry of byId.values()) {
        const i = sky.colliders.indexOf(entry.hit);
        if (i >= 0) sky.colliders.splice(i, 1);
        entry.hit.geometry.dispose();
        entry.label.material.map.dispose();
        entry.label.material.dispose();
      }
      sky.root.remove(group);
      geometry.dispose();
      material.dispose();
      sky.onHover = null;
    },
  };
}
