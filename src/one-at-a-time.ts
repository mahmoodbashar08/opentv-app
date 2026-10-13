/**
 * ONE TAP, ONE RUN — for the buttons whose work outlives the tap.
 *
 * `nav-guard` stops a double tap opening a screen twice. This is the same rule
 * for an action that awaits something first: capturing a share card, asking
 * TheTVDB for an id before adding a show. Nothing on those buttons changes
 * while the await runs, so a second tap — or the tap made twice because the
 * first seemed to do nothing — started the whole thing again: two share
 * sheets fighting to present, two lookups, two "couldn't add" alerts.
 *
 * KEYED, NOT PER BUTTON. The key says what must not overlap with itself, and
 * a module-level set holds the ones running, so the rule works the same from
 * a component, a module-level helper, or a button that is re-created on every
 * render. Every share uses the key `share`, deliberately: there is one share
 * sheet, and two share buttons on one screen cannot both have it either.
 */
const running = new Set<string>();

/** Run `fn` unless a run under the same key has not finished yet. */
export async function oneAtATime(key: string, fn: () => Promise<unknown>): Promise<void> {
  if (running.has(key)) return;
  running.add(key);
  try {
    await fn();
  } finally {
    running.delete(key);
  }
}
