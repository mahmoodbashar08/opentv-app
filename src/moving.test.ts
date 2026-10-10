import { movingPaths } from './moving';

const fresh = { onboarded: false, icloud: true };

describe('movingPaths', () => {
  it('same kind of phone: the platform copy first, then the free file, then Plus, then fresh', () => {
    expect(movingPaths('iphone', 'iphone', fresh)).toEqual(['icloud', 'file', 'server', 'fresh']);
    expect(movingPaths('android', 'android', fresh)).toEqual(['drive', 'file', 'server', 'fresh']);
  });

  it('across platforms the platform copy cannot land here, so it is not offered', () => {
    expect(movingPaths('android', 'iphone', fresh)).toEqual(['file', 'server', 'fresh']);
    expect(movingPaths('iphone', 'android', fresh)).toEqual(['file', 'server', 'fresh']);
  });

  it('the free file path is always there, and always before the Plus one', () => {
    for (const here of ['iphone', 'android'] as const)
      for (const old of ['iphone', 'android'] as const) {
        const paths = movingPaths(here, old, fresh);
        expect(paths.indexOf('file')).toBeGreaterThanOrEqual(0);
        expect(paths.indexOf('file')).toBeLessThan(paths.indexOf('server'));
      }
  });

  it('an onboarded phone (opened from Settings) has nothing to start fresh', () => {
    expect(movingPaths('android', 'iphone', { onboarded: true, icloud: true })).toEqual(['file', 'server']);
  });

  it('a build without the iCloud module skips the iCloud step rather than reporting nothing found', () => {
    expect(movingPaths('iphone', 'iphone', { onboarded: false, icloud: false })).toEqual(['file', 'server', 'fresh']);
  });
});
