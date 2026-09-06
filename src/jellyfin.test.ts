import { tvdbIdFromProviderIds } from '@/jellyfin';

describe('jellyfin', () => {
  test('tvdbIdFromProviderIds takes only a positive TheTVDB id', () => {
    expect(tvdbIdFromProviderIds({ Tvdb: '121361', Tmdb: '1399' })).toBe(121361);
    expect(tvdbIdFromProviderIds({ tvdb: '5' })).toBe(5);
    expect(tvdbIdFromProviderIds({ Tmdb: '1399' })).toBeNull();
    expect(tvdbIdFromProviderIds({ Tvdb: 'abc' })).toBeNull();
    expect(tvdbIdFromProviderIds(undefined)).toBeNull();
  });
});
