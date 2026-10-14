/**
 * The daily puzzle's reads and writes — the half of `puzzle.ts` that touches
 * SQLite, the cached metadata and, once per picture, the network.
 *
 * THE SPLIT, as `tonight.ts` / `tonight-data.ts` have it: every judgement is
 * in `puzzle.ts` and tested; this file gathers and stores, and decides
 * nothing that could be wrong in an interesting way.
 *
 * EVERYTHING LIVES IN `meta`, under `puzzle.` keys. Turning the game off is
 * one flag; the history, the pinned answers and today's game stay exactly
 * where they were, so switching it back on is not a fresh start. The streak
 * of 10 Oct is gone (14 Oct); an old `puzzle.streak` is never read again.
 * `wipeAllData` clears `meta` with everything else.
 *
 * WHERE TODAY'S TITLE COMES FROM. The library first — a show watched enough
 * to be fair (four episodes or half of what aired, relaxed for a small
 * library: `libraryCandidates`), or (14 Oct) a film marked watched, with a
 * picture to blur — which is the edge no catalogue game has. When fewer than ten of those
 * exist (a new install, a watchlist-only library), the bundled classics
 * (`src/data/metadata.json`, 113 shows with artwork) are added to the pool, so
 * the first day has a puzzle too. There are no bundled classic FILMS: the
 * bundled film file is keyed by TMDB id and carries no title, so nothing in it
 * could be typed. The pick is PINNED for the day the moment it is made: the
 * library can change at lunchtime, the answer cannot — and neither can an
 * update. A phone that opened today's puzzle before films existed keeps
 * today's show; films join its pool from the next pick, which is tomorrow's.
 *
 * NOTHING IS UPLOADED. The requests this file can make are to TMDB: a
 * textless backdrop of a show that has no watched still, the same request the
 * metadata sync already makes for artwork, cached under `puzzle.pic:<id>`; and
 * for a film, the film page's own `/movie/{id}` with its credits, cached under
 * `puzzle.film:<tmdbId>`. One answer a day, each asked once.
 */
import { getMeta, getProfileLayout, getWatchedSet, puzzleFilms, puzzleShows, puzzleTopCharacter, setMeta } from '@/db';
import metadata, { showMeta, type ShowMeta } from '@/metadata';
import { movieMeta } from '@/movie-metadata';
import { reminderHourOf } from '@/notification-plan';
import { isPlus } from '@/plus';
import { parseLayout, publishableWidgets } from '@/profile-layout';
import { displayTitle, localDayStamp, parseAltTitles } from '@/pure';
import {
  filmId,
  isOver,
  libraryCandidates,
  newGame,
  parseGame,
  parseHistory,
  parsePinned,
  pickAnswer,
  pickPicture,
  publicPuzzle,
  puzzleStats,
  resultOf,
  usedPictures,
  withPinned,
  withResult,
  type Clues,
  type Game,
  type Pinned,
  type PublicPuzzle,
  type PuzzleId,
  type Result,
  type Stats,
} from '@/puzzle';
import { airedTotalOf } from '@/show-status';
import { tmdb } from '@/tmdb';

const K = {
  off: 'puzzle.off',
  game: 'puzzle.game',
  history: 'puzzle.history',
  /** Every day ever opened and its answer — `Pinned`. */
  answers: 'puzzle.answers',
  /** Archive results, kept APART from the history so they never move the
   *  stats or the profile's month: replaying March in October is not
   *  playing in March. */
  archive: 'puzzle.archive',
  /** The one archive game in progress. */
  archiveGame: 'puzzle.archiveGame',
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
 * Whether the stats and the squares may appear on the PUBLIC profile. On by
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

/** Rows from before films (numeric ids) and after read alike — `parseHistory`. */
export function loadHistory(): Result[] {
  return parseHistory(parse<unknown>(K.history));
}

/** Archive results — never part of the stats. */
export function loadArchive(): Result[] {
  return parseHistory(parse<unknown>(K.archive));
}

/** Today's game as it was left, or null — yesterday's is not resumed. With
 *  `archive`, the archive game for that day instead. */
export function loadGame(day: string, archive = false): Game | null {
  return parseGame(parse<unknown>(archive ? K.archiveGame : K.game), day);
}

/** After every guess, so an app killed mid-game comes back where it was. */
export function saveGame(g: Game, archive = false): void {
  setMeta(archive ? K.archiveGame : K.game, JSON.stringify(g));
}

/**
 * Every pinned day, with the history and the archive folded in: a day played
 * before `puzzle.answers` existed (14 Oct) still counts as that day's answer,
 * so the first pick after the update avoids it too.
 */
function loadPinned(): Pinned[] {
  let list = parsePinned(parse<unknown>(K.answers));
  const known = new Set(list.map((p) => p.d));
  for (const r of [...loadHistory(), ...loadArchive()]) {
    if (!known.has(r.d)) list = withPinned(list, { d: r.d, id: r.id, pic: null });
  }
  return list;
}

function savePin(p: Pinned): void {
  setMeta(K.answers, JSON.stringify(withPinned(parsePinned(parse<unknown>(K.answers)), p)));
}

// ── the answers ─────────────────────────────────────────────────────────────

export type Answer = {
  id: PuzzleId;
  kind: 'show' | 'film';
  tmdbId: number | null;
  /** As the library knows it. */
  name: string;
  /** Every name it answers to: the library's, and the catalogue's English one. */
  names: string[];
  poster: string | null;
  /** In this phone's library at all. */
  mine: boolean;
  /** With at least one watched episode, or a film marked watched — the first
   *  half of what makes it a candidate; `libraryCandidates` is the second. */
  watched: boolean;
  /** Shows in the library: distinct episodes watched. */
  seen?: number;
  /**
   * First-air year for a show, release year for a film, or null. Printed
   * after every suggestion (14 Oct), because a title alone cannot tell
   * Avatar: The Last Airbender 2005 from 2024, nor the two Deathly Hallows.
   */
  year: string | null;
  /** Films only, from the library row: the key `/movie/[name]` opens, the
   *  year and runtime (minutes) the clues start from, and when it was watched. */
  film?: { name: string; year: string | null; runtime: number | null; watchedAt: string | null };
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
  const out = new Map<PuzzleId, Answer>();
  for (const s of puzzleShows()) {
    const m = showMeta(s.tvdbId);
    const names = [...new Set([s.name, m?.name ?? ''].filter((n) => n.trim()))];
    out.set(s.tvdbId, {
      id: s.tvdbId,
      kind: 'show',
      tmdbId: s.tmdbId || m?.tmdbId || null,
      name: s.name,
      names,
      poster: s.posterUrl ?? m?.poster ?? null,
      mine: true,
      watched: s.watched > 0,
      seen: s.watched,
      year: m?.year?.slice(0, 4) || null,
    });
  }
  for (const [key, m] of Object.entries(metadata)) {
    const id = Number(key);
    if (out.has(id) || !m.name) continue;
    out.set(id, {
      id,
      kind: 'show',
      tmdbId: m.tmdbId || null,
      name: m.name,
      names: [m.name],
      poster: m.poster,
      mine: false,
      watched: false,
      year: m.year?.slice(0, 4) || null,
    });
  }
  /* FILMS, every name they answer to: the library's key, the original title
     and whatever `alt-titles.ts` learnt — so "Pap" finds Paprika whichever
     title the import carried. Shown by the same English-first name the film
     page prints. */
  for (const f of puzzleFilms()) {
    const id = filmId(f.tmdbId, f.name);
    const alt = parseAltTitles(f.altTitles);
    const names = [...new Set([f.name, f.originalName ?? '', alt.en ?? '', alt.orig ?? '', alt.loc ?? ''].filter((n) => n.trim()))];
    out.set(id, {
      id,
      kind: 'film',
      tmdbId: f.tmdbId || null,
      name: displayTitle(f.name, f.altTitles),
      names,
      poster: f.poster,
      mine: true,
      watched: f.watchedAt != null,
      year: f.year?.slice(0, 4) || movieMeta(f.tmdbId)?.release?.slice(0, 4) || null,
      // `movies.runtime` is SECONDS (TV Time's unit); every clue speaks minutes.
      film: { name: f.name, year: f.year, runtime: f.runtime ? Math.round(f.runtime / 60) : null, watchedAt: f.watchedAt },
    });
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

/** A watched title with no picture cannot be blurred, so it cannot be asked.
 *  A film's is its backdrop or its poster — never a frame from inside it. */
function hasPicture(a: Answer): boolean {
  if (a.kind === 'film') return !!a.poster || !!movieMeta(a.tmdbId)?.backdrop || !!filmDetail(a.tmdbId)?.backdrop;
  const id = a.id as number;
  const m = showMeta(id);
  return !!m?.backdrop || watchedStills(id, m).length > 0;
}

/** What a day may be picked from: the watched library with a picture, held
 *  to the fairness bar (`libraryCandidates`), and the classics.
 *  `pickAnswer` decides how they mix. Every bundled classic carries a
 *  backdrop, so none needs the check. `airedTotalOf` is asked only of the
 *  shows that got this far, not of the whole answer box. */
function candidates(pool: readonly Answer[]): { library: PuzzleId[]; classics: PuzzleId[] } {
  const mine = pool.filter((a) => a.mine && a.watched && hasPicture(a));
  const { ids } = libraryCandidates(
    mine.filter((a) => a.kind === 'show').map((a) => ({ id: a.id, seen: a.seen ?? 0, aired: airedTotalOf(a.id as number) })),
    mine.filter((a) => a.kind === 'film').map((a) => a.id),
  );
  return { library: ids, classics: pool.filter((a) => !a.mine).map((a) => a.id) };
}

/**
 * A day's game: the one in progress, or a fresh one on that day's pinned
 * answer, or — the first time the day is opened — a fresh pick, pinned.
 *
 * Re-picked only if the answer has left the pool — the show was deleted from
 * the library mid-game — since a game nobody can answer is worse than a new
 * one. `archive` reads and writes the archive's own game, so replaying an old
 * day never touches today's.
 */
export function gameFor(day: string, pool: readonly Answer[], archive = false): Game | null {
  const inPool = (id: PuzzleId) => pool.some((a) => a.id === id);
  const saved = loadGame(day, archive);
  const pinned = loadPinned();
  const pin = pinned.find((p) => p.d === day);
  let g: Game;
  if (saved && inPool(saved.id)) {
    g = saved;
  } else {
    const { library, classics } = candidates(pool);
    const id = pin && inPool(pin.id) ? pin.id : pickAnswer(day, library, classics, pinned);
    if (id == null) return null;
    g = newGame(day, id);
    saveGame(g, archive);
  }
  if (!pin || pin.id !== g.id) savePin({ d: day, id: g.id, pic: null });
  return g;
}

/** Today's game — `gameFor` on today. */
export function todaysGame(day: string, pool: readonly Answer[]): Game | null {
  return gameFor(day, pool);
}

// ── clues ───────────────────────────────────────────────────────────────────

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
 * The text clues, from what the phone already holds. Any of them may be null
 * — a show TheTVDB lists no cast for, a film whose details were never fetched
 * because the phone was offline — and the screen says so for that row rather
 * than inventing one (`clueParts`).
 *
 * THE CHARACTER IS THEIRS FIRST: the one this person voted for most on this
 * show, before TheTVDB's featured list. A clue that is also a memory.
 *
 * A FILM READS THREE PLACES, best first per field: the library row (year,
 * runtime — what the person's own copy says), the bundled film metadata, and
 * the one `/movie/{id}` answer `filmDetail` cached, which is the only one that
 * knows the director. Called again once that answer has arrived.
 */
export function cluesFor(a: Answer): Clues {
  if (a.kind === 'film') {
    const b = movieMeta(a.tmdbId);
    const d = filmDetail(a.tmdbId);
    const lead = b?.cast?.[0] ?? (d?.actor ? { name: d.actor, character: d.character } : null);
    return {
      kind: 'film',
      year: a.film?.year?.slice(0, 4) || b?.release?.slice(0, 4) || d?.year || null,
      genre: b?.genres?.[0] ?? d?.genre ?? null,
      network: null,
      seasons: null,
      director: d?.director ?? null,
      runtime: a.film?.runtime || b?.runtime || d?.runtime || null,
      actor: lead?.name ?? null,
      character: castCharacter(lead?.character),
    };
  }
  const id = a.id as number;
  const m = showMeta(id);
  return {
    kind: 'show',
    year: m?.year ?? null,
    genre: m?.genres?.[0] ?? null,
    network: m?.network ?? null,
    seasons: m?.totalSeasons || null,
    director: null,
    runtime: null,
    actor: m?.cast?.find((c) => c.name?.trim())?.name ?? null,
    character: puzzleTopCharacter(id) ?? m?.characters?.[0]?.name ?? castCharacter(m?.cast?.[0]?.character),
  };
}

// ── a film's details ────────────────────────────────────────────────────────

/** What one `/movie/{id}` answer leaves behind for the puzzle. */
type FilmDetail = {
  /** A TEXTLESS backdrop, or null when TMDB has none without words on it. */
  backdrop: string | null;
  /** Up to six textless backdrops (14 Oct), so a film that comes back after
   *  sixty days is asked with a different picture. Absent in a detail cached
   *  before then, which reads as `[backdrop]`. */
  backdrops?: string[];
  year: string | null;
  genre: string | null;
  director: string | null;
  runtime: number | null;
  actor: string | null;
  character: string | null;
  /**
   * TMDB's `belongs_to_collection` id (14 Oct), null when the film is in none.
   * ABSENT on a detail cached before then, which means "not known": the
   * answer's is fetched again once (`fetchFilmDetail`), a guess's is fetched
   * the first time it is guessed.
   */
  collection?: number | null;
};

const filmKey = (tmdbId: number) => `puzzle.film:${tmdbId}`;

/** The cached answer, or null when it was never fetched. */
function filmDetail(tmdbId: number | null): FilmDetail | null {
  return tmdbId ? parse<FilmDetail>(filmKey(tmdbId)) : null;
}

/**
 * Fetch a film's details once, for the puzzle's clues and picture.
 *
 * THE FILM PAGE'S OWN REQUEST — `/movie/{id}` with its credits — plus the
 * textless images in the same answer, so a backdrop with the title across it
 * never gives the game away. Most libraries' films are not in the bundled
 * metadata, and no other screen keeps a director, so without this a film
 * would have half the clues a show has. Remembered under `puzzle.film:`;
 * a failure remembers nothing, so a later day asks again, as `puzzle.pic:`
 * does for shows.
 */
async function fetchFilmDetail(tmdbId: number): Promise<FilmDetail | null> {
  const known = filmDetail(tmdbId);
  if (known && known.collection !== undefined) return known;
  try {
    const d = await tmdb<{
      runtime?: number | null;
      genres?: { name?: string }[];
      release_date?: string;
      belongs_to_collection?: { id?: number } | null;
      credits?: { cast?: { name?: string; character?: string }[]; crew?: { name?: string; job?: string }[] };
      images?: { backdrops?: { file_path?: string | null }[] };
    }>(`/movie/${tmdbId}?append_to_response=credits,images&include_image_language=null`);
    const backdrops = textless(d.images?.backdrops);
    const lead = d.credits?.cast?.find((c) => c.name?.trim());
    const detail: FilmDetail = {
      backdrop: backdrops[0] ?? null,
      backdrops,
      year: d.release_date?.slice(0, 4) || null,
      genre: d.genres?.[0]?.name ?? null,
      director: d.credits?.crew?.find((c) => c.job === 'Director' && c.name?.trim())?.name ?? null,
      runtime: d.runtime || null,
      actor: lead?.name ?? null,
      character: lead?.character ?? null,
      collection: d.belongs_to_collection?.id ?? null,
    };
    setMeta(filmKey(tmdbId), JSON.stringify(detail));
    return detail;
  } catch {
    // Offline or rate-limited: nothing is remembered. A detail cached before
    // collections were is still good for the clues and the picture.
    return known;
  }
}

// ── the right series, the wrong part ────────────────────────────────────────

/**
 * Whether `guessed` is another film of the answer's TMDB collection, from
 * what is cached: true or false when both are known, null when one is not
 * fetched yet. Anything but two different films is false — shows have no
 * collections.
 */
export function sameSeriesNow(answer: Answer, guessed: Answer | undefined): boolean | null {
  if (!guessed || answer.kind !== 'film' || guessed.kind !== 'film' || guessed.id === answer.id) return false;
  if (!answer.tmdbId || !guessed.tmdbId) return false;
  const a = filmDetail(answer.tmdbId)?.collection;
  // The answer in no series settles it without asking about the guess.
  if (a === null) return false;
  const b = filmDetail(guessed.tmdbId)?.collection;
  if (a === undefined || b === undefined) return null;
  return a === b;
}

/**
 * The same question, fetching what is missing — the guessed film's details,
 * once, and remembered like the answer's. Never on the guess's critical path:
 * the screen counts the try as a plain miss at once and turns it yellow when
 * this says so. Offline, it is false, and the miss stays a plain one.
 */
export async function sameSeries(answer: Answer, guessed: Answer | undefined): Promise<boolean> {
  const now = sameSeriesNow(answer, guessed);
  if (now !== null) return now;
  const [a, b] = await Promise.all([fetchFilmDetail(answer.tmdbId!), fetchFilmDetail(guessed!.tmdbId!)]);
  return a?.collection != null && a.collection === b?.collection;
}

// ── the picture ─────────────────────────────────────────────────────────────

/** TMDB's textless backdrops as full URLs, at most six — enough for a title to
 *  come back every sixty days for a year without repeating a frame. */
function textless(list: { file_path?: string | null }[] | undefined): string[] {
  return (list ?? [])
    .map((b) => b.file_path)
    .filter((p): p is string => !!p)
    .slice(0, 6)
    .map((p) => `https://image.tmdb.org/t/p/w780${p}`);
}

/**
 * A show's textless backdrops, asked for once and remembered under
 * `puzzle.pics:` as a list. `[]` means "asked, TMDB has none" — not asked
 * again. The single-URL `puzzle.pic:` of before 14 Oct is still read, so a
 * phone offline today keeps yesterday's answer.
 */
async function showBackdrops(a: Answer): Promise<string[]> {
  const key = `puzzle.pics:${a.id}`;
  const cached = parse<unknown>(key);
  if (Array.isArray(cached)) return cached.filter((u): u is string => typeof u === 'string');
  const old = getMeta(`puzzle.pic:${a.id}`);
  if (a.tmdbId) {
    try {
      const d = await tmdb<{ backdrops?: { file_path?: string | null }[] }>(
        `/tv/${a.tmdbId}/images?include_image_language=null`,
      );
      const urls = textless(d.backdrops);
      setMeta(key, JSON.stringify(urls));
      return urls;
    } catch {
      // Offline or rate-limited: nothing is remembered, so a later day asks again.
    }
  }
  return old ? [old] : [];
}

/**
 * The frame to blur for `day`, best source first:
 *
 *   1. A still of an episode this person watched — a real frame, no text, and
 *      spoiler-safe by construction.
 *   2. A textless backdrop from TMDB (`include_image_language=null`) — a
 *      backdrop with the title across it gives the game away on the first clue.
 *   3. The cached backdrop, whatever is on it.
 *   4. TheTVDB's background art, asked for only when there is nothing else.
 *
 * A film: its textless backdrops, the bundled one, then the poster — never a
 * frame from inside it; a backdrop or a poster is what anybody sees before
 * pressing play.
 *
 * NEVER THE SAME PICTURE TWICE FOR ONE TITLE (14 Oct), while there is another:
 * the pictures it was asked with on other days are avoided (`pickPicture`),
 * so a title that comes back after sixty days comes back looking different.
 * The choice is pinned with the day, so reopening today shows the same frame.
 *
 * Null when the phone is offline and has never seen any of them; the text
 * clues still work and the screen says why the picture is missing.
 */
export async function pictureFor(a: Answer, day: string): Promise<string | null> {
  const pinned = loadPinned();
  const pin = pinned.find((p) => p.d === day && p.id === a.id);
  if (pin?.pic) return pin.pic;
  const used = usedPictures(pinned, a.id, day);
  let pic: string | null;
  if (a.kind === 'film') {
    const d = a.tmdbId ? await fetchFilmDetail(a.tmdbId) : null;
    pic = pickPicture(day, [d?.backdrops ?? (d?.backdrop ? [d.backdrop] : []), [movieMeta(a.tmdbId)?.backdrop ?? ''], [a.poster ?? '']], used);
  } else {
    const id = a.id as number;
    const m = showMeta(id);
    const stills = watchedStills(id, m);
    // A fresh still needs no request; the backdrops are asked for only when
    // every watched still has been used already.
    const backdrops = stills.some((u) => !used.has(u)) ? [] : await showBackdrops(a);
    pic = pickPicture(day, [stills, backdrops, [m?.backdrop ?? '']], used);
    if (!pic) {
      try {
        // Lazy, as `catalog.ts` requires it: a top-level import of `@/tvdb` here
        // would pull the whole client into every screen that shows the card.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const t = require('@/tvdb') as typeof import('@/tvdb');
        pic = await t.tvdbSeriesBackground(id);
      } catch {
        pic = null;
      }
    }
  }
  if (pic) savePin({ d: day, id: a.id, pic });
  return pic;
}

// ── finishing, the stats, the block ─────────────────────────────────────────

/**
 * Record a finished game. Today's goes into the history — the stats, the
 * profile block — and republishes the block if it is placed. An archive
 * game goes into the archive's own record and nowhere else.
 */
export function finishGame(g: Game, archive = false): void {
  saveGame(g, archive);
  if (archive) {
    setMeta(K.archive, JSON.stringify(withResult(loadArchive(), resultOf(g))));
    return;
  }
  setMeta(K.history, JSON.stringify(withResult(loadHistory(), resultOf(g))));
  void republishPuzzleBlock();
}

/** Played, win %, average tries — today's games only, never the archive's. */
export function currentStats(): Stats {
  return puzzleStats(loadHistory());
}

/** What the owner's own block draws: this month's squares and the stats.
 *  Null when the game is off or nothing was ever played, so the block
 *  collapses like every other widget with nothing to say. */
export function puzzleBlockValue(day = today()): PublicPuzzle | null {
  if (!puzzleOn()) return null;
  const h = loadHistory();
  if (!h.length) return null;
  return publicPuzzle(h, day.slice(0, 7));
}

/** What LEAVES the phone with the arrangement: the same value, only while the
 *  owner allows it. Counts and colours — `publicPuzzle` carries no id and,
 *  since 14 Oct, no streak. */
export function publishedPuzzleValue(): PublicPuzzle | null {
  return puzzlePublicOn() ? puzzleBlockValue() : null;
}

// ── the archive ─────────────────────────────────────────────────────────────

/** Each past day's result, today's games and archive games alike — the
 *  archive list draws both, and only today's ever count. */
export function resultsByDay(): Map<string, Result> {
  return new Map([...loadArchive(), ...loadHistory()].map((r) => [r.d, r]));
}

/** The first day played on the day it was the puzzle, or null. */
export function firstPlayedDay(): string | null {
  return loadHistory()[0]?.d ?? null;
}

/**
 * Push the arrangement again with today's numbers.
 *
 * The profile tab publishes the arrangement when it is REARRANGED, which is
 * right for every other block and wrong for one whose value changes daily:
 * a visitor would see the month as it was the day the block was placed. So
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
 * When today's reminder should fire, or null: the game or the reminder is off,
 * today's puzzle is already finished, or the chosen hour has passed.
 * "You haven't played today's puzzle" — no streak to threaten since 14 Oct.
 * `notifications.ts` schedules it on every sync, so "once a day" is the DATE
 * trigger itself, and finishing the game re-plans, which drops it.
 */
export function puzzleReminderAt(now: Date): { at: number } | null {
  if (!puzzleOn() || !puzzleReminderOn()) return null;
  const day = localDayStamp(now);
  const g = loadGame(day);
  if ((g && isOver(g)) || loadHistory().some((r) => r.d === day)) return null;
  const at = new Date(now);
  at.setHours(puzzleReminderHour(), 0, 0, 0);
  if (at.getTime() <= now.getTime()) return null;
  return { at: at.getTime() };
}

/**
 * DEVELOPMENT ONLY: today's puzzle again, as if never played — a different
 * title at random, no tries, and today's row out of the history. For testing
 * the clues and the picture without waiting a day; the screen only offers it
 * under __DEV__.
 */
export function devFreshGame(day: string, pool: readonly Answer[], not: PuzzleId | null): Game | null {
  const { library, classics } = candidates(pool);
  const ids = (library.length ? library : classics).filter((id) => id !== not);
  if (!ids.length) return null;
  setMeta(K.history, JSON.stringify(loadHistory().filter((r) => r.d !== day)));
  const g = newGame(day, ids[Math.floor(Math.random() * ids.length)]!);
  saveGame(g);
  savePin({ d: day, id: g.id, pic: null });
  return g;
}
