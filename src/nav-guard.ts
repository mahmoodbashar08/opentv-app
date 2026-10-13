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
 *
 * AND NOTHING ELSE UNTIL THE SCREEN HAS ARRIVED (14 Oct). The 700ms window was
 * measured on the wall clock, and that is not the clock a slow open runs on.
 * "I press an episode, nothing happens, I press again, sometimes it opens
 * twice": while the new screen renders, the JS thread is busy and every tap
 * made in the meantime WAITS — then all of them arrive at once, after the
 * render, already more than 700ms after the first. The window had expired
 * before the second tap was even seen. A different row tapped in that dead
 * time got through for the same reason, stacking A, B and A again.
 *
 * So a push now also locks the router until the root stack says the new
 * screen's transition has ENDED — every push, whatever its destination — and
 * the queued taps land on the lock instead of on a second screen. A push that
 * never produces a transition (a destination that does not exist, a tab
 * switch) releases it after LOCK_MS instead, so the worst a missed event can
 * cost is one dead second and a half, never a stuck app.
 *
 * WHY NOT expo-router's `dangerouslySingular` (tried, 14 Oct). It makes a
 * route's id unique in the stack, but pushing an id that is already there
 * MOVES that screen to the top rather than ignoring the push — and the common
 * journey show → episode → the episode's show pill does exactly that. Moving
 * a presented transparentModal is something react-native-screens cannot do:
 * the app crashed to the home screen on the simulator. The lock gets the same
 * protection without reordering anything.
 */
import { router } from 'expo-router';

const WINDOW_MS = 700;
/** The longest a push can hold the router shut without its transition ending. */
const LOCK_MS = 1500;

let lastHref = '';
let lastAt = 0;
/** A push is still opening its screen until this time (0 = nothing opening). */
let lockedUntil = 0;

/** Exported for the test — the decision, without the router. */
export function isDuplicatePush(href: string, now: number): boolean {
  if (now < lockedUntil) return true;
  if (href === lastHref && now - lastAt < WINDOW_MS) return true;
  lastHref = href;
  lastAt = now;
  lockedUntil = now + LOCK_MS;
  return false;
}

/**
 * The root stack's `transitionEnd`: the screen that was opening is on screen,
 * so the next tap is a new decision. A CLOSING transition does not count — a
 * swipe back finishing just after a push must not open the lock that push set.
 * The same-destination window above stays in force after this; it is the
 * lock that ends here.
 */
export function navTransitionEnded(closing?: boolean): void {
  if (!closing) lockedUntil = 0;
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
