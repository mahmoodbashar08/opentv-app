/**
 * One person's own devices, kept level.
 *
 * WHAT IT IS. A relay of INTENT. The phone says "watched S2E3", the tablet
 * hears it and does the same thing to its own database. Nothing here moves a
 * library: SQLite on each device stays the source of truth, and if the server
 * lost every one of these messages, every device would keep its complete
 * history and lose only the few minutes in flight.
 *
 * WHY NOT THE BACKUP ZIP, which already exists and already crosses devices.
 * Because that ZIP is a TV Time-format export, and every row of a TV Time
 * export is something you HAVE. Un-marking an episode, taking a rating back
 * and deleting a film are ABSENCES — unwritable in a format made of presences.
 * A sync built on it would silently resurrect everything you deleted on the
 * other device, on every sync, for ever. The ZIP is still the right answer for
 * a NEW phone, and `restore.tsx` uses it; it is the wrong answer for two
 * phones in use at once.
 *
 * WHY INTENT AND NOT ROWS. Replaying "watched S2E3" through the app's own
 * `markWatched` keeps the episode counter, the streaks, the widget and the
 * calendar correct by construction. Shipping the row would mean shipping
 * `episodesSeen` with it, and two devices that disagree about a derived number
 * have no way to settle the argument.
 *
 * THE ECHO. Applying a remote op calls the functions that queue ops, so an
 * apply raises `setApplyingRemote`. Without it the two devices would tell each
 * other the same news for ever, and "+1 rewatch" — the only op here that is
 * not idempotent — would double on every lap. The server declines to hand a
 * device its own ops as well; both guards are cheap and the failure is silent.
 *
 * OFFLINE IS NOT AN ERROR. The outbox is only emptied on acknowledgement, so a
 * week on a plane costs nothing but a longer first sync.
 */
import {
  addMovieRewatch,
  addMovieToWatchlist,
  clearEpisodeRating,
  deleteMovie,
  deleteShow,
  dropOps,
  getMeta,
  markRewatched,
  markWatched,
  onOpQueued,
  pendingOpCount,
  pendingOps,
  setApplyingRemote,
  setEpisodeRating,
  setFollowing,
  setMeta,
  setMovieStars,
  setMovieWatched,
  setShowArchived,
  setShowFavorited,
  setShowFinished,
  unmarkWatched,
} from '@/db';
import { api, ApiError } from '@/api';
import { getToken } from '@/community-session';
import { restoreFromServerBackup } from '@/cloud-backup';
import { orderOps, parseOp, type Action, type RemoteOp } from '@/sync-ops';

const ON = 'sync.on';
const DEVICE = 'sync.device';
const CURSOR = 'sync.cursor';
const AT = 'sync.at';

export function syncEnabled(): boolean {
  return getMeta(ON) === '1';
}

/**
 * HAS ANYBODY ACTUALLY CHOSEN, as opposed to never having been asked.
 *
 * `syncEnabled()` cannot tell those apart — both read as false — and the
 * difference is the whole question when cloud backup turns this on for you.
 * Somebody who switched it OFF meant it; somebody who has never seen the switch
 * did not mean anything.
 */
export function syncDecided(): boolean {
  const v = getMeta(ON);
  return v === '1' || v === '0';
}

export function lastSyncAt(): number | null {
  const raw = getMeta(AT);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const pendingCount = pendingOpCount;

/**
 * A name for this device that survives a restart and is not a fingerprint.
 *
 * RANDOM, NOT THE HARDWARE'S ID. The server needs to tell two devices apart —
 * that is the whole of it — and an identifier derived from the phone would be
 * one more thing about the user sitting on a server for no benefit. It is also
 * the id half of every op, so it must not change: a device that renamed itself
 * would start receiving its own past back.
 */
function deviceId(): string {
  let id = getMeta(DEVICE);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    setMeta(DEVICE, id);
  }
  return id;
}

/**
 * Turning it on does NOT push the library — that is what the backup is for.
 * It starts the relay from this moment, so the first thing the other device
 * hears is the next thing you actually do.
 */
export function setSyncEnabled(on: boolean): void {
  setMeta(ON, on ? '1' : '0');
  if (on) deviceId();
}

export async function disableSync(): Promise<void> {
  setSyncEnabled(false);
  try {
    const token = await getToken();
    if (token) await api('/v1/sync', { method: 'DELETE', token });
  } catch {
    // Off locally is what the user asked for. A server that cannot be reached
    // keeps some messages for ninety days and then drops them itself.
  }
}

/** Everything one op means, done through the same functions the screens use. */
function apply(a: Action): void {
  switch (a.t) {
    case 'watch':
      markWatched(a.show, a.s, a.e, a.at || undefined);
      break;
    case 'unwatch':
      unmarkWatched(a.show, a.s, a.e);
      break;
    case 'rewatch':
      markRewatched(a.show, a.s, a.e);
      break;
    case 'rate':
      setEpisodeRating(a.show, a.s, a.e, a.stars);
      break;
    case 'unrate':
      clearEpisodeRating(a.show, a.s, a.e);
      break;
    case 'showFlag':
      if (a.flag === 'followed') setFollowing(a.show, a.on);
      else if (a.flag === 'favorited') setShowFavorited(a.show, a.on);
      else if (a.flag === 'archived') setShowArchived(a.show, a.on);
      else setShowFinished(a.show, a.on);
      break;
    case 'showDelete':
      deleteShow(a.show);
      break;
    case 'movieWatch':
      setMovieWatched(a.name, a.on);
      break;
    case 'movieStars':
      setMovieStars(a.name, a.stars);
      break;
    case 'movieRewatch':
      addMovieRewatch(a.name);
      break;
    case 'movieDelete':
      deleteMovie(a.name);
      break;
    case 'movieAdd':
      addMovieToWatchlist(a.name, a.poster, a.year, a.tmdbId);
      break;
  }
}

export type SyncOutcome = 'done' | 'off' | 'signed-out' | 'plus-required' | 'failed';

/** Guards against two syncs overlapping — a launch and a foreground can land
 *  together, and the second would push the same ops the first is still
 *  waiting on. */
let running = false;

/**
 * Say what happened here, hear what happened there, once.
 *
 * THE CURSOR MOVES PER OP, NOT PER BATCH. A crash halfway through an apply
 * would otherwise replay everything already applied on the next run, and
 * "+1 rewatch" replayed is a wrong number nobody can spot.
 */
/**
 * PUSH WHEN THE TICK HAPPENS, not when the app is put away.
 *
 * Sync used to leave only on background or launch — the reasoning being that
 * leaving the app is when a batch of ticks is finished, so it is the cheapest
 * moment to send them. True, and it made the wait invisible: somebody ticks an
 * episode, looks at their tablet, and nothing has moved. They do not know to
 * background the app, and nothing on screen says so. "it didnt show anythin"
 * is what that looks like from the outside.
 *
 * DEBOUNCED, NOT IMMEDIATE. Marking a season is twenty ops in a few seconds,
 * and twenty requests for one intention is the reason batching existed. The
 * timer restarts on every op, so a burst still leaves as one request — and a
 * single tap leaves about a second later, which reads as instant.
 *
 * The background and launch pushes stay: this handles the app being open, and
 * they handle everything else — a failed send, a device that was offline, ops
 * queued before sync was switched on.
 */
const PUSH_AFTER_MS = 1200;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

onOpQueued(() => {
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncDevices().catch(() => {});
  }, PUSH_AFTER_MS);
});

export async function syncDevices(): Promise<SyncOutcome> {
  if (running || !syncEnabled()) return running ? 'done' : 'off';
  running = true;
  try {
    const token = await getToken();
    if (!token) return 'signed-out';

    const out = pendingOps();
    const cursor = Number(getMeta(CURSOR) ?? '0') || 0;

    let res: { cursor: number; reset: boolean; ops: RemoteOp[] };
    try {
      res = await api('/v1/sync', {
        method: 'POST',
        token,
        body: { device: deviceId(), cursor, ops: out },
      });
    } catch (e) {
      /*
       * A LAPSED SUBSCRIPTION STOPS SENDING, NOT RECEIVING — the rule the
       * backup route keeps. Reported up so the settings row can say so
       * plainly; the outbox is left intact, so everything resumes on renewal
       * rather than being lost.
       */
      if (e instanceof ApiError && e.code === 'plus_required') return 'plus-required';
      return 'failed';
    }

    // Only now, because an unacknowledged push must stay queued.
    dropOps(out.map((o) => o.id));

    if (res.reset) {
      /*
       * TOO LONG AWAY. The server no longer holds the messages this device
       * missed, so no sequence of ops can make it current. The full backup is
       * the one thing that always can — and it merges, so nothing here is
       * lost by taking it.
       */
      setApplyingRemote(true);
      try {
        await restoreFromServerBackup(() => {});
      } catch {
        // Leave the cursor where it is and try again next time rather than
        // silently accepting a library with a hole in it.
        return 'failed';
      } finally {
        setApplyingRemote(false);
      }
    }

    setApplyingRemote(true);
    try {
      for (const op of orderOps(res.ops)) {
        const a = parseOp(op.kind, op.payload);
        // `null` is a newer build's vocabulary. Skip it and keep the cursor
        // moving — refusing the batch would wedge this device for good.
        if (a) {
          try {
            apply(a);
          } catch {
            // One op that cannot be applied — a show this device never had —
            // must not stop the rest of the batch.
          }
        }
        setMeta(CURSOR, String(op.seq));
      }
    } finally {
      setApplyingRemote(false);
    }

    // Past whatever this device wrote itself, which came back in no op.
    if (res.cursor > (Number(getMeta(CURSOR) ?? '0') || 0)) setMeta(CURSOR, String(res.cursor));
    setMeta(AT, String(Date.now()));
    return 'done';
  } finally {
    running = false;
  }
}
