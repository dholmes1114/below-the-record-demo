// =============================================================================
// WHAT THIS FILE IS
//   The "chart it" gesture, as a set of rules with no drawing in it. Squeeze a
//   star and hold: over two seconds it drains toward a flat checkbox. Let go
//   early and it springs back. Hold to the end and it stays charted, so the
//   room can look, until it is squeezed (or double-clicked) again.
//   Only loaded when the `chartGesture` flag is on in config.json.
//
// HOW TO READ IT
//   Each star being charted has one number, `p`, from 0 (a full star) to 1
//   (a flat checkbox). `tick` moves it: up while held, down when let go early.
//   Whoever draws the star is told the new amount through `onAmount`, and told
//   when a star finishes charting or is restored through `onDone`.
// =============================================================================
export const DRAIN_SECONDS = 2; // how long a full squeeze takes
export const SPRING_SECONDS = 0.5; // how fast it springs back if let go early
export const RESTORE_SECONDS = 0.8; // how fast a charted star comes back when restored

const smooth = (p) => p * p * (3 - 2 * p); // ease in, ease out

/**
 * @param canChart  (id) => true if that star has a chartedAs line
 * @param onAmount  (id, amount 0..1) called whenever a star's amount changes
 * @param onDone    (id, charted true/false) called when a star becomes fully charted, or is restored
 */
export function createCharting({ canChart, onAmount = () => {}, onDone = () => {} }) {
  const entries = new Map();
  const entry = (id) => {
    if (!entries.has(id)) entries.set(id, { p: 0, shown: 0, holding: false, auto: false, charted: false, restoring: false });
    return entries.get(id);
  };
  function restore(id) {
    const e = entries.get(id);
    if (!e || (!e.charted && e.p === 0)) return;
    const was = e.charted;
    e.charted = false; e.holding = false; e.auto = false; e.restoring = true;
    if (was) onDone(id, false);
  }
  return {
    /** A squeeze starts on this star. On a star that is already charted, the squeeze restores it. Returns false if the star cannot be charted. */
    begin(id) {
      if (!canChart(id)) return false;
      const e = entry(id);
      if (e.charted) restore(id);
      else { e.holding = true; e.restoring = false; }
      return true;
    },
    /** The squeeze is let go. */
    end(id) { const e = entries.get(id); if (e) e.holding = false; },
    /** For a button or a key: chart it all the way without holding, or restore it if it is charted. */
    toggle(id) {
      if (!canChart(id)) return false;
      const e = entry(id);
      if (e.charted || e.auto) restore(id);
      else { e.auto = true; e.restoring = false; }
      return true;
    },
    restore,
    restoreAll() { for (const id of entries.keys()) restore(id); },
    /** Runs every frame. dt = seconds since the last frame. */
    tick(dt) {
      for (const [id, e] of entries) {
        if (e.charted) continue;
        if (e.holding || e.auto) {
          e.p = Math.min(1, e.p + dt / DRAIN_SECONDS);
          if (e.p >= 1) { e.charted = true; e.holding = false; e.auto = false; }
        } else if (e.p > 0) {
          e.p = Math.max(0, e.p - dt / (e.restoring ? RESTORE_SECONDS : SPRING_SECONDS));
          if (e.p === 0) e.restoring = false;
        }
        const amount = smooth(e.p);
        if (amount !== e.shown) { e.shown = amount; onAmount(id, amount); }
        if (e.charted) onDone(id, true);
      }
    },
    amount: (id) => entries.get(id)?.shown ?? 0,
    isCharted: (id) => Boolean(entries.get(id)?.charted),
    isBusy: (id) => { const e = entries.get(id); return Boolean(e && (e.holding || e.auto || e.charted || e.p > 0)); },
  };
}
