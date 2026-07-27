/**
 * The import rules, run against the real export files rather than fixtures we
 * wrote ourselves.
 *
 * Every data bug this release produced typechecked and passed the unit tests;
 * they were found by importing a real export and reading the SQLite file back.
 * These tests close as much of that gap as Jest can reach: the *decisions* the
 * importer makes are pure functions in `@/pure`, so they can be replayed over
 * the actual CSVs and asserted against the numbers the changelog claims.
 *
 * What this cannot cover: anything below the decision — the SQL writes, the
 * network calls, the transaction. `importer.ts` imports `expo-file-system`,
 * `expo-sqlite` and `expo-document-picker` at module scope, so requiring it in
 * Node fails before any code runs. See the note in the review for what making
 * that testable would take.
 *
 * The exports live in the WORKSPACE root, one level above this git repo, so
 * they are not guaranteed present (a fresh clone of `mobile/` alone won't have
 * them). Every fixture test skips itself rather than failing when they are
 * missing — a red suite for a missing file trains people to ignore red suites.
 */
import * as fs from 'fs';
import * as path from 'path';

import { canFoldMovie, disambiguatedMovieName, parseCsv, shouldBulkFill, v1WatchIsStale } from './pure';

const ROOT = path.resolve(__dirname, '..', '..');
const GDPR = path.join(ROOT, 'gdpr-data');
const AMANDA = path.join(ROOT, 'amanda_gdpr');
const COMMUNITY = path.join(ROOT, 'tvtime-2026-07-01');

const has = (dir: string) => fs.existsSync(dir);
const read = (dir: string, file: string) => parseCsv(fs.readFileSync(path.join(dir, file), 'utf8'));

// ---------------------------------------------------------------------------
// parseCsv — the first thing every import runs, and the likeliest cause of an
// "imported 0". It had no test at all before this.
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([{ a: '1', b: '2' }]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('a,b\n"one, two",3')).toEqual([{ a: 'one, two', b: '3' }]);
  });

  it('keeps newlines inside quoted fields — comments contain them', () => {
    expect(parseCsv('a,b\n"line one\nline two",3')).toEqual([{ a: 'line one\nline two', b: '3' }]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"he said ""hi"""')).toEqual([{ a: 'he said "hi"' }]);
  });

  it('handles CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('pads a short row rather than dropping it', () => {
    expect(parseCsv('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('returns nothing for an empty file or a header alone', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b\n')).toEqual([]);
  });

  it('tolerates a trailing newline without inventing a blank row', () => {
    expect(parseCsv('a\n1\n')).toEqual([{ a: '1' }]);
  });
});

// ---------------------------------------------------------------------------
// The official GDPR export
// ---------------------------------------------------------------------------

(has(GDPR) ? describe : describe.skip)('gdpr-data (official GDPR export)', () => {
  const showRows = () => read(GDPR, 'user_tv_show_data.csv');
  const v2 = () => read(GDPR, 'tracking-prod-records-v2.csv');
  const v1 = () => read(GDPR, 'tracking-prod-records.csv');

  it('parses every CSV in the export without throwing', () => {
    const csvs = fs.readdirSync(GDPR).filter((f) => f.endsWith('.csv'));
    expect(csvs.length).toBeGreaterThan(20);
    for (const f of csvs) expect(() => read(GDPR, f)).not.toThrow();
  });

  it('finds the columns the importer reads by name', () => {
    // a silently renamed column is the "import completed, 0 items" bug
    expect(Object.keys(showRows()[0])).toEqual(
      expect.arrayContaining(['tv_show_id', 'tv_show_name', 'nb_episodes_seen', 'is_followed', 'is_favorited']),
    );
    expect(Object.keys(v2()[0])).toEqual(
      expect.arrayContaining(['s_id', 'season_number', 'episode_number', 'created_at', 'runtime', 'episode_id']),
    );
    expect(Object.keys(v1()[0])).toEqual(
      expect.arrayContaining(['type', 'entity_type', 'series_id', 'movie_name', 'watch_count', 'rewatch_count']),
    );
  });

  it('carries the history the importer is sized for', () => {
    expect(showRows()).toHaveLength(117);
    expect(v2().filter((r) => r.s_id && r.episode_number && r.season_number)).toHaveLength(1104);
  });

  /**
   * The headline "episodes you never watched are gone" fix. The changelog
   * claims 136 fabricated episodes across two shows on this library; this
   * pins that number to the real file.
   */
  it('refuses to invent the 136 episodes TV Time\'s counter claimed', () => {
    const rows = showRows();
    const watches = v2().filter((r) => r.s_id && r.episode_number && r.season_number);
    const showsInV2 = new Set(watches.map((r) => Number(r.s_id)));
    const exportHasV2 = showsInV2.size > 0;
    const explicit = new Map<number, Set<string>>();
    for (const w of watches) {
      const id = Number(w.s_id);
      if (!explicit.has(id)) explicit.set(id, new Set());
      explicit.get(id)!.add(`${w.season_number}-${w.episode_number}`);
    }
    const corroborated = new Map<number, number>();
    for (const r of v1()) {
      if (r.type === 'count-watch-episode-series' && r.series_id) corroborated.set(Number(r.series_id), Number(r.watch_count || 0));
    }

    const refusedByMissingFromV2: { name: string; claimed: number }[] = [];
    let stillFilled = 0;
    for (const s of rows) {
      const id = Number(s.tv_show_id);
      const seen = Number(s.nb_episodes_seen || 0);
      const n = explicit.get(id)?.size ?? 0;
      // importer.ts guard: the current tracking file has no episodes for this
      // show at all, so there is nothing to corroborate a counter against
      if (exportHasV2 && !showsInV2.has(id)) {
        if (seen > 0) refusedByMissingFromV2.push({ name: s.tv_show_name, claimed: seen });
        continue;
      }
      if (shouldBulkFill(n, seen, corroborated.get(id) ?? null)) stillFilled += seen - n;
    }

    expect(refusedByMissingFromV2.map((s) => s.name).sort()).toEqual(['Haikyu!!', 'Madan Senki Ryukendo']);
    expect(refusedByMissingFromV2.reduce((t, s) => t + s.claimed, 0)).toBe(136);
    // nothing else in a 117-show library gets rebuilt from the counter
    expect(stillFilled).toBe(0);
  });

  it('drops exactly the two v1-only shows TV Time\'s own migration left behind', () => {
    const watches = v2().filter((r) => r.s_id && r.episode_number && r.season_number);
    const showsInV2 = new Set(watches.map((r) => Number(r.s_id)));
    const stale = new Set<number>();
    const kept = new Set<number>();
    for (const r of v1()) {
      if (r.type !== 'watch' || r.entity_type !== 'episode' || !r.series_id || !r.episode_number || !r.season_number) continue;
      const id = Number(r.series_id);
      (v1WatchIsStale(showsInV2.has(id), showsInV2.size > 0) ? stale : kept).add(id);
    }
    expect([...stale].sort()).toEqual([247982, 278157]);
    // and it does not throw away the 14 shows whose v1 rows are genuine history
    expect(kept.size).toBe(14);
  });

  it('folds the watchlist copy of a film into the watched one, case included', () => {
    const rows = v1();
    const watched = [...new Set(rows.filter((r) => r.type === 'watch' && r.entity_type === 'movie' && r.movie_name).map((r) => r.movie_name))];
    const later = [...new Set(rows.filter((r) => r.type === 'towatch' && r.movie_name).map((r) => r.movie_name))];
    const folds = watched.flatMap((w) => later.filter((t) => w !== t && canFoldMovie({ name: w }, { name: t })).map((t) => `${w}|${t}`));
    // the only near-duplicate in this library: watched "CODA", watchlisted "Coda"
    expect(folds).toEqual(['CODA|Coda']);
  });

  it('never disambiguates a GDPR title — the export gives no id to justify a split', () => {
    // disambiguatedMovieName only ever fires when two rows carry DIFFERENT ids,
    // and the GDPR movie rows carry none, so a 154-title library stays 154
    const names = v1().filter((r) => r.type === 'watch' && r.entity_type === 'movie' && r.movie_name).map((r) => r.movie_name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(154);
  });
});

// ---------------------------------------------------------------------------
// The community browser-extension export — a different importer path entirely
// ---------------------------------------------------------------------------

(has(COMMUNITY) ? describe : describe.skip)('tvtime-2026-07-01 (community extension export)', () => {
  const file = (token: string, not?: string) => {
    const f = fs.readdirSync(COMMUNITY).find((n) => n.endsWith('.csv') && n.includes(token) && (!not || !n.includes(not)));
    if (!f) throw new Error(`no CSV matching ${token}`);
    return read(COMMUNITY, f);
  };
  const series = () => file('tvtime-series', 'episodes');
  const episodes = () => file('tvtime-series-episodes');
  const movies = () => file('tvtime-movies');

  it('matches the three files by the same basename tokens the importer uses', () => {
    // the extension appends a date, so an exact-name match would find nothing —
    // and "tvtime-series" must not swallow "tvtime-series-episodes"
    expect(series()).toHaveLength(361);
    expect(episodes()).toHaveLength(27917);
    expect(movies()).toHaveLength(546);
  });

  it('states the ids and years the importer used to guess at', () => {
    // this is what makes the community path exact where GDPR has to infer
    expect(movies().filter((m) => !m.tvdb_id || !m.year || !m.title)).toHaveLength(0);
    expect(series().filter((s) => !s.tvdb_id)).toHaveLength(0);
    expect(episodes().filter((e) => !e.series_tvdb_id)).toHaveLength(0);
  });

  it('splits the five same-titled films that used to overwrite each other', () => {
    const byTitle = new Map<string, Set<string>>();
    for (const m of movies()) {
      if (!m.title) continue;
      if (!byTitle.has(m.title)) byTitle.set(m.title, new Set());
      byTitle.get(m.title)!.add(m.tvdb_id);
    }
    const collisions = [...byTitle.entries()].filter(([, ids]) => ids.size > 1).map(([t]) => t);
    expect(collisions.sort()).toEqual([
      'Air',
      'Ghostbusters',
      'Operation Fortune: Ruse de guerre',
      'Road House',
      'Superman',
    ]);

    // replaying importer.ts's `nameFor`: every watched film keeps its own row
    const idOfName = new Map<string, number>();
    const taken = new Set<string>();
    const keys = new Set<string>();
    const renamed: string[] = [];
    for (const r of movies()) {
      if (r.is_watched?.toLowerCase() !== 'true') continue;
      const id = Number(r.tvdb_id) || null;
      const known = idOfName.get(r.title);
      let key: string;
      if (id && known && known !== id) {
        key = disambiguatedMovieName(r.title, r.year, taken);
        taken.add(key.toLowerCase());
        renamed.push(key);
      } else {
        taken.add(r.title.toLowerCase());
        if (id && !known) idOfName.set(r.title, id);
        key = r.title;
      }
      keys.add(key);
    }
    const watched = movies().filter((m) => m.is_watched?.toLowerCase() === 'true').length;
    expect(watched).toBe(533);
    // 533 films in, 533 rows out — the five collisions cost nothing now
    expect(keys.size).toBe(533);
    expect(renamed.sort()).toEqual([
      'Air (2023)',
      'Ghostbusters (2016)',
      'Operation Fortune: Ruse de guerre (2023)',
      'Road House (2024)',
      'Superman (1978)',
    ]);
  });

  it('carries the watchlist as well as the watched films', () => {
    const m = movies();
    expect(m.filter((x) => x.is_watched?.toLowerCase() === 'true')).toHaveLength(533);
    expect(m.filter((x) => x.is_watched?.toLowerCase() !== 'true')).toHaveLength(13);
  });

  it('keeps specials in season 0, where the bulk fill and notifications skip them', () => {
    const watched = episodes().filter((e) => e.is_watched?.toLowerCase() === 'true');
    expect(watched).toHaveLength(21621);
    const specials = watched.filter((e) => e.special?.toLowerCase() === 'true');
    expect(specials).toHaveLength(37);
    expect(specials.every((e) => e.season === '0')).toBe(true);
  });

  it('maps every status, and only "stopped" archives', () => {
    const statuses = new Set(series().map((s) => s.status));
    expect([...statuses].sort()).toEqual(['continuing', 'not_started_yet', 'stopped', 'up_to_date', 'watch_later']);
    const archived = series().filter((s) => (s.status || '').toLowerCase().includes('stop'));
    expect(archived).toHaveLength(11);
    expect(archived.every((s) => s.status === 'stopped')).toBe(true);
  });

  it('contains 11 duplicate watched-episode rows the writer must not double-count', () => {
    // the extension emits the same (series, season, episode) twice for a few
    // shows. `watches` has no unique key, so this is the shape that produces a
    // doubled episode count if the insert path ever stops deduping.
    const watched = episodes().filter((e) => e.is_watched?.toLowerCase() === 'true');
    const seen = new Set<string>();
    let dupes = 0;
    for (const e of watched) {
      const k = `${e.series_tvdb_id}|${e.season}|${e.episode}`;
      if (seen.has(k)) dupes++;
      seen.add(k);
    }
    expect(dupes).toBe(11);
    expect(seen.size).toBe(21610);
  });
});

// ---------------------------------------------------------------------------
// A minimal, converted export — the columns the importer must not require
// ---------------------------------------------------------------------------

(has(AMANDA) ? describe : describe.skip)('amanda_gdpr (converted, minimal columns)', () => {
  it('has none of the optional columns, and must still import', () => {
    const v2 = read(AMANDA, 'tracking-prod-records-v2.csv');
    const v1 = read(AMANDA, 'tracking-prod-records.csv');
    const shows = read(AMANDA, 'user_tv_show_data.csv');

    // the columns that ARE there
    expect(Object.keys(v2[0]).sort()).toEqual(['created_at', 'episode_number', 's_id', 'season_number', 'series_name']);
    // the ones that are NOT — every read of these must tolerate undefined
    for (const col of ['runtime', 'episode_id', 'rewatch_count']) expect(v2[0]).not.toHaveProperty(col);
    expect(shows[0]).not.toHaveProperty('nb_episodes_seen');
    expect(v1[0]).not.toHaveProperty('movie_tvdb_id');

    expect(v2).toHaveLength(21621);
    expect(shows).toHaveLength(361);
  });

  it('cannot bulk-fill anything, because there is no counter to inflate', () => {
    const shows = read(AMANDA, 'user_tv_show_data.csv');
    // Number(undefined || 0) === 0, so episodesSeen is 0 for every row
    for (const s of shows) expect(shouldBulkFill(0, Number(s.nb_episodes_seen || 0), null)).toBe(false);
  });

  it('is all movies on the v1 side, all episodes on the v2 side', () => {
    const v1 = read(AMANDA, 'tracking-prod-records.csv');
    expect(v1.every((r) => r.entity_type === 'movie')).toBe(true);
    expect(v1.filter((r) => r.type === 'watch')).toHaveLength(533);
  });
});
