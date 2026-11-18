// =============================================================================
// WHAT THIS FILE IS
//   The sky itself: it draws every star, cloud, label and line, and decides
//   how bright each one is when something is selected.
//
// HOW TO READ IT
//   `buildSky` makes one group (`root`) holding everything:
//
//     stars     a bright core with a thin ring and a soft glow, plus an
//               invisible, generous "hit" sphere so you don't have to click a pinpoint
//     dust      thousands of tiny points, drawn in one go: a shell round the
//               center, a cloud in each school's own colour, a trail along each
//               spoke, and the dotted orbits that show distance from the center
//     spokes    one thin line from the center to each definition and school
//     lines     the assumptions: straight, faint until chosen, then gold
//     labels    schools get a small dark card; everything else is plain text
//
//   `setFocus(id)` is the spotlight: the chosen star and what it touches go
//   bright, the rest dims. `tick` runs every frame and eases toward those
//   targets, which is what makes it gentle.
//
//   Two more things later features build on, both idle unless something asks:
//
//     layers    `setLayer(name, ...)` is a dimmer laid over the spotlight. Each
//               feature gets its own named dimmer (one for the timeline, one
//               for a viewpoint, ...) and they multiply, so two features can dim
//               the same star without fighting. A star dimmed to nothing also
//               stops being clickable.
//     moving    `setLayout(...)` eases every star to a new arrangement and
//               `setOffset(id, ...)` nudges one star. Its cloud, its spoke and
//               any assumption line through it follow.
// =============================================================================
import * as THREE from 'three';
import { labelSide, ORBIT_LABEL_DEGREES } from './layout.js';

// My own position is warm (the center and the two definitions). Each school of thought has its
// own colour, like the threads of a research map. The one I push against is coral.
export const PALETTE = {
  background: 0x05060b,
  center: 0xfff0cf,
  anchor: 0xf5c680,
  schools: [0x3fd8c8, 0xa07cff, 0x5f93ff, 0xf27fc0, 0x7ddc8a, 0x62c8ff], // handed out in the order schools are listed
  contrast: 0xff6f61,
  line: 0xf5c680,
  orbit: 0x9aa6d8,
  ring: 0xfff1cf,
};
const LABEL_COLOR = {
  center: '#fff3d6', anchor: '#ffe0ac', cluster: '#eceef6', assumption: '#ffdca0', reference: '#d2d8ea', orbit: '#8d92a8',
  darkMatter: '#d5dae8',
  charted: '#cfd2da',
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

const SIZE = {
  // star = width of the star picture (its ring is about a quarter of that across), hit = radius of the
  // invisible click target, text = label line height. All in sky units.
  center: { star: 5.2, hit: 2.2, text: 0.95 },
  anchor: { star: 3.4, hit: 1.6, text: 1.0 },
  cluster: { star: 3.8, hit: 1.7, text: 0.88 },
  assumption: { star: 1.6, hit: 1.0, text: 0.72 },
  reference: { star: 1.5, hit: 1.1, text: 0.66 },
  orbit: { text: 0.6 },
  darkMatter: { text: 0.78 },
  charted: { text: 0.8 },
};
const BASE_OPACITY = { center: 1, anchor: 0.95, cluster: 0.92, assumption: 0.7, reference: 0.75 };
const CORE_RADIUS = 2.3; // the shell of dust around the center star

/** A repeatable stream of numbers from 0 to 1. Same seed, same sky, every time. */
export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft round glow, used for the far-away background stars. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return canvasTexture(c);
}

/** The picture of one star: a soft glow in its colour, a white core, and (for the main stars) a thin ring. */
function starTexture(color, withRing) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const tint = `${(color >> 16) & 255},${(color >> 8) & 255},${color & 255}`; // the colour as red, green, blue
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, `rgba(${tint},0.5)`);
  glow.addColorStop(0.3, `rgba(${tint},0.16)`);
  glow.addColorStop(1, `rgba(${tint},0)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  if (withRing) {
    g.strokeStyle = `rgba(${tint},0.95)`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(64, 64, 30, 0, Math.PI * 2);
    g.stroke();
  }
  const coreRadius = withRing ? 15 : 19;
  const core = g.createRadialGradient(64, 64, 0, 64, 64, coreRadius);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  core.addColorStop(1, `rgba(${tint},0)`);
  g.fillStyle = core;
  g.beginPath();
  g.arc(64, 64, coreRadius, 0, Math.PI * 2);
  g.fill();
  return canvasTexture(c);
}
const RING_FRACTION = 30 / 128; // the ring's radius as a share of the star picture's width

/** A thin circle, used to mark the selected star. */
function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  return canvasTexture(c);
}

/** Break a label into lines of about `max` characters, on spaces. */
function wrapLabel(text, max = 24) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundedRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * A text label as a sprite that always faces the viewer.
 * Schools get a "card": a dark rounded plate with a dot in the school's colour, so the name
 * stays readable over the dust. Everything else is plain text with a dark edge.
 */
export function makeLabel(text, kind, maxAnisotropy, cardColor = null) {
  const wrapAt = { center: 16, assumption: 20, reference: 18, charted: 16 }[kind] ?? 24;
  const lines = wrapLabel(text, wrapAt);
  const px = 56;
  const lineH = px * 1.2;
  const pad = cardColor ? 26 : 18;
  const dot = cardColor ? 44 : 0; // room on the left for the coloured dot
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `600 ${px}px ${FONT}`;
  g.font = font;
  const textWidth = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width)));
  c.width = textWidth + pad * 2 + dot;
  c.height = Math.ceil(lines.length * lineH + pad * 2);
  g.font = font;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  if (cardColor) {
    roundedRect(g, 2, 2, c.width - 4, c.height - 4, 30);
    g.fillStyle = 'rgba(12,14,24,0.8)';
    g.fill();
    g.strokeStyle = 'rgba(196,204,255,0.28)';
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = cardColor;
    g.beginPath();
    g.arc(pad + 13, pad + lineH / 2, 13, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = LABEL_COLOR[kind];
    lines.forEach((l, i) => g.fillText(l, pad + dot, pad + lineH * (i + 0.5)));
  } else {
    g.textAlign = 'center';
    lines.forEach((l, i) => {
      const y = pad + lineH * (i + 0.5);
      g.strokeStyle = 'rgba(5,6,11,0.94)'; // a dark edge keeps the words readable over dust and lines
      g.lineWidth = 12;
      g.strokeText(l, c.width / 2, y);
      g.fillStyle = LABEL_COLOR[kind];
      g.fillText(l, c.width / 2, y);
    });
  }
  const texture = canvasTexture(c);
  texture.anisotropy = maxAnisotropy;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  const h = (c.height / lineH) * SIZE[kind].text;
  sprite.userData.baseScale = [h * (c.width / c.height), h];
  sprite.scale.set(sprite.userData.baseScale[0], sprite.userData.baseScale[1], 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Thousands of tiny far-away stars, just for atmosphere. Seeded, so it is the same sky every time. */
export function makeStarfield(count = 1600) {
  const rand = seeded(708);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = 170 + rand() * 130;
    const s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
    const b = 0.2 + rand() * 0.5;
    col.set([b * 0.85, b * 0.92, b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.1, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}

// ---- dust ------------------------------------------------------------------
// Every speck is drawn in a single pass. Each one knows its size in sky units, so it shrinks
// correctly when the whole constellation is scaled down to room size in the headset, and it is
// sized against whichever picture is being drawn (the window, or one eye).
const DUST_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aPhase;
  uniform float uPixels; // height of the picture being drawn, in pixels
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float worldScale = length(modelViewMatrix[0].xyz);
    float px = aSize * worldScale * projectionMatrix[1][1] * uPixels * 0.5 / max(0.001, -mv.z);
    gl_PointSize = clamp(px, 1.0, 48.0);
    float twinkle = 0.84 + 0.16 * sin(uTime * 0.7 + aPhase * 6.2832);
    vAlpha = aAlpha * twinkle * min(1.0, px); // a speck smaller than one pixel fades rather than flickers
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }
`;
const DUST_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = max(0.0, 1.0 - d);
    gl_FragColor = vec4(vColor, a * a * vAlpha);
    #include <colorspace_fragment>
  }
`;

export function buildSky(model, layout, { maxAnisotropy = 4, reducedMotion = false } = {}) {
  const root = new THREE.Group();
  root.name = 'constellation';
  const colliders = [];
  const stars = new Map(); // id -> everything drawn for that star
  const lines = new Map(); // assumption id -> its line
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const state = { focus: null, hover: null, labelsAll: false, labelScale: 1 };
  let hoverListener = null; // told whenever the pointer moves onto or off something
  const textures = new Map();
  const starPicture = (color, withRing) => {
    const key = `${color}:${withRing}`;
    if (!textures.has(key)) textures.set(key, starTexture(color, withRing));
    return textures.get(key);
  };

  // ---- colours -------------------------------------------------------------
  const schoolColor = new Map();
  let handedOut = 0;
  for (const id of model.order.clusters) {
    const node = model.nodes.get(id);
    if (node.color) schoolColor.set(id, new THREE.Color(node.color).getHex());
    else if (String(node.alignment).toLowerCase() === 'contrast') schoolColor.set(id, PALETTE.contrast);
    else schoolColor.set(id, PALETTE.schools[handedOut++ % PALETTE.schools.length]);
  }
  const owners = layout.owners ?? new Map();
  const colorOf = (node) => {
    if (node.kind === 'cluster') return schoolColor.get(node.id);
    if (node.kind === 'assumption') return PALETTE.line;
    if (node.kind === 'reference') return schoolColor.get(owners.get(node.id)) ?? PALETTE.anchor; // a reference wears its school's colour
    return PALETTE[node.kind];
  };

  // ---- stars -------------------------------------------------------------
  for (const node of model.nodes.values()) {
    const p = layout.positions.get(node.id);
    if (!p) continue;
    const size = SIZE[node.kind];
    let starSize = size.star;
    if (node.kind === 'cluster') starSize = size.star - node.distance * 1.2; // closer schools shine bigger
    const color = colorOf(node);
    const main = node.kind === 'center' || node.kind === 'anchor' || node.kind === 'cluster';

    const group = new THREE.Group();
    group.position.set(p[0], p[1], p[2]);

    const glyph = new THREE.Sprite(new THREE.SpriteMaterial({
      map: starPicture(color, main), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glyph.scale.setScalar(starSize);

    const cardColor = node.kind === 'cluster' ? `#${new THREE.Color(color).getHexString()}` : null;
    const label = makeLabel(node.label, node.kind, maxAnisotropy, cardColor);
    const [labelW, labelH] = label.userData.baseScale;
    // The center's words sit over the lower half of its globe; everything else clears its own ring.
    const clear = (node.kind === 'center' ? 0.75 : starSize * RING_FRACTION) + 0.35;
    const beside = (dx) => label.center.set(dx > 0 ? -clear / labelW : 1 + clear / labelW, 0.5);
    if (node.kind === 'reference') {
      // A reference's name reads outward, away from the school it belongs to, like a callout.
      const o = layout.positions.get(owners.get(node.id)) ?? [0, 0, 0];
      const dx = p[0] - o[0];
      const dy = p[1] - o[1];
      if (Math.abs(dx) >= Math.abs(dy) * 0.6) beside(dx);
      else label.center.set(0.5, dy > 0 ? -clear / labelH : 1 + clear / labelH);
    } else if (node.kind === 'assumption') {
      label.center.set(0.5, -clear / labelH); // above its marker, clear of the words that hang under the stars
    } else if (node.kind === 'cluster' && labelSide(p) !== 'below') {
      beside(labelSide(p) === 'right' ? 1 : -1);
    } else {
      // The anchor point sits above the label's top edge, so the words hang under the star from any angle.
      label.center.set(0.5, 1 + clear / labelH);
    }

    const hit = new THREE.Mesh(new THREE.SphereGeometry(size.hit, 12, 8), hitMaterial);
    hit.userData.id = node.id;
    colliders.push(hit);

    group.add(glyph, label, hit);
    root.add(group);

    stars.set(node.id, {
      node, group, glyph, label, hit, starSize, color, alwaysLabelled: main, baseOpacity: BASE_OPACITY[node.kind],
      index: stars.size,
      origin: group.position.clone(), // where it stood when its dust was scattered
      base: group.position.clone(), // where the arrangement puts it now
      from: group.position.clone(), to: group.position.clone(), moveT: 1, moveSeconds: 0, // a move in progress
      offset: new THREE.Vector3(), offsetFrom: new THREE.Vector3(), offsetTarget: new THREE.Vector3(), offsetT: 1, offsetSeconds: 0, // a nudge on top of the arrangement
      veil: 1, // the layers' combined dimmer: 1 = untouched, 0 = gone
      chart: 0, kit: null, // "chart it": 0 = a full star, 1 = a flat checkbox; kit = the checkbox and its plain label, made on first use
      level: 1, levelTarget: 1, // brightness: 1 normal, above 1 highlighted, below 1 dimmed
      labelOpacity: main ? 1 : 0, labelTarget: main ? 1 : 0,
      grow: 1, growTarget: 1,
    });
    label.material.opacity = main ? 1 : 0;
    label.visible = main;
  }
  const starList = [...stars.values()];
  const centerStar = stars.get(model.order.center) ?? null;

  // ---- spokes: one thin line from the center to each definition and school -------------
  const spokes = [...model.order.anchors, ...model.order.clusters]
    .map((id) => stars.get(id))
    .filter((s) => s && centerStar);
  const spokePositions = new Float32Array(spokes.length * 6);
  const spokeColors = new Float32Array(spokes.length * 6);
  function writeSpokes() {
    spokes.forEach((s, i) => {
      const a = centerStar.group.position;
      const b = s.group.position;
      spokePositions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });
  }
  writeSpokes();
  const spokeGeometry = new THREE.BufferGeometry();
  spokeGeometry.setAttribute('position', new THREE.BufferAttribute(spokePositions, 3));
  spokeGeometry.setAttribute('color', new THREE.BufferAttribute(spokeColors, 3));
  root.add(new THREE.LineSegments(spokeGeometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));

  // ---- assumption lines ---------------------------------------------------
  /** The two shapes of one line through a list of points: the thin one you see and the fat one you can click. */
  function lineShapes(points) {
    const route = new THREE.CurvePath();
    for (let i = 0; i < points.length - 1; i++) route.add(new THREE.LineCurve3(points[i].clone(), points[i + 1].clone()));
    const segments = Math.max(8, Math.round(route.getLength() * 1.5));
    return [new THREE.TubeGeometry(route, segments, 0.04, 6), new THREE.TubeGeometry(route, Math.ceil(segments / 2), 0.4, 5)];
  }
  for (const [id] of layout.paths) {
    // A line runs through the stars it connects, wherever they are now, so it can follow them when they move.
    const through = model.nodes.get(id).connects.map((c) => stars.get(c)).filter(Boolean);
    const [seen, fat] = lineShapes(through.map((s) => s.group.position));
    const material = new THREE.MeshBasicMaterial({ color: PALETTE.line, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const core = new THREE.Mesh(seen, material);
    const hit = new THREE.Mesh(fat, hitMaterial);
    hit.userData.id = id;
    hit.userData.isLine = true;
    colliders.push(hit);
    root.add(core, hit);
    lines.set(id, { material, core, hit, through, level: 0.12, levelTarget: 0.12, veil: 1 });
  }
  /** Rebuild each line exactly through its stars' new places. Done once, when the moving stops. */
  function redrawLines() {
    for (const l of lines.values()) {
      const [seen, fat] = lineShapes(l.through.map((s) => s.group.position));
      l.core.geometry.dispose();
      l.hit.geometry.dispose();
      l.core.geometry = seen;
      l.hit.geometry = fat;
    }
  }
  /**
   * While stars are moving, slide each line's existing shape along with them. This re-uses the shape
   * already drawn (no rebuilding, which is the costly part), so a move stays smooth in the headset.
   */
  const slide = { centre: new THREE.Vector3(), along: new THREE.Vector3(), side: new THREE.Vector3(), up: new THREE.Vector3() };
  function slideLines() {
    const AROUND = 6; // the thin line is drawn as a tube with six sides
    for (const l of lines.values()) {
      const points = l.through.map((s) => s.group.position);
      const at = l.core.geometry.attributes.position;
      const rings = at.count / (AROUND + 1);
      const lengths = [];
      let total = 0;
      for (let i = 0; i < points.length - 1; i++) { lengths.push(points[i].distanceTo(points[i + 1])); total += lengths[i]; }
      for (let r = 0; r < rings; r++) {
        let rest = (r / (rings - 1)) * total;
        let leg = 0;
        while (leg < lengths.length - 1 && rest > lengths[leg]) { rest -= lengths[leg]; leg++; }
        slide.centre.lerpVectors(points[leg], points[leg + 1], lengths[leg] > 0 ? Math.min(1, rest / lengths[leg]) : 0);
        slide.along.subVectors(points[leg + 1], points[leg]).normalize();
        slide.side.set(0, 0, 1).cross(slide.along);
        if (slide.side.lengthSq() < 1e-6) slide.side.set(1, 0, 0);
        slide.side.normalize();
        slide.up.crossVectors(slide.along, slide.side);
        for (let j = 0; j <= AROUND; j++) {
          const a = (j / AROUND) * Math.PI * 2;
          const x = Math.cos(a) * 0.04;
          const y = Math.sin(a) * 0.04;
          at.setXYZ(r * (AROUND + 1) + j,
            slide.centre.x + slide.side.x * x + slide.up.x * y,
            slide.centre.y + slide.side.y * x + slide.up.y * y,
            slide.centre.z + slide.side.z * x + slide.up.z * y);
        }
      }
      at.needsUpdate = true;
      l.core.geometry.boundingSphere = null; // worked out again from the new places
    }
  }
  let linesBehind = false; // true while the lines are only slid along, not yet rebuilt exactly

  // ---- dust ---------------------------------------------------------------
  const rand = seeded(1114);
  const bell = () => (rand() + rand() + rand() + rand() - 2) * 1.732; // roughly a bell curve, mostly between -2 and 2
  // owner = star index, or -1 for the orbits. hold = how firmly a speck follows its owner when the owner moves:
  // 1 for a star's own cloud; along a spoke it runs from 0 (at the center) to 1 (at the star).
  const dust = { position: [], color: [], size: [], alpha: [], phase: [], owner: [], hold: [] };
  const tmp = new THREE.Color();
  function speck(x, y, z, hex, brightness, size, alpha, owner, whiten = 0, hold = 1) {
    tmp.setHex(hex).lerp(new THREE.Color(0xffffff), whiten).multiplyScalar(brightness);
    dust.position.push(x, y, z);
    dust.color.push(tmp.r, tmp.g, tmp.b);
    dust.size.push(size);
    dust.alpha.push(alpha);
    dust.phase.push(rand());
    dust.owner.push(owner);
    dust.hold.push(hold);
  }
  /** A cloud of specks around one star: most packed in close, the rest thinning out around it. */
  function cloud(star, count, spread, sizes = [0.1, 0.27]) {
    const c = star.group.position;
    for (let i = 0; i < count; i++) {
      const reach = spread * (rand() < 0.6 ? 0.5 : 1.15);
      speck(
        c.x + bell() * reach, c.y + bell() * reach, c.z + bell() * reach * 0.6,
        star.color, 0.65 + rand() * 0.35, sizes[0] + rand() * (sizes[1] - sizes[0]), 0.6 + rand() * 0.4, star.index,
        rand() < 0.08 ? 0.6 : 0,
      );
    }
  }
  for (const star of starList) {
    const kind = star.node.kind;
    const c = star.group.position;
    if (kind === 'center') {
      for (let i = 0; i < 620; i++) { // a shell, like a small glowing globe
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const r = CORE_RADIUS * (1 + bell() * 0.035);
        speck(c.x + Math.cos(a) * s * r, c.y + u * r, c.z + Math.sin(a) * s * r, star.color, 0.4 + rand() * 0.6, 0.09 + rand() * 0.12, 0.5 + rand() * 0.5, star.index);
      }
      cloud(star, 160, 0.8, [0.08, 0.18]);
    } else if (kind === 'anchor') cloud(star, 160, 1.1);
    else if (kind === 'cluster') cloud(star, Math.round(640 - star.node.distance * 300), 2.0 - star.node.distance * 0.5);
    else if (kind === 'reference') cloud(star, 22, 0.45, [0.07, 0.14]);
  }
  spokes.forEach((star) => { // a trail of specks along each spoke
    const a = centerStar.group.position;
    const b = star.group.position;
    const count = Math.round(a.distanceTo(b) * 2.4);
    for (let i = 0; i < count; i++) {
      const t = 0.14 + rand() * 0.8;
      speck(
        a.x + (b.x - a.x) * t + bell() * 0.1, a.y + (b.y - a.y) * t + bell() * 0.1, a.z + (b.z - a.z) * t + bell() * 0.1,
        star.color, 0.75, 0.08 + rand() * 0.07, 0.6, star.index, 0, t,
      );
    }
  });
  const orbitLabels = [];
  for (const ring of layout.rings ?? []) { // the dotted orbits that show distance from the center
    const count = Math.round((Math.PI * (ring.rx + ring.ry)) / 0.4);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      speck(Math.cos(a) * ring.rx, Math.sin(a) * ring.ry, 0, PALETTE.orbit, 0.8, 0.11, 0.75, -1);
    }
    const label = makeLabel(ring.label, 'orbit', maxAnisotropy);
    const at = THREE.MathUtils.degToRad(ORBIT_LABEL_DEGREES);
    label.position.set(Math.cos(at) * ring.rx, Math.sin(at) * ring.ry, 0);
    root.add(label);
    orbitLabels.push(label);
  }
  const dustCount = dust.owner.length;
  const dustAlphaBase = Float32Array.from(dust.alpha);
  const dustAlpha = new THREE.BufferAttribute(Float32Array.from(dust.alpha), 1);
  dustAlpha.setUsage(THREE.DynamicDrawUsage);
  const dustGeometry = new THREE.BufferGeometry();
  const dustHome = Float32Array.from(dust.position); // where each speck was scattered
  const dustPosition = new THREE.BufferAttribute(Float32Array.from(dust.position), 3);
  dustGeometry.setAttribute('position', dustPosition);
  dustGeometry.setAttribute('aColor', new THREE.BufferAttribute(Float32Array.from(dust.color), 3));
  dustGeometry.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from(dust.size), 1));
  dustGeometry.setAttribute('aPhase', new THREE.BufferAttribute(Float32Array.from(dust.phase), 1));
  dustGeometry.setAttribute('aAlpha', dustAlpha);
  const dustMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixels: { value: 800 }, uTime: { value: 0 } },
    vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const dustPoints = new THREE.Points(dustGeometry, dustMaterial);
  dustPoints.frustumCulled = false;
  const viewport = new THREE.Vector4();
  dustPoints.onBeforeRender = (renderer) => { // called once per picture: the window, or each eye in the headset
    dustMaterial.uniforms.uPixels.value = renderer.getCurrentViewport(viewport).w;
  };
  root.add(dustPoints);
  const dustLevel = new Float32Array(starList.length + 1).fill(-1); // the brightness last applied, per owner (last slot = the orbits)
  let ambient = 1; // brightness of the orbits and their words
  let ambientTarget = 1;
  let ambientVeil = 1; // the layers' dimmer for the orbits
  /** Carry every speck along with the star it belongs to. Only called when a star has moved. */
  function moveDust() {
    const out = dustPosition.array;
    const c = centerStar ? centerStar.group.position.clone().sub(centerStar.origin) : new THREE.Vector3();
    const d = new THREE.Vector3();
    for (let i = 0; i < dustCount; i++) {
      const owner = dust.owner[i];
      if (owner < 0) continue; // the orbits stay where they are
      const s = starList[owner];
      d.copy(s.group.position).sub(s.origin);
      const hold = dust.hold[i];
      out[i * 3] = dustHome[i * 3] + d.x * hold + c.x * (1 - hold);
      out[i * 3 + 1] = dustHome[i * 3 + 1] + d.y * hold + c.y * (1 - hold);
      out[i * 3 + 2] = dustHome[i * 3 + 2] + d.z * hold + c.z * (1 - hold);
    }
    dustPosition.needsUpdate = true;
  }

  // ---- the ring around the selected star -----------------------------------
  const ring = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ringTexture(), color: PALETTE.ring, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  ring.visible = false;
  root.add(ring);
  let ringOpacity = 0;

  // ---- who is related to whom ---------------------------------------------
  /** Everything a selected item touches: the stars an assumption connects, a star's assumptions and sources. */
  function relatedTo(id) {
    const out = new Set();
    const node = model.nodes.get(id);
    if (!node) return out;
    node.refs.forEach((r) => out.add(r));
    if (node.kind === 'assumption') node.connects.forEach((c) => out.add(c));
    for (const other of model.nodes.values()) {
      if (other.kind === 'assumption' && other.connects.includes(id)) out.add(other.id);
      if (node.kind === 'reference' && other.refs.includes(id)) out.add(other.id);
    }
    return out;
  }

  function retarget() {
    const focus = state.focus;
    const related = focus ? relatedTo(focus) : new Set();
    const focusKind = focus ? model.nodes.get(focus).kind : null;
    for (const [id, s] of stars) {
      const isFocus = id === focus;
      const isRelated = related.has(id);
      const isHover = id === state.hover;
      // Selecting the center star is the overview, so the rest only dims a little.
      const dim = focusKind === 'center' ? 0.75 : 0.25;
      s.levelTarget = !focus ? 1 : isFocus ? 1.5 : isRelated ? 1.2 : dim;
      if (isHover && !isFocus) s.levelTarget = Math.max(s.levelTarget, 1.3);
      s.growTarget = isFocus ? 1.25 : isHover ? 1.12 : 1;
      if (s.alwaysLabelled) s.labelTarget = !focus || isFocus || isRelated || isHover ? 1 : focusKind === 'center' ? 0.8 : 0.3;
      // An assumption is named in the sky only when it is the one chosen or pointed at; the reading panel
      // lists the others. Otherwise the middle fills with words. "All labels" names the references.
      else if (s.node.kind === 'assumption') s.labelTarget = isFocus || isHover ? 1 : 0;
      else s.labelTarget = isFocus || isRelated || isHover || state.labelsAll ? 1 : 0;
    }
    for (const [id, l] of lines) {
      // At rest the six lines are only a hint. One at a time comes forward when it is chosen.
      const touches = focus && (id === focus || related.has(id));
      l.levelTarget = !focus ? 0.12 : id === focus ? 1 : touches ? 0.55 : focusKind === 'center' ? 0.12 : 0.03;
      if (id === state.hover) l.levelTarget = Math.max(l.levelTarget, 0.8);
    }
    ambientTarget = !focus ? 1 : focusKind === 'center' ? 0.85 : 0.45;
    const s = focus && stars.get(focus);
    ring.visible = Boolean(s);
    if (s) ring.position.copy(s.group.position);
  }

  // ---- layers: named dimmers laid over the spotlight ---------------------------
  // Each layer holds a dimmer value from 0 to 1 for every star, every line and the orbits.
  const layers = new Map();
  const lineIds = [...lines.keys()];
  const unit = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1));
  const untouched = () => ({ stars: new Float32Array(starList.length).fill(1), lines: new Float32Array(lineIds.length).fill(1), ambient: 1 });
  function valuesFrom(spec) {
    const v = untouched();
    if (!spec) return v;
    const all = spec.all ?? 1;
    starList.forEach((s, i) => { v.stars[i] = unit(spec.stars?.[s.node.id] ?? all); });
    lineIds.forEach((id, i) => { v.lines[i] = unit(spec.lines?.[id] ?? all); });
    v.ambient = unit(spec.ambient ?? all);
    return v;
  }
  /** Something dimmed to (almost) nothing by the layers should not catch a click or a controller ray. */
  function updateClickable() {
    const reach = (pick) => { let v = 1; for (const layer of layers.values()) v *= pick(layer.to); return v > 0.05; };
    starList.forEach((s, i) => s.hit.layers.set(reach((to) => to.stars[i]) ? 0 : 1));
    lineIds.forEach((id, i) => lines.get(id).hit.layers.set(reach((to) => to.lines[i]) ? 0 : 1));
  }
  /**
   * Set (or with `null`, remove) one named dimmer.
   *   spec = { all: 0.2, stars: { 'a1': 1 }, lines: { 'a1': 1 }, ambient: 0.5 }
   * `all` is the level for anything not named; a star, line or the orbits (`ambient`) can be given its own.
   * 1 leaves it alone, 0 hides it. `seconds` is how long the change takes.
   */
  function setLayer(name, spec, { seconds = 0.6 } = {}) {
    let layer = layers.get(name);
    if (!layer) {
      if (!spec) return;
      layer = { now: untouched() };
      layers.set(name, layer);
    }
    layer.from = { stars: layer.now.stars.slice(), lines: layer.now.lines.slice(), ambient: layer.now.ambient };
    layer.to = valuesFrom(spec);
    layer.t = 0;
    layer.seconds = seconds;
    layer.leaving = !spec;
    updateClickable();
  }
  function tickLayers(dt) {
    if (!layers.size) return;
    const mix = (a, b, e) => (e >= 1 ? b : a + (b - a) * e);
    for (const [name, layer] of layers) {
      if (layer.t < 1) {
        layer.t = reducedMotion || !(layer.seconds > 0) ? 1 : Math.min(1, layer.t + dt / layer.seconds);
        const e = layer.t * layer.t * (3 - 2 * layer.t); // ease in, ease out
        for (let i = 0; i < starList.length; i++) layer.now.stars[i] = mix(layer.from.stars[i], layer.to.stars[i], e);
        for (let i = 0; i < lineIds.length; i++) layer.now.lines[i] = mix(layer.from.lines[i], layer.to.lines[i], e);
        layer.now.ambient = mix(layer.from.ambient, layer.to.ambient, e);
      }
      if (layer.leaving && layer.t >= 1) layers.delete(name);
    }
    starList.forEach((s, i) => { s.veil = 1; for (const layer of layers.values()) s.veil *= layer.now.stars[i]; });
    lineIds.forEach((id, i) => { const l = lines.get(id); l.veil = 1; for (const layer of layers.values()) l.veil *= layer.now.lines[i]; });
    ambientVeil = 1;
    for (const layer of layers.values()) ambientVeil *= layer.now.ambient;
  }

  // ---- charting: a star drained into a flat checkbox (the optional "chart it" feature) ----
  let checkbox = null; // one picture shared by every charted star
  function checkboxTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(16,18,26,0.92)';
    g.fillRect(22, 22, 84, 84);
    g.strokeStyle = LABEL_COLOR.charted;
    g.lineWidth = 7;
    g.strokeRect(22, 22, 84, 84);
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(40, 66); g.lineTo(57, 84); g.lineTo(90, 44);
    g.stroke();
    return canvasTexture(c);
  }
  /**
   * How charted a star is: 0 = the full glowing star, 1 = a flat grey checkbox with one plain line of text.
   * In between, its colour, glow, cloud and name drain away. Nothing extra is made for a star until it is first charted.
   */
  function setCharted(id, amount) {
    const s = stars.get(id);
    if (!s) return;
    amount = Math.min(1, Math.max(0, amount));
    if (amount > 0 && !s.kit) {
      const box = new THREE.Sprite(new THREE.SpriteMaterial({ map: (checkbox ??= checkboxTexture()), transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
      box.scale.setScalar(Math.max(1.1, s.starSize * RING_FRACTION * 2.3));
      box.renderOrder = 9;
      // The field's text, without a tick at the end: the star itself has become the tick box.
      const text = String(s.node.chartedAs || s.node.label).replace(/\s*[\u2610\u2611\u2612\u2713\u2714]\s*$/u, '');
      const flat = makeLabel(text, 'charted', maxAnisotropy);
      // Hang the new label on the same side of the star as the old one, the same distance away.
      const [oldW, oldH] = s.label.userData.baseScale;
      const [newW, newH] = flat.userData.baseScale;
      const same = (at, oldSize, newSize) => (at < 0 ? (at * oldSize) / newSize : at > 1 ? 1 + ((at - 1) * oldSize) / newSize : at);
      flat.center.set(same(s.label.center.x, oldW, newW), same(s.label.center.y, oldH, newH));
      flat.material.opacity = 0;
      s.group.add(box, flat);
      s.kit = { box, flat };
    }
    if (amount === 0 && s.kit) { // fully restored: take the checkbox and its label away again, so nothing is left behind
      s.group.remove(s.kit.box, s.kit.flat);
      s.kit.box.material.dispose();
      s.kit.flat.material.map.dispose();
      s.kit.flat.material.dispose();
      s.kit = null;
    }
    s.chart = amount;
  }

  // ---- moving --------------------------------------------------------------
  /** Ease every star to where a new arrangement (from computeLayout) puts it. */
  function setLayout(next, { seconds = 1.5 } = {}) {
    for (const s of starList) {
      const p = next.positions.get(s.node.id);
      if (!p) continue;
      s.from.copy(s.base);
      s.to.set(p[0], p[1], p[2]);
      if (s.from.equals(s.to)) continue;
      s.moveT = 0;
      s.moveSeconds = seconds;
    }
  }
  /** Nudge one star away from its place by [x, y, z] sky units; `null` lets it go back. `seconds` is how long it takes. */
  function setOffset(id, by, { seconds = 0.7 } = {}) {
    const s = stars.get(id);
    if (!s) return;
    const x = by?.[0] ?? 0, y = by?.[1] ?? 0, z = by?.[2] ?? 0;
    if (s.offsetTarget.x === x && s.offsetTarget.y === y && s.offsetTarget.z === z) return; // already going there
    s.offsetFrom.copy(s.offset);
    s.offsetTarget.set(x, y, z);
    s.offsetT = 0;
    s.offsetSeconds = seconds;
  }
  function tickMoves(dt, k) {
    let anyMoved = false;
    for (const s of starList) {
      let moved = false;
      if (s.moveT < 1) {
        s.moveT = reducedMotion || !(s.moveSeconds > 0) ? 1 : Math.min(1, s.moveT + dt / s.moveSeconds);
        const e = s.moveT * s.moveT * (3 - 2 * s.moveT);
        if (s.moveT >= 1) s.base.copy(s.to);
        else s.base.lerpVectors(s.from, s.to, e);
        moved = true;
      }
      if (s.offsetT < 1) { // a nudge runs on a fixed clock, so it ends when it says it will
        s.offsetT = reducedMotion || !(s.offsetSeconds > 0) ? 1 : Math.min(1, s.offsetT + dt / s.offsetSeconds);
        const e = s.offsetT * s.offsetT * (3 - 2 * s.offsetT);
        if (s.offsetT >= 1) s.offset.copy(s.offsetTarget);
        else s.offset.lerpVectors(s.offsetFrom, s.offsetTarget, e);
        moved = true;
      }
      if (moved) {
        s.group.position.copy(s.base).add(s.offset);
        anyMoved = true;
      }
    }
    if (anyMoved) {
      const stillMoving = starList.some((s) => s.moveT < 1 || s.offsetT < 1);
      writeSpokes();
      spokeGeometry.attributes.position.needsUpdate = true;
      if (stillMoving) slideLines();
      else redrawLines();
      linesBehind = stillMoving;
      moveDust();
    } else if (linesBehind) {
      redrawLines();
      linesBehind = false;
    }
  }

  // Easing settles exactly on its target once it is within a hair of it, so nothing keeps creeping forever.
  const ease = (current, target, k) => (reducedMotion || Math.abs(target - current) < 0.001 ? target : current + (target - current) * k);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Runs every frame. dt = seconds since the last frame, time = seconds since the page opened. */
  function tick(dt, time) {
    const k = 1 - Math.exp(-dt * 6);
    tickLayers(dt);
    tickMoves(dt, k);
    let dustChanged = false;
    for (const s of starList) {
      s.level = ease(s.level, s.levelTarget, k);
      s.grow = ease(s.grow, s.growTarget, k);
      s.labelOpacity = ease(s.labelOpacity, s.labelTarget, k);
      s.glyph.material.opacity = Math.min(1, s.baseOpacity * s.level) * s.veil;
      s.glyph.scale.setScalar(s.starSize * s.grow);
      s.label.material.opacity = s.labelOpacity * s.veil;
      s.label.visible = s.label.material.opacity > 0.02;
      const b = s.label.userData.baseScale;
      s.label.scale.set(b[0] * state.labelScale, b[1] * state.labelScale, 1);
      if (s.kit) { // being charted: the star and its name drain away as the flat checkbox and its field come in
        const c = s.chart;
        const stay = s.veil * clamp(s.level, 0.4, 1);
        s.glyph.material.opacity *= 1 - c;
        s.glyph.scale.setScalar(s.starSize * s.grow * (1 - 0.4 * c));
        s.label.material.opacity *= 1 - c;
        s.label.visible = s.label.material.opacity > 0.02;
        s.kit.box.material.opacity = c * stay;
        s.kit.box.visible = s.kit.box.material.opacity > 0.01;
        s.kit.flat.material.opacity = c * stay;
        s.kit.flat.visible = s.kit.flat.material.opacity > 0.02;
        const f = s.kit.flat.userData.baseScale;
        s.kit.flat.scale.set(f[0] * state.labelScale, f[1] * state.labelScale, 1);
      }
      // Compared as the stored (single-precision) number, so a settled sky is never rewritten.
      const cloudLevel = Math.fround(clamp(s.level, 0.2, 1.25) * s.veil * (1 - s.chart));
      if (cloudLevel !== dustLevel[s.index]) { dustLevel[s.index] = cloudLevel; dustChanged = true; }
    }
    ambient = ease(ambient, ambientTarget, k);
    const orbitLevel = Math.fround(ambient * ambientVeil);
    if (orbitLevel !== dustLevel[starList.length]) { dustLevel[starList.length] = orbitLevel; dustChanged = true; }
    if (dustChanged) {
      const out = dustAlpha.array;
      for (let i = 0; i < dustCount; i++) {
        const owner = dust.owner[i];
        out[i] = dustAlphaBase[i] * dustLevel[owner < 0 ? starList.length : owner];
      }
      dustAlpha.needsUpdate = true;
    }
    dustMaterial.uniforms.uTime.value = reducedMotion ? 0 : time;

    spokes.forEach((s, i) => { // each spoke follows the brightness of the star it leads to
      tmp.setHex(s.color).multiplyScalar(0.3 * clamp(s.level, 0.25, 1.4) * Math.min(s.veil, centerStar.veil) * (1 - 0.75 * s.chart));
      spokeColors.set([tmp.r * 0.5, tmp.g * 0.5, tmp.b * 0.5, tmp.r, tmp.g, tmp.b], i * 6);
    });
    spokeGeometry.attributes.color.needsUpdate = true;

    for (const l of lines.values()) {
      l.level = ease(l.level, l.levelTarget, k);
      l.material.opacity = Math.min(1, l.level) * l.veil;
    }
    for (const label of orbitLabels) {
      label.material.opacity = 0.85 * ambient * ambientVeil;
      const b = label.userData.baseScale;
      label.scale.set(b[0] * state.labelScale, b[1] * state.labelScale, 1);
    }
    const s = state.focus && stars.get(state.focus);
    ringOpacity = ease(ringOpacity, s ? 0.85 : 0, k);
    ring.material.opacity = ringOpacity * (s ? s.veil : 1);
    if (s) {
      ring.position.copy(s.group.position);
      const pulse = reducedMotion ? 1 : 1 + 0.04 * Math.sin(time * 1.6);
      const around = s.node.kind === 'center' ? CORE_RADIUS * 2.5 : Math.max(1.5, s.starSize * RING_FRACTION * 3.4);
      ring.scale.setScalar(around * pulse);
    }
  }

  retarget();
  return {
    root,
    colliders,
    tick,
    setFocus(id) { state.focus = id && stars.has(id) ? id : null; retarget(); },
    setHover(id) { if (state.hover !== id) { state.hover = id; retarget(); hoverListener?.(id); } },
    /** Another part of the page (dark matter) can ask to be told what the pointer is on. */
    set onHover(listener) { hoverListener = listener; },
    get labelScale() { return state.labelScale; },
    setLabelsAll(on) { state.labelsAll = on; retarget(); },
    setLabelScale(scale) { state.labelScale = scale; },
    setLayer,
    setLayout,
    setOffset,
    setCharted,
    /** A star's colour as "#rrggbb", for anything outside the sky that wants to match it (a room's accents). */
    colorHex(id) { const s = stars.get(id); return s ? `#${new THREE.Color(s.color).getHexString()}` : null; },
    /** Where a star sits inside the constellation (before the constellation itself is moved or scaled). */
    localPosition(id) { return stars.get(id)?.group.position ?? null; },
    get hover() { return state.hover; },
    /** For checks: how many specks of dust are drawn. */
    get dustCount() { return dustCount; },
  };
}

/**
 * From a list of ray hits on the colliders, choose the id to act on.
 * A star or marker wins over a line (and over a patch of dark matter), so neither steals a click from a star.
 */
export function pickId(hits) {
  if (!hits.length) return null;
  const star = hits.find((h) => !h.object.userData.isLine && !h.object.userData.isDarkMatter);
  return (star ?? hits[0]).object.userData.id ?? null;
}
