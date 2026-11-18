// =============================================================================
// WHAT THIS FILE IS
//   The thinking half of the "step inside a star" rooms. It reads rooms.json
//   and holds the rules for walking through one room. No drawing happens here
//   (that is rooms-dom.js on a screen, and the reading board in the headset),
//   so this file also runs in `npm run check`.
//   Only used when the `rooms` flag is on in config.json.
//
// HOW TO READ IT
//   A room plays one beat at a time, and only when asked, so nothing appears
//   before there has been time to read and think:
//     the setting → each beat → the prompt (waits for the class to choose
//     A, B or C) → that choice's outcome → the reveal → the closing line,
//     which is the star's own first paragraph from content.json.
//   `createRoomRun` is that walk: advance, back, choose. `roomScreen` turns
//   where the walk has got to into the words to show, the same for the
//   screen and the headset.
// =============================================================================

const line = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Turn the raw rooms.json object into what the page uses. Never throws.
 *   rooms   Map of star id to that star's rooms, in the order written (a star can have several doors)
 *   all     every room, in order;  byId: Map of room id to room
 *   held    how many "play" rooms were left out because the playground switch is off
 *   moods   Map of mood name to its colours;  moodProblems: mistakes in moods, kept apart from `problems`
 *           because they only matter when the atmosphere switch is on
 * A room marked "play": true is one for exploring, not for the talk: it is only kept when `playground` is on.
 */
export function normalizeRooms(raw, model, { playground = false } = {}) {
  const out = { settings: { choiceKeys: ['A', 'B', 'C'], targetSecondsPerRoom: 75 }, rooms: new Map(), all: [], byId: new Map(), moods: new Map(), held: 0, problems: [], moodProblems: [], notes: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.rooms)) {
    out.problems.push('rooms.json should be { "rooms": [ ... ] }. No rooms are available.');
    return out;
  }
  const s = raw.settings ?? {};
  if (Array.isArray(s.choiceKeys) && s.choiceKeys.length) out.settings.choiceKeys = s.choiceKeys.map((k) => String(k).toUpperCase());
  if (Number.isFinite(s.targetSecondsPerRoom)) out.settings.targetSecondsPerRoom = s.targetSecondsPerRoom;
  const keys = out.settings.choiceKeys;
  out.moods = readMoods(raw.moods, out.moodProblems);

  raw.rooms.forEach((r, i) => {
    const where = `Room ${i + 1} in rooms.json${r?.id ? ` ("${r.id}")` : ''}`;
    if (!r || typeof r !== 'object' || !model.nodes.has(r.star)) {
      out.problems.push(`${where} names the star "${r?.star}", which does not exist. It was skipped.`);
      return;
    }
    const play = r.play === true;
    if (play && !playground) { out.held++; return; } // a play room waits for the playground switch
    const id = line(r.id) || `room-${r.star}-${i + 1}`;
    if (out.byId.has(id)) {
      out.problems.push(`${where} repeats the id "${id}". Every room needs its own id. This one was skipped.`);
      return;
    }
    const structureOnly = r.structureOnly === true; // a room still being written: its screen is built, its words are empty
    const beats = (Array.isArray(r.beats) ? r.beats : []).filter((b) => b && line(b.text)).map((b) => ({ t: line(b.t), text: line(b.text) }));
    const choices = keys.map((key) => ({ key, label: line(r.choices?.[key]?.label), outcome: line(r.choices?.[key]?.outcome) }));
    if (!structureOnly && (!line(r.prompt) || choices.some((c) => !c.label))) {
      out.problems.push(`${where} needs a prompt and a label for each of ${keys.join(', ')}. (Mark it "structureOnly": true while you are still writing it.)`);
      return;
    }
    // The closing line is the star's own words: the first paragraph of its text in content.json.
    const from = line(r.closing?.fromStar) || r.star;
    if (!model.nodes.has(from)) out.problems.push(`${where} takes its closing line from "${from}", which does not exist. It closes without one.`);
    const closing = model.nodes.get(from)?.paragraphs[0] ?? '';
    // Optional links to other features. "flatten": the numbered beat drains into the chosen box (the chart-it squeeze).
    let flattenBeat = null;
    if (r.flatten !== undefined) {
      const n = Number(r.flatten?.beat);
      if (Number.isInteger(n) && n >= 1 && n <= beats.length) flattenBeat = n - 1;
      else out.problems.push(`${where}: "flatten" should name a beat by number, 1 to ${beats.length}. It was ignored.`);
    }
    // "toDarkMatter": which choices leave the room for the dark matter. Either a list of letters (always those),
    // or the word "unchosen" (whichever ones the class did not choose).
    const driftUnchosen = line(r.toDarkMatter).toLowerCase() === 'unchosen';
    const toDarkMatter = Array.isArray(r.toDarkMatter) ? r.toDarkMatter.map((k) => String(k).toUpperCase()).filter((k) => keys.includes(k)) : [];
    if (r.toDarkMatter !== undefined && !driftUnchosen && !toDarkMatter.length) {
      out.problems.push(`${where}: "toDarkMatter" should be "unchosen" or a list of choice letters such as ["B", "C"]. It was ignored.`);
    }
    // "mood": the name of one of the moods at the top of rooms.json. It sets the room's colour and light when
    // the atmosphere switch is on. A room without one takes its star's own colour.
    let mood = line(r.mood);
    if (mood && !out.moods.has(mood)) {
      out.moodProblems.push(`${where} asks for the mood "${mood}", which is not in the "moods" list (${[...out.moods.keys()].join(', ') || 'the list is empty'}). It uses its star's colour for now.`);
      mood = '';
    }
    if (Number.isInteger(r.tourStop) && model.tour[r.tourStop - 1] !== r.star) {
      out.notes.push(`${where} says tour stop ${r.tourStop}, but "${r.star}" is not at that stop now. The room still works; the number is only a reminder.`);
    }
    const room = {
      id, star: r.star, play, title: line(r.title), setting: line(r.setting), beats,
      prompt: line(r.prompt), choices, reveal: line(r.reveal), closing, structureOnly,
      guide: structureOnly && Array.isArray(r.guide) ? r.guide.map(line).filter(Boolean) : [],
      flattenBeat, toDarkMatter, driftUnchosen, mood,
    };
    out.all.push(room);
    out.byId.set(id, room);
    if (!out.rooms.has(r.star)) out.rooms.set(r.star, []);
    out.rooms.get(r.star).push(room);
  });
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;
const unit = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/**
 * Read the "moods" block of rooms.json: Map of mood name to { wash, lights, pace, glow }.
 *   wash    the colour of the dark all round, "#rrggbb"
 *   lights  one to five colours for the slow lights; the word "star" means the star's own colour
 *   pace    0 (still) to 1: how fast the lights drift.   glow: 0 to 1: how bright they are.
 * A mood with a mistake in it is left out and named in `problems`.
 */
function readMoods(raw, problems) {
  const moods = new Map();
  if (raw === undefined) return moods;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('"moods" in rooms.json should be { "a-name": { "wash": "#101830", "lights": ["star"] } }. No moods are available.');
    return moods;
  }
  for (const [name, m] of Object.entries(raw)) {
    if (name.startsWith('_')) continue; // a note to the reader
    const lights = Array.isArray(m?.lights) ? m.lights.map(line) : [];
    const bad = lights.filter((c) => c !== 'star' && !HEX.test(c));
    if (!m || !HEX.test(line(m.wash)) || !lights.length || lights.length > 5 || bad.length) {
      problems.push(`The mood "${name}" in rooms.json needs a "wash" colour like "#101830" and one to five "lights", each a colour like "#3f7fd8" or the word "star"${bad.length ? ` (not "${bad[0]}")` : ''}. It was left out.`);
      continue;
    }
    moods.set(name, { name, wash: line(m.wash).toLowerCase(), lights: lights.map((c) => c.toLowerCase()), pace: unit(m.pace, 0.5), glow: unit(m.glow, 0.5) });
  }
  return moods;
}

/**
 * Which choices leave this room for the dark matter, given what the class chose (a letter, or null).
 * A room either names them outright, or says "unchosen": every choice except the one that was picked.
 */
export function drifts(room, choice) {
  if (room.driftUnchosen) return choice ? room.choices.filter((c) => c.key !== choice).map((c) => c.key) : [];
  return room.toDarkMatter;
}

/**
 * One walk through a room. Every method answers with what happened:
 *   'moved'    something new is showing
 *   'waiting'  the prompt is up and nobody has chosen yet
 *   'leave'    the walk is over: go back to the sky
 *   'no'       nothing to do (a key that is not a choice, or too early or late to choose)
 */
export function createRoomRun(room) {
  const steps = ['setting', ...room.beats.map((_, i) => `beat${i}`)];
  if (!room.structureOnly) {
    steps.push('prompt', 'outcome');
    if (room.reveal) steps.push('reveal');
    if (room.closing) steps.push('closing');
  }
  const where = (name) => steps.indexOf(name);
  let at = 0;
  let choice = null;
  return {
    advance() {
      if (steps[at] === 'prompt' && !choice) return 'waiting';
      if (at >= steps.length - 1) return 'leave';
      at++;
      return 'moved';
    },
    back() {
      if (at === 0) return 'no';
      at--;
      if (at < where('outcome')) choice = null; // stepping back to the prompt lets the class choose again
      return 'moved';
    },
    choose(key) {
      key = String(key).toUpperCase();
      if (room.structureOnly || !room.choices.some((c) => c.key === key)) return 'no';
      if (at < where('prompt') || at > where('outcome')) return 'no'; // only while the prompt, or its outcome, is the newest thing
      choice = key;
      at = where('outcome');
      return 'moved';
    },
    /** What is showing right now. */
    view() {
      const shows = (name) => where(name) >= 0 && at >= where(name);
      return {
        step: steps[at], beatsShown: Math.min(room.beats.length, at), showPrompt: shows('prompt'), choice,
        showOutcome: Boolean(choice) && shows('outcome'), showReveal: shows('reveal'), showClosing: shows('closing'),
        waiting: steps[at] === 'prompt' && !choice, first: at === 0, last: at === steps.length - 1,
      };
    },
  };
}

/**
 * The words to show for a room at this point in its walk. The screen and the headset both read this,
 * so they can never say different things. `t` is the phrase book (ui.js); `starLabel` is the star's name.
 */
export function roomScreen(room, view, t, starLabel) {
  const chosen = room.choices.find((c) => c.key === view.choice) ?? null;
  const leaving = view.showReveal ? drifts(room, view.choice) : [];
  return {
    room: true,
    kicker: t('rooms.kicker', { star: starLabel }),
    title: room.title,
    setting: room.setting,
    beats: room.beats.map((b, i) => ({ ...b, shown: i < view.beatsShown, flattened: Boolean(chosen) && room.flattenBeat === i })),
    prompt: room.prompt,
    showPrompt: view.showPrompt || room.structureOnly,
    choices: room.choices.map((c) => ({
      key: c.key, label: c.label,
      state: !chosen ? 'open' : c.key === chosen.key ? 'chosen' : 'other',
      drifting: leaving.includes(c.key), // it is leaving for the dark matter
    })),
    canChoose: !room.structureOnly && view.showPrompt && !view.showReveal,
    outcome: view.showOutcome ? chosen.outcome : '',
    chose: view.showOutcome ? t('rooms.chose', { key: chosen.key }) : '',
    reveal: view.showReveal ? room.reveal : '',
    closing: view.showClosing ? room.closing : '',
    waiting: view.waiting,
    first: view.first,
    last: view.last,
    // A room still being written shows its empty slots, and the writer's own notes for filling them.
    notes: room.structureOnly ? { heading: t('rooms.notWritten'), lines: room.guide } : null,
    // The room at its fullest (its longest outcome, its reveal and closing), used once to size the text so that
    // nothing has to shrink or move part-way through.
    fullest: {
      outcome: room.choices.reduce((longest, c) => (c.outcome.length > longest.length ? c.outcome : longest), ''),
      chose: t('rooms.chose', { key: room.choices[0]?.key ?? '' }), reveal: room.reveal, closing: room.closing,
    },
    // The newest thing on show, for a screen reader.
    newest: view.step === 'setting' ? room.setting
      : view.step.startsWith('beat') ? room.beats[view.beatsShown - 1]?.text ?? ''
        : view.step === 'prompt' ? room.prompt
          : view.step === 'outcome' ? chosen?.outcome ?? '' : view.step === 'reveal' ? room.reveal : room.closing,
  };
}

/** Fetch rooms.json. Always resolves; if anything goes wrong there are no rooms and `problems` says why. */
export async function loadRooms(url, model, options) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return normalizeRooms(JSON.parse(await res.text()), model, options);
  } catch (err) {
    const empty = normalizeRooms({ rooms: [] }, model, options);
    empty.problems.push(`rooms.json could not be read (${err.message}). No star can be stepped inside; the constellation itself is unaffected.`);
    return empty;
  }
}
