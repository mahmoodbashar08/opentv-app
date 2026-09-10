/**
 * The other names a film is known by, so searching for it works.
 *
 * WHY THIS EXISTS. A library imported from TV Time carries whatever title that
 * export happened to hold, which is often not English: one film in a real
 * library is stored as "La Tortue rouge", so searching "The Red Turtle" — in the
 * app or out loud to Siri — finds nothing at all. The library is not wrong; it
 * simply knows one of the film's names, and the person asking knows a different
 * one.
 *
 * WHAT IS FETCHED, AND WHAT IS NOT. TMDB's `alternative_titles` returns dozens
 * of rows per film, one per country, most of them noise. This asks for the film
 * twice instead — once in English, once in the reader's own language — and keeps
 * the original title alongside. Three names cover the case that actually
 * happens: the library holds one language and the person speaks another.
 *
 * ONE PASS, THEN NEVER AGAIN. A film's other names do not change, so a row is
 * fetched once and remembered, and a film that returns nothing is marked so the
 * next launch does not ask a second time. That marker is what keeps this from
 * becoming a request per film per launch, for ever.
 */
import * as Localization from 'expo-localization';

import db, { getMeta, setMeta } from '@/db';
import { pool, tmdb } from '@/tmdb';

/** The column holds a JSON array of names. Empty array means "asked, none". */
type Row = { name: string; tmdbId: number };

/**
 * How many films to resolve per launch.
 *
 * FORTY WAS TOO FEW TO BE USEFUL. The order is unwatched-first and then
 * alphabetical, so a watchlist of a hundred and forty-three meant everything
 * past the letter C waited for tomorrow — and the two films actually being
 * asked about, "La Tortue rouge" and a Spider-Man, sat at L and S. A user
 * cannot tell "not fetched yet" from "broken", and reasonably called it broken.
 *
 * Two hundred covers a normal watchlist in one launch. The work is pooled four
 * at a time behind the launch, costs at most two small requests per film, and
 * happens once per film for ever.
 */
const BATCH = 200;

function pending(): Row[] {
  try {
    return db.getAllSync<Row>(
      `SELECT name, tmdbId FROM movies
        WHERE tmdbId IS NOT NULL AND (altTitles IS NULL OR altTitles = '')
        ORDER BY (watchedAt IS NULL) DESC, name
        LIMIT ?`,
      [BATCH],
    );
  } catch {
    return [];
  }
}

/**
 * Ask TMDB what else this film is called.
 *
 * TWO REQUESTS, NOT THE ALTERNATIVE-TITLES ENDPOINT: the film in English and
 * the film in the reader's language. `original_title` comes free with either.
 */
/**
 * NAMED FIELDS, NOT A BAG OF STRINGS, and that distinction was a bug.
 *
 * The first version stored an unlabelled array and left the reader to guess
 * which entry was the English one. Guessing by "longest Latin string" kept
 * "La Tortue rouge" over "The Red Turtle" — and for a film stored in English
 * with an Arabic original, the same guess would have offered the Arabic. Which
 * name is which is knowable at fetch time, so it is recorded rather than
 * inferred later.
 */
type AltTitles = { en?: string; orig?: string; loc?: string };

async function namesFor(tmdbId: number, locale: string): Promise<AltTitles> {
  const out: AltTitles = {};
  const english = await tmdb<{ title?: string; original_title?: string }>(
    `/movie/${tmdbId}?language=en-US`,
  );
  if (english.title) out.en = english.title;
  if (english.original_title) out.orig = english.original_title;

  // Only when the reader is not already reading English, so the common case
  // costs one request rather than two.
  if (!locale.toLowerCase().startsWith('en')) {
    try {
      const mine = await tmdb<{ title?: string }>(`/movie/${tmdbId}?language=${encodeURIComponent(locale)}`);
      if (mine.title) out.loc = mine.title;
    } catch {
      // A locale TMDB does not serve is not a failure; the English pass stands.
    }
  }
  return out;
}

/**
 * Fill in what is missing, a batch at a time.
 *
 * Runs behind the same background work as the other metadata passes and is
 * safe to call on every launch: it stops immediately once every film with a
 * TMDB id has been asked about.
 */
export async function fillAltTitles(): Promise<void> {
  const rows = pending();
  if (!rows.length) return;

  const locale = Localization.getLocales()[0]?.languageTag ?? 'en-US';
  await pool(
    rows,
    async (row) => {
      // Asked before and answered nothing: never ask again.
      if (getMeta(`altTitlesMiss:${row.tmdbId}`)) return;
      try {
        const names = await namesFor(row.tmdbId, locale);
        db.runSync('UPDATE movies SET altTitles = ? WHERE name = ?', [JSON.stringify(names), row.name]);
        // Nothing that differs from the stored name is nothing worth asking
        // about again.
        const useful = [names.en, names.orig, names.loc].filter((n) => n && n !== row.name);
        if (!useful.length) setMeta(`altTitlesMiss:${row.tmdbId}`, '1');
      } catch {
        // Offline, rate-limited, or a dead id. No marker is written, so the
        // next launch tries again — right for a transient failure and harmless
        // for a permanent one, because the batch is small.
      }
    },
    4,
  );
}

/**
 * Read a stored value, tolerating the older array shape that shipped first.
 * Returns the named fields; unknown shapes give an empty object rather than
 * throwing.
 */
export function parseAltTitles(raw: string | null | undefined): AltTitles {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      // The first version's shape: an unlabelled list. Keep it readable as a
      // last resort rather than discarding it, but it names nothing.
      const first = parsed.find((x): x is string => typeof x === 'string');
      return first ? { orig: first } : {};
    }
    if (parsed && typeof parsed === 'object') return parsed as AltTitles;
    return {};
  } catch {
    return {};
  }
}

/** Every name a film answers to, for searching. Never throws. */
export function altTitlesOf(movieName: string): string[] {
  try {
    const row = db.getFirstSync<{ altTitles: string | null }>(
      'SELECT altTitles FROM movies WHERE name = ?',
      [movieName],
    );
    const t = parseAltTitles(row?.altTitles);
    return [t.en, t.orig, t.loc].filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}
