// =============================================================================
// WHAT THIS FILE IS
//   The charge nurse. It starts everything, keeps track of which star is
//   selected and where the tour is, and passes each event (a click, an arrow
//   key, a controller button) to the part that handles it.
//
// HOW TO READ IT
//   Top to bottom is the order things happen when the page opens:
//     1. load content.json and stop with a readable message if it is broken
//     2. build the sky, the camera and the panels
//     3. `select(id)` is the one place a star gets chosen, however it was chosen
//     4. the tour is just `select` on a fixed list of ids
//     5. `frame` runs about 60 times a second and redraws
// =============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadContent } from './content.js';
import { loadConfig, isOn, withAddressFlags } from './config.js';
import { loadUI } from './ui.js';
import { computeLayout } from './layout.js';
import { describe } from './card.js';
import { buildSky, makeStarfield, pickId, PALETTE } from './sky.js';
import { createDomPanel, createIndex } from './panel-dom.js';
import { createVRPanel } from './panel-vr.js';
import { setupXR } from './xr.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function showNotice(title, items, { fatal }) {
  const box = $('notice');
  box.hidden = false;
  box.className = fatal ? 'notice' : 'notice warning';
  box.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = title;
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  box.append(h, ul);
  if (!fatal) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'OK, hide this';
    b.addEventListener('click', () => { box.hidden = true; });
    box.append(b);
  }
}

async function start() {
  // ---- 1. content --------------------------------------------------------
  const model = await loadContent('content.json');
  // Optional features are switched on in config.json. With none on, this is the base constellation.
  const config = withAddressFlags(await loadConfig('config.json'), location.search);
  // The page's own wording (headings, button names, hints) is read from ui.json.
  const ui = await loadUI('ui.json');
  const t = ui.t;
  const errors = model.problems.filter((p) => p.level === 'error').map((p) => p.message);
  const warnings = [...model.problems.filter((p) => p.level === 'warning').map((p) => p.message), ...config.problems, ...ui.problems];
  if (errors.length) {
    showNotice('content.json needs a fix before the sky can be drawn', errors, { fatal: true });
    return;
  }
  if (warnings.length) showNotice('Loaded, with a few things to look at', warnings, { fatal: false });

  const meta = model.meta;
  if (meta.title) {
    document.title = meta.title;
    $('site-title').textContent = meta.title;
  }
  $('site-author').textContent = meta.author || '';
  $('help-course').textContent = [meta.course, meta.institution, meta.date].filter(Boolean).join(' · ');

  const layout = computeLayout(model);

  // For testing without a headset: add ?emulate to the address and a pretend Quest 2 is attached.
  // It comes from node_modules (a developer tool), so it is not part of the packed site/ folder.
  if (params.has('emulate')) {
    const { XRDevice, metaQuest2 } = await import('../node_modules/iwer/build/iwer.module.js');
    window.xrDevice = new XRDevice(metaQuest2);
    window.xrDevice.installRuntime({ forceInstall: true });
  }

  // ---- 2. scene ----------------------------------------------------------
  const canvas = $('sky');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // The window can report a size of 0 while it is still hidden; never divide by that.
  const view = { w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight) };
  renderer.setSize(view.w, view.h);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.background);
  const camera = new THREE.PerspectiveCamera(50, view.w / view.h, 0.05, 1000);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const sky = buildSky(model, layout, { maxAnisotropy, reducedMotion });
  scene.add(sky.root);
  const starfield = makeStarfield();
  scene.add(starfield);

  // ---- dark matter (optional: the `darkMatter` flag) ---------------------------
  // Nothing in this block runs, and none of its files are fetched, unless the flag is on.
  let dark = null;
  let addToDark = () => false; // set below when dark matter is on: lets a room send lines into it
  if (isOn(config, 'darkMatter')) {
    const { loadDarkMatter, placeDarkMatter, bendOffsets } = await import('./darkmatter.js');
    const list = await loadDarkMatter('darkmatter.json', model);
    if (list.problems.length) showNotice('Loaded, with a few things to look at', [...warnings, ...list.problems], { fatal: false });
    if (list.items.length) {
      const { buildDarkMatter } = await import('./darkmatter-sky.js');
      const make = (items) => {
        const places = placeDarkMatter(items, model, layout);
        return buildDarkMatter({ items, places, offsets: bendOffsets(places, model, layout), sky, maxAnisotropy, reducedMotion });
      };
      dark = make(list.items);
      // New items join by rebuilding the haze with the longer list. The ones already there keep their places.
      addToDark = (extra) => {
        const fresh = extra.filter((item) => !dark.owns(item.id));
        if (!fresh.length) return false;
        const items = [...dark.items, ...fresh];
        dark.dispose();
        dark = make(items);
        return true;
      };
    }
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 120;
  controls.rotateSpeed = 0.6;

  /** How far back the camera sits to see the whole chart; further on a narrow window. */
  const homeDistance = () => Math.max(38, 25 / (Math.tan(THREE.MathUtils.degToRad(25)) * camera.aspect));
  camera.position.set(0, 0, homeDistance());
  controls.update();

  // ---- panels and lists --------------------------------------------------
  const state = { selected: null, tourIndex: -1, textScale: 1, labelsAll: false };
  const domPanel = createDomPanel({ onJump: (id) => select(id, { focusPanel: true }), onClose: close, onChart: (id) => chartStep(id), onEnter: (id, roomId) => enterRoom(id, roomId), t });
  const index = createIndex(model, (id) => {
    // On a small screen the list covers the sky, so put it away once a star is chosen.
    if (window.innerWidth <= 860) { $('index').hidden = true; $('btn-index').setAttribute('aria-expanded', 'false'); }
    select(id, { focusPanel: true });
  }, t);
  const vrPanel = createVRPanel(maxAnisotropy, t);
  if (dark) index.addGroup(t('dark.index'), dark.items.map((item) => ({ id: item.id, label: item.label })));

  // ---- "chart it" (optional: the `chartGesture` flag) ---------------------------
  // Squeeze a star and it drains into a flat checkbox: what the record keeps of it. The rules are in
  // chart.js; nothing here runs, and that file is not fetched, unless the flag is on.
  let chart = null;
  const canChart = (id) => Boolean(model.nodes.get(id)?.chartedAs);
  if (isOn(config, 'chartGesture')) {
    const { createCharting } = await import('./chart.js');
    chart = createCharting({
      canChart,
      onAmount(id, amount) {
        sky.setCharted(id, amount);
        if (state.selected === id && !xr.presenting) showChart(id);
      },
      onDone(id, charted) {
        if (state.selected !== id) return;
        showChart(id);
        if (xr.presenting) vrPanel.show(cardFor(id), vrFooter()); // the board repaints once, when the charting finishes or is undone
      },
    });
    const key = document.createElement('dt');
    key.append(Object.assign(document.createElement('kbd'), { textContent: 'C' }));
    $('help-keys').append(key, Object.assign(document.createElement('dd'), { textContent: t('chart.help') }));
  }
  // ---- rooms (optional: the `rooms` flag): step inside a star ------------------------
  // A star that has a room in rooms.json gets a "Step inside" button. Inside, the sky fades out and the room
  // plays one beat per press. The rules are in rooms.js; nothing here runs, and none of the room files are
  // fetched, unless the flag is on.
  let rooms = null; // what rooms.json holds
  let roomKit = null; // the rules (rooms.js)
  let roomView = null; // the room on screen (rooms-dom.js)
  let roomNow = null; // the room we are inside, if any
  if (isOn(config, 'rooms')) {
    roomKit = await import('./rooms.js');
    // Rooms marked "play" in rooms.json are for exploring, not for the talk: they only load with the playground switch on.
    const list = await roomKit.loadRooms('rooms.json', model, { playground: isOn(config, 'playground') });
    if (list.problems.length) showNotice('Loaded, with a few things to look at', [...warnings, ...list.problems], { fatal: false });
    if (list.rooms.size) {
      const { createRoomView } = await import('./rooms-dom.js');
      rooms = list;
      roomView = createRoomView({ t, keys: list.settings.choiceKeys, onAction: (action) => roomStep(action) });
      const key = document.createElement('dt');
      key.append(Object.assign(document.createElement('kbd'), { textContent: 'Enter' }));
      $('help-keys').append(key, Object.assign(document.createElement('dd'), { textContent: t('rooms.help') }));
    }
  }
  // ---- room atmosphere (optional: the `atmosphere` flag, on top of `rooms`) -----------
  // Inside a room the dark all round takes on that room's mood: a colour, and a few slow lights. Nothing here
  // runs, and neither atmosphere file is fetched, unless both flags are on and there is at least one room.
  const facing = new THREE.Vector3(); // scratch: which way the view is looking
  let atmosphere = null; // the surround (atmosphere-sky.js)
  let moodKit = null; // the recipe for each room (atmosphere.js)
  if (rooms && isOn(config, 'atmosphere')) {
    moodKit = await import('./atmosphere.js');
    const { buildAtmosphere } = await import('./atmosphere-sky.js');
    atmosphere = buildAtmosphere({ scene, reducedMotion });
    // A misspelt mood only matters with this switch on, so it is only mentioned here (and always by `npm run content`).
    if (rooms.moodProblems.length) showNotice('Loaded, with a few things to look at', [...warnings, ...rooms.moodProblems], { fatal: false });
    roomView.root.classList.add('lit'); // styles.css: the words keep a dark backing, and the colour shows round it
  }
  const roomScreenNow = () => roomKit.roomScreen(roomNow.room, roomNow.run.view(), t, model.nodes.get(roomNow.id).label);
  /** Show the room as it now stands, on the screen and (in the headset) on the reading board. */
  function showRoom() {
    const screen = roomScreenNow();
    roomView.update(screen);
    if (xr.presenting) vrPanel.show({ ...screen, leaveLabel: t('rooms.vrLeave') }, t('rooms.vrHint'));
  }
  /** Step inside a star. `roomId` picks one of its doors; without it, the star's first room. */
  function enterRoom(id, roomId) {
    const room = roomId ? rooms?.byId.get(roomId) : rooms?.rooms.get(id)?.[0];
    if (!room || room.star !== id || roomNow) return false;
    if (state.selected !== id) select(id);
    roomNow = { id, room, run: roomKit.createRoomRun(room), darkWas: Boolean(dark?.revealed) };
    if (dark?.revealed) setDark(false);
    sky.setLayer('rooms', { all: 0 }, { seconds: 1.2 }); // the sky fades out slowly; nothing flashes
    // The room's own colour and lights fade in at the same pace, placed either side of where the viewer is looking.
    atmosphere?.enter(moodKit.moodSpec(room, rooms.moods, sky.colorHex(id)), camera.getWorldDirection(new THREE.Vector3()).toArray(), { level: xr.presenting });
    domPanel.hide();
    document.body.classList.add('in-room');
    roomView.open(roomScreenNow(), sky.colorHex(id));
    if (xr.presenting) showRoom();
    stirred();
    return true;
  }
  function leaveRoom() {
    if (!roomNow) return;
    const { id, room, run, darkWas } = roomNow;
    const reached = run.view();
    roomNow = null;
    roomView.close();
    document.body.classList.remove('in-room');
    sky.setLayer('rooms', null, { seconds: 1.2 });
    atmosphere?.leave(); // fades out with the room, then is taken away completely
    // Some lines leave the room and join the dark matter (when that feature is on), once the room has been
    // played as far as its reveal. The room says which: named letters, or whichever the class did not choose.
    let sent = [];
    const leaving = reached.showReveal ? roomKit.drifts(room, reached.choice) : [];
    if (dark && leaving.length) {
      sent = room.choices.filter((c) => leaving.includes(c.key))
        .map((c) => ({ id: `dm-${room.id}-${c.key.toLowerCase()}`, label: c.label, near: id }));
      addToDark(sent);
    }
    if (dark && (sent.length || darkWas)) {
      setDark(true);
      for (const item of sent) dark.showLabel(item.id); // their labels show, so the class sees where they went
    }
    select(id); // the star's own panel comes back
    const door = rooms.rooms.get(id).indexOf(room); // and the keyboard returns to the door that was used
    document.querySelectorAll('#panel-body .step-inside')[door]?.focus({ preventScroll: true });
  }
  /** One press inside a room: 'advance', 'back', 'leave', or 'choose:B'. */
  function roomStep(action) {
    if (!roomNow) return;
    stirred();
    const { run } = roomNow;
    const result = action === 'leave' ? 'leave'
      : action === 'advance' ? run.advance()
        : action === 'back' ? run.back()
          : String(action).startsWith('choose:') ? run.choose(action.slice(7)) : 'no';
    if (result === 'leave') leaveRoom();
    else if (result === 'moved') showRoom();
  }

  /** The reading card for a star; when charting is on it also carries the before and after, and a star with a room offers its door. */
  const cardFor = (id) => {
    const card = describe(model, id, t, chart ? { charted: chart.isCharted(id) } : null);
    const doors = rooms?.rooms.get(id);
    // One door per room. A star with several rooms names each door by its room's title.
    if (doors) card.doors = doors.map((room) => ({ roomId: room.id, label: doors.length > 1 ? t('rooms.stepInsideNamed', { title: room.title }) : t('rooms.stepInside') }));
    return card;
  };
  // The button and the C key go in beats, so there is time to read and think before the record's line appears:
  // first press shows the star "as it is"; second press drains it; when it is a checkbox the record's line
  // fades in; a press after that restores it.
  let ready = null; // the star whose "as it is" card is showing
  const showChart = (id) => domPanel.setChart(chart.amount(id), chart.isCharted(id), ready === id);
  function chartStep(id) {
    if (!chart || !canChart(id)) return;
    stirred();
    if (chart.isBusy(id)) { ready = null; chart.toggle(id); } // charted, or on its way: undo it
    else if (ready === id) chart.toggle(id); // second press: chart it
    else ready = id; // first press: just show it as it is
    showChart(id);
  }
  /** A squeeze lands on a star (mouse hold, grip, or pinch). Returns false if this star cannot be charted. */
  function grab(id) {
    if (!chart || !canChart(id)) return false;
    if (state.selected !== id) select(id);
    stirred();
    return chart.begin(id);
  }
  const tour = model.tour;

  // ---- camera flights ----------------------------------------------------
  let flight = null;
  function flyTo(position, target) {
    atHome = false;
    if (reducedMotion) {
      camera.position.copy(position);
      controls.target.copy(target);
      flight = null;
      return;
    }
    flight = { fromP: camera.position.clone(), toP: position, fromT: controls.target.clone(), toT: target, t: 0 };
  }
  /**
   * How far back the camera sits so the whole chart, name cards included, fits in the part of the
   * window the reading panel leaves free. The panel covers the right side (or the bottom, on a small screen).
   */
  function fitDistance() {
    const freeAcross = 1 - domPanel.coveredWidth / view.w;
    const freeDown = 1 - domPanel.coveredHeight / view.h;
    const tan = Math.tan(THREE.MathUtils.degToRad(25));
    return Math.max(homeDistance(), 26 / (tan * camera.aspect * freeAcross), 15 / (tan * freeDown));
  }
  const flyHome = () => { flyTo(new THREE.Vector3(0, 0, fitDistance()), new THREE.Vector3()); atHome = true; };
  function flyToStar(id) {
    const p = sky.localPosition(id);
    if (!p) return;
    if (model.nodes.get(id).kind === 'center') return flyHome();
    // The chart stays whole and in frame. The camera only leans a little toward the chosen star;
    // the spotlight (the ring, the dimming, the gold line) is what says "this one".
    const target = p.clone().multiplyScalar(0.08);
    flyTo(new THREE.Vector3(target.x + p.x * 0.08, target.y + p.y * 0.08, fitDistance()), target);
  }
  // After a few quiet seconds with nothing selected, the chart turns slowly from side to side, like a
  // mobile, so its depth shows. It never turns edge-on (a flat chart seen from the side is a pile of
  // names), and any touch brings it back to face you.
  const TURN_AFTER = 3.5; // seconds of stillness before the turning starts
  const TURN_REST = 0.035; // how far it sways at rest, in radians (about 2 degrees)
  const TURN_IDLE = 0.5; // how far it turns each way when idle (about 29 degrees)
  let lastStirred = performance.now();
  let turn = TURN_REST;
  const stirred = () => { lastStirred = performance.now(); };
  controls.addEventListener('start', () => { flight = null; atHome = false; stirred(); }); // grabbing the mouse cancels a flight
  for (const type of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(type, stirred, { passive: true });

  // ---- 3. selecting ------------------------------------------------------
  function select(id, { focusPanel = false } = {}) {
    if (roomNow) return; // inside a room the sky is put away
    if (dark?.owns(id)) {
      // A patch of dark matter has no panel: choosing it shows its label faintly (choosing it again lets it fade).
      stirred();
      if (!dark.revealed) { setDark(true); dark.showLabel(id); } else dark.toggleLabel(id);
      return;
    }
    if (!model.nodes.has(id)) return;
    state.selected = id;
    stirred();
    sky.setFocus(id);
    const card = cardFor(id);
    domPanel.show(card, { focus: focusPanel });
    if (chart) {
      if (ready !== id) ready = null; // the "as it is" card belongs to the star it was opened on
      showChart(id);
    }
    index.setCurrent(id);
    if (xr.presenting) vrPanel.show(card, vrFooter());
    else flyToStar(id);
    updateTourBar();
    if (params.get('debug') === 'vrpanel') previewVRPanel(card);
  }
  function close() {
    // If the keyboard was inside the panel, hand it back to the button it came from instead of losing it.
    const wasReading = $('panel').contains(document.activeElement);
    state.selected = null;
    stirred();
    sky.setFocus(null);
    domPanel.hide();
    vrPanel.hide();
    index.setCurrent(null);
    updateTourBar();
    if (wasReading) $('btn-index').focus();
  }

  // ---- dark matter: showing and hiding -------------------------------------
  function setDark(on) {
    if (!dark) return;
    dark.setRevealed(on);
    stirred();
    $('btn-dark').setAttribute('aria-pressed', String(dark.revealed));
  }
  const toggleDark = () => setDark(!dark?.revealed);
  if (dark) {
    const b = $('btn-dark');
    b.textContent = t('dark.button');
    b.hidden = false;
    b.addEventListener('click', toggleDark);
    const key = document.createElement('dt');
    key.append(Object.assign(document.createElement('kbd'), { textContent: 'D' }));
    $('help-keys').append(key, Object.assign(document.createElement('dd'), { textContent: t('dark.help') }));
  }

  // ---- 4. the tour -------------------------------------------------------
  function goTo(i) {
    if (!tour.length) return;
    const cameFrom = state.tourIndex;
    state.tourIndex = Math.min(tour.length - 1, Math.max(0, i));
    select(tour[state.tourIndex]);
    // A tour stop written as { "star": "...", "darkMatter": true } reveals the haze from that stop on (false hides
    // it). Going Back past that stop hides it again, so the tour looks the same whichever way you arrive.
    if (dark) {
      const marked = (index) => {
        for (let k = index; k >= 0; k--) if (typeof model.tourStops[k]?.darkMatter === 'boolean') return model.tourStops[k].darkMatter;
        return null;
      };
      const now = marked(state.tourIndex);
      if (now !== marked(cameFrom)) setDark(now === true);
    }
  }
  const next = () => goTo(state.tourIndex + 1);
  const prev = () => goTo(state.tourIndex - 1);
  const onTourStop = () => state.tourIndex >= 0 && state.selected === tour[state.tourIndex];

  function updateTourBar() {
    const status = $('tour-status');
    status.replaceChildren();
    if (state.tourIndex < 0) {
      status.textContent = t('tour.begin');
    } else {
      const step = document.createElement('span');
      step.className = 'step';
      step.textContent = t('tour.step', { n: state.tourIndex + 1, total: tour.length });
      const name = model.nodes.get(tour[state.tourIndex]).label;
      status.append(step, onTourStop() ? name : t('tour.paused'));
    }
    $('tour-prev').disabled = state.tourIndex <= 0;
    $('tour-next').disabled = state.tourIndex >= tour.length - 1 && onTourStop();
  }
  function vrFooter() {
    const base = state.tourIndex < 0 ? t('vr.footerStart') : t('vr.footerStep', { n: state.tourIndex + 1, total: tour.length });
    return [base, dark && t('dark.vrHint'), chart && t('chart.vrHint')].filter(Boolean).join('   ·   ');
  }
  $('tour-next').addEventListener('click', next);
  $('tour-prev').addEventListener('click', prev);

  // ---- VR ----------------------------------------------------------------
  const xr = setupXR({
    renderer, scene, sky, vrPanel,
    handlers: {
      // In the headset a second trigger pull on the star that is already open steps inside it (when it has a room).
      select: (id) => { if (rooms && id === state.selected && rooms.rooms.has(id)) enterRoom(id); else select(id); },
      next: () => (roomNow ? roomStep('advance') : next()),
      prev: () => (roomNow ? roomStep('back') : prev()),
      close: () => { if (roomNow) roomStep('advance'); else close(); }, // inside a room, a trigger pull anywhere goes on
      up: () => { if (!roomNow) toggleDark(); },
      grab: (id) => !roomNow && grab(id),
      // A trigger pull on the reading board: inside a room it chooses what is pointed at, or just goes on.
      board(uv) {
        const action = vrPanel.actionAt(uv);
        if (roomNow) roomStep(action ?? 'advance');
        else if (action?.startsWith('enter:') && state.selected) enterRoom(state.selected, action.slice(6));
      },
      release: (id) => chart?.end(id),
      started() {
        flight = null;
        controls.enabled = false;
        camera.clearViewOffset();
        document.body.classList.add('in-vr');
        $('btn-vr').textContent = t('vr.exit');
        // Open on whatever was selected, or a welcome card.
        const card = state.selected ? cardFor(state.selected) : {
          kind: 'center', kicker: meta.course || t('vr.welcomeKicker'), title: meta.title || t('vr.welcomeTitle'), subtitle: meta.author || '',
          paragraphs: [t('vr.welcome')],
          citation: null, connects: [], assumptions: [], citedBy: [], sources: [],
        };
        vrPanel.show(card, vrFooter());
        if (roomNow) showRoom();
      },
      ended() {
        controls.enabled = true;
        document.body.classList.remove('in-vr');
        $('btn-vr').textContent = t('vr.enter');
        camera.position.set(0, 0, homeDistance());
        camera.quaternion.identity();
        controls.target.set(0, 0, 0);
        controls.update();
        onResize();
        if (state.selected) flyToStar(state.selected);
      },
    },
  });
  xr.isSupported().then((ok) => {
    const b = $('btn-vr');
    b.hidden = false;
    if (ok) {
      b.addEventListener('click', () => xr.toggle().catch((err) => showNotice('VR could not start', [err.message], { fatal: false })));
    } else {
      b.disabled = true;
      b.textContent = t('vr.unavailable');
      b.title = window.isSecureContext
        ? t('vr.noHeadset') : t('vr.notSecure');
    }
  });

  // ---- mouse -------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = { x: 0, y: 0, moved: false, inside: false, downX: 0, downY: 0, downAt: 0 };
  const starUnder = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return pickId(raycaster.intersectObjects(sky.colliders, false));
  };
  canvas.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = true; pointer.inside = true; });
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; sky.setHover(null); canvas.style.cursor = ''; });
  canvas.addEventListener('pointerdown', (e) => { pointer.downX = e.clientX; pointer.downY = e.clientY; pointer.downAt = performance.now(); });
  canvas.addEventListener('pointerup', (e) => {
    // A click, not a drag: the pointer barely moved between press and release.
    if (Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) > 6 || performance.now() - pointer.downAt > 600) return;
    const id = starUnder(e.clientX, e.clientY);
    if (id) select(id);
  });

  // ---- "chart it" with the mouse: click a star and hold; double-click a charted star to restore it ----
  if (chart) {
    let waiting = null; // a press that has not yet lasted long enough to count as a hold
    let held = null; // the star being squeezed
    const letGo = () => {
      clearTimeout(waiting);
      waiting = null;
      if (held) chart.end(held);
      held = null;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const id = starUnder(e.clientX, e.clientY);
      if (!id || !canChart(id)) return;
      waiting = setTimeout(() => { waiting = null; if (grab(id)) held = id; }, 250); // a quick click still just selects
    });
    canvas.addEventListener('pointermove', (e) => {
      if ((waiting || held) && Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) > 6) letGo(); // that was a drag
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) canvas.addEventListener(type, letGo);
    canvas.addEventListener('dblclick', (e) => {
      const id = starUnder(e.clientX, e.clientY);
      if (id && chart.isCharted(id)) chart.restore(id);
    });
  }

  // ---- buttons -----------------------------------------------------------
  const toggle = (button, panelEl, on) => {
    const open = on ?? panelEl.hidden;
    panelEl.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    return open;
  };
  $('btn-index').addEventListener('click', () => toggle($('btn-index'), $('index')));
  $('btn-help').addEventListener('click', () => toggle($('btn-help'), $('help')));
  $('help-close').addEventListener('click', () => { toggle($('btn-help'), $('help'), false); $('btn-help').focus(); });
  $('btn-home').addEventListener('click', flyHome);

  function setTextScale(scale) {
    state.textScale = Math.min(1.6, Math.max(0.85, Math.round(scale * 100) / 100));
    document.documentElement.style.setProperty('--panel-scale', state.textScale);
    try { localStorage.setItem('panel-scale', state.textScale); } catch { /* private window: just don't remember it */ }
  }
  try { setTextScale(Number(localStorage.getItem('panel-scale')) || 1); } catch { /* same */ }
  $('btn-text').addEventListener('click', () => setTextScale(state.textScale >= 1.6 ? 1 : state.textScale + 0.2));

  // ---- keyboard ----------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    const handled = () => e.preventDefault();
    const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement; // Enter and Space belong to a focused button
    if (roomNow) {
      // Inside a room the keys belong to the room: → next, ← back, the choice letters (or 1 2 3), Esc out.
      const keys = rooms.settings.choiceKeys;
      const pick = keys.find((k, i) => key.toUpperCase() === k || key === String(i + 1));
      if (key === 'Escape') roomStep('leave');
      else if (key === 'ArrowRight' || key === 'PageDown' || ((key === ' ' || key === 'Enter') && !onControl)) roomStep('advance');
      else if (key === 'ArrowLeft' || key === 'PageUp') roomStep('back');
      else if (pick) roomStep(`choose:${pick}`);
      else return;
      handled();
      return;
    }
    if (key === 'Enter' && !onControl && rooms?.rooms.has(state.selected)) { enterRoom(state.selected); handled(); return; }
    if (key === 'ArrowRight' || key === 'PageDown') { next(); handled(); }
    else if (key === 'ArrowLeft' || key === 'PageUp') { prev(); handled(); }
    else if (key === 'Home') { goTo(0); handled(); }
    else if (key === 'End') { goTo(tour.length - 1); handled(); }
    else if (key === 'Escape') {
      if (!$('help').hidden) toggle($('btn-help'), $('help'), false);
      else if (state.selected) close();
      else if (!$('index').hidden) toggle($('btn-index'), $('index'), false);
    }
    else if ((key === 'd' || key === 'D') && dark) toggleDark();
    else if ((key === 'c' || key === 'C') && chart && state.selected && !e.repeat) chartStep(state.selected);
    else if (key === 'l' || key === 'L') { state.labelsAll = !state.labelsAll; sky.setLabelsAll(state.labelsAll); }
    else if (key === '+' || key === '=') setTextScale(state.textScale + 0.1);
    else if (key === '-' || key === '_') setTextScale(state.textScale - 0.1);
    else if (key === 'u' || key === 'U') document.body.classList.toggle('stage');
    else if (key === 'f' || key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
    else if (key === '?' || key === 'h' || key === 'H') toggle($('btn-help'), $('help'));
  });

  // ---- window size -------------------------------------------------------
  let atHome = true; // true until the camera has been moved by a flight or the mouse
  function onResize() {
    if (renderer.xr.isPresenting) return;
    view.w = Math.max(1, window.innerWidth);
    view.h = Math.max(1, window.innerHeight);
    camera.aspect = view.w / view.h;
    camera.updateProjectionMatrix();
    renderer.setSize(view.w, view.h);
    if (atHome) {
      camera.position.set(0, 0, homeDistance());
      controls.target.set(0, 0, 0);
    }
  }
  window.addEventListener('resize', onResize);

  // ---- a way to preview the headset board on a normal screen (add ?debug=vrpanel to the address) ----
  function previewVRPanel(card) {
    const { height } = vrPanel.draw(card, vrFooter());
    let img = $('vr-preview');
    if (!img) {
      img = document.createElement('canvas');
      img.id = 'vr-preview';
      img.style.cssText = 'position:fixed;left:20px;bottom:96px;width:512px;z-index:4;border-radius:8px';
      document.body.append(img);
    }
    img.width = 1024;
    img.height = Math.round(height / 2);
    img.getContext('2d').drawImage(vrPanel.canvas, 0, 0, 2048, height, 0, 0, 1024, img.height);
  }

  // ---- 5. every frame ----------------------------------------------------
  const viewShift = { x: 0, y: 0 };
  let last = performance.now();
  const began = last;
  let framesDrawn = 0;
  function frame() {
    framesDrawn++;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    const time = (now - began) / 1000;
    last = now;

    if (renderer.xr.isPresenting) {
      xr.update();
    } else {
      if (Math.max(1, window.innerWidth) !== view.w || Math.max(1, window.innerHeight) !== view.h) onResize(); // catches a resize the browser did not announce
      if (flight) {
        flight.t = Math.min(1, flight.t + dt / 1.3);
        const e = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2; // ease in, ease out
        camera.position.lerpVectors(flight.fromP, flight.toP, e);
        controls.target.lerpVectors(flight.fromT, flight.toT, e);
        if (flight.t >= 1) flight = null;
      }
      controls.update();

      // When the reading panel is open, slide the picture left (or up, on a small screen) so the sky is centered in the space that is left.
      const settle = reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
      viewShift.x += (domPanel.coveredWidth / 2 - viewShift.x) * settle;
      viewShift.y += (domPanel.coveredHeight / 2 - viewShift.y) * settle;
      if (viewShift.x > 0.5 || viewShift.y > 0.5) camera.setViewOffset(view.w, view.h, viewShift.x, viewShift.y, view.w, view.h);
      else if (camera.view) camera.clearViewOffset();

      if (pointer.moved && pointer.inside) {
        pointer.moved = false;
        const id = starUnder(pointer.x, pointer.y);
        sky.setHover(id);
        canvas.style.cursor = id ? 'pointer' : '';
      }
      if (!reducedMotion) {
        // Gentle motion: the chart sways a degree or two (much wider when left idle) and the far stars drift.
        const idle = !flight && !state.selected && performance.now() - lastStirred > TURN_AFTER * 1000;
        turn += ((idle ? TURN_IDLE : TURN_REST) - turn) * (1 - Math.exp(-dt * (idle ? 0.5 : 4)));
        sky.root.rotation.y = Math.sin(time * 0.11) * turn;
        sky.root.rotation.x = Math.sin(time * 0.07) * 0.015;
        starfield.rotation.y = time * 0.004;
      }
    }
    chart?.tick(dt);
    sky.tick(dt, time);
    dark?.tick(dt, time);
    // On a screen the lights keep their places either side of the words, wherever the view has glided to. In the headset they stay put in the room.
    if (atmosphere?.showing) atmosphere.tick(dt, time, xr.presenting ? null : camera.getWorldDirection(facing).toArray());
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);
  updateTourBar();

  // A small window for checking the page from the browser console and from tests.
  window.constellation = {
    model, config, ui, layout, state, select, close, next, prev, goTo, xr, vrPanel, camera, controls, sky,
    flagOn: (name) => isOn(config, name),
    get dark() { return dark; },
    setDark, chart, grab, chartStep,
    rooms, enterRoom, leaveRoom, roomStep, roomView, atmosphere, scene,
    get room() { return roomNow; },
    /** For checks: the words the room is showing right now. */
    get roomScreen() { return roomNow ? { ...roomScreenNow(), leaveLabel: t('rooms.vrLeave') } : null; },
    /** What the last frame cost to draw: how many separate draw calls and triangles. */
    get renderInfo() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures }; },
    get starCount() { return model.nodes.size; },
    /** For checks: draw one picture right now, even if the window is hidden and has stopped drawing by itself. */
    drawNow: () => frame(),
    /** How many pictures have been drawn so far. It stops climbing while the window is hidden. */
    get framesDrawn() { return framesDrawn; },
    screenPosition(id) {
      const p = sky.localPosition(id);
      if (!p) return null;
      const v = p.clone().applyMatrix4(sky.root.matrixWorld).project(camera);
      return { x: ((v.x + 1) / 2) * view.w, y: ((1 - v.y) / 2) * view.h };
    },
  };

  // Add ?selftest to the address and the page checks itself (the tour, fading, moving) and lists what passed.
  if (params.has('selftest')) {
    import('./selftest.js')
      .then((m) => m.runSelfTest(window.constellation))
      .catch((err) => showNotice('The self-test could not run', [String(err?.message || err)], { fatal: false }));
  }

  // Deep links: add #critical-realism (any id from content.json) to open on that star.
  const openFromAddress = () => {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && model.nodes.has(hash)) select(hash);
  };
  window.addEventListener('hashchange', openFromAddress);
  openFromAddress();
}

start().catch((err) => {
  console.error(err);
  showNotice('Something went wrong starting the page', [String(err?.message || err)], { fatal: true });
});
