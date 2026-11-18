// =============================================================================
// WHAT THIS FILE IS
//   The thinking half of "dark matter": the nursing work that never enters the
//   record. It reads darkmatter.json, decides where each faint shape goes, and
//   works out how far each star leans toward it. No drawing happens here (that
//   is darkmatter-sky.js), so this file also runs in `npm run check`.
//
// HOW TO READ IT
//   normalizeDarkMatter  reads the list and reports anything odd, never crashes
//   placeDarkMatter      gives each item an open patch of sky, clear of the
//                        stars and their names (or beside a star you name)
//   bendOffsets          the "gravity": every star leans a little toward the
//                        hidden mass, so what is unrecorded visibly moves what
//                        is recorded
//   Only used when the `darkMatter` flag is on in config.json.
// =============================================================================
import { labelSide, labelSpace, ORBIT_LABEL_DEGREES } from './layout.js';

export const DARK = {
  reachX: 19, reachY: 13.5, // how far from the center a shape may sit: out to just past the last orbit
  keepOut: 4.5, // not this close to the center star
  depth: -1.6, // a little behind the chart
  pull: 1.7, // how strongly a star leans toward a shape right beside it, in sky units
  falloff: 4.5, // the lean fades with distance; at this distance it has halved
  most: 1.2, // no star ever leans further than this (about the width of a star's ring)
};

/** Turn the raw darkmatter.json object into { items, problems }. Never throws. */
export function normalizeDarkMatter(raw, model) {
  const out = { items: [], problems: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.items)) {
    out.problems.push('darkmatter.json should be { "items": [ ... ] }. Dark matter stays hidden.');
    return out;
  }
  const seen = new Set();
  raw.items.forEach((item, i) => {
    const where = `Item ${i + 1} in darkmatter.json`;
    if (!item || typeof item !== 'object' || typeof item.label !== 'string' || !item.label.trim()) {
      out.problems.push(`${where} needs a "label". It was skipped.`);
      return;
    }
    let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `dm-${i + 1}`;
    if (!id.startsWith('dm-')) id = `dm-${id}`; // keeps these ids apart from star ids
    if (seen.has(id)) {
      out.problems.push(`${where} repeats the id "${id}". It was skipped.`);
      return;
    }
    seen.add(id);
    let near = null;
    if (item.near !== undefined) {
      if (model?.nodes?.has(item.near)) near = item.near;
      else out.problems.push(`${where} says near "${item.near}", which is not a star. It was placed in open sky instead.`);
    }
    out.items.push({ id, label: item.label.trim(), near });
  });
  return out;
}

/**
 * Where each item sits: Map of id to [x, y, z].
 * Each takes the open patch with the most elbow room, clear of stars, of the space their names
 * take up, and of the shapes already placed. The same list always gives the same places.
 */
export function placeDarkMatter(items, model, layout) {
  const { order } = model;
  const obstacles = []; // [x, y, weight]: a heavier weight keeps shapes further away
  for (const [id, p] of layout.positions) {
    const main = id === order.center || order.anchors.includes(id) || order.clusters.includes(id);
    obstacles.push([p[0], p[1], main ? 1 : 0.8]);
    if (main) {
      const side = order.clusters.includes(id) ? labelSide(p) : 'below';
      for (const spot of labelSpace(p, side)) obstacles.push([spot[0], spot[1], 1]);
      // A long school name makes a long card; a patch's own label is wide too, so keep further off to that side.
      if (side !== 'below') for (const reach of [8.6, 10.8]) obstacles.push([p[0] + (side === 'right' ? reach : -reach), p[1], 1]);
    }
  }
  for (const ring of layout.rings ?? []) { // keep clear of the orbits' names too
    const at = (ORBIT_LABEL_DEGREES * Math.PI) / 180;
    obstacles.push([Math.cos(at) * ring.rx, Math.sin(at) * ring.ry, 1]);
  }
  const places = new Map();
  for (const item of items) {
    const anchor = item.near ? layout.positions.get(item.near) : null;
    let best = -1;
    let spot = [0, DARK.reachY * 0.6];
    for (let x = -DARK.reachX; x <= DARK.reachX; x += 1.5) {
      for (let y = -DARK.reachY; y <= DARK.reachY; y += 1.5) {
        if ((x / DARK.reachX) ** 2 + (y / DARK.reachY) ** 2 > 1) continue; // stay inside the chart
        if (Math.hypot(x, y) < DARK.keepOut) continue;
        if (anchor) {
          const d = Math.hypot(x - anchor[0], y - anchor[1]);
          if (d < 2.5 || d > 5.5) continue; // beside the named star, not on top of it
        }
        const room = Math.min(...obstacles.map((o) => Math.hypot(x - o[0], y - o[1]) * o[2]));
        if (room > best + 1e-9) {
          best = room;
          spot = [x, y];
        }
      }
    }
    places.set(item.id, [spot[0], spot[1], DARK.depth]);
    obstacles.push([spot[0], spot[1], 0.62]); // the next shape keeps well away from this one
  }
  return places;
}

/**
 * How far each star leans toward the hidden shapes: Map of star id to [dx, dy, dz].
 * Close to a shape the lean is about one unit (a star's ring is about that wide); far away it is almost nothing.
 * An assumption's marker leans with its line, so it stays on the line.
 */
export function bendOffsets(places, model, layout) {
  const shapes = [...places.values()];
  const lean = (p) => {
    const sum = [0, 0, 0];
    for (const s of shapes) {
      const d = [s[0] - p[0], s[1] - p[1], s[2] - p[2]];
      const dist = Math.hypot(...d);
      if (dist < 1e-6) continue;
      const strength = DARK.pull / (1 + (dist / DARK.falloff) ** 2);
      for (let i = 0; i < 3; i++) sum[i] += (d[i] / dist) * strength;
    }
    const length = Math.hypot(...sum);
    return length > DARK.most ? sum.map((v) => (v * DARK.most) / length) : sum;
  };
  const offsets = new Map();
  if (!shapes.length) return offsets;
  for (const [id, p] of layout.positions) if (!layout.paths.has(id)) offsets.set(id, lean(p));
  for (const [id, path] of layout.paths) {
    // Find which stretch of the line the marker sits on, and how far along it.
    const stops = model.nodes.get(id).connects.filter((c) => layout.positions.has(c));
    let found = { s: 0, t: 0.5, miss: Infinity };
    for (let s = 0; s < path.points.length - 1; s++) {
      const a = path.points[s];
      const b = path.points[s + 1];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((path.marker[0] - a[0]) * ab[0] + (path.marker[1] - a[1]) * ab[1] + (path.marker[2] - a[2]) * ab[2]) / len2));
      const miss = Math.hypot(a[0] + ab[0] * t - path.marker[0], a[1] + ab[1] * t - path.marker[1], a[2] + ab[2] * t - path.marker[2]);
      if (miss < found.miss) found = { s, t, miss };
    }
    const from = offsets.get(stops[found.s]) ?? [0, 0, 0];
    const to = offsets.get(stops[found.s + 1]) ?? [0, 0, 0];
    offsets.set(id, from.map((v, i) => v + (to[i] - v) * found.t));
  }
  return offsets;
}

/** Fetch darkmatter.json. Always resolves; if anything goes wrong there are no items and `problems` says why. */
export async function loadDarkMatter(url, model) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return normalizeDarkMatter(JSON.parse(await res.text()), model);
  } catch (err) {
    return { items: [], problems: [`darkmatter.json could not be read (${err.message}). Dark matter stays hidden; the constellation itself is unaffected.`] };
  }
}
