/**
 * A stub for `expo-router` under the plain-Node test runner.
 *
 * Same reason as `expo-file-system` next door: the real module is untranspiled
 * source that reaches into React Native, and this runner is deliberately
 * preset-free (see jest.config.js). `plus.ts` imports it for exactly one thing
 * — pushing the paywall route — and `community-publish.ts` now imports `plus.ts`
 * for the entitlement, so the whole of React Native was arriving in a suite
 * that tests set arithmetic.
 *
 * NAVIGATION IS NOT UNDER TEST HERE. `push` records nothing and asserts
 * nothing; a test that wants to prove the paywall opens wants a renderer, not
 * a richer fake. Keeping it inert is the point — a stub that grows behaviour
 * nobody verifies is how a suite starts passing against a router that does not
 * behave like the shipped one.
 */
export const router = {
  push(_href: string): void {},
  back(): void {},
  replace(_href: string): void {},
};
