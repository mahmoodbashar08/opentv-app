/** Which CommsUni thread a comment screen opens — a wrong one would show a
 *  different title's comments under this one. */
import { boardTargetFor } from './pure';

const t = (source: string, key: string, season: number | null = null, episode: number | null = null) => ({ source, key, season, episode });

describe('boardTargetFor', () => {
  it('an episode is its show id with season and episode', () => {
    expect(boardTargetFor(t('tvdb', '81189', 1, 2), null)).toEqual({ type: 'episode', id: 81189, season: 1, episode: 2 });
  });
  it('a show is its own id', () => {
    expect(boardTargetFor(t('tvdb', '81189'), null)).toEqual({ type: 'show', id: 81189 });
  });
  it('a film is only reachable by the TVDB id its screen passes', () => {
    expect(boardTargetFor(t('title', 'inception-2010'), 1234)).toEqual({ type: 'movie', id: 1234 });
    expect(boardTargetFor(t('title', 'inception-2010'), null)).toBeNull();
  });
  it('half an episode address, or a non-numeric key, has no board', () => {
    expect(boardTargetFor(t('tvdb', '81189', 1, null), null)).toBeNull();
    expect(boardTargetFor(t('tmdb', '1399'), null)).toBeNull();
    expect(boardTargetFor(t('tvdb', 'abc'), null)).toBeNull();
  });
});
