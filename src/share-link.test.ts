import { profilePath, withLink } from '@/share-link';

describe('share links', () => {
  test('every share carries a way back', () => {
    expect(withLink('Join me on OpenTV')).toBe('Join me on OpenTV\n\nhttps://theopentv.com/download');
  });
  test('a member shares their own page, a stranger the download page', () => {
    expect(profilePath('amanda')).toBe('/@amanda');
    expect(profilePath(null)).toBe('/download');
    expect(withLink('amanda on OpenTV', profilePath('amanda'))).toBe('amanda on OpenTV\n\nhttps://theopentv.com/@amanda');
  });
});
