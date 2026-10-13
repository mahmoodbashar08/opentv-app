/**
 * "Guess the title" — the daily puzzle's rules, with no I/O.
 *
 * ONE TITLE A DAY, SIX TRIES, A CLUE PER MISS. A show or, since 14 Oct, a
 * film — whichever the day picks out of what the player has watched. Wordle's lesson is not the word
 * game, it is the shape: one puzzle for everybody today, a grid of squares that
 * says how it went without saying what it was, and a streak that makes
 * tomorrow matter. The edge nobody else has is WHERE THE SHOW COMES FROM — a
 * still from a show the player has actually watched, which `puzzle-data.ts`
 * picks from the library. Framed and Moviedle cannot do that; they do not have
 * your history.
 *
 * PURE, like `games.ts` and `notification-plan.ts`: every judgement here —
 * which show today, what a miss reveals, whether the streak survived the night,
 * what the share text says — is a function of plain values, so it is tested
 * under Node and the screen only draws. `puzzle-data.ts` is the half that
 * reads SQLite.
 *
 * DAYS ARE 'YYYY-MM-DD' IN THE PHONE'S OWN ZONE (`localDayStamp`), never UTC:
 * a puzzle that changed at 01:00 for half of Europe would be a different game
 * from the one the share text claims.
 */

import type { LocaleKey } from '@/locales/keys';

export const MAX_TRIES = 6;

/**
 * Puzzle #1 is this day; the number in the share text counts up from it.
 *
 * FIXED, AND NEVER MOVED AFTER RELEASE: "#12" has to mean the same day on
 * every phone, or two friends comparing grids are talking about different
 * shows. Days before it clamp to 1 rather than going negative on a phone whose
 * clock is wrong.
 */
export const PUZZLE_EPOCH = '2026-11-01';

/**
 * How blurred the still is before each miss, as `expo-image`'s `blurRadius`.
 *
 * The first two entries ARE the first two clues ("very blurred" → "less
 * blurred"); after that the text clues take over and the picture keeps
 * sharpening a little each miss so the last try is nearly a plain frame. Zero
 * once the game is over, whatever happened — the reveal is part of the reward.
 */
export const BLUR: readonly number[] = [36, 20, 14, 10, 6, 3];

/**
 * In order of revelation: one per miss, the first one free.
 *
 * THE KIND COMES FIRST (14 Oct), once films joined: "Series · 2010" or
 * "Film · 2006" halves the answer box before anything else does, and it is the
 * fairest thing to give — a player who cannot tell a still from a film frame
 * has not lost anything they could have known. Then the genre; then what is
 * particular to the kind (network and seasons, or director and runtime); then
 * a lead actor; and last the character, which for a show is the one this
 * person voted for most.
 *
 * The country clue of 10 Oct went with this order; `ShowMeta.country` is still
 * cached and costs nothing where it is.
 */
export const CLUES = ['still', 'kindYear', 'genre', 'details', 'actor', 'character'] as const;
export type Clue = (typeof CLUES)[number];

// ── ids: a show or a film ───────────────────────────────────────────────────

/**
 * What a game, a guess and a history row call a title.
 *
 * A SHOW IS STILL A BARE NUMBER — its TheTVDB id, exactly as every save before
 * films stored it — so nothing already on a phone needs migrating: an old
 * game, an old history row and an old `avoid` list read as shows because that
 * is what they are. A FILM is a string, `m:<tmdbId>`, or `m:n:<name>` for a
 * library film nobody matched to TMDB (its name is the `movies` primary key).
 * The two cannot collide: a number is never equal to a string, and the `n:`
 * keeps a film called "603" from being TMDB's 603.
 */
export type PuzzleId = number | string;

export function filmId(tmdbId: number | null | undefined, name: string): string {
  return tmdbId ? `m:${tmdbId}` : `m:n:${name}`;
}

export function isFilmId(id: PuzzleId): id is string {
  return typeof id === 'string' && id.startsWith('m:');
}

/** A stored id from either era, or null for anything this build cannot read.
 *  `SKIP` (0) passes as the number it is. */
export function parseId(v: unknown): PuzzleId | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && /^m:(\d+|n:.+)$/.test(v)) return v;
  return null;
}

// ── days ────────────────────────────────────────────────────────────────────

/** A day stamp as a UTC midnight, which is the only clock arithmetic that
 *  does not slip an hour at the DST change. */
function utcMidnight(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** `b - a` in whole days. Negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMidnight(b) - utcMidnight(a)) / 86_400_000);
}

export function shiftDay(day: string, n: number): string {
  const d = new Date(utcMidnight(day) + n * 86_400_000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function puzzleNumber(day: string): number {
  return Math.max(1, daysBetween(PUZZLE_EPOCH, day) + 1);
}

// ── which show today ────────────────────────────────────────────────────────

/** FNV-1a over the day stamp. Small, stable, and nothing to do with
 *  `Math.random`: the same day must pick the same show on every open. */
export function hashDay(day: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Today's show out of the candidates.
 *
 * SORTED FIRST, so the order rows come out of SQLite in cannot change the
 * answer between two opens of the same day. `avoid` is what was played
 * recently; it is honoured when there is anything left after it and ignored
 * when there is not, because a tiny library must still get a puzzle rather
 * than none.
 *
 * The caller PINS the result for the day (`puzzle-data.ts`) — adding a show
 * at lunchtime would otherwise shift the index and change the afternoon's
 * answer under a game already in progress.
 */
export function pickForDay(day: string, ids: readonly PuzzleId[], avoid: readonly PuzzleId[] = []): PuzzleId | null {
  const sorted = [...new Set(ids)].sort(byId);
  if (!sorted.length) return null;
  const skip = new Set(avoid);
  const fresh = sorted.filter((id) => !skip.has(id));
  const pool = fresh.length ? fresh : sorted;
  return pool[hashDay(day) % pool.length];
}

/**
 * Shows by number, then films by code unit — the order the pick indexes into.
 *
 * NUMBERS EXACTLY AS BEFORE, so a library with no watched film is sorted, and
 * therefore answered, the way it was before films existed. Films compare with
 * `<`, never `localeCompare`: the order must not depend on the phone's
 * language, or two phones with the same library would disagree about today.
 */
function byId(a: PuzzleId, b: PuzzleId): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Below this many library candidates the bundled classics join the pool. */
export const MIN_LIBRARY_POOL = 10;

/**
 * The ids today may be picked from: the library's watched shows AND films
 * with a picture, and the bundled classics only while those are fewer than
 * `MIN_LIBRARY_POOL`. A watched film counts towards the ten exactly as a show
 * does — a library of four shows and six films is a library, not a new
 * install. The classics are all shows: no bundled film carries a title.
 */
export function candidatePool(library: readonly PuzzleId[], classics: readonly PuzzleId[]): PuzzleId[] {
  return library.length >= MIN_LIBRARY_POOL ? [...library] : [...library, ...classics];
}

/** Same hash, for choosing one still out of several — a different lane from
 *  the show pick so the two do not move together. */
export function pickIndex(day: string, count: number, lane = 1): number {
  if (count <= 0) return 0;
  return hashDay(`${day}#${lane}`) % count;
}

// ── one game ────────────────────────────────────────────────────────────────

/** A skipped try. Shown as ⬛: it cost a try, it was not a wrong show. */
export const SKIP = 0;

export type Game = {
  day: string;
  /** The answer: a show's TheTVDB id, or a film's `m:` key. */
  id: PuzzleId;
  /** Each try, in order: an id as above, or `SKIP`. */
  guesses: PuzzleId[];
  won: boolean;
};

export function newGame(day: string, id: PuzzleId): Game {
  return { day, id, guesses: [], won: false };
}

export function isOver(g: Game): boolean {
  return g.won || g.guesses.length >= MAX_TRIES;
}

/** One try. A finished game ignores further guesses rather than growing. */
export function guess(g: Game, id: PuzzleId): Game {
  if (isOver(g)) return g;
  return { ...g, guesses: [...g.guesses, id], won: id === g.id };
}

/** Wrong tries so far — what decides which clues are showing. */
export function misses(g: Game): number {
  return g.won ? g.guesses.length - 1 : g.guesses.length;
}

/** How many of `CLUES` are revealed: the first is free, one more per miss,
 *  and all of them once the game is over — the reveal is the reward. */
export function cluesShown(g: Game): number {
  return isOver(g) ? CLUES.length : Math.min(misses(g) + 1, CLUES.length);
}

export function blurFor(g: Game): number {
  return isOver(g) ? 0 : BLUR[Math.min(misses(g), BLUR.length - 1)];
}

/** 🟥 wrong, 🟩 right, ⬛ skipped — the grid people post. */
export function squares(g: Game): string {
  return g.guesses.map((id) => (id === g.id ? '🟩' : id === SKIP ? '⬛' : '🟥')).join('');
}

/**
 * "🎬 OpenTV #12 🟥🟥🟩 3/6 🔥 7" — the one line that is the same in every
 * language, because every character in it is a number or a square. A loss is
 * X/6, as Wordle writes it; the streak is left off when there is none, since
 * "🔥 0" is a sentence about losing.
 */
export function shareText(number: number, g: Game, streak: number): string {
  const score = g.won ? `${g.guesses.length}/${MAX_TRIES}` : `X/${MAX_TRIES}`;
  return `🎬 OpenTV #${number} ${squares(g)} ${score}${streak > 0 ? ` 🔥 ${streak}` : ''}`;
}

// ── the streak ──────────────────────────────────────────────────────────────

/**
 * Days in a row with a finished puzzle, and the one freeze that saves it.
 *
 * `last` is the last day a puzzle was FINISHED — started does not count, or a
 * streak could be kept alive by opening the screen. `frozenOn` is the day the
 * freeze last stood in for a missed one; it is what makes the freeze weekly
 * rather than infinite.
 */
export type Streak = { n: number; last: string | null; frozenOn: string | null };

export const NO_STREAK: Streak = { n: 0, last: null, frozenOn: null };

/** One freeze a week: a rolling week, counted from the day it was last spent. */
export const FREEZE_DAYS = 7;

export function freezeAvailable(s: Streak, today: string): boolean {
  return s.frozenOn == null || daysBetween(s.frozenOn, today) >= FREEZE_DAYS;
}

/**
 * The streak after today's puzzle is finished.
 *
 * Yesterday → one more. The day before yesterday → one more, and the freeze
 * is spent on the day in between, IF it was available. Anything further back,
 * or a second missed day inside the freeze's week, starts over at one. The
 * freeze's cooldown is kept across a restart so a lost streak cannot be
 * restarted with a fresh freeze the same week.
 */
export function streakAfterPlay(s: Streak, today: string): Streak {
  if (s.last === today) return s;
  const gap = s.last ? daysBetween(s.last, today) : Infinity;
  if (gap === 1) return { ...s, n: s.n + 1, last: today };
  if (gap === 2 && freezeAvailable(s, today)) return { n: s.n + 1, last: today, frozenOn: shiftDay(today, -1) };
  return { n: 1, last: today, frozenOn: s.frozenOn };
}

/**
 * The streak as it stands today, before today's puzzle.
 *
 * TODAY OR YESTERDAY KEEPS IT, like `watchStreak` in db.ts: showing a broken
 * streak every morning to somebody who plays in the evening is a lie about
 * them. Two days ago keeps it too while the freeze can still cover yesterday —
 * playing today will spend it. Anything else is zero.
 */
export function liveStreak(s: Streak, today: string): number {
  if (!s.last || s.n === 0) return 0;
  const gap = daysBetween(s.last, today);
  if (gap <= 1) return s.n;
  if (gap === 2 && freezeAvailable(s, today)) return s.n;
  return 0;
}

/**
 * Would not playing today end the streak? This is the only question the
 * reminder asks — "about to break", never "you have not played yet".
 *
 * Not at risk when: already played today; no streak to lose; or yesterday was
 * played and a freeze is there to cover today. At risk when yesterday was
 * played with no freeze left, or when the freeze is already standing in for
 * yesterday and today is the last chance to claim it.
 */
export function streakAtRisk(s: Streak, today: string): boolean {
  if (!s.last || s.last === today || liveStreak(s, today) === 0) return false;
  const gap = daysBetween(s.last, today);
  return gap === 2 || !freezeAvailable(s, today);
}

// ── history: the month of squares ───────────────────────────────────────────

export type Result = { d: string; id: PuzzleId; tries: number; won: boolean };

/** Over a year of days. The profile block reads a month; the picker avoids
 *  the last sixty answers; nothing needs more. */
export const HISTORY_MAX = 400;

export function resultOf(g: Game): Result {
  return { d: g.day, id: g.id, tries: g.guesses.length, won: g.won };
}

/** One row per day, newest last. A day replayed (it cannot be, but a bad
 *  write must not double it) replaces its row. */
export function withResult(history: readonly Result[], r: Result): Result[] {
  return [...history.filter((h) => h.d !== r.d), r].sort((a, b) => a.d.localeCompare(b.d)).slice(-HISTORY_MAX);
}

/** The last `n` answers, for `pickForDay`'s `avoid`. */
export function recentIds(history: readonly Result[], n = 60): PuzzleId[] {
  return history.slice(-n).map((h) => h.id);
}

/**
 * How strongly a day's square is coloured: 6 for a first-try win down to 1 for
 * a sixth-try one, 0 for a loss. The block mixes the green by this, so "dark
 * green = first try … grey = lost" is one number, not six colours.
 */
export function winLevel(r: Result): number {
  return r.won ? Math.max(1, MAX_TRIES + 1 - r.tries) : 0;
}

/**
 * What the profile block is drawn from, on either phone.
 *
 * COUNTS AND COLOURS ONLY. The streak, and one level per day played this
 * month. No id and no title: the server never learns which shows anybody
 * guessed, and a visitor's phone could not use them anyway.
 */
export type PublicPuzzle = { n: number; days: [string, number][] };

export function publicPuzzle(history: readonly Result[], streak: number, month: string): PublicPuzzle {
  return {
    n: streak,
    days: history.filter((r) => r.d.startsWith(month)).map((r) => [r.d, winLevel(r)]),
  };
}

/** A published value from somebody else's phone — tolerant, like
 *  `parsePublished`: a shape this build does not recognise draws nothing. */
export function parsePublicPuzzle(v: unknown): PublicPuzzle | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { n?: unknown; days?: unknown };
  const n = typeof o.n === 'number' && Number.isFinite(o.n) ? Math.max(0, Math.floor(o.n)) : 0;
  const days: [string, number][] = [];
  if (Array.isArray(o.days)) {
    for (const item of o.days) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'number') continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item[0])) continue;
      days.push([item[0], Math.min(MAX_TRIES, Math.max(0, Math.floor(item[1])))]);
    }
  }
  return { n, days };
}

// ── saves from either era ───────────────────────────────────────────────────

/**
 * Today's saved game, as `puzzle.game` holds it, or null — yesterday's is not
 * resumed, and neither is a shape this build cannot read. A game saved before
 * films (every id a number) passes unchanged: see `PuzzleId`.
 */
export function parseGame(v: unknown, day: string): Game | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Partial<Record<keyof Game, unknown>>;
  const id = parseId(o.id);
  if (o.day !== day || id == null || !Array.isArray(o.guesses)) return null;
  const guesses = o.guesses.map(parseId);
  if (guesses.some((x) => x == null)) return null;
  return { day, id, guesses: guesses as PuzzleId[], won: o.won === true };
}

/** The history, rows from either era; a row this build cannot read is dropped
 *  rather than taking the whole month with it. */
export function parseHistory(v: unknown): Result[] {
  if (!Array.isArray(v)) return [];
  const out: Result[] = [];
  for (const r of v) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Partial<Record<keyof Result, unknown>>;
    const id = parseId(o.id);
    if (typeof o.d !== 'string' || id == null) continue;
    out.push({ d: o.d, id, tries: typeof o.tries === 'number' ? o.tries : 0, won: o.won === true });
  }
  return out;
}

// ── the clues ───────────────────────────────────────────────────────────────

/**
 * What the phone knows about today's answer, gathered by `puzzle-data.ts`.
 * Any field may be null; the kind never is.
 */
export type Clues = {
  kind: 'show' | 'film';
  year: string | null;
  genre: string | null;
  /** Shows. */
  network: string | null;
  seasons: number | null;
  /** Films. */
  director: string | null;
  runtime: number | null;
  actor: string | null;
  character: string | null;
};

/** One translatable piece of a clue row: a key and its values. */
export type CluePart = [key: LocaleKey, params?: Record<string, string | number>];

/**
 * The pieces of one clue row, which the screen translates and joins with " · ".
 *
 * WHAT EXISTS, AND NOTHING INVENTED: a film with no director cached says its
 * runtime alone, and a row with nothing at all comes back EMPTY — the screen
 * then says "nothing known here", exactly as a show missing its network
 * always has. The kind row is never empty: the kind is always known.
 */
export function clueParts(clue: Clue, c: Clues): CluePart[] {
  const film = c.kind === 'film';
  const parts: (CluePart | null)[] = [];
  switch (clue) {
    case 'kindYear':
      parts.push(
        [film ? 'puzzleTitles.kindFilm' : 'puzzleTitles.kindShow'],
        c.year ? [film ? 'puzzleTitles.released' : 'puzzle.clueYear', { year: c.year }] : null,
      );
      break;
    case 'genre':
      parts.push(c.genre ? ['puzzle.clueGenre', { genre: c.genre }] : null);
      break;
    case 'details':
      if (film) {
        parts.push(
          c.director ? ['puzzleTitles.director', { name: c.director }] : null,
          c.runtime ? ['puzzleTitles.runtime', { count: c.runtime }] : null,
        );
      } else {
        parts.push(
          c.network ? ['puzzle.clueNetwork', { network: c.network }] : null,
          c.seasons ? ['show.seasonsCount', { count: c.seasons }] : null,
        );
      }
      break;
    case 'actor':
      parts.push(c.actor ? ['puzzleTitles.actor', { name: c.actor }] : null);
      break;
    case 'character':
      parts.push(c.character ? ['puzzle.clueCharacter', { name: c.character }] : null);
      break;
    default:
      break;
  }
  return parts.filter((p): p is CluePart => p != null);
}

/** Case-insensitive, diacritic-insensitive "does this title match what was
 *  typed", so "la casa de papel" finds "La Casa de Papel" and "pokemon" finds
 *  "Pokémon". Nothing cleverer: the list is one library, not a search engine. */
export function titleMatches(name: string, query: string): boolean {
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const q = fold(query.trim());
  return q.length > 0 && fold(name).includes(q);
}
