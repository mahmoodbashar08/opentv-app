/**
 * Your shows, in the calendar you already look at.
 *
 * WHY THIS AND NOT ANOTHER NOTIFICATION. The app has had episode reminders
 * since 1.1 and they answer a different question: a reminder interrupts you on
 * the day. A calendar answers "what is this week" before the week starts — it
 * is the thing people check when they plan, and every tracker that charges for
 * anything charges for this (Simkl sells iCal and Google Calendar sync in VIP).
 *
 * ITS OWN CALENDAR, NEVER YOURS. Writing into somebody's default calendar
 * means their work diary fills with television and there is no way back except
 * deleting events one by one. OpenTV creates a calendar of its own, which the
 * phone's own Calendar app can hide with one switch and delete with another.
 * Turning the setting off here deletes it outright.
 *
 * ALL-DAY EVENTS, because an air DATE is all the catalogue gives us. Inventing
 * a time — 9pm, or whenever it first aired in America — would put a wrong hour
 * in somebody's day and look authoritative doing it.
 *
 * IDEMPOTENT BY KEY, not by search. Every event carries the episode it was made
 * for in a stable id stored on this device, so a re-sync updates what moved,
 * removes what was cancelled and leaves the rest alone. A sync that deleted
 * everything and rewrote it would lose whatever the reader had dragged, noted
 * or invited somebody to.
 */
import { Platform } from 'react-native';

import db, { getMeta, setMeta } from '@/db';
import { showMeta } from '@/metadata';

/** The calendar we made, so we never touch one we did not. */
const CAL_ID_KEY = 'calendarId';
/** episode key → the event id we created for it. */
const MAP_KEY = 'calendarEvents';
const ON_KEY = 'calendarSyncOn';
const AT_KEY = 'calendarSyncedAt';

/**
 * How far ahead to write.
 *
 * Longer than the notification horizon (21 days) on purpose: a reminder is
 * about this week, a calendar is what you scroll through when planning a
 * month. Short enough that a show announcing two years of dates does not put
 * four hundred entries in somebody's diary.
 */
const DAYS_AHEAD = 60;

/*
 * THE LEGACY ENTRY POINT, DELIBERATELY.
 *
 * SDK 57 replaced expo-calendar's functions with an object-oriented API and
 * the old names now THROW rather than warn: "Method
 * requestCalendarPermissionsAsync imported from expo-calendar is deprecated."
 * That throw is what made the switch fail in silence — it happened inside a
 * promise nobody was catching.
 *
 * `expo-calendar/legacy` is the same API the package still ships and supports.
 * Moving to the new one is a rewrite of this whole file for no behaviour
 * anybody asked for; it can happen when there is a reason beyond a rename.
 */
type CalendarModule = typeof import('expo-calendar/legacy');

function calendarModule(): CalendarModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-calendar/legacy') as CalendarModule;
  } catch {
    // A build without the native module — Jest, Expo Go — gets a silent no-op
    // rather than a throw at import time. Same guard as `analytics.ts`.
    return null;
  }
}

export const calendarSupported = (): boolean => calendarModule() != null;

export const calendarSyncOn = (): boolean => getMeta(ON_KEY) === '1';

export function lastCalendarSyncAt(): number | null {
  const v = getMeta(AT_KEY);
  return v ? Number(v) : null;
}

function readMap(): Record<string, string> {
  try {
    const raw = getMeta(MAP_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

const writeMap = (m: Record<string, string>): void => setMeta(MAP_KEY, JSON.stringify(m));

/** One episode, as the calendar needs it. */
type Airing = { key: string; title: string; date: string };

/**
 * Every upcoming episode of a followed show, within the horizon.
 *
 * FOLLOWED AND NOT ARCHIVED, the same set the reminders use: a calendar full
 * of a show somebody stopped watching is worse than an empty one, because they
 * have to read it before they can ignore it.
 */
function airings(now: number): Airing[] {
  const out: Airing[] = [];
  const todayKey = new Date(now).toISOString().slice(0, 10);
  const horizonKey = new Date(now + DAYS_AHEAD * 86400000).toISOString().slice(0, 10);

  let shows: { tvdbId: number; name: string }[] = [];
  try {
    shows = db.getAllSync<{ tvdbId: number; name: string }>(
      'SELECT tvdbId, name FROM shows WHERE followed = 1 AND archived = 0',
    );
  } catch {
    return out;
  }

  for (const s of shows) {
    const m = showMeta(s.tvdbId);
    if (!m) continue;
    for (const [epKey, em] of Object.entries(m.episodes ?? {})) {
      const air = em?.air;
      if (!air || air < todayKey || air > horizonKey) continue;
      const [season, episode] = epKey.split('-').map(Number);
      if (!season || season < 1) continue;
      const code = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
      out.push({
        key: `${s.tvdbId}-${epKey}`,
        // The show first, because a calendar row is read at a glance and the
        // show is what identifies it; the episode title is the detail.
        title: em.title ? `${s.name} · ${code} — ${em.title}` : `${s.name} · ${code}`,
        date: air,
      });
    }
  }
  return out;
}

/** An all-day event wants midnight LOCAL, not midnight UTC — an hour's drift
 *  the wrong way puts the episode on the day before. */
function localMidnight(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

export type CalendarOutcome = 'done' | 'unavailable' | 'denied';

/**
 * WHY IT FAILED, kept for the alert to print.
 *
 * The first version caught everything and answered "unavailable", so a switch
 * that would not switch on said only that it could not be set up — which is
 * the same sentence for a refused permission, a missing native module and a
 * calendar the system would not create. A reader cannot act on that, and
 * neither could I.
 */
let lastError: string | null = null;
export const lastCalendarError = (): string | null => lastError;

/**
 * Ask for the permission and make the calendar. The one call that may show a
 * system prompt, so it is only ever reached by a deliberate tap.
 */
export async function enableCalendarSync(): Promise<CalendarOutcome> {
  const Calendar = calendarModule();
  if (!Calendar) return 'unavailable';

  lastError = null;
  /*
   * THE PERMISSION REQUEST IS INSIDE THE TRY, and it being outside is why
   * three builds of this reported nothing at all.
   *
   * `requestCalendarPermissionsAsync` can THROW rather than answer — a missing
   * usage description, an iOS state it does not like — and it sat above the
   * try, so the whole function rejected. The caller did `void toggle(v)` with
   * no catch of its own, so the rejection went nowhere: the switch moved,
   * failed, and said nothing, which is the one outcome that cannot be
   * diagnosed from the outside.
   *
   * Nothing between here and the end may escape. A feature that cannot turn on
   * must at least be able to say so.
   */
  try {
    /*
     * ASK WHAT WE ALREADY HAVE BEFORE ASKING AGAIN.
     *
     * iOS reported "Full Access" in its own Settings while this said the
     * access was refused, which means the REQUEST answered something other
     * than `granted` for a permission already held. Reading the current state
     * first is both cheaper and the thing that is actually true; the request
     * is only made when there is nothing yet.
     *
     * `granted` is trusted alongside `status`, because iOS 17 split calendar
     * access into full and write-only and the two fields do not always agree
     * about which word describes the result. Writing is all this feature does.
     */
    let perm = await Calendar.getCalendarPermissionsAsync();
    if (!(perm.granted || perm.status === 'granted')) {
      perm = await Calendar.requestCalendarPermissionsAsync();
    }
    if (!(perm.granted || perm.status === 'granted')) {
      // The refusal carries what the system actually said, for the same reason
      // the throw above had to: "refused" alone cannot be acted on.
      lastError = `status=${String(perm.status)} granted=${String(perm.granted)} access=${String(
        (perm as { accessPrivileges?: unknown }).accessPrivileges ?? '—',
      )}`;
      return 'denied';
    }

    const id = await ensureCalendar(Calendar);
    // `lastError` already holds what iOS said; do not write over it.
    if (!id) return 'unavailable';
    setMeta(ON_KEY, '1');
    await syncCalendar(true);
    return 'done';
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    // Half-on is worse than off: the switch would read as enabled while
    // nothing was ever written.
    setMeta(ON_KEY, '');
    return 'unavailable';
  }
}

/**
 * Stop, and take the calendar with it.
 *
 * Leaving sixty entries behind after somebody turned the feature off would be
 * the app keeping a shelf in their diary it no longer maintains.
 */
export async function disableCalendarSync(): Promise<void> {
  const Calendar = calendarModule();
  const id = getMeta(CAL_ID_KEY);
  setMeta(ON_KEY, '');
  setMeta(MAP_KEY, '');
  setMeta(AT_KEY, '');
  setMeta(CAL_ID_KEY, '');
  if (!Calendar || !id) return;
  try {
    await Calendar.deleteCalendarAsync(id);
  } catch {
    // Already gone, or removed by hand in the Calendar app. Either way the
    // local state is clear and there is nothing to repair.
  }
}

async function ensureCalendar(Calendar: CalendarModule): Promise<string | null> {
  const existing = getMeta(CAL_ID_KEY);
  if (existing) {
    try {
      // Deleted by hand in the phone's Calendar app is a normal thing to have
      // happened; making a new one is better than failing every sync forever.
      const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      if (all.some((c) => c.id === existing)) return existing;
    } catch {
      return existing;
    }
  }

  /*
   * THE SOURCE MUST BE ONE THE DEVICE ALREADY HAS.
   *
   * iOS does not let an app invent one: `createCalendarAsync` answers
   * "Calendar has no source" (EKErrorDomain 14) for a descriptor it did not
   * issue, which is what every previous attempt here was handing it. The
   * pattern that works — and the one every report of this settles on — is to
   * read the device's own calendars and borrow the source off one of them.
   *
   *   https://forums.expo.dev/t/what-is-the-sourceid-parameter-for-creating-an-os-calendar/32675
   *   https://github.com/expo/expo/issues/7491
   *
   * A LOCAL source first, then CalDAV, then anything modifiable. Local keeps
   * the calendar on this phone, which is where a calendar the app generates
   * belongs — putting it in somebody's iCloud would surface it on their work
   * laptop without asking.
   */
  /*
   * TRY EVERY SOURCE THE DEVICE HAS, IN ORDER, UNTIL ONE ACCEPTS.
   *
   * iOS will not let an app invent a source — `createCalendarAsync` answers
   * "Calendar has no source" for a descriptor it did not issue — so the source
   * must be borrowed from a calendar already on the phone. But borrowing one
   * is not enough either: an account can refuse additions outright, which iOS
   * reports as "That account does not allow calendars to be added or
   * removed", and nothing expo exposes says in advance which account that is.
   *
   *   https://forums.expo.dev/t/what-is-the-sourceid-parameter-for-creating-an-os-calendar/32675
   *   https://github.com/expo/expo/issues/7491
   *
   * So the question is asked of the system rather than guessed: every distinct
   * source, in preference order, until one works. Local first — a calendar the
   * app generates belongs on this phone rather than in somebody's iCloud,
   * where it would appear on their work laptop — then CalDAV, then whatever
   * else is there.
   */
  const candidates: string[] = [];
  if (Platform.OS === 'ios') {
    try {
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const rank = (c: (typeof cals)[number]): number => {
        const type = c.source?.type ?? '';
        if (type === 'local') return c.allowsModifications ? 0 : 1;
        if (type === 'caldav') return c.allowsModifications ? 2 : 3;
        return c.allowsModifications ? 4 : 5;
      };
      for (const c of [...cals].sort((a, b) => rank(a) - rank(b))) {
        const id = c.source?.id;
        if (id && !candidates.includes(id)) candidates.push(id);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    try {
      const def = (await Calendar.getDefaultCalendarAsync())?.source?.id;
      if (def && !candidates.includes(def)) candidates.push(def);
    } catch {
      // Write-only access, or nothing default. The list above still stands.
    }
  }

  const shapes: Record<string, unknown>[] =
    Platform.OS === 'android'
      ? [
          {
            source: { isLocalAccount: true, name: 'OpenTV' },
            ownerAccount: 'OpenTV',
            accessLevel: Calendar.CalendarAccessLevel.OWNER,
          },
        ]
      : candidates.map((sourceId) => ({ sourceId }));
  // A phone that reported no sources at all still gets one attempt, so iOS
  // gets to say why rather than us reporting an empty list as a failure.
  if (shapes.length === 0) shapes.push({});

  let id: string | null = null;
  for (const shape of shapes) {
    try {
      id = await Calendar.createCalendarAsync({
        /* The calendar's NAME is the app's, not a label: somebody scrolling a
           list of calendars is looking for "OpenTV", and it is the same six
           letters in every language. */
        // eslint-disable-next-line no-restricted-syntax
        title: 'OpenTV',
        name: 'OpenTV',
        color: '#FFD400',
        entityType: Calendar.EntityTypes.EVENT,
        ...shape,
      } as never);
      lastError = null;
      break;
    } catch (err) {
      // KEPT, NOT REPLACED — the last refusal is the one that still stands,
      // and overwriting it with a sentence of our own cost two builds already.
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!id) return null;

  setMeta(CAL_ID_KEY, id);
  return id;
}

/**
 * Bring the calendar level with the library.
 *
 * Safe to call on every launch: it writes only what changed, and returns
 * immediately for everybody who has not turned it on — which is almost
 * everybody, so it costs them a `getMeta` and nothing else.
 */
export async function syncCalendar(force = false): Promise<CalendarOutcome> {
  if (!calendarSyncOn() && !force) return 'unavailable';
  const Calendar = calendarModule();
  if (!Calendar) return 'unavailable';

  try {
    const perms = await Calendar.getCalendarPermissionsAsync();
    if (perms.status !== 'granted') return 'denied';

    const calendarId = await ensureCalendar(Calendar);
    if (!calendarId) return 'unavailable';

    const wanted = airings(Date.now());
    const map = readMap();
    const next: Record<string, string> = {};

    for (const a of wanted) {
      const start = localMidnight(a.date);
      const end = new Date(start.getTime() + 86400000);
      const existing = map[a.key];
      if (existing) {
        try {
          // UPDATED, NOT REPLACED: a date that moved should move, and anything
          // the reader added to the event — a note, an alert, a guest — stays.
          await Calendar.updateEventAsync(existing, { title: a.title, startDate: start, endDate: end });
          next[a.key] = existing;
          continue;
        } catch {
          // Deleted in the Calendar app; fall through and make it again.
        }
      }
      try {
        next[a.key] = await Calendar.createEventAsync(calendarId, {
          title: a.title,
          startDate: start,
          endDate: end,
          allDay: true,
          timeZone: 'UTC',
        });
      } catch {
        // One episode failing must not abandon the rest of the season.
      }
    }

    // Anything we made that is no longer wanted — watched, unfollowed, or an
    // air date that slipped past the horizon.
    for (const [key, id] of Object.entries(map)) {
      if (next[key]) continue;
      try {
        await Calendar.deleteEventAsync(id);
      } catch {
        // Already gone.
      }
    }

    writeMap(next);
    setMeta(AT_KEY, String(Date.now()));
    return 'done';
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    return 'unavailable';
  }
}
