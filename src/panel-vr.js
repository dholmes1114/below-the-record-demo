// =============================================================================
// WHAT THIS FILE IS
//   The reading panel inside the headset. A web page's normal text boxes do not
//   exist in VR, so this paints the words onto a picture and hangs that picture
//   in the air like a whiteboard.
//
// HOW TO READ IT
//   `draw` lays the card out twice: once to measure how tall it is, once to
//   paint it. If the text is too long for the board, the type steps down a
//   little until it fits. The board is 1 metre wide and body text is drawn at
//   58 pixels on a 2048-pixel-wide picture, which is comfortably readable on a
//   Quest 2 at arm's-and-a-bit length.
// =============================================================================
import * as THREE from 'three';

const W = 2048; // picture size in pixels (the board uses the top `height` pixels of it)
const PAD = 120;
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Noto Serif", serif';
const INK = { text: '#f6f3ea', gold: '#f6cf8f', soft: '#c9d2e6', board: '#090c13', edge: 'rgba(246,207,143,0.55)' };

export const PANEL_WIDTH_M = 1.0;

/** Turn a card into blocks of text, each with its own size and colour. */
function blocksFor(card, footer, t) {
  const blocks = [];
  const plain = (text) => [{ text, italic: false }];
  blocks.push({ runs: plain(card.kicker.toUpperCase()), size: 40, weight: 700, family: SANS, color: INK.gold, gap: 26, spacing: 3 });
  blocks.push({ runs: plain(card.title), size: 96, weight: 700, family: SERIF, color: INK.text, gap: 40, line: 1.14 });
  if (card.subtitle) blocks.push({ runs: [{ text: card.subtitle, italic: true }], size: 50, weight: 400, family: SANS, color: INK.soft, gap: 36 });
  for (const p of card.paragraphs) blocks.push({ runs: plain(p), size: 58, weight: 400, family: SANS, color: INK.text, gap: 40, line: 1.42 });
  if (card.citation) blocks.push({ runs: card.citation, size: 54, weight: 400, family: SANS, color: INK.text, gap: 40, line: 1.42 });
  if (card.connects.length) {
    blocks.push({ runs: plain(t('board.connects') + '  ' + card.connects.map((c) => c.label).join('  →  ')), size: 44, weight: 600, family: SANS, color: INK.gold, gap: 30, line: 1.35 });
  }
  if (card.citedBy.length) {
    blocks.push({ runs: plain(t('board.citedBy') + '  ' + card.citedBy.map((c) => c.label).join('  ·  ')), size: 44, weight: 600, family: SANS, color: INK.gold, gap: 30, line: 1.35 });
  }
  if (card.sources.length) {
    blocks.push({ runs: plain(t('board.sources') + '  ' + card.sources.map((s) => s.short).join('  ·  ')), size: 42, weight: 400, family: SANS, color: INK.soft, gap: 30, line: 1.35 });
  }
  if (card.chart?.done) { // the star has been charted: this is all the record holds
    blocks.push({ runs: plain(t('chart.after').toUpperCase()), size: 40, weight: 700, family: SANS, color: INK.gold, gap: 18, spacing: 3 });
    blocks.push({ runs: plain(card.chart.after), size: 64, weight: 600, family: 'ui-monospace, Menlo, Consolas, monospace', color: INK.text, gap: 40, line: 1.3 });
  }
  for (const door of card.doors ?? []) { // this star has a room (or several): a box each, to point at and pull the trigger
    const label = card.doors.length === 1 ? t('rooms.vrEnter') : door.label;
    blocks.push({ runs: plain(`▸  ${label}`), size: 48, weight: 700, family: SANS, color: INK.gold, gap: 26, line: 1.3, box: 'open', action: `enter:${door.roomId}` });
  }
  if (footer) blocks.push({ runs: plain(footer), size: 38, weight: 400, family: SANS, color: INK.soft, gap: 0, line: 1.35, rule: true });
  return blocks;
}

/** Turn a room's screen (from roomScreen in rooms.js) into blocks. Choices are boxes that can be pointed at. */
function roomBlocks(card, footer) {
  const blocks = [];
  const plain = (text) => [{ text, italic: false }];
  const faint = 'rgba(201,210,230,0.45)';
  blocks.push({ runs: plain(card.kicker.toUpperCase()), size: 40, weight: 700, family: SANS, color: INK.gold, gap: 22, spacing: 3 });
  if (card.title) blocks.push({ runs: plain(card.title), size: 84, weight: 700, family: SERIF, color: INK.text, gap: 30, line: 1.14 });
  if (card.setting) blocks.push({ runs: [{ text: card.setting, italic: true }], size: 46, weight: 400, family: SANS, color: INK.soft, gap: 32, line: 1.35 });
  // Once the class has chosen, the board drops the earlier beats (except one that flattens) so the ending has room.
  for (const b of card.beats) {
    if (!b.shown || (card.outcome && !b.flattened)) continue;
    blocks.push({ runs: plain(`${b.t ? `${b.t}   ` : ''}${b.text}`), size: 50, weight: 400, family: SANS, color: b.flattened ? faint : INK.text, gap: 24, line: 1.36 });
  }
  if (card.showPrompt && card.prompt) blocks.push({ runs: plain(card.prompt), size: 56, weight: 700, family: SANS, color: INK.gold, gap: 28, line: 1.3 });
  if (card.showPrompt) {
    for (const c of card.choices) {
      blocks.push({
        runs: plain(`${c.key}     ${c.label}`), size: 52, weight: 600, family: SANS, gap: 22, line: 1.3,
        color: c.state === 'other' || c.drifting ? faint : INK.text,
        box: c.state === 'chosen' ? 'chosen' : 'open', action: card.canChoose ? `choose:${c.key}` : null,
      });
    }
  }
  if (card.outcome) blocks.push({ runs: plain(card.outcome), size: 52, weight: 400, family: SANS, color: INK.text, gap: 30, line: 1.4 });
  if (card.reveal) blocks.push({ runs: plain(card.reveal), size: 54, weight: 700, family: SANS, color: INK.gold, gap: 30, line: 1.35 });
  if (card.closing) blocks.push({ runs: [{ text: card.closing, italic: true }], size: 58, weight: 400, family: SERIF, color: INK.text, gap: 34, line: 1.36 });
  if (card.notes) {
    blocks.push({ runs: plain(card.notes.heading), size: 44, weight: 700, family: SANS, color: INK.soft, gap: 18, line: 1.3 });
    for (const text of card.notes.lines) blocks.push({ runs: plain(`·  ${text}`), size: 40, weight: 400, family: SANS, color: INK.soft, gap: 12, line: 1.32 });
  }
  blocks.push({ runs: plain(`◂  ${card.leaveLabel}`), size: 42, weight: 600, family: SANS, color: INK.soft, gap: 18, line: 1.3, box: 'open', action: 'leave' });
  if (footer) blocks.push({ runs: plain(footer), size: 38, weight: 400, family: SANS, color: INK.soft, gap: 0, line: 1.35, rule: true });
  return blocks;
}

const fontOf = (block, italic, scale) => `${italic ? 'italic ' : ''}${block.weight} ${Math.round(block.size * scale)}px ${block.family}`;

/** Wrap a block's words into lines that fit the board. Italic and plain words can share a line. */
function wrap(g, block, scale, maxWidth) {
  const words = [];
  for (const run of block.runs) {
    g.font = fontOf(block, run.italic, scale);
    if ('letterSpacing' in g) g.letterSpacing = `${block.spacing || 0}px`;
    run.text.split(/(\s+)/).forEach((piece, i) => {
      if (!piece) return;
      if (/^\s+$/.test(piece)) {
        if (words.length) words[words.length - 1].spaceAfter = true;
        return;
      }
      words.push({ text: piece, italic: run.italic, width: g.measureText(piece).width, spaceAfter: false, glue: i === 0 });
    });
  }
  g.font = fontOf(block, false, scale);
  const space = g.measureText(' ').width;
  const lines = [[]];
  let x = 0;
  for (const word of words) {
    const line = lines[lines.length - 1];
    const prev = line[line.length - 1];
    const lead = prev && prev.spaceAfter ? space : 0;
    if (line.length && x + lead + word.width > maxWidth) {
      lines.push([word]);
      x = word.width;
    } else {
      word.lead = lead;
      line.push(word);
      x += lead + word.width;
    }
  }
  return lines;
}

/**
 * Lay the card out. With `paint` false it only measures; returns the height used.
 * `regions`, when given, collects where each pointable block ended up: [{ action, top, bottom }].
 */
function layout(g, blocks, scale, paint, regions = null) {
  let y = PAD;
  for (const block of blocks) {
    const lineH = block.size * scale * (block.line || 1.3);
    if (block.rule) {
      y += 20;
      if (paint) {
        g.fillStyle = 'rgba(201,210,230,0.3)';
        g.fillRect(PAD, y, W - PAD * 2, 3);
      }
      y += 36;
    }
    const inset = block.box ? 34 : 0; // a boxed block (a choice) sits inside its outline
    const lines = wrap(g, block, scale, W - PAD * 2 - inset * 2);
    const top = y;
    if (block.box) {
      if (paint) {
        roundedRect(g, PAD - 8, top, W - PAD * 2 + 16, lines.length * lineH + 36, 26);
        if (block.box === 'chosen') { g.fillStyle = 'rgba(246,207,143,0.16)'; g.fill(); }
        g.strokeStyle = block.box === 'chosen' ? INK.gold : 'rgba(201,210,230,0.5)';
        g.lineWidth = block.box === 'chosen' ? 6 : 3;
        g.stroke();
      }
      y += 18;
    }
    for (const line of lines) {
      if (paint) {
        let x = PAD + inset;
        g.fillStyle = block.color;
        g.textBaseline = 'middle';
        for (const word of line) {
          x += word.lead || 0;
          g.font = fontOf(block, word.italic, scale);
          g.fillText(word.text, x, y + lineH / 2);
          x += word.width;
        }
      }
      y += lineH;
    }
    if (block.box) y += 18;
    if (regions && block.action) regions.push({ action: block.action, top, bottom: y });
    y += block.gap * scale;
  }
  return y + PAD * 0.75;
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

export function createVRPanel(maxAnisotropy = 8, t = (key) => key) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = W;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide }),
  );
  mesh.visible = false;
  mesh.renderOrder = 20;
  mesh.userData.isPanel = true;
  let height = W;
  let regions = []; // where the pointable boxes (a room's choices, "Step inside") were last painted

  /** Paint a card onto the board. `footer` is the small line at the bottom (tour step and button hints). */
  function draw(card, footer = '') {
    const blocks = card.room ? roomBlocks(card, footer) : blocksFor(card, footer, t);
    let scale = 1;
    while (layout(g, blocks, scale, false) > W && scale > 0.6) scale -= 0.05;
    height = Math.min(W, Math.ceil(layout(g, blocks, scale, false)));
    g.clearRect(0, 0, W, W);
    roundedRect(g, 6, 6, W - 12, height - 12, 56);
    g.fillStyle = INK.board;
    g.fill();
    g.strokeStyle = INK.edge;
    g.lineWidth = 6;
    g.stroke();
    regions = [];
    layout(g, blocks, scale, true, regions);
    // Show only the part of the picture that was used.
    texture.repeat.set(1, height / W);
    texture.offset.set(0, 1 - height / W);
    texture.needsUpdate = true;
    mesh.scale.set(PANEL_WIDTH_M, (PANEL_WIDTH_M * height) / W, 1);
    return { height, scale };
  }

  return {
    mesh,
    canvas,
    draw,
    get usedHeight() { return height; },
    /** What, if anything, is at this spot on the board. `uv` comes from a controller's ray: (0,0) bottom left, (1,1) top right. */
    actionAt(uv) {
      if (!uv) return null;
      const y = (1 - uv.y) * height;
      return regions.find((r) => y >= r.top && y <= r.bottom)?.action ?? null;
    },
    get actions() { return regions.map((r) => r.action); },
    show(card, footer) { const r = draw(card, footer); mesh.visible = true; return r; },
    hide() { mesh.visible = false; },
  };
}
