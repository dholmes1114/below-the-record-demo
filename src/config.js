// =============================================================================
// WHAT THIS FILE IS
//   The switchboard. config.json lists optional features ("flags") and whether
//   each is on. This file reads it.
//
// HOW TO READ IT
//   The rule is "off unless told otherwise, and never in the way". A flag is on
//   only if config.json says exactly `true`. A missing flag, a missing file or a
//   file with a typo all mean "everything off", and the base constellation
//   still opens. Nothing here can stop the page.
// =============================================================================

/** Turn the raw config.json object into { flags, problems }. Never throws. */
export function normalizeConfig(raw) {
  const config = { flags: {}, problems: [] };
  if (raw === undefined || raw === null) return config;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    config.problems.push('config.json should be one { ... } object. All optional features are off.');
    return config;
  }
  const flags = raw.flags;
  if (flags === undefined) return config;
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
    config.problems.push('"flags" in config.json should be a { ... } block of name: true or false. All optional features are off.');
    return config;
  }
  for (const [name, value] of Object.entries(flags)) {
    if (typeof value !== 'boolean') {
      config.problems.push(`Flag "${name}" in config.json should be true or false (no quotes). It is treated as off.`);
      continue;
    }
    config.flags[name] = value;
  }
  return config;
}

/**
 * For rehearsing a feature without editing config.json: add ?flags=darkMatter (or ?flags=one,two)
 * to the address and those features are on for that visit only. Nothing is saved.
 */
export function withAddressFlags(config, search) {
  const names = new URLSearchParams(search || '').get('flags');
  if (!names) return config;
  for (const name of names.split(',').map((n) => n.trim())) {
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) config.flags[name] = true;
  }
  return config;
}

/** Is this feature switched on? Only an exact `true` counts. */
export const isOn = (config, name) => config?.flags?.[name] === true;

/** Fetch config.json. Always resolves; if anything goes wrong, every flag is off and `problems` says why. */
export async function loadConfig(url = 'config.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return normalizeConfig(undefined); // no file is fine: nothing optional is on
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return normalizeConfig(JSON.parse(await res.text()));
  } catch (err) {
    const config = normalizeConfig(undefined);
    config.problems.push(`config.json could not be read (${err.message}). All optional features are off; the base constellation is unaffected.`);
    return config;
  }
}
