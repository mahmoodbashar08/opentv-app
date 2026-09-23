/**
 * ONE TAP, ONE SCREEN.
 *
 * Reported as "if I press a movie more than once it shows it three times",
 * and that is exactly what was happening: `router.push` stacks a screen every
 * time it is called, so two quick taps on a poster produced two identical
 * copies of the film, three taps three. Backing out then walked through them
 * one at a time, which reads as the app being stuck — you press back, the same
 * page is still there.
 *
 * It is not a poster problem. There are 234 `router.push` calls in this app
 * and not one of them guarded against it: every row, every card, every menu
 * item had the same bug. So the guard goes where all of them meet rather than
 * into 234 call sites, where the next screen someone writes would miss it.
 *
 * WHY PATCHING THE SINGLETON IS THE RIGHT SHAPE HERE. `router` is a plain
 * object exported once by expo-router, and every `import { router }` in the
 * app — and inside `Link` — reaches this same object. Wrapping its `push`
 * makes the rule true everywhere by construction, including in code that has
 * not been written yet. The alternative, a `pushOnce` helper, is only a rule
 * for the people who remember to import it.
 *
 * WHAT COUNTS AS A DOUBLE TAP: the same destination within 700ms. A different
 * destination always goes through, so tapping quickly along a row of posters
 * still works. 700ms is longer than the push animation and far longer than a
 * human double tap; nobody deliberately opens the same screen twice inside it.
 *
 * `replace` and `back` are left alone. `replace` swaps rather than stacks and
 * `back` cannot stack; the bug is `push`'s alone.
 */
import { router } from 'expo-router';

const WINDOW_MS = 700;

let lastHref = '';
let lastAt = 0;

/** Exported for the test — the decision, without the router. */
export function isDuplicatePush(href: string, now: number): boolean {
  if (href === lastHref && now - lastAt < WINDOW_MS) return true;
  lastHref = href;
  lastAt = now;
  return false;
}

/** Called once, from the root layout. Idempotent: a fast refresh that
 *  re-runs this module must not wrap the wrapper. */
let installed = false;
export function installNavGuard(): void {
  if (installed) return;
  installed = true;
  const push = router.push.bind(router);
  router.push = ((href: Parameters<typeof router.push>[0], options?: Parameters<typeof router.push>[1]) => {
    // A non-string href (the object form) is keyed on its serialisation —
    // same destination, same string.
    const key = typeof href === 'string' ? href : JSON.stringify(href);
    if (isDuplicatePush(key, Date.now())) return;
    return push(href, options);
  }) as typeof router.push;
}
