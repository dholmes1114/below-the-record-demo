// =============================================================================
// WHAT THIS FILE IS
//   The page checking itself. Add ?selftest to the address and it walks the
//   whole tour, fades the sky out and back, moves a star and puts it back, and
//   lists what passed. Add ?selftest&emulate and it also does the tour inside a
//   pretend Quest 2. It changes nothing and sends nothing.
//
// HOW TO READ IT
//   `fingerprint` reduces everything drawn in the sky (where each star is, how
//   bright, which labels show) to one short code, like a checksum on a
//   medication label. If two fingerprints match, the two skies are the same.
//   `runSelfTest` is the list of checks, top to bottom, in plain words.
//   This file is only loaded when ?selftest is in the address.
// =============================================================================
import * as THREE from 'three';
import { computeLayout } from './layout.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
/** Add up a list of numbers so that swapping two of them changes the answer. */
function weighedSum(array) {
  let s = 0;
  for (let i = 0; i < array.length; i++) s += array[i] * (1 + (i % 7));
  return Math.round(s * 100) / 100;
}
function shortCode(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** The one object that draws all the dust. */
function dustOf(c) {
  let found = null;
  c.sky.root.traverse((o) => { if (o.isPoints) found = o.geometry; });
  return found;
}

/** Let every fade and move finish at once, so a check never depends on timing. */
function settle(c) {
  c.chart?.tick(10);
  for (let i = 0; i < 2; i++) {
    c.sky.tick(10, 0);
    c.dark?.tick(10, 0);
    c.atmosphere?.tick(10, 0);
  }
}

/**
 * One short code for everything drawn in the sky right now.
 * `lines` is the long form (one line per drawn thing), for finding what differs when two codes don't match.
 */
export function fingerprint(c) {
  settle(c);
  const lines = [];
  c.sky.root.traverse((o) => {
    if (o === c.sky.root) return;
    if (!o.visible) { lines.push(`${o.type}|hidden`); return; }
    const m = o.material;
    const g = o.geometry;
    const at = g?.attributes ?? {};
    const parts = [
      o.type, o.position.toArray().map(r3), o.scale.toArray().map(r3),
      m ? `${r3(m.opacity ?? 1)}/${m.color ? m.color.getHexString() : '-'}/${m.visible}` : '-',
      at.position ? `${at.position.count}:${weighedSum(at.position.array)}` : '-',
    ];
    for (const name of ['aAlpha', 'aColor', 'aSize', 'color']) if (at[name]) parts.push(`${name}${weighedSum(at[name].array)}`);
    if (o.isSprite) parts.push(o.center.toArray().map(r3));
    lines.push(parts.join('|'));
  });
  lines.sort();
  return { code: `${shortCode(lines.join('\n'))}:${lines.length}`, lines };
}

/** Fingerprints of the sky at rest, at every tour stop, and in a few other states. Used to compare two versions of the code. */
export function snapshotAll(c) {
  const out = {};
  c.close(); c.sky.setHover(null); c.sky.setLabelsAll(false);
  out.idle = fingerprint(c).code;
  c.model.tour.forEach((id, i) => { c.goTo(i); out[`stop${i + 1}`] = fingerprint(c).code; });
  c.close();
  out.closed = fingerprint(c).code;
  const { clusters, assumptions, references } = c.model.order;
  if (clusters.length) { c.sky.setHover(clusters[clusters.length - 1]); out.hoverStar = fingerprint(c).code; }
  if (assumptions.length) { c.sky.setHover(assumptions[0]); out.hoverLine = fingerprint(c).code; }
  c.sky.setHover(null);
  c.sky.setLabelsAll(true); out.allLabels = fingerprint(c).code; c.sky.setLabelsAll(false);
  if (references.length) { c.select(references[0]); out.reference = fingerprint(c).code; c.close(); }
  out.dust = c.sky.dustCount;
  out.clickTargets = c.sky.colliders.length;
  return out;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runSelfTest(c) {
  const results = [];
  const errors = [];
  const onError = (e) => errors.push(String(e.message || e.reason?.message || e.reason || e));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : detail });
  const note = (name, detail) => results.push({ name, ok: null, detail });
  const tour = c.model.tour;
  const panelTitle = () => document.getElementById('panel-title')?.textContent ?? '';

  /** Step through the tour with Next and say which stops, if any, did not land on the right star. */
  function walkTour(readsPanel) {
    const wrong = [];
    c.goTo(0);
    tour.forEach((id, i) => {
      if (i) c.next();
      const label = c.model.nodes.get(id).label;
      if (c.state.selected !== id || c.state.tourIndex !== i || (readsPanel && panelTitle() !== label)) wrong.push(i + 1);
    });
    return wrong;
  }

  // ---- on a normal screen -------------------------------------------------
  let wrong = walkTour(true);
  check(`The tour reaches all ${tour.length} stops in order`, !wrong.length, `wrong at stop ${wrong.join(', ')}`);
  for (let i = tour.length - 1; i > 0; i--) c.prev();
  check('Back steps all the way to the first stop', c.state.tourIndex === 0 && c.state.selected === tour[0]);

  const unread = [...c.model.nodes.values()].filter((n) => { c.select(n.id); return panelTitle() !== n.label; });
  check(`Every star opens its own panel (${c.model.nodes.size} stars)`, !unread.length, unread.map((n) => n.id).join(', '));
  c.close();
  check('Closing puts the panel away', document.getElementById('panel').hidden && c.state.selected === null);

  c.sky.setHover(null);
  let rest = fingerprint(c).code;

  // ---- fading: every part of the sky can be dimmed to nothing and brought back ----
  c.sky.setLayer('selftest', { all: 0 }, { seconds: 0 });
  settle(c);
  const lit = [];
  c.sky.root.traverse((o) => {
    if (!o.visible || !o.material || o.material.visible === false) return;
    const at = o.geometry?.attributes ?? {};
    if (o.isPoints) { if (at.aAlpha.array.some((a) => a > 0.001)) lit.push('dust'); }
    else if (o.isLineSegments) { if (at.color.array.some((v) => v > 0.001)) lit.push('spokes'); }
    else if (o.material.opacity > 0.001) lit.push(o.type);
  });
  check('The whole sky can fade out', !lit.length, `still showing: ${[...new Set(lit)].join(', ')}`);
  const stillClickable = c.sky.colliders.filter((h) => h.layers.mask & 1).length;
  check('A faded-out star cannot be clicked', stillClickable === 0, `${stillClickable} still clickable`);
  /** Aim a real pointing ray from the camera at a star and say whether it lands on that star. */
  const rayFinds = (id, place = c.sky.localPosition(id)) => {
    c.sky.root.updateMatrixWorld(true);
    const from = c.camera.getWorldPosition(new THREE.Vector3());
    const to = place.clone().applyMatrix4(c.sky.root.matrixWorld);
    const ray = new THREE.Raycaster(from, to.sub(from).normalize());
    return ray.intersectObjects(c.sky.colliders, false).some((h) => h.object.userData.id === id);
  };
  const aim = c.model.order.clusters[0] ?? tour[0];
  const missedWhileFaded = !rayFinds(aim);
  c.sky.setLayer('selftest', null, { seconds: 0 });
  check('The sky comes back exactly as it was', fingerprint(c).code === rest);
  check('A pointing ray passes through a faded star and lands on it again afterwards', missedWhileFaded && rayFinds(aim));

  // A fade that takes time: partway there partway through, and exactly there at the end.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dustNow = () => weighedSum(dustOf(c).attributes.aAlpha.array);
  const full = dustNow();
  c.sky.setLayer('selftest', { all: 0 }, { seconds: 1.5 });
  c.sky.tick(0.5, 0);
  const partway = dustNow();
  c.sky.tick(0.5, 0); c.sky.tick(0.5, 0); c.sky.tick(0.05, 0);
  check('A 1.5 second fade is partway at half a second and finished at the end', (reduced || (partway > 0 && partway < full)) && dustNow() === 0, `full ${full}, partway ${partway}, end ${dustNow()}`);
  c.sky.setLayer('selftest', null, { seconds: 0 });
  check('The sky comes back exactly after a timed fade', fingerprint(c).code === rest);

  c.sky.setLayer('selftest', { all: 1, stars: { [tour[0]]: 0 } }, { seconds: 0 });
  settle(c);
  check('One star can be faded by itself', c.sky.colliders.filter((h) => !h.userData.isDarkMatter && !(h.layers.mask & 1)).length === 1);
  c.sky.setLayer('selftest', null, { seconds: 0 });

  // ---- moving: a star can be nudged, the whole chart can re-arrange, and both undo cleanly ----
  const school = c.model.order.clusters[0];
  if (school) {
    const before = c.sky.localPosition(school).clone();
    c.sky.setOffset(school, [3, 2, 0]);
    const nudged = fingerprint(c).code;
    check('A star can be moved', c.sky.localPosition(school).distanceTo(before) > 3 && nudged !== rest);
    c.sky.setOffset(school, null);
    check('The moved star returns exactly', fingerprint(c).code === rest);

    const nodes = new Map([...c.model.nodes].map(([id, n]) => [id, { ...n }]));
    nodes.get(school).distance = nodes.get(school).distance > 0.5 ? 0.1 : 0.9;
    c.sky.setLayout(computeLayout({ ...c.model, nodes }), { seconds: 0 });
    check('The chart can re-arrange (a school changes distance)', fingerprint(c).code !== rest);
    c.sky.setLayout(c.layout, { seconds: 0 });
    check('The chart returns to its own arrangement exactly', fingerprint(c).code === rest);

    // A move that takes time: on the way at half a second, arrived exactly at the end.
    const moved = computeLayout({ ...c.model, nodes });
    const goal = new THREE.Vector3(...moved.positions.get(school));
    const whole = before.distanceTo(goal);
    c.sky.setLayout(moved, { seconds: 1.5 });
    c.sky.tick(0.5, 0);
    const left = c.sky.localPosition(school).distanceTo(goal);
    c.sky.tick(0.5, 0); c.sky.tick(0.5, 0); c.sky.tick(0.05, 0);
    check('A 1.5 second move is on its way at half a second and arrives exactly', (reduced || (left > 0 && left < whole)) && c.sky.localPosition(school).distanceTo(goal) === 0);
    c.sky.setLayout(c.layout, { seconds: 0 });
    check('The chart returns exactly after a timed move', fingerprint(c).code === rest);
  }

  // ---- the grip buttons, by sending the same signal the headset sends -----------
  const hands = c.sky.root.parent.children.filter((o) => o.userData?.ray);
  if (hands.length === 2) {
    const [grip] = hands;
    const squeeze = (hand, hit) => { grip.userData.hand = hand; grip.userData.hit = hit; grip.dispatchEvent({ type: 'squeezestart' }); };
    const letGo = () => grip.dispatchEvent({ type: 'squeezeend' });
    c.goTo(2);
    squeeze('right', null); letGo();
    const forward = c.state.tourIndex === 3;
    squeeze('left', null); letGo();
    check('The grips step the tour on empty sky: right is next, left is back', forward && c.state.tourIndex === 2);
    const aimed = c.model.order.clusters[0];
    squeeze('right', { id: aimed });
    if (c.chart) {
      c.chart.tick(0.5);
      const squeezing = c.chart.amount(aimed) > 0 && c.state.tourIndex === 2 && c.state.selected === aimed;
      letGo();
      c.chart.tick(2);
      check('With charting on, the grip on a star squeezes that star and letting go releases it', squeezing && c.chart.amount(aimed) === 0);
    } else {
      letGo();
      check('The grip on a star still steps the tour', c.state.tourIndex === 3);
    }
    grip.userData.hand = 'none';
    grip.userData.hit = null;
    c.close();
    settle(c);
  }

  if (!c.rooms && hands.length) { // with the rooms off, a second trigger pull on the open star just keeps it open
    const [hand] = hands;
    const star = c.model.order.clusters[0];
    hand.userData.hit = { id: star }; hand.dispatchEvent({ type: 'select' });
    hand.userData.hit = { id: star }; hand.dispatchEvent({ type: 'select' });
    hand.userData.hit = { panel: true, uv: { x: 0.5, y: 0.5 } }; hand.dispatchEvent({ type: 'select' });
    const stays = c.state.selected === star && !c.room;
    hand.userData.hit = null; hand.dispatchEvent({ type: 'select' });
    check('The trigger opens a star, pulling again keeps it open, and a pull on empty sky closes it', stays && c.state.selected === null);
    settle(c);
  }

  // ---- dark matter (only when its flag is on) ----------------------------------
  if (c.dark) {
    const ids = [...c.model.nodes.keys()].filter((id) => c.sky.localPosition(id));
    const was = new Map(ids.map((id) => [id, c.sky.localPosition(id).clone()]));
    const patch = c.dark.items[0].id;
    check('Dark matter starts hidden and cannot be pointed at', c.dark.strength === 0 && !rayFinds(patch, c.dark.place(patch)));
    c.setDark(true);
    settle(c);
    check('Dark matter fades in', c.dark.revealed && c.dark.strength === 1 && document.getElementById('btn-dark').getAttribute('aria-pressed') === 'true');
    const leans = ids.map((id) => c.sky.localPosition(id).distanceTo(was.get(id)));
    check('Every star leans toward it, and only a little', Math.max(...leans) <= 1.25 && leans.filter((d) => d > 0.05).length > ids.length / 2, `furthest lean ${Math.max(...leans).toFixed(2)}`);
    check('A patch of dark matter can be pointed at', rayFinds(patch, c.dark.place(patch)));
    c.sky.setHover(patch);
    settle(c);
    const faint = c.dark.labelOpacity(patch);
    check('Pointing at a patch shows its label faintly', faint > 0.3 && faint < 0.9, `opacity ${faint}`);
    c.sky.setHover(null);
    settle(c);
    check('The label fades when the pointer leaves', c.dark.labelOpacity(patch) === 0);
    c.select(patch);
    settle(c);
    check('Choosing a patch keeps its label showing, and no panel opens', c.dark.labelOpacity(patch) > 0.3 && c.state.selected === null);
    c.select(patch);
    const hazeDust = dustOf(c).attributes;
    const hazeSent = hazeDust.aAlpha.version + hazeDust.position.version;
    for (let i = 0; i < 5; i++) { c.sky.tick(0.016, i); c.dark.tick(0.016, i); }
    check('With dark matter showing, a still sky does no extra work', hazeDust.aAlpha.version + hazeDust.position.version === hazeSent);
    c.setDark(false);
    settle(c);
    check('Hiding dark matter puts every star back exactly', !c.dark.revealed && c.dark.strength === 0 && fingerprint(c).code === rest);
  } else note('Dark matter', 'switched off. Add &flags=darkMatter to the address to test it.');

  // ---- "chart it" (only when its flag is on) -------------------------------------
  if (c.chart) {
    const star = c.model.order.assumptions.find((id) => c.model.nodes.get(id).chartedAs) ?? tour[0];
    const node = c.model.nodes.get(star);
    const step = (seconds) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) { c.chart.tick(0.05); c.sky.tick(0.05, 0); } };
    check('A reference cannot be charted', !c.grab(c.model.order.references[0]));
    check('Squeezing a star starts charting it and opens its panel', c.grab(star) && c.state.selected === star);
    step(1);
    const partway = c.chart.amount(star);
    const pair = document.querySelector('#panel-body .chart-pair');
    const record = () => document.querySelector('#panel-body .chart-after');
    check('Halfway through the squeeze it is partly drained; "as it is" shows and the record\'s line waits', partway > 0 && partway < 1 && pair && !pair.hidden && record().hidden, `amount ${partway}`);
    c.chart.end(star);
    step(1);
    c.close();
    check('Letting go early springs it back exactly', c.chart.amount(star) === 0 && fingerprint(c).code === rest);
    c.select(star); // open the panel first, so only changes made by the squeeze itself are counted
    const said = new MutationObserver(() => {});
    said.observe(document.getElementById('panel-body'), { childList: true, characterData: true, subtree: true });
    c.grab(star);
    step(2.1);
    const rewrites = said.takeRecords().length;
    said.disconnect();
    check('The panel\'s words change only a few times during a squeeze, so a screen reader is not flooded', rewrites <= 4, `${rewrites} changes`);
    c.chart.end(star);
    step(1);
    const field = document.querySelector('#panel-body .chart-field')?.textContent;
    check('Held for two seconds it stays charted, and only then does the panel show the record\'s line', c.chart.isCharted(star) && c.chart.amount(star) === 1 && !record().hidden && field === node.chartedAs, `field "${field}"`);
    check('A charted star is drawn differently from a full one', fingerprint(c).code !== rest);
    c.chart.toggle(star);
    step(1.5);
    c.close();
    check('Restoring it puts the star back exactly', !c.chart.isCharted(star) && c.chart.amount(star) === 0 && fingerprint(c).code === rest);

    // The button goes in beats: show it as it is, then chart it, then the record's line.
    c.select(star);
    const button = document.querySelector('#panel-body .chart-toggle');
    const boxes = () => ({ pair: !document.querySelector('#panel-body .chart-pair').hidden, record: !record().hidden });
    button.click();
    step(3);
    const first = boxes();
    check('First press of Chart it only shows the star as it is, for as long as you like', first.pair && !first.record && c.chart.amount(star) === 0 && button.getAttribute('aria-pressed') === 'false');
    button.click();
    step(1);
    const during = boxes();
    step(1.2);
    const after = boxes();
    check('Second press drains the star, and the record\'s line appears only when it has finished', during.pair && !during.record && after.record && c.chart.isCharted(star));
    button.click();
    step(1.5);
    c.close();
    check('A third press restores it exactly', c.chart.amount(star) === 0 && fingerprint(c).code === rest);
  } else note('Chart it', 'switched off. Add &flags=chartGesture to the address to test it.');

  // ---- the rooms (only when their flag is on) -------------------------------------
  if (c.rooms) {
    const all = c.rooms.all;
    const first = all.find((r) => !r.structureOnly);
    const node = c.model.nodes.get(first.star);
    const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const showing = (sel) => { const n = document.querySelector(`#room ${sel}`); return Boolean(n) && !n.hidden; };
    const beatsUp = () => [...document.querySelectorAll('#room .room-beat')].filter((n) => !n.hidden).length;
    const skyLit = () => {
      let lit = 0;
      c.sky.root.traverse((o) => { if (o.visible && o.isSprite && o.material.opacity > 0.001) lit++; });
      return lit;
    };
    const toPrompt = (room) => { for (let i = 0; i <= room.beats.length; i++) press('ArrowRight'); };

    c.select(c.model.order.references[0]);
    const noDoor = !document.querySelector('#panel-body .step-inside');
    c.select(first.star);
    const door = document.querySelector('#panel-body .step-inside');
    check('A star with a room shows a Step inside button; choosing the star does not enter it; other stars have no door', Boolean(door) && !c.room && noDoor);
    const tourWas = c.state.tourIndex;
    door.click();
    settle(c);
    check('Stepping inside fades the whole sky out and opens the room', Boolean(c.room) && c.roomView.isOpen && skyLit() === 0 && document.getElementById('panel').hidden);
    let oneAtATime = beatsUp() === 0 && !showing('.room-prompt');
    for (let i = 1; i <= first.beats.length; i++) { press('ArrowRight'); oneAtATime = oneAtATime && beatsUp() === i && !showing('.room-prompt'); }
    check('Each press shows one more beat, and the choices stay hidden until the beats are done', oneAtATime);
    press('ArrowRight');
    const promptUp = showing('.room-prompt') && showing('.room-choices') && !showing('.room-outcome');
    press('ArrowRight'); press('ArrowRight');
    check('The prompt waits: Next does nothing until the class decides', promptUp && !showing('.room-outcome') && Boolean(c.room));
    const board = c.roomScreen;
    c.vrPanel.draw(board, 'hint');
    const pointable = new Set();
    for (let y = 0; y <= 1; y += 0.004) { const action = c.vrPanel.actionAt({ x: 0.5, y }); if (action) pointable.add(action); }
    check('The headset board shows the room, with a box to point at for each choice and one to leave', ['choose:A', 'choose:B', 'choose:C', 'leave'].every((a) => pointable.has(a)), [...pointable].join(' '));
    press('b');
    const outcome = document.querySelector('#room .room-outcome').textContent;
    check('Pressing B shows that choice\'s outcome and nothing further', outcome === first.choices[1].outcome && !showing('.room-reveal') && !showing('.room-closing'));
    check('After a choice the keyboard is on Next, so Space or Enter goes on', document.activeElement?.classList.contains('room-next'));
    press('ArrowRight');
    const revealUp = showing('.room-reveal') && !showing('.room-closing');
    press('ArrowRight');
    check('Then the reveal, then the closing line, which is the star\'s own words', revealUp && document.querySelector('#room .room-closing').textContent === node.paragraphs[0]);
    check('The tour did not move while inside the room', c.state.tourIndex === tourWas);
    press('ArrowRight');
    settle(c);
    const backOut = !c.room && c.state.selected === first.star && !document.getElementById('panel').hidden
      && document.activeElement?.classList.contains('step-inside');
    c.close();
    check('One more press returns to the same star with its panel, and the sky comes back exactly', backOut && fingerprint(c).code === rest);
    c.enterRoom(first.star, first.id);
    press('ArrowRight');
    press('Escape');
    settle(c);
    c.close();
    check('Esc returns to the sky from anywhere in a room', !c.room && fingerprint(c).code === rest);

    // The headset board: at every step of every room, every box that should be pointable can be reached,
    // and the text never has to shrink below what the board allows.
    let smallest = 1;
    const unreachable = [];
    for (const room of all) {
      c.enterRoom(room.star, room.id);
      for (let guard = 0; guard < 40 && c.room; guard++) {
        const { scale } = c.vrPanel.draw(c.roomScreen, 'hint');
        smallest = Math.min(smallest, scale);
        const found = new Set();
        for (let y = 0; y <= 1; y += 0.002) { const action = c.vrPanel.actionAt({ x: 0.5, y }); if (action) found.add(action); }
        for (const action of c.vrPanel.actions) if (!found.has(action)) unreachable.push(`${room.id}: ${action}`);
        if (c.roomScreen.waiting) press('a'); else press('ArrowRight');
      }
      if (c.room) press('Escape');
      settle(c);
    }
    c.setDark?.(false);
    settle(c);
    c.close();
    if (c.dark) rest = fingerprint(c).code; // walking the last room to its end may have added dark matter patches
    check('On the headset board every choice and the way out can be pointed at, at every step of every room', !unreachable.length && smallest > 0.6, `${unreachable.slice(0, 3).join('; ')} smallest text ${smallest.toFixed(2)}`);

    // The trigger, by sending the same signal the headset sends.
    const hand = c.sky.root.parent.children.find((o) => o.userData?.ray);
    if (hand) {
      const trigger = (hit) => { hand.userData.hit = hit; hand.dispatchEvent({ type: 'select' }); };
      trigger({ id: first.star });
      const firstPull = c.state.selected === first.star && !c.room;
      trigger({ id: first.star });
      const secondPull = Boolean(c.room);
      toPrompt(first);
      c.vrPanel.draw(c.roomScreen, 'hint');
      let aimB = null;
      for (let y = 0; y <= 1 && aimB === null; y += 0.002) if (c.vrPanel.actionAt({ x: 0.5, y }) === 'choose:B') aimB = y;
      trigger({ panel: true, uv: { x: 0.5, y: aimB + 0.004 } });
      const chosen = c.room?.run.view().choice === 'B';
      trigger(null); // empty sky: goes on
      const wentOn = c.room?.run.view().showReveal === true;
      hand.userData.hit = null;
      press('Escape');
      settle(c);
      c.close();
      check('In the headset: one trigger pull opens the star, a second steps inside, a pull on a choice chooses it, a pull anywhere else goes on', firstPull && secondPull && chosen && wentOn && !c.room);
    }

    // A star with several rooms shows one door per room, and each door opens its own room.
    const crowded = [...c.rooms.rooms.entries()].find(([, doors]) => doors.length > 1);
    if (crowded) {
      const [star, doors] = crowded;
      c.select(star);
      const buttons = [...document.querySelectorAll('#panel-body .step-inside')];
      const named = buttons.length === doors.length && buttons.every((b, i) => b.textContent.includes(doors[i].title));
      buttons[buttons.length - 1].click();
      const opened = c.room?.room.id === doors[doors.length - 1].id;
      press('Escape');
      settle(c);
      c.close();
      check('A star with several rooms shows a named door for each, and each door opens its own room', named && opened && !c.room);
    } else note('Several doors on one star', 'not tested: no star has more than one room showing. Add playground to &flags= to include the play rooms.');

    const writing = all.find((r) => r.structureOnly);
    if (writing) {
      c.enterRoom(writing.star, writing.id);
      const empty = Boolean(c.room) && showing('.room-notes') && [...document.querySelectorAll('#room .room-choice')].every((b) => b.disabled);
      press('b');
      const stillEmpty = !showing('.room-outcome');
      press('Escape');
      settle(c);
      c.close();
      check('A room still being written opens with empty slots and its notes, and has nothing to choose', empty && stillEmpty && !c.room);
    }
    const flat = all.find((r) => r.flattenBeat !== null);
    if (flat) {
      c.enterRoom(flat.star, flat.id);
      toPrompt(flat);
      const before = document.querySelectorAll('#room .room-beat.flattened').length;
      press('c');
      const flattened = [...document.querySelectorAll('#room .room-beat')].findIndex((n) => n.classList.contains('flattened'));
      const ticked = document.querySelector('#room .room-choice.chosen')?.textContent.startsWith('C');
      press('Escape');
      settle(c);
      c.close();
      check('In the flowsheet room the marked line drains into the chosen box', before === 0 && flattened === flat.flattenBeat && ticked);
    }
    const drift = all.find((r) => r.driftUnchosen || r.toDarkMatter.length);
    if (drift && c.dark) {
      const { drifts } = await import('./rooms.js');
      // Choose the second option, so a room that sends "whichever were not chosen" has to work that out.
      const picked = drift.choices[1].key;
      const expected = drifts(drift, picked);
      c.enterRoom(drift.star, drift.id);
      toPrompt(drift);
      press(picked.toLowerCase());
      press('ArrowRight');
      const lifting = [...document.querySelectorAll('#room .room-choice.drifting .room-letter')].map((n) => n.textContent).join('');
      press('ArrowRight'); press('ArrowRight');
      settle(c);
      const ids = expected.map((key) => `dm-${drift.id}-${key.toLowerCase()}`);
      const joined = ids.filter((id) => c.dark.owns(id));
      check(`In the last room the lines that leave lift away (with ${picked} chosen: ${expected.join(' and ')}), and join the dark matter back in the sky`, lifting === expected.join('') && expected.length > 0 && !c.room
        && joined.length === ids.length && c.dark.revealed && ids.every((id) => c.dark.labelOpacity(id) > 0.3)
        && c.dark.items.filter((i) => ids.includes(i.id)).length === ids.length, `${joined.length} of ${ids.length} joined`);
      c.setDark(false);
      settle(c);
      c.close();
      rest = fingerprint(c).code; // the dark matter now holds more (hidden) patches, so this is the new resting sky
    } else if (drift) note('The dark matter link', 'not tested: add darkMatter to &flags= as well.');

    // ---- room atmosphere (only when its flag is on too) ------------------------
    if (c.atmosphere) {
      const kit = await import('./atmosphere.js');
      const air = c.atmosphere;
      c.close();
      const things = c.scene.children.length;
      const before = fingerprint(c).code;
      const moody = all.find((r) => r.mood) ?? all[0];
      const other = all.find((r) => r !== moody && !r.structureOnly) ?? moody;
      c.enterRoom(moody.star, moody.id);
      air.tick(0.3, 0);
      const partWay = air.level;
      settle(c);
      const hits = [];
      air.object?.raycast(new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)), hits);
      check('Stepping inside fades in one surround of colour and light, and it cannot be pointed at',
        partWay > 0 && partWay < 1 && air.level === 1 && c.scene.children.length === things + 1 && air.spec.mood === moody.mood
        && air.spec.lights.length >= 1 && air.spec.lights.length <= kit.ATMOSPHERE.maxLights && hits.length === 0 && !c.sky.colliders.includes(air.object),
        `level ${partWay.toFixed(2)} then ${air.level}; ${c.scene.children.length - things} added; ${hits.length} hits`);

      // A room with no mood takes its star's colour: one light.
      const plain = all.find((r) => !r.mood);
      if (plain) {
        press('Escape');
        settle(c);
        c.enterRoom(plain.star, plain.id);
        settle(c);
        check('A room with no mood takes its star\'s own colour', air.level === 1 && air.spec.id === plain.id && air.spec.mood === '' && air.spec.lights.length === 1,
          `${air.spec?.id}: ${air.spec?.lights.length} lights`);
        press('Escape');
        settle(c);
        c.enterRoom(moody.star, moody.id);
        settle(c);
      }
      // On a screen the lights keep their places beside the words when the view turns.
      // (Measured as a compass heading, because a light above eye level sweeps a slightly smaller arc than the view does.)
      const heading = () => { const d = air.object.material.uniforms.uDir.value[0]; return Math.atan2(d.x, -d.z) * 180 / Math.PI; };
      air.tick(0, 0, [0, 0, -1]);
      const headingBefore = heading();
      air.tick(0, 0, [1, 0, 0]);
      const turned = ((heading() - headingBefore) % 360 + 360) % 360;
      check('On a screen the lights stay beside the words when the view turns', Math.abs(turned - 90) < 1, `turned ${turned.toFixed(1)} degrees for a quarter turn of the view`);

      // Readability: worked out from the real colours on the page, against the brightest the surround may ever be.
      const backing = Number(getComputedStyle(c.roomView.root).getPropertyValue('--lit-back'));
      const rgb = (node) => getComputedStyle(node).color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const body = ['.room-title', '.room-setting', '.room-text'].map((q) => document.querySelector(`#room ${q}`)).filter(Boolean);
      const accent = ['.room-kicker', '.room-time', '.room-prompt'].map((q) => document.querySelector(`#room ${q}`)).filter(Boolean);
      const lowBody = Math.min(...body.map((n) => kit.worstContrast(rgb(n), backing)));
      const lowAccent = Math.min(...accent.map((n) => kit.worstContrast(rgb(n), backing)));
      check('The room\'s words stay readable over the brightest light allowed', backing > 0 && backing <= 1 && lowBody >= 7 && lowAccent >= 4.5,
        `contrast ${lowBody.toFixed(1)} for the text (needs 7), ${lowAccent.toFixed(1)} for the coloured words (needs 4.5)`);
      // The dark backing only reaches as far down as the words do, and never stops short of them.
      const reach = () => parseFloat(c.roomView.root.style.getPropertyValue('--lit-bottom'));
      const wordsEnd = () => document.querySelector('#room .room-foot').getBoundingClientRect().bottom;
      const short = reach();
      const roomScrolls = c.roomView.root.scrollHeight > c.roomView.root.clientHeight + 1; // a very small window: the backing covers everything
      const coveredAtFirst = short >= wordsEnd() - 1 && (short < window.innerHeight || roomScrolls);
      press('ArrowRight');
      const coveredAfter = reach() >= wordsEnd() - 1 && (reach() > short || roomScrolls);
      press('ArrowLeft');
      check('The dark backing follows the words down the screen and always covers them', coveredAtFirst && coveredAfter,
        `backing to ${short}px then ${reach()}px; the words end at ${Math.round(wordsEnd())}px of ${window.innerHeight}px`);
      note('Contrast of the room\'s words at their worst', `${lowBody.toFixed(1)} to 1 for the text, ${lowAccent.toFixed(1)} to 1 for the coloured words (worked out, not looked at)`);

      // The lights drift slowly: over one second none of them moves more than a degree or two.
      const basis = kit.basisFrom([0, 0, -1]);
      const swing = Math.max(...air.spec.lights.map((light) => {
        const a = kit.lightDirection(light, 10, 1, basis);
        const b = kit.lightDirection(light, 11, 1, basis);
        return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI;
      }));
      check('The lights only drift: at the fastest pace, under 3 degrees in a second', swing < 3, `${swing.toFixed(2)} degrees in a second`);

      // Leaving, then stepping into a different room before the first has finished fading: no jump, and nothing left behind.
      press('Escape');
      air.tick(0.3, 0);
      const fading = air.level;
      c.enterRoom(other.star, other.id);
      const held = air.spec.id;
      settle(c);
      const swapped = air.spec?.id === other.id && air.level === 1;
      press('Escape');
      settle(c);
      c.close();
      settle(c);
      check('Leaving takes the surround away completely, even when another room is entered mid-fade',
        fading > 0 && fading < 1 && (other === moody || held === moody.id) && swapped && !air.showing && c.scene.children.length === things && fingerprint(c).code === before,
        `fading ${fading.toFixed(2)}; held ${held}; swapped ${swapped}; still showing ${air.showing}`);
    } else note('The room atmosphere', 'switched off. Add atmosphere to &flags= (with rooms) to test it.');
  } else note('The rooms', 'switched off. Add &flags=rooms to the address to test them.');

  // A settled sky should not keep redoing work. With a star chosen and everything at rest, the dust
  // (thousands of specks) must not be sent to the graphics chip again on every picture.
  c.goTo(Math.min(3, tour.length - 1));
  settle(c);
  const dust = dustOf(c).attributes;
  const sent = dust.aAlpha.version + dust.position.version;
  for (let i = 0; i < 5; i++) c.sky.tick(0.016, i);
  check('A still sky does no extra work', dust.aAlpha.version + dust.position.version === sent, `the dust was re-sent ${dust.aAlpha.version + dust.position.version - sent} times in 5 pictures`);
  c.close();

  /** A hidden window draws nothing, so anything that needs a drawn picture cannot be checked there. */
  async function isDrawing() {
    const before = c.framesDrawn;
    await wait(700);
    return c.framesDrawn > before;
  }
  const HIDDEN = 'not checked: this window is hidden, so nothing is being drawn. Bring it to the front and reload.';
  if (await isDrawing()) {
    const desktop = c.renderInfo;
    note('Cost of one picture on this screen', `${desktop.calls} draw calls, ${desktop.triangles.toLocaleString()} triangles`);
  } else note('Cost of one picture on this screen', HIDDEN);

  // ---- in the headset (a pretend one with ?emulate, or a real one) -----------
  async function headsetHalf() {
    await c.xr.toggle();
    await wait(900);
    check('Enters VR', c.xr.presenting);
    wrong = walkTour(false);
    check(`In VR the tour reaches all ${tour.length} stops`, !wrong.length, `wrong at stop ${wrong.join(', ')}`);
    check('The reading board is showing', c.vrPanel.mesh.visible);
    // The board is stood in place on the first pictures drawn in VR, once the headset says where the head is.
    if (await isDrawing()) {
      const m = c.xr.measure();
      check('The chart is ahead and a little left', m.chart.degrees < -8 && m.chart.degrees > -35 && m.chart.metres > 2 && m.chart.metres < 5, JSON.stringify(m.chart));
      check('The reading board is to the right, within reach', m.board.degrees > 20 && m.board.degrees < 50 && m.board.metres > 0.8 && m.board.metres < 2, JSON.stringify(m.board));
      const vr = c.renderInfo;
      note('Cost of one picture in the headset', `${vr.calls} draw calls, ${vr.triangles.toLocaleString()} triangles`);
    } else note('Where the chart and board stand, and the cost of one picture', HIDDEN);
    await c.xr.toggle();
    await wait(500);
    c.close();
    c.sky.setHover(null);
    check('Leaves VR and the sky is as it was', !c.xr.presenting && fingerprint(c).code === rest);
  }

  let needsPress = false;
  if (await c.xr.isSupported()) {
    try { await headsetHalf(); }
    catch (err) {
      if (/SecurityError|NotAllowedError|user activation|gesture/i.test(`${err.name} ${err.message}`)) needsPress = true;
      else check('The headset half ran', false, String(err.message || err));
    }
  } else {
    note('Headset half skipped', 'no headset here. Add &emulate to the address to try it with a pretend Quest 2.');
  }

  const finish = () => {
    check('No errors while testing', !errors.length, errors.slice(0, 3).join(' | '));
    const failed = results.filter((r) => r.ok === false);
    window.selftestResult = { ok: !failed.length && !needsPress, pending: needsPress, results, fingerprint: rest };
    show(results, needsPress ? async () => { needsPress = false; results.pop(); try { await headsetHalf(); } catch (err) { check('The headset half ran', false, String(err.message || err)); } finish(); } : null);
    console.log('[selftest]', failed.length ? `FAILED: ${failed.map((r) => r.name).join('; ')}` : needsPress ? 'screen half passed; headset half waiting for a press' : 'all clear', rest);
  };
  finish();
  return window.selftestResult;
}

/** Put the results on the page as a plain list: a tick or a cross, and words, never colour alone. */
function show(results, runHeadsetHalf) {
  let box = document.getElementById('selftest');
  if (!box) {
    box = document.createElement('section');
    box.id = 'selftest';
    box.setAttribute('aria-label', 'Self-test results');
    box.style.cssText = 'position:fixed;left:16px;top:72px;z-index:20;max-width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 170px);overflow:auto;'
      + 'background:#0b0d16;color:#fff;border:2px solid #f5c680;border-radius:10px;padding:14px 18px;font:15px/1.5 system-ui,sans-serif';
    document.body.append(box);
  }
  box.replaceChildren();
  const add = (tag, text, style = '') => { const n = document.createElement(tag); n.textContent = text; n.style.cssText = style; box.append(n); return n; };
  add('h2', 'Self-test', 'margin:0 0 8px;font-size:18px');
  const list = add('ul', '', 'list-style:none;margin:0;padding:0');
  for (const r of results) {
    const li = document.createElement('li');
    const mark = r.ok === null ? '·' : r.ok ? '✓ pass' : '✗ FAIL';
    li.textContent = `${mark}  ${r.name}${r.detail ? `: ${r.detail}` : ''}`;
    li.style.color = r.ok === false ? '#ff9d8f' : r.ok === null ? '#c9cfe2' : '#b9f0c0';
    list.append(li);
  }
  const failed = results.filter((r) => r.ok === false);
  if (runHeadsetHalf) {
    const b = add('button', 'Run the headset half', 'margin-top:10px;padding:8px 14px;font:inherit;border-radius:8px;border:2px solid #f5c680;background:#1a1d2b;color:#fff');
    b.type = 'button';
    b.addEventListener('click', runHeadsetHalf);
  }
  add('p', failed.length ? `Look at: ${failed.map((r) => r.name).join('; ')}` : runHeadsetHalf ? 'Screen half: all clear. Press the button for the headset half.' : 'All clear.',
    `margin:10px 0 0;font-weight:600;color:${failed.length ? '#ff9d8f' : '#b9f0c0'}`);
}
