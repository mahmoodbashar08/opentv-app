/**
 * New-episode reminders — fully on-device, like everything else. No push
 * server: on every app open (and trip to the background) this reads the air
 * dates already cached in metadata and schedules LOCAL notifications for the
 * next few days of followed shows. Re-running always cancels and reschedules,
 * so unfollowed/deleted shows drop out naturally.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import db, { getMeta, setMeta } from '@/db';
import { showMeta } from '@/metadata';

const DAYS_AHEAD = 7; // schedule this many days out; refreshed every app open
const MAX_SCHEDULED = 30; // iOS caps pending locals at 64 — stay well under

export function notificationsEnabled(): boolean {
  return getMeta('notifyNewEpisodes') === '1';
}

/** Ask for permission and turn the feature on. Returns whether it's active. */
export async function enableEpisodeNotifications(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;
  setMeta('notifyNewEpisodes', '1');
  await syncEpisodeNotifications();
  return true;
}

export async function disableEpisodeNotifications(): Promise<void> {
  setMeta('notifyNewEpisodes', '');
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** Reschedule everything from current data. Safe to call often. */
export async function syncEpisodeNotifications(): Promise<void> {
  try {
    if (!notificationsEnabled()) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('new-episodes', {
        name: 'New episodes',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await Notifications.cancelAllScheduledNotificationsAsync();

    const shows = db.getAllSync<{ tvdbId: number; name: string }>(
      'SELECT tvdbId, name FROM shows WHERE followed = 1 AND archived = 0',
    );
    const today = new Date();
    const horizon = new Date(today.getTime() + DAYS_AHEAD * 86400000);
    const todayKey = today.toISOString().slice(0, 10);
    const horizonKey = horizon.toISOString().slice(0, 10);

    type Up = { show: string; season: number; episode: number; title: string | null; air: string };
    const upcoming: Up[] = [];
    for (const s of shows) {
      const m = showMeta(s.tvdbId);
      if (!m) continue;
      for (const [key, em] of Object.entries(m.episodes)) {
        const air = em?.air;
        if (!air || air < todayKey || air > horizonKey) continue;
        const [season, episode] = key.split('-').map(Number);
        if (!season || season < 1) continue; // specials don't ping
        upcoming.push({ show: s.name, season, episode, title: em.title ?? null, air });
      }
    }
    upcoming.sort((a, b) => a.air.localeCompare(b.air));

    for (const u of upcoming.slice(0, MAX_SCHEDULED)) {
      // fire at 20:00 local time on the air date — prime watching hour
      const when = new Date(`${u.air}T20:00:00`);
      if (when.getTime() <= Date.now()) continue;
      const code = `S${String(u.season).padStart(2, '0')}E${String(u.episode).padStart(2, '0')}`;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${u.show} — new episode`,
          body: u.title ? `${code} · ${u.title} airs today` : `${code} airs today`,
          ...(Platform.OS === 'android' ? { channelId: 'new-episodes' } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      });
    }
  } catch {
    // notifications must never break the app
  }
}
