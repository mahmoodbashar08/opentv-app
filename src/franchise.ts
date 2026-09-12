/**
 * A film's own series, in order, with your progress against it.
 *
 * WHAT THIS IS AND IS NOT. TMDB knows that Iron Man belongs to a collection
 * called "Iron Man Collection", and that is free, accurate and maintained by
 * somebody else. It does NOT know that Andor comes before Rogue One which
 * comes before A New Hope — nothing does, because a mixed film-and-television
 * chronology is an editorial opinion, not a fact in any catalogue. So this is
 * the half that can be had for nothing: the film series a film belongs to, in
 * RELEASE ORDER, ticked against your library.
 *
 * The other half — hand-curated chronologies mixing shows, seasons and
 * specials — is a permanent editorial job rather than a piece of code, and it
 * is not worth signing up for until somebody uses this one.
 *
 * MATCHED BY TMDB ID FIRST, name second. The library's primary key is a name,
 * and names collide: "Amado" (2011) and "Amado" (2022) are two films the
 * catalogue distinguishes only by id. Ticking the wrong one is worse than
 * ticking neither, because it is invisible.
 *
 * Pure, so the matching and the ordering can be tested without TMDB.
 */

/** One film as TMDB describes it inside a collection. */
export type Part = {
  tmdbId: number;
  title: string;
  poster: string | null;
  /** 'YYYY-MM-DD', or empty for something announced but undated. */
  release: string;
};

/** What the phone knows it has. */
export type Held = { name: string; tmdbId: number | null; watched: boolean };

export type Row = Part & {
  /** In the library at all — watched or on the watchlist. */
  held: boolean;
  watched: boolean;
  /** The library's own key, so a tap can open the right row. */
  libraryName: string | null;
  /** Announced but not out: shown, never counted against you. */
  unreleased: boolean;
};

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The series in release order, ticked.
 *
 * UNDATED ENTRIES SORT LAST, not first. An empty release date sorts before
 * everything as a string, which would put an unannounced sequel at the head of
 * the series — the one position that makes the whole band look wrong.
 */
export function franchiseRows(parts: readonly Part[], library: readonly Held[], today: string): Row[] {
  const byId = new Map<number, Held>();
  const byName = new Map<string, Held>();
  for (const h of library) {
    if (h.tmdbId != null) byId.set(h.tmdbId, h);
    // First writer wins, so a disambiguated duplicate never displaces the
    // original it was named after.
    const k = norm(h.name);
    if (!byName.has(k)) byName.set(k, h);
  }

  return parts
    .map((p) => {
      const hit = byId.get(p.tmdbId) ?? byName.get(norm(p.title));
      return {
        ...p,
        held: hit != null,
        watched: hit?.watched ?? false,
        libraryName: hit?.name ?? null,
        unreleased: p.release === '' || p.release > today,
      };
    })
    .sort((a, b) => {
      if (!a.release !== !b.release) return a.release ? -1 : 1;
      return a.release.localeCompare(b.release) || a.title.localeCompare(b.title);
    });
}

/**
 * "3 of 9 watched" — and the 9 EXCLUDES what is not out yet.
 *
 * Counting an unreleased sequel against somebody means a completed series can
 * never read as complete, which turns a satisfying number into a nagging one.
 */
export function progress(rows: readonly Row[]): { watched: number; total: number } {
  const out = rows.filter((r) => !r.unreleased);
  return { watched: out.filter((r) => r.watched).length, total: out.length };
}

/** The next one to watch: the first released entry not yet watched. */
export function nextUp(rows: readonly Row[]): Row | null {
  return rows.find((r) => !r.unreleased && !r.watched) ?? null;
}
