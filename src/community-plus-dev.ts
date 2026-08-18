/**
 * The development Plus switch, server half.
 *
 * PLUS IS CHECKED TWICE ON PURPOSE, and the switch only ever moved one of
 * them. The app asks `isPlus()` for what it draws; the server checks its own
 * `is_plus` column before storing anything a visitor would see — because a
 * client can lie about entitlement, and the check belongs where the data
 * lives. So a debug build with the switch on met real refusals from real
 * features: "A profile theme needs OpenTV Plus", on a phone showing every Plus
 * screen there is.
 *
 * This tells the server the same thing, so the two halves move together.
 *
 * `__DEV__` ONLY, and silent. A release build never calls this and the secret
 * is never read there. Somebody with no session, or a Worker with no
 * `DEV_PLUS_SECRET` set, simply gets nothing — the local switch still works and
 * the server keeps refusing, which is exactly the behaviour before this
 * existed.
 */

import { api } from '@/api';
import { getToken } from '@/community-session';

/**
 * NEVER READ IN A RELEASE BUILD. `EXPO_PUBLIC_` values are compiled into the
 * bundle, so this must stay behind `__DEV__` and must not be set in the EAS
 * build environment — a secret in a store binary is not a secret.
 */
const DEV_PLUS_SECRET = process.env.EXPO_PUBLIC_DEV_PLUS_SECRET ?? '';

export async function pushDevPlus(on: boolean): Promise<void> {
  if (!__DEV__ || !DEV_PLUS_SECRET) return;
  try {
    const token = await getToken();
    if (!token) return;
    await api('/v1/dev/plus', {
      method: 'POST',
      token,
      body: { on },
      headers: { 'X-Dev-Secret': DEV_PLUS_SECRET },
    });
  } catch {
    // The local switch has already moved; the server disagreeing is the state
    // this exists to avoid but is not worth an alert in a debug build.
  }
}
