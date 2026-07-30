/**
 * Local notifications — fully on-device, like everything else. No push server:
 * on every app open (and trip to the background) this reads the air dates and
 * progress already in the database and schedules LOCAL notifications for the
 * next few days. Re-running always cancels and reschedules, so unfollowed and
 * deleted shows drop out naturally.
 *
 * The RULES live in `notification-plan.ts`, which is pure and unit-tested.
 * This file is the I/O around them: permissions, Android channels, per-type
 * toggles, and gathering the library snapshot the planner needs.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import db, { getMeta, getSeasons, setMeta } from '@/db';
import { t } from '@/i18n';
import { showMeta } from '@/metadata';
import { planNotifications, type CatchUpCandidate, type NotifyKind, type NotifyToggles, type UpcomingEpisode } from '@/notification-plan';
import type { LocaleKey } from '@/locales/keys';

const DAYS_AHEAD = 21; // horizon for episode reminders; refreshed every app open

// notification-plan.ts is deliberately free of `@/` imports (so its rules can
// be unit-tested under plain Node), so it hands back an i18n KEY in `title`
// rather than English text for every kind except `catchup` — whose title is
// nothing but the show's own name, so there's nothing to translate. This is
// where those keys get resolved into real, localised display text. `body` is
// always a key, for every kind, so it has no kind-gated set of its own.
const TITLE_KEY_KINDS: ReadonlySet<NotifyKind> = new Set(['episode', 'finale', 'movieNight', 'inactivity', 'popcorn']);

/** Meta key per type. `episode` keeps its 1.1.x key so existing users are
 *  neither silently re-enabled nor reset by the 1.2.0 update. */
const KEYS: Record<NotifyKind, string> = {
  episode: 'notifyNewEpisodes',
  finale: 'notifyFinales',
  catchup: 'notifyCatchup',
  movieNight: 'notifyMovieNight',
  inactivity: 'notifyInactivity',
  popcorn: 'notifyPopcorn',
};

/** Types added in 1.2.0 default ON for anyone who already allowed
 *  notifications — same category they opted into — but stay switchable. */
// popcorn is the one that defaults OFF: it is an easter-egg game, not the
// reason anyone installed a TV tracker, so it is opt-in rather than opt-out.
const DEFAULT_ON: NotifyKind[] = ['finale', 'catchup', 'movieNight', 'inactivity'];

export const NOTIFY_KINDS: NotifyKind[] = ['episode', 'finale', 'catchup', 'movieNight', 'inactivity', 'popcorn'];

export function notificationsEnabled(): boolean {
  return getMeta(KEYS.episode) === '1';
}

/** Whether one type is on. Anything the user has never touched falls back to
 *  its default, so the new kinds work without a settings visit. */
export function notifyKindEnabled(kind: NotifyKind): boolean {
  const raw = getMeta(KEYS[kind]);
  if (raw === '1') return true;
  if (raw === '') return false;
  return DEFAULT_ON.includes(kind); // never set
}

export function toggles(): NotifyToggles {
  return {
    episode: notifyKindEnabled('episode'),
    finale: notifyKindEnabled('finale'),
    catchup: notifyKindEnabled('catchup'),
    movieNight: notifyKindEnabled('movieNight'),
    inactivity: notifyKindEnabled('inactivity'),
    popcorn: notifyKindEnabled('popcorn'),
  };
}

export async function setNotifyKind(kind: NotifyKind, on: boolean): Promise<void> {
  setMeta(KEYS[kind], on ? '1' : '');
  await syncEpisodeNotifications();
}

/** Ask for permission and turn the feature on. Returns whether it's active. */
export async function enableEpisodeNotifications(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;
  setMeta(KEYS.episode, '1');
  await syncEpisodeNotifications();
  return true;
}

export async function disableEpisodeNotifications(): Promise<void> {
  setMeta(KEYS.episode, '');
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** Stamped on every sync — the inactivity reminder counts from here. */
function markOpened(): void {
  setMeta('lastOpenedAt', String(Date.now()));
}

function lastOpenedAt(): number | null {
  const n = Number(getMeta('lastOpenedAt'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Everything the planner needs, read once. */
function snapshot(now: number): Parameters<typeof planNotifications>[0] {
  const shows = db.getAllSync<{ tvdbId: number; name: string }>(
    'SELECT tvdbId, name FROM shows WHERE followed = 1 AND archived = 0',
  );
  const todayKey = new Date(now).toISOString().slice(0, 10);
  const horizonKey = new Date(now + DAYS_AHEAD * 86400000).toISOString().slice(0, 10);

  const upcoming: UpcomingEpisode[] = [];
  const catchUp: CatchUpCandidate[] = [];
  let unwatchedCount = 0;

  for (const s of shows) {
    const m = showMeta(s.tvdbId);
    if (!m) continue;
    const seasonNums = Object.keys(m.seasons ?? {}).map(Number).filter((n) => n >= 1);
    const lastSeason = seasonNums.length ? Math.max(...seasonNums) : null;
    const ended = m.status === 'Ended' || m.status === 'Canceled';

    for (const [key, em] of Object.entries(m.episodes ?? {})) {
      const air = em?.air;
      if (!air || air < todayKey || air > horizonKey) continue;
      const [season, episode] = key.split('-').map(Number);
      if (!season || season < 1) continue;
      upcoming.push({
        showId: s.tvdbId,
        showName: s.name,
        season,
        episode,
        title: em.title ?? null,
        air,
        seasonTotal: m.seasons?.[String(season)]?.count ?? null,
        lastSeason,
        ended,
      });
    }

    // how close each season is to done, and how much is outstanding overall
    const watchedBySeason = new Map(getSeasons(s.tvdbId).map((r) => [r.season, r.watched]));
    for (const n of seasonNums) {
      const total = m.seasons?.[String(n)]?.count ?? 0;
      if (!total) continue;
      // only count episodes that have actually aired — a season half-released
      // is not one the user is "behind" on
      let aired = 0;
      for (let e = 1; e <= total; e++) {
        const a = m.episodes?.[`${n}-${e}`]?.air;
        if (a && a <= todayKey) aired++;
      }
      const watched = watchedBySeason.get(n) ?? 0;
      const remaining = Math.max(aired - watched, 0);
      unwatchedCount += remaining;
      if (remaining > 0 && remaining <= 2) {
        catchUp.push({ showId: s.tvdbId, showName: s.name, season: n, remaining });
      }
    }
  }

  const watchlistCount =
    db.getFirstSync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM movies WHERE watchedAt IS NULL AND (releaseDate IS NULL OR releaseDate = '' OR releaseDate <= ?)",
      [todayKey],
    )?.n ?? 0;

  // the game's own best score, read straight from meta so this module does not
  // have to import the game component
  const popcornBest = Number(getMeta('popcornBest') ?? '0') || 0;

  return { upcoming, catchUp, watchlistCount, unwatchedCount, lastOpenedAt: lastOpenedAt(), popcornBest };
}

/** Reschedule everything from current data. Safe to call often. */
export async function syncEpisodeNotifications(): Promise<void> {
  try {
    if (!notificationsEnabled()) {
      // the master switch is off — make sure nothing is left pending
      await Notifications.cancelAllScheduledNotificationsAsync();
      return;
    }
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('new-episodes', {
        name: 'New episodes',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await Notifications.cancelAllScheduledNotificationsAsync();

    const now = Date.now();
    const planned = planNotifications(snapshot(now), now, toggles());
    for (const n of planned) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: TITLE_KEY_KINDS.has(n.kind) ? t(n.title as LocaleKey, n.titleParams) : n.title,
          body: t(n.bodyKey, n.bodyParams),
          ...(Platform.OS === 'android' ? { channelId: 'new-episodes' } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.at) },
      });
    }
    // last, so a failure above doesn't push the inactivity clock forward
    markOpened();
  } catch {
    // notifications must never break the app
  }
}
