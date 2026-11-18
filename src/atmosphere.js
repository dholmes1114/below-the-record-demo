// =============================================================================
// WHAT THIS FILE IS
//   The thinking half of the room "atmosphere": the colour and slow lights
//   that surround a room when you step inside a star. It turns a room's mood
//   (from rooms.json) into numbers: the colour of the dark, where each light
//   sits, and where it has drifted to at a given moment. No drawing happens
//   here (that is atmosphere-sky.js), so this file also runs in `npm run check`.
//   Only used when the `rooms` and `atmosphere` flags are both on.
//
// HOW TO READ IT
//   `moodSpec` is the recipe for one room. `lightDirection` says where one of
//   its lights is at a given second. The last part works out how readable
//   text stays over the brightest the surround is ever allowed to get.
// =============================================================================

export const ATMOSPHERE = {
  fadeSeconds: 1.2, // the same slow fade as the sky leaving; nothing flashes
  maxLights: 5,
  cap: 0.25, // the brightest any part of the surround may ever be (about half-grey on a screen), whatever the mood asks for
  loopSeconds: 60, // at "pace": 1, one slow swing of a light takes this long
  backing: [5, 7, 13], // the dark behind the room's words on a screen (the same dark as styles.css)
};

// Where each light sits to begin with: [how far round from straight ahead, how far above eye level], in radians.
// The first two flank the words, upper left and lower right; the others are behind and to the sides, for the headset.
const PLACES = [[-0.52, 0.2], [0.58, -0.14], [2.5, 0.22], [-2.1, 0.02], [1.5, 0.42]];

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** "#rrggbb" to [r, g, b] in linear light, 0 to 1 (what the graphics chip adds up in). */
export function hexToLinear(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
}

/** A repeatable stream of numbers from 0 to 1, started from a word, so a room looks the same every visit. */
function seededFrom(text) {
  let a = 2166136261;
  for (const ch of String(text)) a = Math.imul(a ^ ch.codePointAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The recipe for one room's atmosphere.
 * @param room     a room from normalizeRooms (its `mood` is a name, or '')
 * @param moods    the Map of moods from normalizeRooms
 * @param starHex  the room's star's own colour, "#rrggbb"
 * A room with no mood takes its star's colour: a dark wash of it, and one light.
 */
export function moodSpec(room, moods, starHex) {
  const mood = moods?.get(room.mood) ?? null;
  const star = hexToLinear(starHex);
  const wash = mood ? hexToLinear(mood.wash) : star.map((v) => v * 0.03);
  const colours = (mood ? mood.lights : ['star']).slice(0, ATMOSPHERE.maxLights).map((c) => (c === 'star' ? star : hexToLinear(c)));
  const glow = mood?.glow ?? 0.5;
  // A light keeps its colour's hue, and "glow" alone sets how bright its middle is: always under the cap, so a
  // pale colour never spreads into a flat, washed-out disc. A dark colour and a pale one glow equally.
  const strength = ATMOSPHERE.cap * (0.15 + 0.8 * glow);
  const lit = (c) => { const top = Math.max(c[0], c[1], c[2], 1e-6); return c.map((v) => (v / top) * strength); };
  const rand = seededFrom(room.id);
  const lights = colours.map((color, i) => ({
    color: lit(color),
    around: PLACES[i][0] + (rand() - 0.5) * 0.2,
    above: PLACES[i][1] + (rand() - 0.5) * 0.12,
    size: 0.7 + rand() * 0.25, // how wide the light is, middle to rim: about 40 to 54 degrees. Most of that is faint halo
    swing: 0.22 + rand() * 0.1, // how far it wanders
    phase: rand() * Math.PI * 2,
    rate: 0.8 + rand() * 0.4,
  }));
  return { id: room.id, mood: mood?.name ?? '', wash, lights, pace: mood?.pace ?? 0.5, glow };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

/**
 * "Straight ahead", "to the right" and "up" for placing the lights, from the direction the viewer is facing.
 * `level: true` (the headset) keeps the lights level with the floor however the head is tilted.
 */
export function basisFrom(forward, { level = false } = {}) {
  let f = [forward[0], level ? 0 : forward[1], forward[2]];
  if (Math.hypot(f[0], f[2]) < 1e-4) f = [0, 0, -1]; // facing straight up or down: fall back to "ahead"
  f = unit(f);
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f) };
}

/** Where one light is, `seconds` after the room opened: a direction [x, y, z] of length 1. */
export function lightDirection(light, seconds, pace, basis) {
  const turn = (pace * seconds * Math.PI * 2) / ATMOSPHERE.loopSeconds;
  const a = light.around + light.swing * Math.sin(turn * light.rate + light.phase);
  const e = light.above + light.swing * 0.45 * Math.cos(turn * light.rate * 0.7 + light.phase);
  const { f, r, u } = basis;
  const ca = Math.cos(e) * Math.cos(a);
  const sa = Math.cos(e) * Math.sin(a);
  const up = Math.sin(e);
  return [f[0] * ca + r[0] * sa + u[0] * up, f[1] * ca + r[1] * sa + u[1] * up, f[2] * ca + r[2] * sa + u[2] * up];
}

// ---- readability -----------------------------------------------------------
const brightness = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * The contrast (1 to 21; 4.5 is the usual minimum, 7 the stricter one) of text over the dark backing,
 * when the brightest light the surround is ever allowed to show sits right behind it.
 * @param text     the text colour as [r, g, b], each 0 to 255
 * @param backing  how solid the dark behind the words is, 0 to 1
 */
export function worstContrast(text, backing) {
  const dark = ATMOSPHERE.backing.map((v) => toLinear(v / 255));
  // Mixing happens in screen values, the way a browser lays one colour over another.
  const toScreen = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const behind = dark.map((d) => toLinear(toScreen(d) * backing + toScreen(ATMOSPHERE.cap) * (1 - backing)));
  const a = brightness(text.map((v) => toLinear(v / 255))) + 0.05;
  const b = brightness(behind) + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}
