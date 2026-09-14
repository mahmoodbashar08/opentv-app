/**
 * A way back into the app, on everything that leaves it.
 *
 * EVERY SHARE USED TO BE A DEAD END. "Join me on OpenTV" with no address:
 * the person who received it had to know the name, find the right store, and
 * care enough to search — and half of them do not. Seven share surfaces, all
 * of them leaking.
 *
 * IN CODE, NOT IN THE COPY. Putting the URL in `en.json` would mean the same
 * string in six locale files and the domain in forty-two places; here it is
 * one constant. Translators translate sentences, not addresses.
 *
 * `/download` CARRIES BOTH STORES, so one link serves an iPhone and an
 * Android reader and survives a listing moving. A member's profile is better
 * still — it is a real page that unfurls into a card on Discord, iMessage and
 * X, and it has the download link on it.
 */
/*
 * DELIBERATELY STILL A CONSTANT, unlike the privacy and terms addresses.
 *
 * Making it server-overridable meant importing `@/links`, which reaches
 * `@/db` and `expo-sqlite` — a module `jest.config.js` will not load — and
 * that took this file's whole test suite down with it. Lazy-requiring moved
 * the failure from import time to call time and no further, because the tests
 * call it.
 *
 * Not worth a mock: this changes only if the domain itself moves, and that is
 * a day with a release in it anyway. The two addresses that DO need fixing
 * without a release — privacy and terms, which App Review reads and the
 * paywall is required to show — go through `appUrl` instead.
 */
export const SITE = 'https://theopentv.com';

/** The message somebody actually sends, with a way back on the end. */
export function withLink(message: string, path = '/download'): string {
  return `${message}\n\n${SITE}${path}`;
}

/** A member's public page, or the download page when there is no handle. */
export function profilePath(handle: string | null | undefined): string {
  return handle ? `/@${handle}` : '/download';
}
