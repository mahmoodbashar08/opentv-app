/**
 * `totalEpisodes` is the denominator of every progress reading in the app —
 * the show screen's bar, the catch-up estimate, the status colour, the widget.
 * These pin the two ways it has been wrong on real libraries.
 */
import { registerShowMeta, showMeta } from '@/metadata';
import type { ShowMeta } from '@/metadata';

const base = (over: Partial<ShowMeta>): ShowMeta =>
  ({
    tmdbId: 0,
    fetchedAt: Date.now(),
    name: 'Test',
    seasons: {},
    episodes: {},
    ...over,
  }) as ShowMeta;

describe('totalEpisodes normalisation', () => {
  it('derives a missing total from the season counts', () => {
    // Better Call Saul as the bundle held it: six seasons of counts, no total.
    // Without this the show screen divided by a flat 200 and drew a
    // fully-watched show at 31%.
    registerShowMeta(900001, base({ seasons: { '1': { count: 10 }, '2': { count: 13 } } as ShowMeta['seasons'] }));
    expect(showMeta(900001)?.totalEpisodes).toBe(23);
  });

  it('leaves specials out of a derived total', () => {
    registerShowMeta(
      900002,
      base({ seasons: { '0': { count: 244 }, '1': { count: 10 } } as ShowMeta['seasons'] }),
    );
    expect(showMeta(900002)?.totalEpisodes).toBe(10);
  });

  it('does not touch a total that is already there', () => {
    registerShowMeta(
      900003,
      base({ totalEpisodes: 63, seasons: { '1': { count: 1 } } as ShowMeta['seasons'] }),
    );
    expect(showMeta(900003)?.totalEpisodes).toBe(63);
  });

  it('recomputes a TheTVDB total that counted specials', () => {
    // The 1.2.0 bug: TheTVDB's raw episode count includes season 0.
    registerShowMeta(
      900004,
      base({
        structureSource: 'tvdb',
        totalEpisodes: 307,
        episodes: { '0-1': {}, '0-2': {}, '1-1': {}, '1-2': {}, '1-3': {} } as unknown as ShowMeta['episodes'],
      }),
    );
    expect(showMeta(900004)?.totalEpisodes).toBe(3);
  });

  it('leaves a TMDB total alone, where a half-loaded season would shrink it', () => {
    registerShowMeta(
      900005,
      base({
        structureSource: 'tmdb',
        totalEpisodes: 62,
        episodes: { '1-1': {}, '1-2': {} } as unknown as ShowMeta['episodes'],
      }),
    );
    expect(showMeta(900005)?.totalEpisodes).toBe(62);
  });
});
