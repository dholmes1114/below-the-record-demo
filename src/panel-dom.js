// =============================================================================
// WHAT THIS FILE IS
//   The reading panel on a normal screen, and the "All stars" list. These are
//   ordinary web-page text and buttons (not drawn in 3D), so they are sharp,
//   work with the keyboard, and can be read aloud by a screen reader.
//
// HOW TO READ IT
//   `createDomPanel` fills the panel from a card (see card.js). Text is always
//   added as plain text, never as HTML, so nothing typed into content.json can
//   break the page. `createIndex` builds the list of every star as buttons.
// =============================================================================

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Add citation text: italic runs become <em>, and a web address becomes a link. */
function appendRuns(parent, runs) {
  for (const run of runs) {
    const holder = run.italic ? el('em') : parent;
    for (const piece of run.text.split(/(https?:\/\/\S+)/)) {
      if (!piece) continue;
      if (/^https?:\/\//.test(piece)) {
        const a = el('a', '', piece);
        a.href = piece;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        holder.append(a);
      } else {
        holder.append(piece);
      }
    }
    if (holder !== parent) parent.append(holder);
  }
}

export function createDomPanel({ onJump, onClose, onChart, onEnter, t }) {
  const panel = document.getElementById('panel');
  const body = document.getElementById('panel-body');
  document.getElementById('panel-close').addEventListener('click', onClose);

  let chartParts = null; // the "chart it" pieces of the card on show, if it has any

  const jumpButton = (item) => {
    const b = el('button', '', item.label);
    b.type = 'button';
    b.addEventListener('click', () => onJump(item.id));
    return b;
  };
  const linkRow = (heading, items, arrows) => {
    const frag = document.createDocumentFragment();
    frag.append(el('h3', '', heading));
    const row = el('div', 'links');
    items.forEach((item, i) => {
      if (arrows && i > 0) row.append(el('span', 'arrow', '→'));
      row.append(jumpButton(item));
    });
    frag.append(row);
    return frag;
  };

  function show(card, { focus = false } = {}) {
    body.replaceChildren();
    body.append(el('p', 'kicker', card.kicker));
    const title = el('h2', '', card.title);
    title.id = 'panel-title';
    title.tabIndex = -1;
    body.append(title);
    if (card.subtitle) body.append(el('p', 'subtitle', card.subtitle));
    for (const p of card.paragraphs) body.append(el('p', '', p));
    if (card.doors?.length) { // this star has a room (or several): stepping inside is always a second, deliberate press
      const doors = el('div', 'doors');
      for (const door of card.doors) {
        const b = el('button', 'step-inside', door.label);
        b.type = 'button';
        b.addEventListener('click', () => onEnter?.(card.id, door.roomId));
        doors.append(b);
      }
      body.append(doors);
    }
    chartParts = null;
    if (card.chart) {
      // "Chart it": a button, and (once charting starts) the rich description beside what the record would show.
      const section = el('section', 'chart-card');
      const button = el('button', 'chart-toggle', t('chart.button'));
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => onChart?.(card.id));
      const pair = el('div', 'chart-pair');
      const before = el('div', 'chart-before');
      before.append(el('h3', '', t('chart.before')), el('p', '', card.chart.before));
      const after = el('div', 'chart-after');
      after.append(el('h3', '', t('chart.after')), el('p', 'chart-field', card.chart.after));
      pair.append(before, after);
      pair.hidden = true;
      after.hidden = true; // the record's line waits until the star has finished draining
      section.append(button, pair);
      body.append(section);
      chartParts = { button, pair, after };
    }
    if (card.citation) {
      const p = el('p', 'citation');
      appendRuns(p, card.citation);
      body.append(p);
    }
    if (card.connects.length) body.append(linkRow(t('panel.connects'), card.connects, true));
    if (card.assumptions.length) body.append(linkRow(t('panel.assumptions'), card.assumptions, false));
    if (card.citedBy.length) body.append(linkRow(t('panel.citedBy'), card.citedBy, false));
    if (card.sources.length) {
      body.append(el('h3', '', t('panel.sources')));
      const list = el('ul', 'sources');
      for (const source of card.sources) {
        const li = el('li');
        const b = el('button');
        b.type = 'button';
        b.title = t('panel.showReference');
        appendRuns(b, source.runs);
        // Inside the list the whole citation is one button (it jumps to the reference star), so strip nested links.
        b.querySelectorAll('a').forEach((a) => a.replaceWith(a.textContent));
        b.addEventListener('click', () => onJump(source.id));
        li.append(b);
        list.append(li);
      }
      body.append(list);
    }
    panel.hidden = false;
    panel.scrollTop = 0;
    if (focus) title.focus();
  }

  return {
    show,
    /** Show how far the open star has been charted: 0 = not at all, 1 = fully. */
    /**
     * Show where the open star is in being charted. It goes in beats, so there is time to read and think:
     *   ready   (first press of the button) only "As it is" shows; nothing has happened to the star yet
     *   amount  above 0 while the star drains; still only "As it is"
     *   done    the star is a checkbox: now "As the record shows it" fades in beside it
     */
    setChart(amount, done, ready = false) {
      if (!chartParts) return;
      // This runs every frame of a squeeze. The panel is read aloud when its words change, so only
      // touch the page when something really changes.
      const next = { hidden: !(ready || done || amount > 0), done: Boolean(done), label: done ? 'chart.restore' : ready ? 'chart.confirm' : 'chart.button' };
      const was = chartParts.shown ?? {};
      if (next.hidden !== was.hidden) chartParts.pair.hidden = next.hidden;
      if (next.done !== was.done) {
        chartParts.after.hidden = !next.done;
        chartParts.button.setAttribute('aria-pressed', String(next.done));
      }
      if (next.label !== was.label) chartParts.button.textContent = t(next.label);
      chartParts.shown = next;
    },
    hide() { panel.hidden = true; },
    get open() { return !panel.hidden; },
    /** How many pixels of the right edge the panel covers (0 when it is closed or sits at the bottom on a small screen). */
    get coveredWidth() {
      if (panel.hidden || window.innerWidth <= 860) return 0;
      return panel.getBoundingClientRect().width + 20;
    },
    /** On a small screen the panel sits along the bottom instead; this is how many pixels of height it covers. */
    get coveredHeight() {
      if (panel.hidden || window.innerWidth > 860) return 0;
      return panel.getBoundingClientRect().height;
    },
  };
}

export function createIndex(model, onPick, t) {
  const nav = document.getElementById('index');
  const buttons = new Map();
  const groups = [
    [t('index.center'), model.order.center ? [model.order.center] : []],
    [t('index.anchors'), model.order.anchors],
    [t('index.clusters'), model.order.clusters],
    [t('index.assumptions'), model.order.assumptions],
    [t('index.references'), model.order.references],
  ];
  /** Add one headed list of buttons. `entries` is [{ id, label }]. */
  function addGroup(heading, entries) {
    if (!entries.length) return;
    nav.append(el('h2', '', heading));
    const ul = el('ul');
    for (const { id, label } of entries) {
      const b = el('button', '', label);
      b.type = 'button';
      b.addEventListener('click', () => onPick(id));
      buttons.set(id, b);
      const li = el('li');
      li.append(b);
      ul.append(li);
    }
    nav.append(ul);
  }
  for (const [heading, ids] of groups) addGroup(heading, ids.map((id) => ({ id, label: model.nodes.get(id).label })));
  return {
    addGroup,
    setCurrent(id) {
      for (const [bid, b] of buttons) {
        if (bid === id) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      }
    },
  };
}
