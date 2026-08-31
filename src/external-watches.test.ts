/**
 * What a Trakt sync is allowed to write.
 *
 * A SCROBBLER'S FAILURES ARE SILENT AND CUMULATIVE, which is why this is the
 * most tested part of it. Nothing on screen looks wrong when a sync ticks an
 * episode twice — the totals, the streaks, the "days watched" and every chart
 * built on them simply drift, and by the time somebody notices there is no way
 * to tell the invented watches from the real ones. So the rules live in a pure
 * function and every refusal has a test.
 *
 * The one thing these tests cannot check is Trakt's own correctness. They pin
 * OUR half: given rows, which do we write.
 */
import { nextWatchWatermark, externalWatchesToApply, externalWatchKey, type ExternalWatchRow } from './pure';

const row = (tvdbId: number, season: number, episode: number, watchedAt = '2026-08-01T10:00:00.000Z'): ExternalWatchRow => ({
  tvdbId,
  season,
  episode,
  watchedAt,
});

/** Two tracked shows; 121361 has S1E1 already ticked. */
const LIBRARY = {
  tracked: new Set([121361, 267440]),
  watched: new Set(['121361:1:1']),
};

describe('externalWatchesToApply', () => {
  it('writes a genuinely new episode of a show you track', () => {
    expect(externalWatchesToApply([row(121361, 1, 2)], LIBRARY)).toHaveLength(1);
  });

  it('refuses an episode already watched — the duplicate is the whole danger', () => {
    /*
     * Second run, same history. Without this, every sync adds another copy of
     * every episode and the totals climb for ever while looking perfectly
     * ordinary.
     */
    expect(externalWatchesToApply([row(121361, 1, 1)], LIBRARY)).toEqual([]);
  });

  it('refuses a show you do not track rather than inventing a library', () => {
    // Trakt remembers shows somebody abandoned on another service years ago.
    // Importing WATCHES must not quietly import SHOWS.
    expect(externalWatchesToApply([row(999999, 1, 1)], LIBRARY)).toEqual([]);
  });

  it('refuses season 0', () => {
    // Specials number differently on every service and Trakt's ordering does
    // not reliably match TheTVDB's. A wrong tick is still a wrong tick.
    expect(externalWatchesToApply([row(121361, 0, 1)], LIBRARY)).toEqual([]);
  });

  it('keeps only the FIRST of a repeated episode in one batch', () => {
    /*
     * Trakt returns one row per rewatch, so a show watched three times arrives
     * as three identical rows. Those are rewatches — this app records them
     * separately — and they must not land as three fresh watches.
     */
    const out = externalWatchesToApply(
      [
        row(267440, 1, 1, '2026-08-01T10:00:00.000Z'),
        row(267440, 1, 1, '2026-08-02T10:00:00.000Z'),
        row(267440, 1, 1, '2026-08-03T10:00:00.000Z'),
      ],
      LIBRARY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].watchedAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('lets the rest of a batch through when one row is refused', () => {
    // A single bad row must not cost the whole sync — that would make one
    // untracked show hide every legitimate episode behind it.
    const out = externalWatchesToApply([row(999999, 1, 1), row(121361, 2, 5), row(121361, 0, 3)], LIBRARY);
    expect(out.map((r) => `${r.tvdbId}:${r.season}:${r.episode}`)).toEqual(['121361:2:5']);
  });

  it('is empty for an empty history rather than throwing', () => {
    expect(externalWatchesToApply([], LIBRARY)).toEqual([]);
  });
});

describe('nextWatchWatermark', () => {
  it('is the newest watched_at actually seen', () => {
    const out = nextWatchWatermark(
      [row(1, 1, 1, '2026-08-01T00:00:00.000Z'), row(1, 1, 2, '2026-08-09T00:00:00.000Z')],
      null,
    );
    expect(out).toBe('2026-08-09T00:00:00.000Z');
  });

  it('never moves backwards, even when Trakt backfills an older watch', () => {
    /*
     * Somebody logging a 2019 episode today must not drag the mark back to
     * 2019 — the next run would re-read seven years of history and re-decide
     * every row in it.
     */
    expect(nextWatchWatermark([row(1, 1, 1, '2019-01-01T00:00:00.000Z')], '2026-08-01T00:00:00.000Z')).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('keeps the old mark when nothing arrived', () => {
    // Never "now": a clock ahead of Trakt's, or a page that failed halfway,
    // would move the mark past rows nothing ever read, and those episodes
    // would be invisible for ever.
    expect(nextWatchWatermark([], '2026-08-01T00:00:00.000Z')).toBe('2026-08-01T00:00:00.000Z');
  });

  it('stays null on a first run that found nothing', () => {
    expect(nextWatchWatermark([], null)).toBeNull();
  });
});

describe('externalWatchKey', () => {
  /*
   * THE BUG THIS EXISTS FOR, caught before it shipped. The decision built
   * `tvdbId:season:episode` while its caller composed its "already watched"
   * set from `getWatchedSet`, which returns `season-episode` with a DASH. The
   * lookup therefore never matched: every episode looked new and every sync
   * would have re-marked the entire history, silently, with the totals simply
   * climbing.
   *
   * Both sides call this now. The test is here so the format cannot be
   * "tidied" on one side alone.
   */
  it('is what the decision compares on', () => {
    expect(externalWatchKey(121361, 1, 1)).toBe('121361:1:1');
  });

  it('matches the key a refusal is keyed on', () => {
    const library = { tracked: new Set([121361]), watched: new Set([externalWatchKey(121361, 1, 1)]) };
    expect(externalWatchesToApply([row(121361, 1, 1)], library)).toEqual([]);
  });

  it('does not collide across shows, seasons or episodes', () => {
    const keys = [externalWatchKey(1, 11, 1), externalWatchKey(1, 1, 11), externalWatchKey(11, 1, 1)];
    expect(new Set(keys).size).toBe(3);
  });
});
