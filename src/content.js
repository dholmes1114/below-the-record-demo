// =============================================================================
// WHAT THIS FILE IS
//   The intake step. It reads content.json and turns it into one tidy list of
//   "nodes" (the center star, the two definitions, the schools of thought, the
//   assumptions and the references) that the rest of the app draws.
//
// HOW TO READ IT
//   `normalize` is the whole job: it walks each section of content.json, checks
//   that every id it mentions really exists (like reconciling a med list), and
//   collects anything odd in `problems` instead of crashing. It has no drawing
//   code, so the same file runs in the browser and in `npm run check`.
// =============================================================================

/** One paragraph or several: content.json may give text as a string or a list of strings. */
function asParagraphs(text) {
  if (Array.isArray(text)) return text.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
  if (typeof text === 'string' && text.trim()) return [text.trim()];
  return [];
}

/** A single line of text, or '' when there is none. Used for `chartedAs`: what the record shows for a star. */
const asLine = (text) => (typeof text === 'string' ? text.trim() : '');

/** "Chinn, P. L., Canty, L., & Mkandawire-Valhmu, L. (2025). ..." becomes "Chinn et al. (2025)". */
export function shortCite(apa) {
  if (typeof apa !== 'string') return 'Reference';
  const m = apa.match(/^(.*?)\s*\((\d{4}[a-z]?)\)/);
  if (!m) return apa.length > 40 ? apa.slice(0, 38) + '…' : apa;
  const [, authors, year] = m;
  // A surname is whatever comes before ", X." (an initial), at the start or after ", " / ", & ".
  const surnames = [...authors.matchAll(/(?:^|,\s+(?:&\s+)?)([^,&]+?),\s+(?:\p{Lu}\.\s?)+/gu)].map((x) => x[1].trim());
  if (surnames.length === 0) return `${authors.replace(/[.,]+$/, '')} (${year})`;
  if (surnames.length === 1) return `${surnames[0]} (${year})`;
  if (surnames.length === 2) return `${surnames[0]} & ${surnames[1]} (${year})`;
  return `${surnames[0]} et al. (${year})`;
}

/** Split a citation into plain and italic runs, using the `italic` snippet from content.json. */
export function citationRuns(apa, italic) {
  if (typeof apa !== 'string') return [];
  if (typeof italic !== 'string' || !italic || !apa.includes(italic)) return [{ text: apa, italic: false }];
  const at = apa.indexOf(italic);
  return [
    { text: apa.slice(0, at), italic: false },
    { text: italic, italic: true },
    { text: apa.slice(at + italic.length), italic: false },
  ].filter((r) => r.text);
}

function alignmentFromDistance(d) {
  if (d < 0.4) return 'close';
  if (d < 0.7) return 'middle';
  if (d < 0.9) return 'farther';
  return 'contrast';
}

/**
 * Turn the raw content.json object into the model the app draws.
 * Never throws: anything wrong is described in `problems` (level "error" stops the page, "warning" does not).
 */
export function normalize(raw) {
  const problems = [];
  const warn = (message) => problems.push({ level: 'warning', message });
  const fail = (message) => problems.push({ level: 'error', message });

  const model = {
    meta: {},
    nodes: new Map(),
    order: { center: null, anchors: [], clusters: [], assumptions: [], references: [] },
    tour: [],
    tourStops: [],
    problems,
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('content.json should be one { ... } object with center, anchors, clusters, assumptions and references inside it.');
    return model;
  }
  model.meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};

  const add = (node, where) => {
    if (typeof node.id !== 'string' || !node.id) {
      warn(`An entry in "${where}" has no "id", so it was skipped.`);
      return false;
    }
    if (model.nodes.has(node.id)) {
      warn(`The id "${node.id}" is used twice (second time in "${where}"). The second one was skipped.`);
      return false;
    }
    model.nodes.set(node.id, node);
    return true;
  };
  const list = (name) => {
    if (raw[name] === undefined) return [];
    if (!Array.isArray(raw[name])) {
      warn(`"${name}" should be a list in [ ... ]. It was ignored.`);
      return [];
    }
    return raw[name].filter((e) => e && typeof e === 'object');
  };

  // References first, so everything else can be checked against them.
  for (const r of list('references')) {
    const node = {
      id: r.id, kind: 'reference', chartedAs: '', label: r.short || shortCite(r.apa),
      subtitle: '', paragraphs: [], refs: [], connects: [], apa: typeof r.apa === 'string' ? r.apa : '', italic: r.italic || '',
    };
    if (!node.apa) warn(`Reference "${r.id}" has no "apa" text.`);
    if (node.italic && !node.apa.includes(node.italic)) warn(`Reference "${r.id}": the "italic" text is not found inside "apa", so nothing will be italic.`);
    if (add(node, 'references')) model.order.references.push(node.id);
  }

  // The center star.
  if (!raw.center || typeof raw.center !== 'object') {
    fail('content.json needs a "center" block (the philosophy at the middle of the constellation).');
  } else {
    const c = raw.center;
    const node = {
      id: c.id || 'center', kind: 'center', chartedAs: asLine(c.chartedAs), label: c.label || 'Philosophy',
      subtitle: c.subtitle || '', paragraphs: asParagraphs(c.text), refs: c.refs || [], connects: [],
    };
    if (add(node, 'center')) model.order.center = node.id;
  }

  for (const a of list('anchors')) {
    const node = {
      id: a.id, kind: 'anchor', chartedAs: asLine(a.chartedAs), label: a.label || a.id,
      subtitle: a.subtitle || '', paragraphs: asParagraphs(a.text), refs: a.refs || [], connects: [],
    };
    if (add(node, 'anchors')) model.order.anchors.push(node.id);
  }

  for (const c of list('clusters')) {
    let distance = Number(c.distance);
    if (!Number.isFinite(distance)) {
      warn(`School "${c.id}": "distance" should be a number from 0 (closest) to 1 (farthest). Used 0.5.`);
      distance = 0.5;
    }
    if (distance < 0 || distance > 1) {
      warn(`School "${c.id}": distance ${distance} is outside 0 to 1, so it was pulled back into range.`);
      distance = Math.min(1, Math.max(0, distance));
    }
    const alignment = typeof c.alignment === 'string' && c.alignment ? c.alignment : alignmentFromDistance(distance);
    // Optional: "color": "#3fd8c8" gives a school its own colour. Left out, the sky picks one from its palette.
    let color = '';
    if (c.color !== undefined) {
      if (/^#[0-9a-f]{6}$/i.test(String(c.color))) color = String(c.color);
      else warn(`School "${c.id}": "color" should look like "#3fd8c8". Used the sky's own colour instead.`);
    }
    const node = {
      id: c.id, kind: 'cluster', chartedAs: asLine(c.chartedAs), label: c.label || c.id,
      subtitle: c.subtitle || '', paragraphs: asParagraphs(c.text), refs: c.refs || [], connects: [], distance, alignment, color,
    };
    if (add(node, 'clusters')) model.order.clusters.push(node.id);
  }

  for (const a of list('assumptions')) {
    const node = {
      id: a.id, kind: 'assumption', chartedAs: asLine(a.chartedAs), label: a.label || a.id,
      subtitle: a.subtitle || '', paragraphs: asParagraphs(a.text), refs: a.refs || [],
      connects: Array.isArray(a.connects) ? a.connects : [],
    };
    if (add(node, 'assumptions')) model.order.assumptions.push(node.id);
  }

  // Second pass: every id that one entry mentions has to point at something real.
  for (const node of model.nodes.values()) {
    node.refs = (Array.isArray(node.refs) ? node.refs : []).filter((id) => {
      const ok = model.nodes.get(id)?.kind === 'reference';
      if (!ok) warn(`"${node.id}" cites "${id}", which is not in the references list.`);
      return ok;
    });
    if (node.kind === 'assumption') {
      node.connects = node.connects.filter((id) => {
        const target = model.nodes.get(id);
        const ok = target && target.kind !== 'assumption' && target.kind !== 'reference';
        if (!ok) warn(`Assumption "${node.id}" connects to "${id}", which is not a star (center, definition or school).`);
        return ok;
      });
      if (node.connects.length < 2) warn(`Assumption "${node.id}" needs at least two stars in "connects" to draw a line.`);
    }
  }

  // The tour: the fixed order for the live talk. A stop is usually just a star's id ("a1"). It may also be
  // written as { "star": "a1", ... } when a later feature needs the stop to carry something extra
  // (speaker notes, a timeline step). `model.tour` is always the plain list of ids; `model.tourStops`
  // keeps the extras, one entry per stop, in the same order.
  if (Array.isArray(raw.tour) && raw.tour.length) {
    for (const entry of raw.tour) {
      const stop = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { star: entry };
      if (typeof stop.star !== 'string' || !model.nodes.has(stop.star)) {
        const named = typeof stop.star === 'string' ? `"${stop.star}", which does not exist` : 'a stop with no "star" id';
        warn(`The tour lists ${named}. That stop was skipped.`);
        continue;
      }
      model.tour.push(stop.star);
      model.tourStops.push({ ...stop });
    }
  } else {
    const o = model.order;
    model.tour = [o.center, ...o.anchors, ...o.clusters, ...o.assumptions].filter(Boolean);
    model.tourStops = model.tour.map((star) => ({ star }));
  }

  return model;
}

/** Fetch and parse content.json. Always resolves with a model; read `model.problems` for anything wrong. */
export async function loadContent(url = 'content.json') {
  let text;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    text = await res.text();
  } catch (err) {
    const model = normalize({});
    model.problems.length = 0;
    model.problems.push({ level: 'error', message: `content.json could not be loaded (${err.message}).` });
    return model;
  }
  try {
    return normalize(JSON.parse(text));
  } catch (err) {
    const model = normalize({});
    model.problems.length = 0;
    model.problems.push({
      level: 'error',
      message: `content.json has a typo the browser cannot read past: ${err.message}. Usual causes: a missing comma between entries, a missing closing quote, or a comma after the last entry in a list.`,
    });
    return model;
  }
}
