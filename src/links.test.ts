import { appLinks, DEFAULT_LINKS, linkIcon, storeAppLinks } from '@/links';
import { getMeta, setMeta } from '@/db';

jest.mock('@/db', () => {
  const store = new Map<string, string>();
  return {
    getMeta: (k: string) => store.get(k) ?? null,
    setMeta: (k: string, v: string) => void store.set(k, v),
    __store: store,
  };
});

/**
 * The rule this file exists to protect: the app always has an answer, and the
 * server can only ever override it. A phone that never talks to the server —
 * which is most of them — must still show a correct list.
 */
describe('appLinks', () => {
  beforeEach(() => {
    (getMeta as unknown as { mockClear?: () => void }).mockClear?.();
    setMeta('communityLinks', '');
  });

  it('ships a working list with no server involved at all', () => {
    setMeta('communityLinks', '');
    expect(appLinks()).toEqual(DEFAULT_LINKS);
    expect(appLinks().every((l) => l.url.startsWith('https://'))).toBe(true);
  });

  it('takes the server list when there is one', () => {
    storeAppLinks([{ key: 'discord', label: 'Discord', url: 'https://discord.gg/new' }]);
    expect(appLinks()).toEqual([{ key: 'discord', label: 'Discord', url: 'https://discord.gg/new' }]);
  });

  it('never opens a link the server should not have sent', () => {
    storeAppLinks([
      { key: 'ok', label: 'Fine', url: 'https://example.com/x' },
      { key: 'bad', label: 'Bad', url: 'javascript:alert(1)' },
    ]);
    expect(appLinks().map((l) => l.key)).toEqual(['ok']);
  });

  it('falls back rather than showing nothing when the answer is unusable', () => {
    // An empty or broken list is not an instruction to delete the section.
    setMeta('communityLinks', 'not json at all');
    expect(appLinks()).toEqual(DEFAULT_LINKS);
    setMeta('communityLinks', '[]');
    expect(appLinks()).toEqual(DEFAULT_LINKS);
    setMeta('communityLinks', JSON.stringify([{ key: 'x' }]));
    expect(appLinks()).toEqual(DEFAULT_LINKS);
  });

  it('ignores an empty response instead of wiping what it has', () => {
    storeAppLinks([{ key: 'discord', label: 'Discord', url: 'https://discord.gg/new' }]);
    storeAppLinks([]);
    expect(appLinks()).toHaveLength(1);
  });

  it('gives an unknown service an icon rather than a blank', () => {
    expect(linkIcon('discord')).toBe('logo-discord');
    expect(linkIcon('mastodon')).toBe('globe-outline');
  });
});
