// =============================================================================
// WHAT THIS FILE IS
//   The star chart. It decides where every star sits, from content.json alone.
//
// HOW TO READ IT
//   Nothing here is random. A star's place depends only on its position in the
//   list and (for schools of thought) its "distance" number, so editing the
//   wording never moves the sky. The chart faces the viewer like a wall map,
//   with a little depth so it reads as 3D when you orbit.
//
//     center      at the middle
//     anchors     close in, lower left and lower right
//     clusters    around the center: distance 0 sits near, distance 1 sits far
//     rings       one faint orbit per alignment word ("close", "middle", ...)
//     assumptions straight lines through the stars they connect
//     references  small stars tucked in beside the school that cites them
// =============================================================================

const DEG = Math.PI / 180;

export const RADIUS = {
  anchor: 6.2,
  clusterNear: 6, // a school with distance 0
  clusterSpan: 12, // added for distance 1
  reference: 3, // how far a reference sits from the school that cites it
  referenceCenter: 4.2, // the same, for references only the center and definitions cite
  squash: 0.78, // the chart is a little wider than it is tall
};

/** Where on each orbit its name is written: upper left, in the open space between two schools. */
export const ORBIT_LABEL_DEGREES = 122;

/**
 * Which side of a star its label goes on. Stars out to the left or right carry their label on
 * the outside, like a callout, so it never lies across the middle of the chart. The rest hang it below.
 */
export function labelSide(position) {
  if (position[0] > 4) return 'right';
  if (position[0] < -4) return 'left';
  return 'below';
}

/** Points that roughly cover the space a star's label takes up, so nothing else is put there. */
export function labelSpace(position, side) {
  const [x, y, z] = position;
  if (side === 'below') return [-2.6, 0, 2.6].map((dx) => [x + dx, y - 1.9, z]);
  const sign = side === 'right' ? 1 : -1;
  return [2, 4.2, 6.4].flatMap((reach) => [-0.7, 0.7].map((dy) => [x + sign * reach, y + dy, z]));
}

const round = (n) => Math.round(n * 1000) / 1000;
const vec = (x, y, z) => [round(x), round(y), round(z)];

/**
 * @param model the result of normalize() in content.js
 * @returns positions: Map of id to [x, y, z]
 *          paths:     Map of assumption id to { points, marker }
 *          owners:    Map of reference id to the id of the star it sits beside
 *          rings:     [{ label, distance, rx, ry }], one orbit per alignment word, nearest first
 */
export function computeLayout(model) {
  const positions = new Map();
  const paths = new Map();
  const { order, nodes } = model;

  if (order.center) positions.set(order.center, vec(0, 0, 0));

  // Definitions: lower left to lower right, just under the center.
  order.anchors.forEach((id, i) => {
    const n = order.anchors.length;
    const angle = (n === 1 ? 270 : 215 + (i * 110) / (n - 1)) * DEG;
    positions.set(id, vec(Math.cos(angle) * RADIUS.anchor, Math.sin(angle) * RADIUS.anchor, 0.8));
  });

  // Schools of thought: start at the top and go clockwise, radius set by "distance".
  order.clusters.forEach((id, i) => {
    const n = order.clusters.length;
    const angle = (90 - (i * 360) / n) * DEG;
    const r = RADIUS.clusterNear + nodes.get(id).distance * RADIUS.clusterSpan;
    positions.set(id, vec(Math.cos(angle) * r, Math.sin(angle) * r * RADIUS.squash, Math.sin(i * 2.4) * 2.2));
  });

  // Assumptions: straight lines through the stars each one connects, in the order listed.
  order.assumptions.forEach((id, index) => {
    const stops = nodes.get(id).connects.map((c) => positions.get(c)).filter(Boolean);
    if (stops.length < 2) return;
    const candidates = []; // places along the line where its clickable marker could sit
    for (let s = 0; s < stops.length - 1; s++) {
      for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
        candidates.push(vec(...[0, 1, 2].map((i) => stops[s][i] + (stops[s + 1][i] - stops[s][i]) * t)));
      }
    }
    // Put the marker on the stretch of line with the most elbow room: as far as possible
    // from every star and from the markers already placed, so no two click targets crowd each other.
    const taken = [order.center, ...order.anchors, ...order.clusters, ...order.assumptions.slice(0, index)]
      .map((other) => positions.get(other))
      .filter(Boolean);
    // Keep markers out from under the labels of the stars as well.
    for (const other of [order.center, ...order.anchors, ...order.clusters]) {
      const p = positions.get(other);
      if (p) taken.push(...labelSpace(p, order.clusters.includes(other) ? labelSide(p) : 'below'));
    }
    let marker = candidates[0];
    let best = -1;
    for (const c of candidates) {
      const room = Math.min(...taken.map((t) => Math.hypot(c[0] - t[0], c[1] - t[1])));
      if (room > best) {
        best = room;
        marker = c;
      }
    }
    paths.set(id, { points: stops.map((p) => [...p]), marker });
    positions.set(id, marker); // the small marker you click to read the assumption
  });

  // References: each sits beside the first school that cites it. One that only the center
  // or the definitions cite sits beside the center. Within that, it takes the spot with the
  // most elbow room, clear of other stars, of the lines, and of where the labels hang.
  const owners = new Map();
  for (const ref of order.references) {
    const school = order.clusters.find((c) => nodes.get(c).refs.includes(ref));
    if (school || order.center) owners.set(ref, school || order.center);
  }
  const obstacles = []; // [x, y, weight]: a heavier weight keeps references further away
  const labelled = [order.center, ...order.anchors, ...order.clusters].filter((id) => positions.has(id));
  for (const id of labelled) {
    const [x, y] = positions.get(id);
    obstacles.push([x, y, 1]);
    // Keep references out of the space where this star's label goes.
    const side = order.clusters.includes(id) ? labelSide(positions.get(id)) : 'below';
    for (const spot of labelSpace(positions.get(id), side)) obstacles.push([spot[0], spot[1], 1]);
  }
  for (const id of order.assumptions) if (positions.has(id)) obstacles.push([...positions.get(id).slice(0, 2), 1]);
  const alongLine = (a, b) => {
    const steps = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 1; k < steps; k++) obstacles.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps, 1.7]);
  };
  const center = positions.get(order.center);
  if (center) for (const id of [...order.anchors, ...order.clusters]) alongLine(center, positions.get(id));
  for (const { points } of paths.values()) for (let s = 0; s < points.length - 1; s++) alongLine(points[s], points[s + 1]);

  for (const ref of order.references) {
    const owner = positions.get(owners.get(ref));
    if (!owner) {
      positions.set(ref, vec(0, -20, -6)); // nothing cites it: park it out of the way, below the chart
      continue;
    }
    const isCenter = owners.get(ref) === order.center;
    const side = isCenter ? 'below' : labelSide(owner);
    const labelAt = { below: 270, right: 0, left: 180 }[side]; // the direction the owner's label takes up
    const reach = isCenter ? RADIUS.referenceCenter : RADIUS.reference;
    let spot = null;
    let best = -1;
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const off = Math.abs(((degrees - labelAt + 540) % 360) - 180);
      if (off < 65) continue; // leave that side clear for the label
      for (const r of [reach, reach + 1]) {
        const x = owner[0] + Math.cos(degrees * DEG) * r;
        const y = owner[1] + Math.sin(degrees * DEG) * r;
        const room = Math.min(...obstacles.map((o) => Math.hypot(x - o[0], y - o[1]) * o[2]));
        if (room > best + 1e-9) {
          best = room;
          spot = [x, y];
        }
      }
    }
    positions.set(ref, vec(spot[0], spot[1], owner[2] - 0.5));
    obstacles.push([spot[0], spot[1], 1]);
  }

  // Orbits: one per alignment word in content.json, at the average distance of the schools that use it.
  const groups = new Map();
  for (const id of order.clusters) {
    const { alignment, distance } = nodes.get(id);
    const key = String(alignment).trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { label: String(alignment).trim(), distances: [] });
    groups.get(key).distances.push(distance);
  }
  const rings = [...groups.values()]
    .map(({ label, distances }) => {
      const distance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
      const r = RADIUS.clusterNear + distance * RADIUS.clusterSpan;
      return { label, distance: round(distance), rx: round(r), ry: round(r * RADIUS.squash) };
    })
    .sort((a, b) => a.distance - b.distance);

  return { positions, paths, owners, rings };
}
