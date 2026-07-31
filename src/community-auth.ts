/**
 * Sign in with Apple and with Google — and nothing else.
 *
 * This module exists so that exactly one file in the app knows two native SDKs
 * exist. Screens ask for a token and get a string or a typed failure; they
 * never import a provider SDK, never see a `statusCode`, never branch on which
 * platform they are running on beyond hiding a button.
 *
 * WHAT A TOKEN IS HERE. Both functions return the provider's **id token** — a
 * signed assertion of "this person is who Apple/Google say they are". It is
 * not an OpenTV session; it is proof handed straight to `POST /v1/auth/session`
 * and immediately forgotten. Nothing in the app stores it, and no other module
 * has a reason to see it.
 *
 * WHY THE NATIVE MODULES ARE REQUIRED LAZILY. Both packages are native, so a
 * binary built before this commit does not contain them. The rest of the app
 * already uses this pattern (`import.tsx`, `settings.tsx`): a lazy `require`
 * inside the function means an old dev client renders the join screen and
 * shows a plain "this build needs rebuilding" error instead of dying on the
 * import at startup, which would take down every screen, community or not.
 */
import { Platform } from 'react-native';

import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '@/auth-config';

/** The two providers the server accepts. Mirrors `Provider` in the Worker. */
export type AuthProvider = 'apple' | 'google';

/**
 * The user closed the sheet. Not an error in any sense the user would
 * recognise, and the one failure that must never produce an alert — they
 * already know what happened, they did it.
 *
 * A distinct class rather than a `null` return so a caller cannot forget to
 * check: `catch (e) { if (e instanceof AuthCancelled) return; }` reads as the
 * deliberate no-op it is.
 */
export class AuthCancelled extends Error {
  constructor() {
    super('sign-in cancelled by the user');
    this.name = 'AuthCancelled';
  }
}

/**
 * Everything else: an unavailable provider, a missing native module, a
 * configuration mistake, a token that never arrived.
 *
 * `developerFault` marks the failures that are the owner's setup rather than
 * the user's day — an unfilled `auth-config.ts`, a build without the native
 * module. Those get a blunt English message on purpose: they can only be seen
 * before the app ships, and translating them would only make the cause harder
 * to recognise in a bug report.
 */
export class AuthFailed extends Error {
  readonly developerFault: boolean;

  constructor(message: string, developerFault = false) {
    super(message);
    this.name = 'AuthFailed';
    this.developerFault = developerFault;
  }
}

/** Reads `code` off an unknown throw without an `any` cast. */
function errorCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return null;
}

/** True when a thrown value is React Native saying the module is not linked. */
function isMissingNativeModule(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.includes('Cannot find native module') || m.includes('has not been linked');
}

// ── Apple ────────────────────────────────────────────────────────────────────

/**
 * True when the Apple button should be drawn at all: iOS 13+, and only iOS.
 *
 * Apple's guideline is that Sign in with Apple must be offered wherever
 * another third-party login is — but only on Apple platforms. Showing it on
 * Android would be offering a sheet that cannot open.
 */
export async function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Apple = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
    return await Apple.isAvailableAsync();
  } catch {
    // No native module (a dev client built before this commit) — treat the
    // provider as absent rather than showing a button that throws.
    return false;
  }
}

/**
 * Opens the Apple sheet and resolves with the identity token.
 *
 * FULL_NAME and EMAIL are requested because Apple returns them **only on the
 * very first authorisation, ever, for this Apple ID and app** — a second
 * sign-in yields nulls even if the first was on another device. The app does
 * not use them today (the profile is seeded from the local library, not from
 * the provider), and asking anyway costs nothing while not asking would make
 * them permanently unrecoverable if a later phase ever wants them.
 */
export async function signInWithApple(): Promise<string> {
  let Apple: typeof import('expo-apple-authentication');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Apple = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
  } catch (e) {
    throw new AuthFailed(
      'expo-apple-authentication is not in this build — rebuild the dev client.',
      isMissingNativeModule(e),
    );
  }

  if (!(await Apple.isAvailableAsync())) {
    throw new AuthFailed('Sign in with Apple is not available on this device.');
  }

  let credential: import('expo-apple-authentication').AppleAuthenticationCredential;
  try {
    credential = await Apple.signInAsync({
      requestedScopes: [
        Apple.AppleAuthenticationScope.FULL_NAME,
        Apple.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    // The documented cancellation code. Everything else is a real failure.
    if (errorCode(e) === 'ERR_REQUEST_CANCELED') throw new AuthCancelled();
    if (isMissingNativeModule(e)) {
      throw new AuthFailed('expo-apple-authentication is not in this build — rebuild the dev client.', true);
    }
    throw new AuthFailed(e instanceof Error ? e.message : 'Apple sign-in failed.');
  }

  if (!credential.identityToken) {
    // Authorised, but with nothing to prove it. Nothing useful to retry.
    throw new AuthFailed('Apple returned no identity token.');
  }
  return credential.identityToken;
}

// ── Google ───────────────────────────────────────────────────────────────────

/** An untouched `auth-config.example.ts` still says this. */
const PLACEHOLDER = 'REPLACE_ME';

/**
 * A copied-but-unfilled `auth-config.ts` must not reach the native SDK. It
 * would open a sheet, fail somewhere inside Google's code, and surface as a
 * generic `DEVELOPER_ERROR` with no hint of the cause — a genuinely expensive
 * hour. Fail here instead, in English, naming the file.
 */
function assertGoogleConfigured(): void {
  const bad = (id: string): boolean => id.length === 0 || id.includes(PLACEHOLDER);
  if (bad(GOOGLE_WEB_CLIENT_ID)) {
    throw new AuthFailed(
      'GOOGLE_WEB_CLIENT_ID is unset in src/auth-config.ts — see auth-config.example.ts.',
      true,
    );
  }
  if (Platform.OS === 'ios' && bad(GOOGLE_IOS_CLIENT_ID)) {
    throw new AuthFailed(
      'GOOGLE_IOS_CLIENT_ID is unset in src/auth-config.ts — see auth-config.example.ts.',
      true,
    );
  }
}

let configured = false;

/**
 * Opens the Google sheet and resolves with the id token.
 *
 * `webClientId` is passed on BOTH platforms, and that is not a copy-paste
 * slip: an Android id token's `aud` claim carries the **web** client id, which
 * is what the Worker checks. See the comment block in auth-config.example.ts.
 */
export async function signInWithGoogle(): Promise<string> {
  assertGoogleConfigured();

  let mod: typeof import('@react-native-google-signin/google-signin');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
  } catch (e) {
    throw new AuthFailed(
      '@react-native-google-signin/google-signin is not in this build — rebuild the dev client.',
      isMissingNativeModule(e),
    );
  }

  const { GoogleSignin, isSuccessResponse } = mod;

  try {
    // configure() is synchronous and idempotent, but pointless to repeat.
    if (!configured) {
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        iosClientId: GOOGLE_IOS_CLIENT_ID,
      });
      configured = true;
    }

    // Android only; a no-op resolve on iOS. Without it a device on an old or
    // missing Play Services fails inside signIn() with nothing readable.
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }

    const res = await GoogleSignin.signIn();
    // v13+ reports cancellation as a RESPONSE, not a throw. Older code that
    // only caught SIGN_IN_CANCELLED silently treated a cancel as a success
    // with no token; both shapes are handled, here and in the catch.
    if (!isSuccessResponse(res)) throw new AuthCancelled();

    const idToken = res.data.idToken;
    if (!idToken) {
      // Almost always a client-id mismatch: signed in, but Google minted no
      // id token because no audience was configured for it.
      throw new AuthFailed('Google returned no id token — check the client ids in src/auth-config.ts.', true);
    }
    return idToken;
  } catch (e) {
    if (e instanceof AuthCancelled || e instanceof AuthFailed) throw e;
    const code = errorCode(e);
    if (code === mod.statusCodes.SIGN_IN_CANCELLED) throw new AuthCancelled();
    if (code === mod.statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new AuthFailed('Google Play Services is unavailable on this device.');
    }
    if (isMissingNativeModule(e)) {
      throw new AuthFailed(
        '@react-native-google-signin/google-signin is not in this build — rebuild the dev client.',
        true,
      );
    }
    throw new AuthFailed(e instanceof Error ? e.message : 'Google sign-in failed.');
  }
}

/**
 * The provider's own sign-in state, cleared when the user leaves the
 * community. Best-effort: the OpenTV session is what matters, and it is
 * already gone by the time this runs.
 */
export async function signOutProviders(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleSignin } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
  } catch {
    // Never signed in with Google, or the module is not in this build.
  }
  // Apple has no sign-out: the credential lives in the system's Apple ID
  // settings, and only the user can revoke it there.
}
