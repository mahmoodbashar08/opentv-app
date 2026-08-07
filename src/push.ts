/**
 * Telling the server where to reach this phone.
 *
 * ASKED LATE, ON PURPOSE. iOS gives an app exactly one chance at the permission
 * prompt — a "no" is permanent until the user goes to Settings — so this is
 * never called on first launch. It runs after joining the community, when the
 * user has just chosen to be part of something other people can react to, which
 * is the only moment the question makes sense.
 *
 * SEPARATE FROM EPISODE REMINDERS. `notifications.ts` schedules local
 * notifications about the user's own shows and needs no server and no account.
 * This is the community half. Someone can have either, both or neither, and
 * turning one off must never silence the other.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/api';
import { getToken } from '@/community-session';
import { getMeta, setMeta } from '@/db';

const TOKEN_KEY = 'pushToken';

/**
 * Register this device, if the user allows it.
 *
 * Returns the token, or null for every ordinary reason it cannot: a simulator
 * (Apple issues no push tokens to one), a refusal, no session, no network. None
 * of those is an error worth showing — the in-app list still works and is where
 * the notification actually lives.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    // A simulator never gets a token; asking looks like a bug in the logs.
    if (!Device.isDevice) return null;
    if (await getToken() == null) return null;

    // BEFORE THE PERMISSION PROMPT, AND BEFORE ANY PUSH CAN ARRIVE.
    //
    // Android 8+ refuses to display a notification with no channel, so Expo
    // drops an unnamed one into a fallback called "Miscellaneous" — which is
    // where every like, reply and follow was landing, beside the episode
    // reminders from `notifications.ts`. A user who wanted one and not the
    // other had a single switch under a name nobody chose.
    //
    // Created here rather than when the first push arrives, because by then it
    // is too late: the channel must already exist for the `channelId` the
    // server sends (see backend/src/push.ts) to resolve to anything. Creating
    // it twice is a no-op, and creating it before the prompt is fine — a
    // channel is not a notification.
    //
    // HIGH, unlike the episode channel's DEFAULT: this is somebody talking to
    // you, and the reply it wants is worth a heads-up display. The user can
    // still turn it down in system settings, which is the whole point of it
    // having its own channel.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('community', {
        name: 'Replies, likes and follows',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;

    // `projectId` is required on SDK 49+ and is the thing that fails silently
    // in a bare build if it is missing.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (projectId == null) return null;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api('/v1/push/tokens', {
      method: 'POST',
      body: { token, platform: Platform.OS === 'android' ? 'android' : 'ios' },
      token: (await getToken()) ?? undefined,
    });
    setMeta(TOKEN_KEY, token);
    return token;
  } catch {
    // Push is a nicety on top of a list that already works.
    return null;
  }
}

/**
 * Stop pushing to this device.
 *
 * Called on sign-out. The row is deleted rather than disabled: a device whose
 * owner signed out is not a dead token, it is a phone that should go quiet.
 */
export async function unregisterPush(): Promise<void> {
  const token = getMeta(TOKEN_KEY);
  if (!token) return;
  try {
    await api(`/v1/push/tokens/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      token: (await getToken()) ?? undefined,
    });
  } catch {
    // The server keeps it, Expo eventually reports the device as unregistered
    // and it is retired then. Worst case is one wasted push.
  }
  setMeta(TOKEN_KEY, '');
}
