import { normaliseServerUrl, tvdbIdFromProviderIds } from '@/jellyfin';

describe('jellyfin', () => {
  test('normaliseServerUrl adds a scheme and strips the slash', () => {
    expect(normaliseServerUrl(' jellyfin.example.com/ ')).toBe('https://jellyfin.example.com');
    expect(normaliseServerUrl('http://192.168.1.10:8096')).toBe('http://192.168.1.10:8096');
    expect(normaliseServerUrl('https://box.local/jellyfin/')).toBe('https://box.local/jellyfin');
    expect(normaliseServerUrl('')).toBeNull();
    expect(normaliseServerUrl('   ')).toBeNull();
  });
  test('tvdbIdFromProviderIds takes only a positive TheTVDB id', () => {
    expect(tvdbIdFromProviderIds({ Tvdb: '121361', Tmdb: '1399' })).toBe(121361);
    expect(tvdbIdFromProviderIds({ tvdb: '5' })).toBe(5);
    expect(tvdbIdFromProviderIds({ Tmdb: '1399' })).toBeNull();
    expect(tvdbIdFromProviderIds({ Tvdb: 'abc' })).toBeNull();
    expect(tvdbIdFromProviderIds(undefined)).toBeNull();
  });
});
