/**
 * "What should I watch tonight?" — answered from YOUR library, not a catalogue.
 *
 * WHY THIS IS NOT A RECOMMENDATION ENGINE. Half a dozen apps already answer
 * "find me a film" from a global catalogue, and they are better at it than we
 * would be. Not one of them knows that you are two episodes from finishing The
 * Bear, that you last opened Severance four days ago, or that you gave
 * Chernobyl five stars. That is the whole of the advantage here, and it is one
 * a catalogue app cannot copy, because it does not have your history.
 *
 * THREE ANSWERS, NEVER A PAGE OF THEM. The problem being solved is that
 * somebody is standing in front of a library they own and cannot choose. A
 * longer list is that problem, not the cure.
 *
 * TIME IS A FILTER; MOOD IS A NUDGE. This distinction is the design, and
 * getting it backwards ruins the feature in both directions. If you have half
 * an hour, a two-hour film is not a worse answer — it is a WRONG one, so time
 * excludes. Mood is a preference and a personal library is small, so filtering
 * on genre would routinely return nothing at all; it moves things up instead.
 *
 * UNKNOWN RUNTIME IS NOT ASSUMED SHORT. A film whose length we never fetched is
 * offered when there is room to be wrong and withheld when there is not.
 *
 * PURE, so every one of those judgements is testable without a database.
 */

export type Kind = 'continue' | 'finish' | 'movie' | 'start';

export type Candidate = {
  /** Stable id — the caller's route key. Also how two picks are told apart. */
  key: string;
  kind: Kind;
  /** What groups picks for variety: the show's id, or the film's own key. */
  group: string;
  title: string;
  poster: string | null;
  /** Length of the ONE thing you would watch now — an episode, not a season. */
  minutes: number | null;
  genres: readonly string[];
  /** Days since you last watched this show. Null for anything not started. */
  lastWatchedDaysAgo: number | null;
  /** Episodes left in the show. Null for films. */
  remaining: number | null;
  /** Your own rating out of 10, when you have given one. */
  stars: number | null;
  /** Known to be streaming somewhere you can reach. */
  available: boolean;
};

export type Time = 'short' | 'medium' | 'long' | 'any';
export type Want = 'continue' | 'new' | 'movie' | 'any';
export type Mood = 'light' | 'funny' | 'dark' | 'exciting' | 'any';

export type Ask = { time: Time; want: Want; mood: Mood };

/**
 * Deliberately overlapping, because a 60-minute episode is an honest answer to
 * both "half an hour to an hour" and "one to two hours" — and a person who
 * picks a band does not mean its edges to the minute.
 */
const BANDS: Record<Exclude<Time, 'any'>, [number, number]> = {
  short: [0, 35],
  medium: [20, 70],
  long: [55, 160],
};

const MOOD_GENRES: Record<Exclude<Mood, 'any'>, readonly string[]> = {
  light: ['Comedy', 'Animation', 'Family', 'Romance', 'Music'],
  funny: ['Comedy'],
  dark: ['Drama', 'Crime', 'Thriller', 'Horror', 'Mystery', 'War & Politics'],
  exciting: ['Action', 'Adventure', 'Science Fiction', 'Sci-Fi & Fantasy', 'Thriller', 'Action & Adventure'],
};

/** Does this fit the time somebody says they have? */
export function fitsTime(minutes: number | null, time: Time): boolean {
  if (time === 'any') return true;
  const [lo, hi] = BANDS[time];
  /*
   * AN UNKNOWN LENGTH IS OFFERED ONLY WHERE BEING WRONG IS CHEAP. Told "I have
   * twenty minutes", answering with something that might run two hours is the
   * single worst thing this screen can do. Told "one to two hours", the same
   * guess is a mild irritation.
   */
  if (minutes == null) return time === 'long';
  return minutes >= lo && minutes <= hi;
}

export function fitsWant(k: Kind, want: Want): boolean {
  switch (want) {
    case 'continue':
      return k === 'continue' || k === 'finish';
    case 'new':
      return k === 'start' || k === 'movie';
    case 'movie':
      return k === 'movie';
    default:
      return true;
  }
}

/**
 * How good an answer this is, given what was asked.
 *
 * Every term is something the app knows about YOU. Nothing here is a global
 * popularity score, because the one thing this screen has that a catalogue
 * does not is that it is answering about things you already chose once.
 */
export function score(c: Candidate, ask: Ask): number {
  let n = 0;

  // Two episodes from the end of something you started is the most satisfying
  // thing anybody can be offered — this is "finish something", folded in.
  if (c.remaining != null && c.remaining > 0 && c.remaining <= 4) n += 45 - c.remaining * 6;

  // Still warm. A show from last week is a thread you are holding; one from
  // three years ago is a decision, and a decision is what this screen is for
  // SAVING you from tonight.
  const d = c.lastWatchedDaysAgo;
  if (d != null) {
    if (d <= 7) n += 28;
    else if (d <= 30) n += 12;
    else if (d > 365) n -= 12;
  }

  if (ask.mood !== 'any') {
    const want = MOOD_GENRES[ask.mood];
    if (c.genres.some((g) => want.includes(g))) n += 30;
  }

  // You already told us this is good.
  if (c.stars != null) {
    if (c.stars >= 8) n += 16;
    else if (c.stars <= 4) n -= 10;
  }

  // An answer you cannot act on tonight is barely an answer.
  if (c.available) n += 10;

  return n;
}

/**
 * Three things to watch, and deliberately not three of the same thing.
 *
 * THE VARIETY RULE IS THE FEATURE. Ranked purely by score, a library mid-way
 * through one show returns that show's next three episodes — which is not a
 * choice, it is the Watch Next screen with extra steps. One pick per show, and
 * at most two of any one kind, so the three are genuinely different decisions.
 */
export function pickTonight(candidates: readonly Candidate[], ask: Ask, howMany = 3): Candidate[] {
  const ranked = candidates
    .filter((c) => fitsTime(c.minutes, ask.time) && fitsWant(c.kind, ask.want))
    .map((c) => ({ c, s: score(c, ask) }))
    // key breaks ties so the same library and the same question always give
    // the same answer — a picker that reshuffles on every render reads as broken
    .sort((a, b) => b.s - a.s || a.c.key.localeCompare(b.c.key));

  const out: Candidate[] = [];
  const groups = new Set<string>();
  const kinds = new Map<Kind, number>();
  for (const { c } of ranked) {
    if (out.length >= howMany) break;
    if (groups.has(c.group)) continue;
    if ((kinds.get(c.kind) ?? 0) >= 2) continue;
    out.push(c);
    groups.add(c.group);
    kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
  }

  /*
   * RATHER FEWER THAN THREE THAN A WRONG ONE. A brand-new library has two
   * films on a watchlist; padding to three would mean breaking the variety
   * rule or the time filter, and both produce an answer the person can see is
   * silly. Saying "here are two" is not a failure.
   */
  return out;
}
