/**
 * The guard, not the reporting.
 *
 * Jest has no native Firebase module, which is exactly the condition
 * `analytics.ts` is written to survive: the `require` fails, `analytics` stays
 * null, and every entry point has to become a no-op rather than throw. That
 * matters because these calls sit INSIDE onPress handlers and write paths — if
 * `track()` threw here, marking an episode watched would fail on any build
 * without Firebase configured, which includes every test run and every plain
 * `expo start`.
 *
 * So this asserts the one property the optional chaining exists to provide:
 * calling it changes nothing and raises nothing. Delete a `?.` and this fails.
 */
import { setAnalyticsConsent, track, trackScreen } from '@/analytics';

describe('analytics without the native module', () => {
  it('never throws', () => {
    expect(() => track('tap', { control: 'pill', id: 'test' })).not.toThrow();
    expect(() => track('community_join')).not.toThrow();
    expect(() => trackScreen('show/[id]')).not.toThrow();
    expect(() => setAnalyticsConsent(true)).not.toThrow();
    expect(() => setAnalyticsConsent(false)).not.toThrow();
  });

  it('returns nothing to await, so callers cannot accidentally block on it', () => {
    expect(track('tap')).toBeUndefined();
    expect(trackScreen('settings')).toBeUndefined();
  });
});
