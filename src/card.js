// =============================================================================
// WHAT THIS FILE IS
//   The index card for one star. Given an id, it gathers what the reading panel
//   shows: the heading, the text, what the star connects to and its sources.
//
// HOW TO READ IT
//   `describe` returns plain data, no drawing. The desktop panel (panel-dom.js)
//   and the in-headset panel (panel-vr.js) both read the same card, so the two
//   can never say different things. `t` is the phrase book (ui.js): it supplies
//   the small heading above the title ("Definition", "School of thought · close").
// =============================================================================
import { citationRuns } from './content.js';

export function describe(model, id, t = (key) => key, charting = null) {
  const node = model.nodes.get(id);
  if (!node) return null;
  const brief = (otherId) => ({ id: otherId, label: model.nodes.get(otherId).label });
  const all = [...model.nodes.values()];

  return {
    id: node.id,
    kind: node.kind,
    kicker: node.kind === 'anchor' && node.subtitle ? node.subtitle : t(`kicker.${node.kind}`, { alignment: node.alignment }),
    title: node.label,
    subtitle: node.kind === 'anchor' ? '' : node.subtitle,
    paragraphs: node.paragraphs,
    // A reference shows its full APA citation, with the italic part marked.
    citation: node.kind === 'reference' ? citationRuns(node.apa, node.italic) : null,
    // An assumption lists the stars its line runs through.
    connects: node.kind === 'assumption' ? node.connects.map(brief) : [],
    // A star lists the assumptions that run through it.
    assumptions: node.kind === 'assumption' || node.kind === 'reference'
      ? []
      : all.filter((n) => n.kind === 'assumption' && n.connects.includes(id)).map((n) => brief(n.id)),
    // A reference lists who cites it.
    citedBy: node.kind === 'reference' ? all.filter((n) => n.refs.includes(id)).map((n) => brief(n.id)) : [],
    // Only when the "chart it" feature is on: the rich description beside what the record would show.
    chart: charting && node.chartedAs
      ? { before: node.paragraphs[0] ?? node.label, after: node.chartedAs, done: Boolean(charting.charted) }
      : null,
    sources: node.refs.map((refId) => {
      const ref = model.nodes.get(refId);
      return { id: refId, short: ref.label, runs: citationRuns(ref.apa, ref.italic) };
    }),
  };
}
