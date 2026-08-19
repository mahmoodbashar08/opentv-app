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
import { currentLocale, t } from '@/i18n';
import { formatPeriod } from '@/locale-resolve';
import { isPlus } from '@/plus';
import { showMeta } from '@/metadata';
import { planNotifications, type CatchUpCandidate, type NotifyKind, type NotifyToggles, type UpcomingEpisode } from '@/notification-plan';
import { memoryFor, memoryNotificationAt, memorySentence } from '@/on-this-day';
import { shouldResync } from '@/pure';
import type { LocaleKey } from '@/locales/keys';

const DAYS_AHEAD = 21; // horizon for episode reminders; refreshed every app open

// notification-plan.ts is deliberately free of `@/` imports (so its rules can
// be unit-tested under plain Node), so it hands back an i18n KEY in `title`
// rather than English text for every kind except `catchup` — whose title is
// nothing but the show's own name, so there's nothing to translate. This is
// where those keys get resolved into real, localised display text. `body` is
// always a key, for every kind, so it has no kind-gated set of its own.
const TITLE_KEY_KINDS: ReadonlySet<NotifyKind> = new Set(['episode', 'finale', 'movieNight', 'inactivity', 'popcorn', 'wrapped']);

/** Meta key per type. `episode` keeps its 1.1.x key so existing users are
 *  neither silently re-enabled nor reset by the 1.2.0 update. */
const KEYS: Record<NotifyKind, string> = {
  episode: 'notifyNewEpisodes',
  finale: 'notifyFinales',
  catchup: 'notifyCatchup',
  movieNight: 'notifyMovieNight',
  inactivity: 'notifyInactivity',
  popcorn: 'notifyPopcorn',
  wrapped: 'notifyWrapped',
  memory: 'notifyMemory',
};

/** Types added in 1.2.0 default ON for anyone who already allowed
 *  notifications — same category they opted into — but stay switchable. */
// popcorn is the one that defaults OFF: it is an easter-egg game, not the
// reason anyone installed a TV tracker, so it is opt-in rather than opt-out.
const DEFAULT_ON: NotifyKind[] = ['finale', 'catchup', 'movieNight', 'inactivity', 'wrapped', 'memory'];

export const NOTIFY_KINDS: NotifyKind[] = ['episode', 'finale', 'catchup', 'movieNight', 'inactivity', 'memory', 'popcorn'];

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
    // PLUS ONLY, and gated here rather than in the planner so there is one
    // place it can be wrong: a free user's plan simply never contains it.
    wrapped: isPlus() && notifyKindEnabled('wrapped'),
    // FREE, AND NEVER PLUS. It shows a person their own past, computed on their
    // own phone from marks they made years ago. Charging for that breaks the
    // rule the whole app stands on.
    memory: notifyKindEnabled('memory'),
  };
}

export async function setNotifyKind(kind: NotifyKind, on: boolean): Promise<void> {
  setMeta(KEYS[kind], on ? '1' : '');
  // forced: the user just flipped this switch, so it has to take effect now
  // rather than whenever the resync gap next allows a background pass
  await syncEpisodeNotifications(true);
}

/** Ask for permission and turn the feature on. Returns whether it's active. */
export async function enableEpisodeNotifications(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;
  setMeta(KEYS.episode, '1');
  await syncEpisodeNotifications(true);
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

  // The month currently running — the one whose recap becomes readable the
  // moment it ends. Offered only if something was actually watched in it: a
  // "your July is ready" for a July with nothing in it opens on the quiet
  // state, which is an honest screen but a pointless notification.
  const wrappedMonth = todayKey.slice(0, 7);
  const watchedThisMonth =
    (db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM watches WHERE substr(watchedAt, 1, 7) = ?', [
      wrappedMonth,
    ])?.n ?? 0) > 0;

  return {
    upcoming,
    catchUp,
    watchlistCount,
    unwatchedCount,
    lastOpenedAt: lastOpenedAt(),
    popcornBest,
    wrappedMonth: watchedThisMonth ? wrappedMonth : null,
    wrappedLabel: watchedThisMonth ? formatPeriod(wrappedMonth, currentLocale()) : null,
  };
}

/**
 * How long to leave between background resyncs. Reminders are for episodes
 * airing days ahead, so nothing this schedules changes inside ten minutes —
 * see `shouldResync` for why the gap exists at all.
 */
const RESYNC_GAP_MS = 10 * 60 * 1000;

/**
 * Reschedule everything from current data.
 *
 * `force` bypasses the resync gap; app launch and a settings change pass it,
 * because there the user is either waiting for the result or has just asked
 * for one. The unforced path is the one that runs on every trip to the
 * background, and is throttled.
 */
export async function syncEpisodeNotifications(force = false): Promise<void> {
  try {
    if (!notificationsEnabled()) {
      // the master switch is off — make sure nothing is left pending
      await Notifications.cancelAllScheduledNotificationsAsync();
      return;
    }
    const now = Date.now();
    if (!force && !shouldResync(Number(getMeta('notifySyncedAt')), now, RESYNC_GAP_MS)) {
      // still record the visit: the inactivity nudge is measured from it, and
      // skipping that would make the app look abandoned while it is in use
      markOpened();
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

    const planned = planNotifications(snapshot(now), now, toggles());
    for (const n of planned) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: TITLE_KEY_KINDS.has(n.kind) ? t(n.title as LocaleKey, n.titleParams) : n.title,
          body: t(n.bodyKey, n.bodyParams),
          ...(n.data ? { data: n.data } : {}),
          ...(Platform.OS === 'android' ? { channelId: 'new-episodes' } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.at) },
      });
    }
    /*
     * TODAY'S MEMORY, scheduled here rather than planned in `notification-plan`
     * because it is the one kind that has to READ THE DATABASE — the planner is
     * deliberately free of `@/` imports so its rules can be tested under plain
     * Node, and a nine-year archive cannot be passed to it as a snapshot.
     *
     * The stamp is what makes three launches in a day mean one notification.
     */
    if (toggles().memory) {
      const today = new Date();
      const m = memoryFor(today);
      const at = memoryNotificationAt(m, today, getMeta('memoryNotifiedDay'));
      if (at != null && m != null) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: t('onThisDay.title'),
            // THE NOTIFICATION CARRIES THE MEMORY, it does not promise one.
            // "A year ago today you finished Dark" is worth reading without
            // ever being tapped; "you have a memory, open the app" is not.
            body: memorySentence(m, today),
            ...(Platform.OS === 'android' ? { channelId: 'new-episodes' } : {}),
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
        });
        setMeta('memoryNotifiedDay', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
      }
    }

    // last, so a failure above doesn't push the inactivity clock forward, and
    // doesn't start the resync gap on work that never landed
    markOpened();
    setMeta('notifySyncedAt', String(now));
  } catch {
    // notifications must never break the app
  }
}
