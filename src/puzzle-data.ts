/**
 * The daily puzzle's reads and writes — the half of `puzzle.ts` that touches
 * SQLite, the cached metadata and, once per picture, the network.
 *
 * THE SPLIT, as `tonight.ts` / `tonight-data.ts` have it: every judgement is
 * in `puzzle.ts` and tested; this file gathers and stores, and decides
 * nothing that could be wrong in an interesting way.
 *
 * EVERYTHING LIVES IN `meta`, under `puzzle.` keys. Turning the game off is
 * one flag; the history, the streak and today's game stay exactly where they
 * were, so switching it back on is not a fresh start. `wipeAllData` clears
 * `meta` with everything else.
 *
 * WHERE TODAY'S SHOW COMES FROM. The library first — a show with at least one
 * watched episode and a picture to blur — which is the edge no catalogue game
 * has. When fewer than ten of those exist (a new install, a watchlist-only
 * library), the bundled classics (`src/data/metadata.json`, 113 shows with
 * artwork) are added to the pool, so the first day has a puzzle too. The pick
 * is PINNED for the day the moment it is made: the library can change at
 * lunchtime, the answer cannot.
 *
 * NOTHING IS UPLOADED. The one request this file can make is to TMDB for a
 * textless backdrop of a show that has no watched still, the same request the
 * metadata sync already makes for artwork; its answer is cached under
 * `puzzle.pic:<id>` and never asked twice.
 */
import { getMeta, getProfileLayout, getWatchedSet, puzzleShows, puzzleTopCharacter, setMeta } from '@/db';
import { currentLocale } from '@/i18n';
import metadata, { showMeta, type ShowMeta } from '@/metadata';
import { reminderHourOf } from '@/notification-plan';
import { isPlus } from '@/plus';
import { parseLayout, publishableWidgets } from '@/profile-layout';
import { localDayStamp } from '@/pure';
import {
  NO_STREAK,
  liveStreak,
  newGame,
  pickForDay,
  pickIndex,
  publicPuzzle,
  recentIds,
  resultOf,
  streakAfterPlay,
  streakAtRisk,
  withResult,
  type Game,
  type PublicPuzzle,
  type Result,
  type Streak,
} from '@/puzzle';
import { tmdb } from '@/tmdb';

const K = {
  off: 'puzzle.off',
  game: 'puzzle.game',
  streak: 'puzzle.streak',
  history: 'puzzle.history',
  remind: 'puzzle.remind',
  remindHour: 'puzzle.remindHour',
  public: 'puzzle.public',
} as const;

export const today = (): string => localDayStamp(new Date());

// ── settings ────────────────────────────────────────────────────────────────

/** On unless switched off: the game is free and for everybody. */
export function puzzleOn(): boolean {
  return getMeta(K.off) !== '1';
}
export function setPuzzleOn(on: boolean): void {
  setMeta(K.off, on ? '' : '1');
}

/** OFF BY DEFAULT. A reminder is asked for, never assumed — not Duolingo's reputation. */
export function puzzleReminderOn(): boolean {
  return getMeta(K.remind) === '1';
}
export function setPuzzleReminderOn(on: boolean): void {
  setMeta(K.remind, on ? '1' : '');
}

/** Same default and same parsing as the episode reminders' hour. */
export function puzzleReminderHour(): number {
  return reminderHourOf(getMeta(K.remindHour));
}
export function setPuzzleReminderHour(hour: number): void {
  setMeta(K.remindHour, String(reminderHourOf(String(hour))));
}

/**
 * Whether the streak and the squares may appear on the PUBLIC profile. On by
 * default: the block itself is opt-in (it has to be placed), and what it
 * publishes is counts and colours, never a title — see `publicPuzzle`.
 */
export function puzzlePublicOn(): boolean {
  return getMeta(K.public) !== '';
}
export function setPuzzlePublicOn(on: boolean): void {
  setMeta(K.public, on ? '1' : '');
}

// ── state ───────────────────────────────────────────────────────────────────

function parse<T>(key: string): T | null {
  try {
    return JSON.parse(getMeta(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

export function loadStreak(): Streak {
  const v = parse<Partial<Streak>>(K.streak);
  return v && typeof v.n === 'number' ? { n: v.n, last: v.last ?? null, frozenOn: v.frozenOn ?? null } : NO_STREAK;
}

export function loadHistory(): Result[] {
  const v = parse<unknown>(K.history);
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is Result =>
      typeof r === 'object' && r !== null && typeof (r as Result).d === 'string' && typeof (r as Result).id === 'number',
  );
}

/** Today's game as it was left, or null — yesterday's is not resumed. */
export function loadGame(day: string): Game | null {
  const g = parse<Game>(K.game);
  return g && g.day === day && typeof g.id === 'number' && Array.isArray(g.guesses) ? g : null;
}

/** After every guess, so an app killed mid-game comes back where it was. */
export function saveGame(g: Game): void {
  setMeta(K.game, JSON.stringify(g));
}

// ── the answers ─────────────────────────────────────────────────────────────

export type Answer = {
  id: number;
  tmdbId: number | null;
  /** As the library knows it. */
  name: string;
  /** Every name it answers to: the library's, and the catalogue's English one. */
  names: string[];
  poster: string | null;
  /** In this phone's library at all. */
  mine: boolean;
  /** With at least one watched episode — what makes it a candidate. */
  watched: boolean;
};

/**
 * Everything the answer box may suggest, library first.
 *
 * TWO NAMES PER SHOW, which is what "in any language" costs here: a library
 * imported from TV Time holds whatever title that export carried, often not
 * English, and the cached record holds the English translation. A guess is
 * matched by id, so typing either name finds the one show.
 */
export function answerPool(): Answer[] {
  const out = new Map<number, Answer>();
  for (const s of puzzleShows()) {
    const m = showMeta(s.tvdbId);
    const names = [...new Set([s.name, m?.name ?? ''].filter((n) => n.trim()))];
    out.set(s.tvdbId, {
      id: s.tvdbId,
      tmdbId: s.tmdbId || m?.tmdbId || null,
      name: s.name,
      names,
      poster: s.posterUrl ?? m?.poster ?? null,
      mine: true,
      watched: s.watched > 0,
    });
  }
  for (const [key, m] of Object.entries(metadata)) {
    const id = Number(key);
    if (out.has(id) || !m.name) continue;
    out.set(id, { id, tmdbId: m.tmdbId || null, name: m.name, names: [m.name], poster: m.poster, mine: false, watched: false });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Stills of episodes this person has WATCHED, in episode order — a frame from
 *  season five is a spoiler for somebody on season one, and a watched one is
 *  not. Empty for a show with no stills or no watches. */
function watchedStills(id: number, m: ShowMeta | undefined): string[] {
  if (!m?.episodes) return [];
  const seen = getWatchedSet(id);
  return Object.keys(m.episodes)
    .filter((k) => seen.has(k) && m.episodes[k]?.still)
    .sort((a, b) => {
      const [sa, ea] = a.split('-').map(Number);
      const [sb, eb] = b.split('-').map(Number);
      return sa - sb || ea - eb;
    })
    .map((k) => m.episodes[k].still as string);
}

/** A watched show with no picture cannot be blurred, so it cannot be asked. */
function hasPicture(id: number): boolean {
  const m = showMeta(id);
  return !!m?.backdrop || watchedStills(id, m).length > 0;
}

/** Below this many library candidates the bundled classics join the pool. */
export const MIN_LIBRARY_POOL = 10;

export function candidateIds(pool: readonly Answer[]): number[] {
  const mine = pool.filter((a) => a.mine && a.watched && hasPicture(a.id)).map((a) => a.id);
  if (mine.length >= MIN_LIBRARY_POOL) return mine;
  // Every bundled entry carries a backdrop, so none needs the check.
  return [...mine, ...pool.filter((a) => !a.mine).map((a) => a.id)];
}

/**
 * Today's game: the one in progress, or a fresh one pinned to today.
 *
 * Re-picked only if the pinned answer has left the pool — the show was deleted
 * from the library mid-game — since a game nobody can answer is worse than a
 * new one.
 */
export function todaysGame(day: string, pool: readonly Answer[]): Game | null {
  const saved = loadGame(day);
  if (saved && pool.some((a) => a.id === saved.id)) return saved;
  const id = pickForDay(day, candidateIds(pool), recentIds(loadHistory()));
  if (id == null) return null;
  const g = newGame(day, id);
  saveGame(g);
  return g;
}

// ── clues ───────────────────────────────────────────────────────────────────

export type Clues = {
  year: string | null;
  genre: string | null;
  country: string | null;
  network: string | null;
  seasons: number | null;
  character: string | null;
};

/**
 * A country, in the reader's language where the phone can say it.
 *
 * TMDB's code is alpha-2 and `Intl.DisplayNames` turns 'US' into "United
 * States" or "États-Unis"; TheTVDB's is alpha-3 ('usa'), which that API does
 * not take, so it is shown as a code. Hermes may not carry `DisplayNames` at
 * all, and the catch makes that the same answer as alpha-3: the code,
 * upper-cased — a clue, not a crash.
 */
function countryName(code: string | null | undefined): string | null {
  const c = (code ?? '').trim();
  if (!c) return null;
  if (c.length === 2) {
    try {
      const name = new Intl.DisplayNames([currentLocale()], { type: 'region' }).of(c.toUpperCase());
      if (name && name !== c.toUpperCase()) return name;
    } catch {
      // No DisplayNames on this runtime: the code will do.
    }
  }
  return c.toUpperCase();
}

/** "Conan Edogawa (voice)" → "Conan Edogawa"; a credit of "Self" or nothing
 *  is no clue at all. */
function castCharacter(raw: string | null | undefined): string | null {
  const name = (raw ?? '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .split(' / ')[0]
    .trim();
  return name && !/^(self|himself|herself|narrator)$/i.test(name) ? name : null;
}

/**
 * The four text clues, from what the phone already holds. Any of them may be
 * null — a record cached before `country` existed, a show nobody voted on and
 * TheTVDB lists no characters for — and the screen says so for that row
 * rather than inventing one.
 *
 * THE CHARACTER IS THEIRS FIRST: the one this person voted for most on this
 * show, before TheTVDB's featured list. A clue that is also a memory.
 */
export function cluesFor(id: number): Clues {
  const m = showMeta(id);
  return {
    year: m?.year ?? null,
    genre: m?.genres?.[0] ?? null,
    country: countryName(m?.country),
    network: m?.network ?? null,
    seasons: m?.totalSeasons || null,
    character: puzzleTopCharacter(id) ?? m?.characters?.[0]?.name ?? castCharacter(m?.cast?.[0]?.character),
  };
}

// ── the picture ─────────────────────────────────────────────────────────────

/**
 * The frame to blur, best source first:
 *
 *   1. A still of an episode this person watched — a real frame, no text, and
 *      spoiler-safe by construction. Which one is picked by the day.
 *   2. A textless backdrop from TMDB (`include_image_language=null`), asked
 *      for once and remembered — a backdrop with the title across it gives
 *      the game away on the first clue.
 *   3. The cached backdrop, whatever is on it.
 *   4. TheTVDB's background art.
 *
 * Null when the phone is offline and has never seen any of them; the text
 * clues still work and the screen says why the picture is missing.
 */
export async function pictureFor(a: Answer, day: string): Promise<string | null> {
  const m = showMeta(a.id);
  const stills = watchedStills(a.id, m);
  if (stills.length) return stills[pickIndex(day, stills.length)];

  const key = `puzzle.pic:${a.id}`;
  const cached = getMeta(key);
  if (cached) return cached;
  // '' means "asked, TMDB has no textless one" — not asked again.
  if (cached == null && a.tmdbId) {
    try {
      const d = await tmdb<{ backdrops?: { file_path?: string | null }[] }>(
        `/tv/${a.tmdbId}/images?include_image_language=null`,
      );
      const path = d.backdrops?.[0]?.file_path ?? null;
      const url = path ? `https://image.tmdb.org/t/p/w780${path}` : '';
      setMeta(key, url);
      if (url) return url;
    } catch {
      // Offline or rate-limited: nothing is remembered, so a later day asks again.
    }
  }
  if (m?.backdrop) return m.backdrop;
  try {
    // Lazy, as `catalog.ts` requires it: a top-level import of `@/tvdb` here
    // would pull the whole client into every screen that shows the card.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const t = require('@/tvdb') as typeof import('@/tvdb');
    return await t.tvdbSeriesBackground(a.id);
  } catch {
    return null;
  }
}

// ── finishing, the streak, the block ────────────────────────────────────────

/**
 * Record a finished game: the day's row in the history, the streak, and the
 * profile block if it is placed. Returns the streak as it now stands and
 * whether the freeze was spent getting there, so the screen can say so.
 */
export function finishGame(g: Game): { streak: Streak; frozen: boolean } {
  saveGame(g);
  setMeta(K.history, JSON.stringify(withResult(loadHistory(), resultOf(g))));
  const before = loadStreak();
  const after = streakAfterPlay(before, g.day);
  setMeta(K.streak, JSON.stringify(after));
  void republishPuzzleBlock();
  return { streak: after, frozen: after.frozenOn != null && after.frozenOn !== before.frozenOn };
}

/** The streak as it stands this morning, for the card and the block. */
export function currentStreak(day = today()): number {
  return liveStreak(loadStreak(), day);
}

/** What the owner's own block draws: this month's squares and the streak.
 *  Null when the game is off or nothing was ever played, so the block
 *  collapses like every other widget with nothing to say. */
export function puzzleBlockValue(day = today()): PublicPuzzle | null {
  if (!puzzleOn()) return null;
  const h = loadHistory();
  if (!h.length) return null;
  return publicPuzzle(h, currentStreak(day), day.slice(0, 7));
}

/** What LEAVES the phone with the arrangement: the same value, only while the
 *  owner allows it. Counts and colours — `publicPuzzle` carries no id. */
export function publishedPuzzleValue(): PublicPuzzle | null {
  return puzzlePublicOn() ? puzzleBlockValue() : null;
}

/**
 * Push the arrangement again with today's numbers.
 *
 * The profile tab publishes the arrangement when it is REARRANGED, which is
 * right for every other block and wrong for one whose value changes daily:
 * a visitor would see the streak as it was the day the block was placed. So
 * a finished game pushes it, and so does the public switch — turning it off
 * must take the value back off the server, not merely stop sending it.
 *
 * Plus only, exactly as the tab's own push is: arranging is Plus, and the
 * server stops serving a lapsed subscriber's arrangement anyway. A phone that
 * never joined has no token and `pushWidgets` returns before any request.
 */
export async function republishPuzzleBlock(): Promise<void> {
  try {
    if (!isPlus()) return;
    const items = parseLayout(getProfileLayout())?.items ?? [];
    if (!items.some((p) => p.id === 'puzzle')) return;
    // Lazy: `profile-widgets` draws the block from this file, so a top-level
    // import would be a cycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { widgetValue } = require('@/components/profile-widgets') as typeof import('@/components/profile-widgets');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pushWidgets } = require('@/community-profiles') as typeof import('@/community-profiles');
    await pushWidgets(JSON.stringify(publishableWidgets(items, (id, span, data) => widgetValue(id, span, data))));
  } catch {
    // Fire and forget, like the tab's push: a block a few minutes stale is not
    // worth interrupting anybody's evening.
  }
}

// ── the reminder ────────────────────────────────────────────────────────────

/**
 * When tonight's reminder should fire, or null: the game or the reminder is
 * off, today is already played, there is no streak that tonight would end,
 * or the chosen hour has passed. `notifications.ts` schedules it on every
 * sync, so "once a day" is the DATE trigger itself.
 */
export function puzzleReminderAt(now: Date): { at: number; streak: number } | null {
  if (!puzzleOn() || !puzzleReminderOn()) return null;
  const day = localDayStamp(now);
  const s = loadStreak();
  if (!streakAtRisk(s, day)) return null;
  const at = new Date(now);
  at.setHours(puzzleReminderHour(), 0, 0, 0);
  if (at.getTime() <= now.getTime()) return null;
  return { at: at.getTime(), streak: liveStreak(s, day) };
}
