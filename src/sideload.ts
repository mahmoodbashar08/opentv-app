/**
 * Which channel this build ships through — and the three things that differ.
 *
 * The GitHub-release APK (docs/GITHUB-APK.md) is the same app signed with a
 * key of our own, for Komi Store, Obtainium and phones without Google Play.
 * Google Play Billing does not exist outside Play, so Plus cannot be bought on
 * it; and every link that says "get it from Play" is a trap on it: Play's copy
 * is signed with a different key, so installing it over this one fails — or,
 * uninstalled first, takes the library with it.
 *
 * `EXPO_PUBLIC_DISTRIBUTION` is set by the workflow (and by the `github`
 * profile in eas.json) and inlined by Metro at bundle time, exactly like
 * `EXPO_OS` in plus.ts. Nothing is detected at runtime, on purpose: the build
 * is the only thing that knows which store it was made for. RevenueCat has no
 * "not from Play" answer — a sideloaded copy configures fine and then fails at
 * purchase time with a developer error, which is the failure this flag exists
 * to prevent. Under Jest the variable is unset and this is false.
 */
export const SIDELOADED = process.env.EXPO_PUBLIC_DISTRIBUTION === 'github';

/** Where a sideloaded phone gets the next version — the page the workflow
 *  attaches `OpenTV-<version>.apk` to. */
export const GITHUB_RELEASES_URL = 'https://github.com/mahmoodbashar08/opentv-app/releases/latest';
