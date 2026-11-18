// =============================================================================
// WHAT THIS FILE IS
//   The room as it appears on a screen or a projector: a large, high-contrast
//   card over the faded sky, built from ordinary page text and buttons so it
//   works with the keyboard and can be read aloud by a screen reader.
//   Only loaded when the `rooms` flag is on.
//
// HOW TO READ IT
//   `open` builds every line of the room once, hidden. `update` then un-hides
//   lines as the walk reaches them (the walk itself is in rooms.js), so each
//   new line fades in on its own and nothing that is already showing moves.
//   The buttons only report what was pressed (`onAction`); main.js decides
//   what happens.
// =============================================================================

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createRoomView({ t, keys, onAction }) {
  const root = el('section', 'room');
  root.id = 'room';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'room-title');
  root.hidden = true;

  const card = el('div', 'room-card');
  const kicker = el('p', 'room-kicker');
  const title = el('h2', 'room-title');
  title.id = 'room-title';
  title.tabIndex = -1;
  const setting = el('p', 'room-setting');
  const beats = el('ol', 'room-beats');
  const prompt = el('p', 'room-prompt');
  const waiting = el('p', 'room-waiting', t('rooms.waiting'));
  const choices = el('div', 'room-choices');
  const chose = el('p', 'room-chose');
  const outcome = el('p', 'room-outcome');
  const reveal = el('p', 'room-reveal');
  const closing = el('blockquote', 'room-closing');
  const notes = el('section', 'room-notes');
  const live = el('p', 'room-live'); // read aloud by a screen reader; not shown
  live.setAttribute('aria-live', 'polite');
  const foot = el('div', 'room-foot');
  const back = el('button', 'room-back', `◀ ${t('rooms.back')}`);
  const hint = el('span', 'room-hint', t('rooms.hint', { keys: keys.join(' ') }));
  const next = el('button', 'room-next');
  const leave = el('button', 'room-leave', t('rooms.leave'));
  for (const b of [back, next, leave]) b.type = 'button';
  back.addEventListener('click', () => onAction('back'));
  next.addEventListener('click', () => onAction('advance'));
  leave.addEventListener('click', () => onAction('leave'));
  foot.append(back, hint, next, leave);
  card.append(kicker, title, setting, beats, prompt, waiting, choices, chose, outcome, reveal, closing, notes, live, foot);
  root.append(card);
  document.body.append(root);

  let beatEls = [];
  const choiceEls = new Map();
  let closeTimer = null;
  let newest = null; // the piece that appeared most recently, kept in view
  let hadOutcome = false;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Un-hide (or hide) one piece. A piece that has just appeared fades in. */
  function show(node, on) {
    if (on && node.hidden) {
      node.hidden = false;
      node.classList.remove('fresh');
      void node.offsetWidth; // lets the fade start again from the beginning
      node.classList.add('fresh');
      newest = node;
    } else if (!on) node.hidden = true;
  }
  /** Put words in a slot; an empty slot in a room still being written shows as an empty box. */
  function fill(node, text, isSlot) {
    node.textContent = text;
    node.classList.toggle('room-empty', Boolean(isSlot) && !text);
  }

  function build(screen) {
    const writing = Boolean(screen.notes);
    kicker.textContent = screen.kicker;
    fill(title, screen.title, writing);
    fill(setting, screen.setting, writing);
    beats.replaceChildren();
    beatEls = screen.beats.map((b) => {
      const li = el('li', 'room-beat');
      if (b.t) li.append(el('span', 'room-time', b.t));
      li.append(el('span', 'room-text', b.text));
      li.hidden = true;
      beats.append(li);
      return li;
    });
    fill(prompt, screen.prompt, writing);
    choices.replaceChildren();
    choiceEls.clear();
    for (const c of screen.choices) {
      const b = el('button', 'room-choice');
      b.type = 'button';
      b.append(el('span', 'room-letter', c.key), el('span', 'room-label', c.label));
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => onAction(`choose:${c.key}`));
      choices.append(b);
      choiceEls.set(c.key, b);
    }
    notes.replaceChildren();
    if (writing) {
      notes.append(el('h3', '', screen.notes.heading));
      const ul = el('ul');
      for (const text of screen.notes.lines) ul.append(el('li', '', text));
      notes.append(ul);
    }
    for (const node of [prompt, waiting, choices, chose, outcome, reveal, closing]) node.hidden = true;
    notes.hidden = !writing;
  }

  function update(screen) {
    newest = null;
    lastScreen = screen;
    card.classList.toggle('decided', Boolean(screen.outcome));
    screen.beats.forEach((b, i) => {
      show(beatEls[i], b.shown);
      beatEls[i].classList.toggle('flattened', b.flattened); // drains into the chosen box, like a charted star
    });
    show(prompt, screen.showPrompt);
    show(choices, screen.showPrompt);
    show(waiting, screen.waiting);
    for (const c of screen.choices) {
      const b = choiceEls.get(c.key);
      b.disabled = !screen.canChoose;
      b.setAttribute('aria-pressed', String(c.state === 'chosen'));
      b.classList.toggle('chosen', c.state === 'chosen');
      b.classList.toggle('other', c.state === 'other');
      b.classList.toggle('drifting', c.drifting); // no field for it: it is leaving for the dark matter
    }
    chose.textContent = screen.chose;
    outcome.textContent = screen.outcome;
    reveal.textContent = screen.reveal;
    closing.textContent = screen.closing;
    show(chose, Boolean(screen.outcome));
    show(outcome, Boolean(screen.outcome));
    show(reveal, Boolean(screen.reveal));
    show(closing, Boolean(screen.closing));
    back.disabled = screen.first;
    next.disabled = screen.waiting;
    next.textContent = screen.last ? t('rooms.leave') : `${t('rooms.next')} ▶`;
    leave.hidden = screen.last; // the Next button already says it
    if (live.textContent !== screen.newest) live.textContent = screen.newest;
    // After a choice, the keyboard moves to Next, so Space or Enter goes on rather than pressing the choice again.
    if (screen.outcome && !hadOutcome) next.focus({ preventScroll: true });
    hadOutcome = Boolean(screen.outcome);
    // If it cannot all fit (a very small window), bring the newest line into view.
    newest?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    // With the atmosphere on (main.js adds the class "lit"), tell the styles how far down the words now reach,
    // so the dark backing covers them and no more (the row of buttons is always the last thing). If the room has to scroll, the backing covers everything.
    if (root.classList.contains('lit')) {
      const scrolls = root.scrollHeight > root.clientHeight + 1;
      root.style.setProperty('--lit-bottom', scrolls ? '4000px' : `${Math.ceil(foot.getBoundingClientRect().bottom)}px`);
    }
  }

  /**
   * Choose the text size once, for the room at its fullest: every beat, the choices, the longest outcome,
   * the reveal and the closing line all showing. Then nothing has to shrink or shift part-way through.
   */
  function fit(screen) {
    const pieces = [...beatEls, prompt, choices, chose, outcome, reveal, closing];
    const was = pieces.map((node) => node.hidden);
    const words = [chose.textContent, outcome.textContent, reveal.textContent, closing.textContent];
    pieces.forEach((node) => { node.hidden = false; });
    if (!screen.notes) {
      chose.textContent = screen.fullest.chose;
      outcome.textContent = screen.fullest.outcome;
      reveal.textContent = screen.fullest.reveal;
      closing.textContent = screen.fullest.closing;
      card.classList.add('decided');
    }
    card.style.removeProperty('--fit');
    const room = root.clientHeight - 56; // the window, less the padding
    let scale = 1;
    while (card.scrollHeight > room && scale > 0.62) {
      scale = Math.round((scale - 0.04) * 100) / 100;
      card.style.setProperty('--fit', String(scale));
    }
    pieces.forEach((node, i) => { node.hidden = was[i]; });
    [chose.textContent, outcome.textContent, reveal.textContent, closing.textContent] = words;
    card.classList.remove('decided');
  }
  let lastScreen = null;
  window.addEventListener('resize', () => { // a projector plugged in mid-room: size the text again
    if (!root.hidden && lastScreen) { fit(lastScreen); update(lastScreen); }
  });

  return {
    /** Build the room and fade it in over the sky. `color` is the star's own colour, used for the accents. */
    open(screen, color) {
      clearTimeout(closeTimer);
      build(screen);
      root.style.setProperty('--room', color || '#f6cf8f');
      root.hidden = false;
      hadOutcome = false;
      fit(screen);
      void root.offsetWidth;
      root.classList.add('open');
      update(screen);
      title.focus({ preventScroll: true });
    },
    update,
    close() {
      root.classList.remove('open');
      closeTimer = setTimeout(() => { root.hidden = true; }, 1250); // once the fade out (1.2 seconds) has finished
    },
    get isOpen() { return root.classList.contains('open'); },
    root,
  };
}
