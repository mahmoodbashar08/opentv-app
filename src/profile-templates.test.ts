jest.mock('expo-asset', () => ({ Asset: {} }));
jest.mock('@/community-appearance', () => ({}));
jest.mock('@/community-profiles', () => ({}));
jest.mock('@/components/profile-widgets', () => ({}));
jest.mock('@/components/profile-template', () => ({}));
jest.mock('@/cover-frame-live', () => ({}));
jest.mock('@/db', () => ({}));
jest.mock('@/theme', () => ({}));

import { WIDGETS, SHELF_PREFIX } from '@/profile-layout';
import { templateItems, TEMPLATES } from '@/profile-templates';

describe('profile templates', () => {
  it('ten of them, every block a real widget at a size it allows, the shelves included once', () => {
    expect(TEMPLATES).toHaveLength(10);
    for (const tpl of TEMPLATES) {
      const items = templateItems(tpl);
      expect(new Set(items.map((i) => i.uid)).size).toBe(items.length);
      expect(items[0]!.id).toBe('banners');
      for (const it of items) {
        if (it.id.startsWith(SHELF_PREFIX)) continue;
        const spec = WIDGETS[it.id];
        expect(spec).toBeDefined();
        expect(spec!.spans).toContain(it.span);
        expect(spec!.private).toBeFalsy();
      }
      expect(items.filter((i) => i.id.startsWith(SHELF_PREFIX))).toHaveLength(4);
      // Squares come in pairs, so no row is left half empty.
      expect(items.filter((i) => i.span === '1x1').length % 2).toBe(0);
    }
  });
});
