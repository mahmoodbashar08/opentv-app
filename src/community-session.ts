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

import { getMeta, setMeta } from '@/db';

/** Keychain / Keystore item. Namespaced so nothing else in the app collides. */
const TOKEN_KEY = 'opentv.community.token';

const JOINED_KEY = 'communityJoined';
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
  joined = false;
  setMeta(JOINED_KEY, '');
  setMeta(PROFILE_ID_KEY, '');
  setMeta(HANDLE_KEY, '');
  notify();
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already gone, or the Keychain is unavailable. The session is over either
    // way — a token nothing reads is inert.
  }
}

/** After the handle flow, or a later rename. Does not touch the token. */
export function setHandle(handle: string): void {
  setMeta(HANDLE_KEY, handle);
  notify();
}
