/**
 * Stop asking when nothing is answering.
 *
 * THE FIFTEEN-MINUTE SPLASH. `runStartupRepairs` re-runs the preserved ZIP
 * through the importer, which looks every show up at TMDB through `pool()` at
 * a concurrency of ten. Every one of those requests already had a 15-second
 * abort, so no single call could hang — and that was never the problem.
 * `pool()` catches each failure, records a null and moves to the next item, so
 * with the network unreachable a 500-show library spends 500 / 10 x 15s
 * grinding through timeouts it has no reason to believe will succeed. Twelve
 * and a half minutes of holding the splash, writing nothing, with the CPU at
 * 8% because the only thing moving was the Popcorn game.
 *
 * The per-request timeout is the wrong place to fix that. It is already
 * correct: fifteen seconds is a fair wait for ONE request. What was missing is
 * that the four hundredth request has much better evidence than the first
 * about whether there is any point making it.
 *
 * So this is a circuit breaker, and it lives here rather than in the importer
 * because every caller of `tmdb()`, `tvdb()` and the image fetches routes
 * through the same two facts. A guard at each call site would be a guard at
 * the call sites that existed the day it was written.
 *
 * WHAT COUNTS AS A FAILURE IS THE WHOLE SUBTLETY. A 404 is an ANSWER: the
 * server is reachable and has told us the show is not there, so it must reset
 * the breaker, not trip it. Only a `fetch` that never produced a response —
 * an abort, a DNS failure, a dead socket — is evidence about the network. Get
 * this backwards and a library full of unmatched shows trips the breaker and
 * the import silently stops fetching anything.
 */

/** Consecutive network-level failures before the breaker opens.
 *
 *  Ten, because `pool` runs ten at a time: one full wave of in-flight requests
 *  failing together is the smallest sample that is actually evidence rather
 *  than one flaky socket. */
const THRESHOLD = 10;

/** How long the breaker stays open before one request is allowed through to
 *  test the water. Long enough that a dead network is not re-probed every few
 *  seconds, short enough that a phone coming back onto Wi-Fi mid-import
 *  recovers without a relaunch. */
const COOLDOWN_MS = 30_000;

let consecutive = 0;
let openedAt = 0;
let probing = false;
let deadline = 0;

/** Thrown instead of making a request the breaker believes will fail.
 *  Callers treat it exactly like any other fetch failure — `pool` records a
 *  null and moves on, which is the point: 490 nulls in a millisecond rather
 *  than 490 nulls in twelve minutes. */
export class NetworkDown extends Error {
  constructor() {
    super('network unavailable');
    this.name = 'NetworkDown';
  }
}

/**
 * True when the last `THRESHOLD` attempts all failed at the network level and
 * the cooldown has not yet elapsed.
 *
 * HALF-OPEN, not just open: once the cooldown passes, exactly one caller is
 * let through. If it succeeds the breaker closes and everything resumes; if it
 * fails the cooldown restarts. Letting them ALL through would put the import
 * straight back into a wave of fifteen-second timeouts, which is the thing
 * this exists to prevent.
 */
export function netIsOpen(): boolean {
  // THE BUDGET, and it is a different question from the breaker.
  //
  // The breaker asks "is anything answering". A budget asks "has this phase
  // had long enough", which is the one the splash actually needs: the startup
  // repair holds the launch, and a metadata pass that is succeeding slowly
  // holds it just as effectively as one that is failing. Watched on 19 Sep:
  // fifteen minutes, with the comment images downloading fine beforehand — so
  // the network was up and the breaker would never have fired.
  //
  // Nothing is lost by stopping. The library is already in SQLite; this pass
  // only decorates it with posters and ids, and the app fetches those lazily
  // at runtime anyway. A launch that finishes without artwork beats a launch
  // that does not finish.
  if (deadline && Date.now() > deadline) return true;
  if (consecutive < THRESHOLD) return false;
  if (Date.now() - openedAt < COOLDOWN_MS) return true;
  if (probing) return true; // a probe is already in flight; everybody else waits
  probing = true;
  return false;
}

/** Throws when the breaker is open. Call before a request, not after. */
export function netGuard(): void {
  if (netIsOpen()) throw new NetworkDown();
}

/**
 * A response arrived. Any response — 200, 404, 500.
 *
 * The status is deliberately not consulted. This records that the request
 * REACHED something, which is the only question the breaker asks.
 */
export function netReachable(): void {
  consecutive = 0;
  probing = false;
}

/** A request failed without producing a response. */
export function netUnreachable(): void {
  probing = false;
  consecutive += 1;
  if (consecutive === THRESHOLD) openedAt = Date.now();
  else if (consecutive > THRESHOLD) openedAt = Date.now(); // a failed probe restarts the cooldown
}

/**
 * Give the network phases of a long job a wall-clock ceiling.
 *
 * `netBudget(90_000)` before, `netBudget(null)` in a `finally` after — the
 * clear is not optional, or the whole app stays offline for the rest of the
 * session.
 */
export function netBudget(ms: number | null): void {
  deadline = ms == null ? 0 : Date.now() + ms;
}

/** Whether the budget, rather than the failures, is what stopped things. Lets
 *  a caller log or report "gave up on time" separately from "no network". */
export function netBudgetSpent(): boolean {
  return deadline !== 0 && Date.now() > deadline;
}

/** Test seam, and used when an import begins: a fresh run deserves a fresh
 *  judgement rather than inheriting one made minutes ago. */
export function netReset(): void {
  consecutive = 0;
  openedAt = 0;
  probing = false;
  deadline = 0;
}

/** Whether a thrown value is a network-level failure rather than an HTTP one.
 *
 *  `AbortError` is the 15-second timeout firing. React Native's fetch raises a
 *  bare `TypeError: Network request failed` when there is no route to the
 *  host. An `Error('TMDB 404')` is neither — it is this app's own wrapper
 *  around a perfectly good response, and must not count. */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof NetworkDown) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  return err instanceof TypeError && /network request failed|failed to fetch/i.test(err.message);
}
