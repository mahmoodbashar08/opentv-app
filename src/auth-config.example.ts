/** Copy this file to src/auth-config.ts and paste in your Google client ids.
 *
 *  Same pattern as api-config.ts and tmdb-token.ts: the real file is gitignored
 *  so nobody's console credentials are ever committed.
 *
 *  ── THE THREE CLIENT IDS ───────────────────────────────────────────────────
 *  Google Cloud Console → APIs & Services → Credentials issues a SEPARATE
 *  OAuth client id per platform, and OpenTV needs all three:
 *
 *    iOS      — created against the bundle id `com.insightfy.opentv`. The iOS
 *               SDK uses it to open the sign-in sheet.
 *    Android  — created against the package name AND the signing certificate's
 *               SHA-1. A debug build and a Play-signed release build have
 *               different SHA-1s, so both usually need registering.
 *    Web      — no platform of its own. **This is the important one.**
 *
 *  THE TRAP: the id token Android hands back does NOT carry the Android client
 *  id in its `aud` claim — it carries the WEB one. That is why
 *  `webClientId` is required by the native SDK on Android even though no web
 *  app exists, and why the Worker's `GOOGLE_CLIENT_IDS` must contain all three
 *  (it checks `aud` against that list). Register only the Android id
 *  server-side and every Android sign-in is rejected as an audience mismatch,
 *  with a message that points nowhere near the cause.
 *
 *  Set `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` below; the Android id
 *  is never named in the app (the native SDK reads it from the build's package
 *  name and signature), but it still has to be in the Worker's list.
 *
 *  Leaving these as-is is detected: `signInWithGoogle()` refuses with a clear
 *  developer-facing error rather than letting the native SDK crash. */

/** OAuth 2.0 client id of type **Web application**. Required on both
 *  platforms — Android tokens are minted with this as their audience. */
export const GOOGLE_WEB_CLIENT_ID = 'REPLACE_ME.apps.googleusercontent.com';

/** OAuth 2.0 client id of type **iOS**, for bundle `com.insightfy.opentv`. */
export const GOOGLE_IOS_CLIENT_ID = 'REPLACE_ME.apps.googleusercontent.com';
