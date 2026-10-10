/**
 * THE YEARLY GOAL — Goodreads' Reading Challenge for screens (2.0.0, asked
 * for on r/ArabLetterboxd, 4 Oct 2026). "52 films in 2027", and episodes too.
 *
 * ALL LOCAL. A goal is a number to compare with what the library already
 * counts: the year's films and episodes come from the same prefix counts the
 * "this year" widget reads, and the goal itself is two integers in `meta`.
 * Nothing here needs an account or a network, and the only thing that ever
 * leaves the phone is the profile block's COUNTS, behind a switch and never
 * a title (see `goalWidgetValue` in `components/yearly-goal.tsx`).
 *
 * TWO HALVES IN ONE FILE. The rules — how far ahead you are by the day of the
 * year, when a nudge may interrupt — are pure and tested in
 * `yearly-goal.test.ts`. The reads and writes go through `@/db`, which is
 * required LAZILY inside the functions that need it: the test runner is the
 * preset-free Node one (see `jest.config.js`) and cannot load expo-sqlite, so
 * a top-level import would take the pure half down with it.
 */

export type GoalKind = 'films' | 'episodes';
export const GOAL_KINDS: readonly GoalKind[] = ['films', 'episodes'];

/** The two targets for one year, each optional. */
export type GoalTargets = { films?: number; episodes?: number };

/** `meta` keys. The per-year key carries the year so a 2027 goal set in
 *  December does not overwrite 2026's while it is still running. */
export const GOAL_ON_KEY = 'yearlyGoalOn';
export const GOAL_NUDGE_KEY = 'yearlyGoalNudge';
export const GOAL_ON_PROFILE_KEY = 'yearlyGoalOnProfile';
export const GOAL_NUDGED_AT_KEY = 'yearlyGoalNudgedAt';
export const goalKey = (year: number): string => `yearlyGoal:${year}`;

/** A target is a positive integer or nothing. Anything else typed, synced or
 *  corrupted reads as "no goal" rather than as a goal of NaN. */
const target = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
};

export function parseGoal(raw: string | null | undefined): GoalTargets {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as { films?: unknown; episodes?: unknown } | null;
    const out: GoalTargets = {};
    const f = target(v?.films);
    const e = target(v?.episodes);
    if (f != null) out.films = f;
    if (e != null) out.episodes = e;
    return out;
  } catch {
    return {};
  }
}

/** Empty string for "no goal", so a cleared goal is an empty row, not `{}`. */
export function serialiseGoal(g: GoalTargets): string {
  const out: GoalTargets = {};
  const f = target(g.films);
  const e = target(g.episodes);
  if (f != null) out.films = f;
  if (e != null) out.episodes = e;
  return Object.keys(out).length === 0 ? '' : JSON.stringify(out);
}

export const hasGoal = (g: GoalTargets): boolean => target(g.films) != null || target(g.episodes) != null;

export const daysInYear = (year: number): number => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365);

/** 1 on 1 January. UTC arithmetic on the local calendar date, so a clock
 *  change does not make the half hour after midnight belong to yesterday. */
export function dayOfYear(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86400000) + 1;
}

/** How much of `year` has gone by at `now`: all of a past year, none of a
 *  future one. The future case is what lets a 2027 goal be set in October
 *  2026 without reading as "2027 behind". */
export function elapsedDay(year: number, now: Date): number {
  if (year < now.getFullYear()) return daysInYear(year);
  if (year > now.getFullYear()) return 0;
  return dayOfYear(now);
}

export type Pace = {
  /** Where you would be if the year were spread evenly. */
  expected: number;
  /** Positive = ahead, negative = behind. */
  delta: number;
  /** 0–1, capped: a goal beaten by a mile is still one full ring. */
  pct: number;
  reached: boolean;
};

/**
 * Ahead or behind, BY THE DAY OF THE YEAR — Goodreads' rule. 52 films on day
 * 283 of 365 means 40 were due; 43 watched is "3 ahead", 38 is "2 behind".
 * Rounded, because "0.3 behind" is not a sentence anybody says.
 */
export function goalPace(target: number, done: number, dayOfYear: number, daysInYear: number): Pace {
  const expected = Math.round((target * dayOfYear) / daysInYear);
  return {
    expected,
    delta: done - expected,
    pct: target > 0 ? Math.min(1, done / target) : 0,
    reached: done >= target,
  };
}

/** One kind's standing: the shape the block draws and the profile publishes. */
export type GoalCell = { kind: GoalKind; target: number; done: number; delta: number; reached: boolean };

export function goalCells(targets: GoalTargets, done: Record<GoalKind, number>, year: number, now: Date): GoalCell[] {
  const day = elapsedDay(year, now);
  const days = daysInYear(year);
  const out: GoalCell[] = [];
  for (const kind of GOAL_KINDS) {
    const t = target(targets[kind]);
    if (t == null) continue;
    const p = goalPace(t, done[kind], day, days);
    out.push({ kind, target: t, done: done[kind], delta: p.delta, reached: p.reached });
  }
  return out;
}

/** The kind that is furthest behind, or null when nothing is — "never when
 *  ahead" starts here. A reached goal is never behind, whatever the day. */
export function mostBehind(cells: readonly GoalCell[]): { kind: GoalKind; by: number } | null {
  let worst: { kind: GoalKind; by: number } | null = null;
  for (const c of cells) {
    if (c.reached || c.delta >= 0) continue;
    if (!worst || -c.delta > worst.by) worst = { kind: c.kind, by: -c.delta };
  }
  return worst;
}

/** What a visitor's phone receives: counts only, re-checked on arrival the way
 *  every published value is, because the JSON was written by somebody else. */
export type PublishedGoal = { year: number; cells: GoalCell[] };

export function parsePublishedGoal(v: unknown): PublishedGoal | null {
  const o = v as { year?: unknown; cells?: unknown } | null;
  if (!o || typeof o.year !== 'number' || !Array.isArray(o.cells)) return null;
  const cells: GoalCell[] = [];
  for (const raw of o.cells as { kind?: unknown; target?: unknown; done?: unknown; delta?: unknown }[]) {
    const t = target(raw?.target);
    const done = typeof raw?.done === 'number' && raw.done >= 0 ? Math.floor(raw.done) : null;
    const delta = typeof raw?.delta === 'number' && Number.isFinite(raw.delta) ? Math.round(raw.delta) : null;
    if (t == null || done == null || delta == null || (raw.kind !== 'films' && raw.kind !== 'episodes')) continue;
    cells.push({ kind: raw.kind, target: t, done, delta, reached: done >= t });
  }
  return cells.length > 0 ? { year: o.year, cells } : null;
}

/** Early evening: the hour with a whole evening still ahead of it, unlike the
 *  memory's 21:00, which is for deciding what to watch, not whether to. */
export const GOAL_NUDGE_HOUR = 19;
export const GOAL_NUDGE_GAP_MS = 7 * 86400000;

/**
 * When the "you're behind" nudge should land, or null.
 *
 * THREE REASONS TO SAY NO, and the switch is OFF by default on top of them:
 * not behind (never when ahead, never once the goal is reached); one went out
 * inside the last week; or the nudge is off. Behind on an evening already
 * gone means tomorrow evening, not never — a goal is not date-bound the way a
 * memory is.
 *
 * IDEMPOTENT ACROSS SYNCS, and this is the subtle part. The scheduler cancels
 * everything and re-plans on every app open, so a nudge booked for tomorrow
 * would be wiped by tonight's second launch. `lastAt` is therefore the SLOT
 * that was booked, not a "sent" flag: while that slot is still in the future
 * it is simply booked again, and only once it has passed does the week start.
 */
export function goalNudgeAt(behind: boolean, now: Date, lastAt: number | null): number | null {
  if (!behind) return null;
  const t = now.getTime();
  if (lastAt != null && lastAt > t) return lastAt;
  if (lastAt != null && t - lastAt < GOAL_NUDGE_GAP_MS) return null;
  const at = new Date(now);
  at.setHours(GOAL_NUDGE_HOUR, 0, 0, 0);
  if (at.getTime() <= t) at.setDate(at.getDate() + 1);
  return at.getTime();
}

// ── the I/O half: `meta` through `@/db`, required lazily (see the header) ──

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dbm = () => require('@/db') as typeof import('@/db');

export const goalFor = (year: number): GoalTargets => parseGoal(dbm().getMeta(goalKey(year)));
export const setGoalFor = (year: number, g: GoalTargets): void => dbm().setMeta(goalKey(year), serialiseGoal(g));

/** ON unless switched off: a goal that is set is a goal that is wanted. Off
 *  keeps the numbers, so turning it back on is not a fresh start. */
export const goalOn = (): boolean => dbm().getMeta(GOAL_ON_KEY) !== '';
export const setGoalOn = (on: boolean): void => dbm().setMeta(GOAL_ON_KEY, on ? '1' : '');

/** OFF by default — asked for, never assumed. And never while the goal is off. */
export const goalNudgeOn = (): boolean => goalOn() && dbm().getMeta(GOAL_NUDGE_KEY) === '1';
export const setGoalNudgeOn = (on: boolean): void => dbm().setMeta(GOAL_NUDGE_KEY, on ? '1' : '');

/** Whether the PUBLIC profile carries the counts. On by default, like the
 *  streak and "this year" widgets, which publish the same kind of number. */
export const goalOnProfile = (): boolean => dbm().getMeta(GOAL_ON_PROFILE_KEY) !== '';
export const setGoalOnProfile = (on: boolean): void => dbm().setMeta(GOAL_ON_PROFILE_KEY, on ? '1' : '');

/** Where `year`'s goal stands today, from the counts the library already
 *  keeps. Empty when no target is set. */
export function goalStatus(year: number, now = new Date()): GoalCell[] {
  const targets = goalFor(year);
  if (!hasGoal(targets)) return [];
  const { episodesInYear, filmsInYear } = dbm();
  return goalCells(targets, { films: filmsInYear(year), episodes: episodesInYear(year) }, year, now);
}
