/**
 * "The new season starts on the 18th and I am nine episodes behind."
 *
 * WHAT THIS ANSWERS that nothing else in the app does. Watch Next says what
 * comes next; the calendar says when the new season lands. Neither says the
 * one thing somebody actually wants to know in September — CAN I MAKE IT, and
 * at what pace. That is arithmetic over data already on the phone: the
 * episodes not yet watched, their runtimes, and the air date of the next
 * season's first episode.
 *
 * NOT THE SAME THING AS THE `catchup` NOTIFICATION, which has existed since
 * long before this and fires when two or fewer episodes remain in a season.
 * That is "finish something", and it knows nothing about a premiere.
 *
 * A PLAN IS A PACE, NOT A DEADLINE. "Nine episodes in 24 days" is a fact
 * nobody can act on; "two a week, done four days early" is a thing to do on
 * Tuesday. So the unit is episodes PER WEEK, rounded UP — a plan that needs
 * 1.4 episodes a week is a plan for two, and the slack shows up as finishing
 * early rather than as a promise quietly broken at the end.
 *
 * IT NEVER PROMISES WHAT IT CANNOT. When there is not enough time left, it
 * says so and gives the honest number, rather than a cheerful pace that
 * misses. Pure, so all of that is testable without a clock or a database.
 */

/** Everything one show contributes. Air dates are 'YYYY-MM-DD' local keys. */
export type Behind = {
  showId: number;
  showName: string;
  poster: string | null;
  /** Episodes aired and not watched, before the new season. */
  remaining: number;
  /** Total minutes of those, when runtimes are known. */
  minutes: number | null;
  /** 'YYYY-MM-DD' the next season starts. */
  premiere: string;
  /** Which season is arriving — for the sentence, not the maths. */
  season: number;
  /** Days since the show was last watched, when it ever was. */
  lastWatchedDaysAgo: number | null;
};

export type Plan = {
  showId: number;
  showName: string;
  poster: string | null;
  remaining: number;
  minutes: number | null;
  season: number;
  premiere: string;
  daysLeft: number;
  /** Rounded UP, so the plan finishes early rather than late. */
  perWeek: number;
  /** Days between finishing at that pace and the premiere. Never negative. */
  spareDays: number;
  /**
   * TRUE WHEN THE PACE IS NOT ACHIEVABLE at anything a person would call
   * watching — more than one a day. Said plainly rather than dressed up: the
   * honest answer to "can I finish Critical Role before Thursday" is no.
   */
  tight: boolean;
};

/** Whole days between two 'YYYY-MM-DD' keys. Negative if the second is past. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * More than one episode a day is not a plan, it is a weekend nobody has.
 * Seven a week is the ceiling above which this stops pretending.
 */
const MAX_PER_WEEK = 7;

export function planFor(b: Behind, today: string): Plan | null {
  // Nothing to catch up on, or the premiere already happened — in which case
  // the person is not behind for a premiere, they are just behind, and Watch
  // Next already covers that.
  if (b.remaining <= 0) return null;
  const daysLeft = daysBetween(today, b.premiere);
  if (daysLeft <= 0) return null;

  const weeks = daysLeft / 7;
  const perWeek = Math.max(1, Math.ceil(b.remaining / weeks));
  // At that pace, when does the last one land?
  const weeksNeeded = b.remaining / perWeek;
  const spareDays = Math.max(0, Math.floor(daysLeft - weeksNeeded * 7));

  return {
    showId: b.showId,
    showName: b.showName,
    poster: b.poster,
    remaining: b.remaining,
    minutes: b.minutes,
    season: b.season,
    premiere: b.premiere,
    daysLeft,
    perWeek,
    spareDays,
    tight: perWeek > MAX_PER_WEEK,
  };
}

/**
 * The plans worth showing, most urgent first.
 *
 * URGENCY IS PACE, NOT DATE. A premiere in three days with one episode left is
 * calm; one in six weeks with forty episodes left is the emergency. Sorting by
 * the premiere date — the obvious choice — puts them in exactly the wrong
 * order.
 */
export function plans(behind: readonly Behind[], today: string, limit = 5): Plan[] {
  return behind
    .map((b) => planFor(b, today))
    .filter((p): p is Plan => p != null)
    .sort((a, b) => b.perWeek - a.perWeek || a.daysLeft - b.daysLeft || a.showName.localeCompare(b.showName))
    .slice(0, limit);
}

/**
 * Are they keeping up?
 *
 * Compared against the pace the plan set when it was made, not against a fresh
 * one — a plan that silently recalculates every day can never be fallen behind
 * on, which makes the whole feature a decoration.
 */
export function onTrack(p: Plan, watchedSince: number, daysSincePlan: number): { behindBy: number; ok: boolean } {
  const due = Math.floor((daysSincePlan / 7) * p.perWeek);
  const behindBy = Math.max(0, due - watchedSince);
  return { behindBy, ok: behindBy === 0 };
}
