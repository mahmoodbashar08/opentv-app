/**
 * The stored community session: are you joined, who are you, and the token
 * that proves it.
 *
 * THE SPLIT, AND WHY IT IS NOT AN OVERSIGHT
 * -----------------------------------------
 * The token lives in `expo-secure-store` (Keychain / Android Keystore), whose
 * API is asynchronous. Everything else — the joined flag, the profile id, the
 * handle — lives in `meta`, which is synchronous SQLite, the way the rest of
 * this app reads state.
 *
 * That is forced, not chosen. `useSyncExternalStore` needs a snapshot it can
 * return DURING render; a promise cannot be rendered, and a screen that has to
 * await the Keychain before it knows whether to show a Join button flickers on
 * every mount. So:
 *
 *   meta says "you are joined"       — synchronous, drives the flag and the UI
 *   SecureStore holds the secret     — asynchronous, needed only when a request
 *                                      is actually being made
 *
 * The two can in principle disagree — a restored iOS backup carries the SQLite
 * file but not the Keychain item. That case resolves itself: the first request
 * finds no token, or the server answers 401, and the caller runs
 * `signOutLocally()`. The flag is a claim about the UI, never proof of
 * identity; only the token is proof, and only the server checks it.
 */
import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

import { setAnalyticsConsent, track } from '@/analytics';
import { ApiError, api, setUnauthenticatedHandler } from '@/api';
import { unregisterPush } from '@/push';

import { getMeta, setMeta } from '@/db';
import { setPlusEntitled, setServerPlus } from '@/plus';

/** Keychain / Keystore item. Namespaced so nothing else in the app collides. */
const TOKEN_KEY = 'opentv.community.token';

const JOINED_KEY = 'communityJoined';
/**
 * The address of an account whose email is not confirmed yet, or ''.
 *
 * WHY IT IS STORED AT ALL. The restriction lives in the session token, so the
 * SERVER knows — but the app only found out by making a request and being
 * refused, and nothing on launch makes one. So closing the app on the confirm
 * screen and reopening it landed on a full community that answered 403 to
 * everything: signed in by every appearance, able to do nothing.
 *
 * The address, not a flag, because the confirmation code is only accepted
 * alongside the address it was sent to — a bare boolean would gate the screen
 * and then be unable to offer the code on it.
 */
const UNVERIFIED_EMAIL_KEY = 'communityUnverifiedEmail';
/**
 * '1' when this account can sign in with a password, '' when it is Apple or
 * Google only. Answered by `GET /v1/me`, which returns an `email` field only
 * where a credentials row exists — so its absence IS the answer, and there is
 * no second request to ask.
 */
const HAS_PASSWORD_KEY = 'communityHasPassword';
const PROFILE_ID_KEY = 'communityProfileId';
const HANDLE_KEY = 'communityHandle';

/** Reactive joined flag — mirrors `session-store.ts`'s `onboarded` exactly. */
let joined = getMeta(JOINED_KEY) === '1';
const subs = new Set<() => void>();

function notify(): void {
  subs.forEach((s) => s());
}

export function useJoined(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => joined,
  );
}

export function isJoined(): boolean {
  return joined;
}

/** The server's profile id, or null when not joined. Synchronous, for render. */
export function getProfileId(): string | null {
  return getMeta(PROFILE_ID_KEY) || null;
}

/** The handle, or null. Synchronous, for render. */
export function getHandle(): string | null {
  return getMeta(HANDLE_KEY) || null;
}

/**
 * The bearer token, or null. Async because the Keychain is.
 *
 * Never cached in a module variable: caching it would put the secret in JS
 * memory for the life of the process for the sake of a few milliseconds on a
 * call that is already crossing a network.
 */
export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    // Keychain unavailable (locked device, restored backup, simulator quirk).
    // No token is the honest answer; the caller will treat it as not joined.
    return null;
  }
}

/**
 * Record a successful sign-in. The token is written FIRST: if the Keychain
 * write fails we must not leave the app claiming to be joined with no way to
 * prove it, so the flag is only set once the secret is safely stored.
 */
export async function signIn(token: string, profileId: string, handle: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  setMeta(PROFILE_ID_KEY, profileId);
  setMeta(HANDLE_KEY, handle);
  setMeta(JOINED_KEY, '1');
  joined = true;
  setAnalyticsConsent(true);
  // AFTER consent is on, or the SDK drops it — this is the first event a new
  // member can legitimately produce, and the denominator for every funnel
  // below it. No handle and no profile id: this says "somebody joined", which
  // is the whole question, and identifying WHO is neither needed nor promised.
  track('community_join');
  notify();
}

/**
 * Leave the community on this device. Nothing about the local library is
 * touched — that is the whole promise, and it is why this is "locally":
 * deleting the account on the server is a separate, explicit call.
 *
 * Also the 401 path. When a request comes back `unauthenticated` the token is
 * dead; clear it once and let the UI fall back to the Join prompt rather than
 * retrying with a credential that cannot start working again.
 *
 * The flag is cleared BEFORE the await, the mirror image of `signIn`: the UI
 * must stop offering community actions immediately, and a Keychain delete that
 * fails must not leave it offering them.
 */
export async function signOutLocally(): Promise<void> {
  // BEFORE the token is dropped — deleting the device registration needs the
  // session that owns it. A failure here is harmless: Expo reports the device
  // as unregistered on the next send and the row retires itself.
  await unregisterPush().catch(() => {});
  // BEFORE consent is withdrawn, for the same reason `community_join` comes
  // after it: once collection is off the SDK drops everything, and a leave
  // that is never recorded makes retention look better than it is.
  track('community_leave');
  setAnalyticsConsent(false);
  joined = false;
  setMeta(JOINED_KEY, '');
  setMeta(PROFILE_ID_KEY, '');
  setMeta(HANDLE_KEY, '');
  setMeta(UNVERIFIED_EMAIL_KEY, '');
  setMeta(HAS_PASSWORD_KEY, '');
  /*
   * BACK TO UNKNOWN, not to false. There is no profile to ask about any more,
   * so the store's answer becomes the only one — which is right, and is what a
   * device that never joined does.
   *
   * The local entitlement itself is deliberately NOT cleared here: a paying
   * subscriber who leaves the community keeps what they bought. The receipt is
   * theirs, not the profile's, and `applyEntitlement` will confirm it on the
   * next customer-info update anyway.
   */
  setServerPlus(null);
  notify();
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already gone, or the Keychain is unavailable. The session is over either
    // way — a token nothing reads is inert.
  }
}

/**
 * Mark this session as awaiting email confirmation, or clear it.
 *
 * Called with the address on sign-in when the server says the account is
 * unconfirmed, and with null the moment it is confirmed.
 */
export function setUnverifiedEmail(email: string | null): void {
  setMeta(UNVERIFIED_EMAIL_KEY, email ?? '');
  notify();
}

/** The address awaiting confirmation, or null. Synchronous, for render. */
export function unverifiedEmail(): string | null {
  return getMeta(UNVERIFIED_EMAIL_KEY) || null;
}

/**
 * THE ADDRESS THIS PHONE LAST SIGNED IN WITH — and why it outlives the session.
 *
 * Leaving the community signs the device out and clears everything about the
 * session, which is right: none of it is proof of anything once the token is
 * gone. But it also threw away the one fact that is useful the next time, which
 * is WHICH ACCOUNT this is. Coming back, somebody was shown a bare Join screen
 * and had to remember whether they used Apple, Google, or an address, and if an
 * address, which one — and getting it wrong makes a SECOND account holding half
 * their comments.
 *
 * So it survives `signOutLocally`, and is cleared only by deleting the account,
 * where the thing it names no longer exists. It is a local hint, never a
 * credential: the token is the only proof of identity, and this is a string in
 * the same SQLite file as the watch history. It rides the iCloud backup with
 * everything else, so a reinstall-and-restore still knows who this was.
 *
 * The PROVIDER too, because "sign in with the same address" is useless advice
 * if the address is a Google one and the person starts typing a password.
 */
const LAST_EMAIL_KEY = 'communityLastEmail';
const LAST_PROVIDER_KEY = 'communityLastProvider';

export type LastAccount = { email: string | null; provider: 'email' | 'google' | 'apple' | null };

export function rememberAccount(email: string | null, provider: LastAccount['provider']): void {
  // Never blank what is known with what is not: a provider sign-in that carries
  // no address must not erase the address a previous email sign-in stored.
  if (email) setMeta(LAST_EMAIL_KEY, email.trim());
  if (provider) setMeta(LAST_PROVIDER_KEY, provider);
  notify();
}

export function lastAccount(): LastAccount {
  return {
    email: getMeta(LAST_EMAIL_KEY) || null,
    provider: (getMeta(LAST_PROVIDER_KEY) as LastAccount['provider']) || null,
  };
}

export function useLastAccount(): LastAccount {
  const email = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => getMeta(LAST_EMAIL_KEY) || null,
  );
  const provider = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => (getMeta(LAST_PROVIDER_KEY) as LastAccount['provider']) || null,
  );
  return { email, provider };
}

/** "Not you?" — and account deletion, where the account itself is gone. */
export function forgetAccount(): void {
  setMeta(LAST_EMAIL_KEY, '');
  setMeta(LAST_PROVIDER_KEY, '');
  notify();
}

/** Reactive form of `unverifiedEmail`, for the route guard. */
export function useUnverifiedEmail(): string | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => getMeta(UNVERIFIED_EMAIL_KEY) || null,
  );
}

/**
 * Ask the server whether this session is still real, once per launch.
 *
 * WHY IT HAS TO BE ASKED. `requireAuth` does no I/O by design — the token is
 * verified inside the isolate — so a profile that has been deleted, by
 * moderation or by hand in the database, leaves every existing token working
 * until it expires. `GET /v1/me` is the one route that looks, and nothing in
 * the app called it, so the phone went on showing itself as signed in to an
 * account that no longer existed: no community, no error, and no Join button
 * either, because as far as the device was concerned it had already joined.
 *
 * A 401 runs the handler registered below and the session ends. Anything else
 * — offline, a 500, a captive portal — is ignored on purpose: a server that
 * cannot answer is not a server saying no, and signing people out of a working
 * account because a train went into a tunnel would be far worse than the bug
 * this fixes.
 *
 * It also refreshes what the server knows and the device only guessed: the
 * handle, and whether the address has been confirmed.
 */
export async function refreshSession(): Promise<void> {
  if (!joined) return;
  const token = await getToken();
  if (!token) {
    // meta says joined, the Keychain disagrees — a restored backup. There is
    // nothing to prove identity with, so this device is not signed in.
    await signOutLocally();
    return;
  }
  try {
    const me = await api<{ handle?: string; email?: string; email_verified?: boolean; is_plus?: boolean }>(
      '/v1/me',
      { token },
    );
    if (me.handle && me.handle !== getMeta(HANDLE_KEY)) setMeta(HANDLE_KEY, me.handle);
    /*
     * PLUS GRANTED SERVER-SIDE, on the request this launch was making anyway.
     *
     * `plus_until` is written by two things: the RevenueCat webhook when
     * somebody buys, and a hand-written UPDATE when somebody is GIVEN the tier
     * — a moderator, an early supporter, an Android user on a platform that
     * cannot sell it yet. The first already reaches the phone through the
     * store; the second reached nothing at all, so a granted account got the
     * badge on its public profile and the server accepted its Plus-only
     * writes, while its own phone went on hiding every Plus screen. A badge
     * with no features is worse than no grant.
     *
     * GRANTING ONLY, NEVER REVOKING. The obvious version — `setPlusEntitled(
     * me.is_plus === true)` — hands the server the power to switch Plus OFF,
     * and the webhook is not instant: buy on a bad connection, relaunch before
     * it lands, and the tier somebody just paid for disappears. Turning it off
     * stays with RevenueCat, which reads the receipt rather than our database.
     *
     * BOTH HALVES. `setServerPlus` records the answer either way, and
     * `applyEntitlement` in `purchases.ts` combines it with the receipt — which
     * is what lets a grant be taken back, by expiry or by hand, and what stops
     * the store's "nothing was bought" from wiping a gift a second after this
     * line grants it.
     *
     * `setPlusEntitled(true)` still fires immediately rather than waiting for
     * that: the store may be slow, unreachable, or absent in a build with no
     * RevenueCat key, and somebody who has been given the tier should not have
     * to wait on a network call to see it. Granting on sight, revoking only on
     * agreement.
     */
    setServerPlus(me.is_plus === true);
    if (me.is_plus === true) setPlusEntitled(true);
    // BOTH DIRECTIONS, from the database rather than the token. Confirming on
    // another device has to lift the gate here, and an account un-confirmed
    // since sign-in — by moderation, or by hand — has to put it back. Only
    // clearing, which is what this did first, meant the second case never
    // reached the phone at all.
    //
    // The fields are ABSENT for Apple and Google accounts, which have no
    // address of ours to confirm; undefined must not read as "unverified".
    if (me.email_verified === true) setMeta(UNVERIFIED_EMAIL_KEY, '');
    else if (me.email_verified === false) setMeta(UNVERIFIED_EMAIL_KEY, me.email ?? '');
    setMeta(HAS_PASSWORD_KEY, me.email ? '1' : '');
    // The server's copy wins over whatever the sign-in screen typed: an address
    // changed elsewhere reaches this phone here and nowhere else.
    if (me.email) rememberAccount(me.email, null);
    notify();
  } catch (e) {
    // 401 already signed out through the handler; `not_found` means the same
    // thing from an older server. Everything else is left alone.
    if (e instanceof ApiError && e.code === 'not_found') await signOutLocally();
  }
}

/** Whether this account has a password as well as (or instead of) a provider. */
export function useHasPassword(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => getMeta(HAS_PASSWORD_KEY) === '1',
  );
}

/** Set once a password is added, so the offer disappears without a round trip. */
export function markHasPassword(): void {
  setMeta(HAS_PASSWORD_KEY, '1');
  notify();
}

/** After the handle flow, or a later rename. Does not touch the token. */
export function setHandle(handle: string): void {
  setMeta(HANDLE_KEY, handle);
  notify();
}

/**
 * Any 401, from anywhere, ends the session on this device.
 *
 * Registered at import time rather than called from `api.ts` directly, which
 * would be a cycle. `isJoined()` guards it because a 401 on an anonymous read
 * is normal — the public endpoints answer without a token — and running the
 * whole sign-out for somebody who never joined would fire `community_leave`
 * at analytics and unregister a push token that does not exist.
 *
 * This is what makes a deleted account reach the phone. Moderation removes a
 * profile, `GET /v1/me` and every other authenticated route answer 401, and
 * the next request of any kind — a read, not just a write — clears the
 * session. Before this, only writes did, so somebody who was reading rather
 * than posting stayed "signed in" to an account that no longer existed.
 */
setUnauthenticatedHandler(() => {
  if (isJoined()) void signOutLocally();
});
