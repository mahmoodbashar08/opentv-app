/**
 * The one thing that keeps a Plex sync from corrupting a library.
 *
 * Plex stores several GUIDs per item — its own `plex://`, and whichever agents
 * matched it. This app keys shows on TheTVDB, so the ONLY acceptable answer is
 * a `tvdb://` id. Everything else must come back null, because a show with no
 * id is treated as untracked and its episodes are refused — which is the safe
 * direction. Reading a TMDB id as a TheTVDB one would tick episodes of a
 * different series entirely, silently, for ever.
 */
import { tvdbIdFromGuids } from './plex';

describe('tvdbIdFromGuids', () => {
  it('reads a TheTVDB id', () => {
    expect(tvdbIdFromGuids([{ id: 'tvdb://121361' }])).toBe(121361);
  });

  it('finds it among the others Plex stores alongside', () => {
    expect(
      tvdbIdFromGuids([{ id: 'imdb://tt0944947' }, { id: 'tmdb://1399' }, { id: 'tvdb://121361' }]),
    ).toBe(121361);
  });

  it('ignores a query string Plex sometimes appends', () => {
    expect(tvdbIdFromGuids([{ id: 'tvdb://121361?lang=en' }])).toBe(121361);
  });

  it('REFUSES a TMDB id — the failure that would tick another show', () => {
    // 1399 is Game of Thrones on TMDB and something else entirely on TheTVDB.
    expect(tvdbIdFromGuids([{ id: 'tmdb://1399' }])).toBeNull();
  });

  it('refuses IMDb and Plex’s own agent', () => {
    expect(tvdbIdFromGuids([{ id: 'imdb://tt0944947' }])).toBeNull();
    expect(tvdbIdFromGuids([{ id: 'plex://show/5d9c08' }])).toBeNull();
  });

  it('refuses a scheme that merely starts the same way', () => {
    // Guarding the anchor: `tvdb2://` and `xtvdb://` are not TheTVDB.
    expect(tvdbIdFromGuids([{ id: 'xtvdb://121361' }])).toBeNull();
  });

  it('refuses a non-numeric or zero id rather than passing it on', () => {
    expect(tvdbIdFromGuids([{ id: 'tvdb://abc' }])).toBeNull();
    expect(tvdbIdFromGuids([{ id: 'tvdb://0' }])).toBeNull();
  });

  it('is null for a show Plex never matched', () => {
    // No id, so `plex-sync` drops its episodes before the decision layer sees
    // them. An honest gap beats a wrong tick.
    expect(tvdbIdFromGuids([])).toBeNull();
    expect(tvdbIdFromGuids(undefined)).toBeNull();
  });
});

/**
 * The two Plex flows, and why they must not be crossed.
 *
 * THE BUG, caught on a real phone: the app asked for a PLAIN pin (four
 * characters, meant for plex.tv/link) and then sent the user to
 * `app.plex.tv/auth#?clientID=…&code=…`, which only completes a STRONG pin.
 * Plex answered "We were unable to complete this request" on a page that had
 * OpenTV's own name at the top of it, so it read as the app being broken.
 */
import { pinAuthUrl } from './plex';

describe('pinAuthUrl', () => {
  it('is plex.tv/link, which is what a four-character PIN is for', () => {
    expect(pinAuthUrl()).toBe('https://plex.tv/link');
  });

  it('is NOT the strong-pin auth flow', () => {
    // `app.plex.tv/auth` silently fails for the pins this app requests.
    expect(pinAuthUrl()).not.toContain('app.plex.tv');
  });

  it('carries no code, because the code is typed rather than passed', () => {
    expect(pinAuthUrl()).not.toContain('code');
  });
});
