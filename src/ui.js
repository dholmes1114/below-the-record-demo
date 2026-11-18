// =============================================================================
// WHAT THIS FILE IS
//   The phrase book. The page's own headings, button names and hints are kept
//   in ui.json, so no wording is buried in the code. This file reads it.
//
// HOW TO READ IT
//   `t('tour.step', { n: 3, total: 17 })` looks up "tour" then "step" in
//   ui.json and fills in the {curly} blanks: "3 of 17".
//   Like config.json, this can never stop the page. If a phrase is missing (or
//   the whole file is), the page shows the phrase's short code name instead
//   and says so, and the constellation itself is untouched.
// =============================================================================

/** Turn the raw ui.json object into { t, problems }. Never throws. */
export function makeUI(raw) {
  const problems = [];
  const isBlock = raw && typeof raw === 'object' && !Array.isArray(raw);
  if (raw !== undefined && raw !== null && !isBlock) problems.push('ui.json should be one { ... } object.');
  const words = isBlock ? raw : {};
  const reported = new Set();

  const find = (key) => {
    let value = words;
    for (const part of String(key).split('.')) value = value && typeof value === 'object' ? value[part] : undefined;
    return typeof value === 'string' ? value : null;
  };
  /** The wording for `key`, with each {name} replaced by values.name. */
  function t(key, values = {}) {
    let text = find(key);
    if (text === null) {
      if (!reported.has(key)) {
        reported.add(key);
        problems.push(`ui.json has no wording for "${key}", so its code name is shown instead.`);
      }
      text = String(key).split('.').pop();
    }
    return text.replace(/\{(\w+)\}/g, (blank, name) => (name in values ? String(values[name]) : blank));
  }
  return { t, has: (key) => find(key) !== null, problems };
}

/** Fetch ui.json. Always resolves; if anything goes wrong the page still runs and `problems` says why. */
export async function loadUI(url = 'ui.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return makeUI(JSON.parse(await res.text()));
  } catch (err) {
    const ui = makeUI(undefined);
    ui.problems.push(`ui.json could not be read (${err.message}). Headings and buttons show short code names until it is fixed; the constellation itself is unaffected.`);
    return ui;
  }
}
