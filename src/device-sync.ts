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
  episodeEmotions,
  onOpQueued,
  pendingOpCount,
  pendingOps,
  notifyRemoteChange,
  onRemoteChange,
  setApplyingRemote,
  setCharacterVoteExact,
  toggleEpisodeEmotion,
  setEpisodeRating,
  setFollowing,
  setMeta,
  clearMovieStars,
  setMovieStars,
  setMovieWatched,
  setShowArchived,
  setShowFavorited,
  setShowFinished,
  unmarkWatched,
} from '@/db';
import { useEffect, useRef } from 'react';
import { AppState, InteractionManager } from 'react-native';

import { api, ApiError } from '@/api';
import { getToken } from '@/community-session';
import { serverUrl } from '@/server-url';
import { restoreFromServerBackup, serverBackupNow } from '@/cloud-backup';
import { orderOps, parseOp, type Action, type RemoteOp } from '@/sync-ops';

const ON = 'sync.on';
const DEVICE = 'sync.device';
const CURSOR = 'sync.cursor';
const AT = 'sync.at';
const SEEDED = 'sync.seeded';
const FOR = 'sync.for';

/**
 * WHOSE RELAY THE CURSOR COUNTS AGAINST — the account AND the server.
 *
 * A cursor is a position in one server's sequence and means nothing in
 * another's. Point a device at a self-hosted instance, sync until the cursor
 * reads 353, point it back at ours where the same account's sequence reaches 1,
 * and it asks for everything after 353 for ever: the relay has nothing that far
 * along and never will, so the device goes permanently deaf while reporting
 * itself perfectly in sync. Nothing on screen can show that — the last-sync
 * time keeps updating, because the request succeeds.
 *
 * The same trap as the publish fingerprints: a stamp that records a position
 * but not whose. So the stamp carries both, and a change of either starts the
 * count again.
 */
function relayOwner(): string {
  return `${getMeta('communityProfileId') ?? ''}@${serverUrl()}`;
}

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
export function deviceId(): string {
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
      if (a.stars == null) clearMovieStars(a.name);
      else setMovieStars(a.name, a.stars);
      break;
    case 'emotion': {
      // The op says what should be TRUE; the local call is a toggle. Only act
      // when they disagree, or replaying would undo what it just said.
      const on = episodeEmotions(a.show, a.s, a.e).includes(a.emotion);
      if (on !== a.on) toggleEpisodeEmotion(a.show, a.s, a.e, a.emotion);
      break;
    }
    case 'charVote':
      setCharacterVoteExact(a.show, a.s, a.e, a.name);
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

/**
 * THE FIRST SYNC ON A DEVICE TAKES THE LIBRARY, without anybody pressing anything.
 *
 * Turning sync on starts the relay from that moment — right for a device that
 * already has the library, and useless for one that does not. The second phone
 * signed in, sat there empty, and waited for the next thing its owner happened
 * to watch. The answer was a Restore button, which is a chore dressed as a
 * feature: "i should not press any think it should do it in the bg when i open
 * the app" is exactly the complaint, and it is right.
 *
 * SO: once per account, on the first sync, the copy on the server is taken. The
 * import MERGES, so a device that already had everything loses nothing and a
 * device that had nothing gains it all — the same operation either way, which
 * is why it is safe to do unasked.
 *
 * THE STAMP CARRIES THE PROFILE, never just a boolean. Sign in as somebody else
 * and their library must arrive too; a bare flag would say "done" for ever and
 * hand the second account an empty app. That exact shape has cost this codebase
 * three bugs already.
 *
 * AND THE UNION GOES BACK UP. `restoreFromServerBackup` stamps what it took as
 * already-backed-up, which is true of the download and not of the merge: a
 * device holding rows the server never had would sit on them until its owner
 * next touched something. One forced upload settles it.
 */
async function seedFromBackup(): Promise<void> {
  const owner = relayOwner();
  if (getMeta(SEEDED) === owner) return;

  /*
   * NOT WHILE THE APP IS STILL OPENING. Everything else here is a sentence over
   * the wire; this is a whole library through the importer, and the launch sync
   * fires from the root effect — so the import landed on top of the first
   * paint, and React reported a state update on a component that had not
   * finished mounting. Once per account, a second later, costs nobody
   * anything.
   */
  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });

  let took = false;
  setApplyingRemote(true);
  try {
    await restoreFromServerBackup(() => {});
    took = true;
  } catch (e) {
    // 404 IS AN ANSWER: nothing has been uploaded yet, so there is nothing to
    // seed and the stamp is earned. ANYTHING ELSE IS NOT — a phone that was
    // offline at the wrong moment must ask again, or it decides once, wrongly,
    // and never seeds for the life of the install.
    if ((e as { status?: number }).status !== 404) throw e;
  } finally {
    setApplyingRemote(false);
  }

  setMeta(SEEDED, owner);
  if (took) void serverBackupNow(true).catch(() => {});
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

/**
 * AND THE BACKUP FOLLOWS, on a much slower clock.
 *
 * Same intention — a change should be safe as soon as it is made, not when the
 * app is next put away — but not the same cost. A sync op is a sentence; a
 * backup is the WHOLE LIBRARY, a couple of megabytes of ZIP. Sending that on
 * every tick would upload it twenty times to mark a season.
 *
 * So the timer is long enough that a sitting is one upload rather than one per
 * episode, and short enough that somebody who ticks an episode and puts the
 * phone down is covered before they forget. `serverBackupNow` compares a
 * signature first, so a run with nothing new costs one read.
 *
 * The background trigger in `backup.ts` stays: this covers the app being open,
 * that covers it being left.
 */
const BACKUP_AFTER_MS = 60_000;
let backupTimer: ReturnType<typeof setTimeout> | null = null;

onOpQueued(() => {
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncDevices().catch(() => {});
  }, PUSH_AFTER_MS);

  if (backupTimer !== null) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    // Lazily, so a phone that never turned backup on never loads the module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { serverBackupNow } = require('@/cloud-backup') as typeof import('@/cloud-backup');
    void serverBackupNow().catch(() => {});
  }, BACKUP_AFTER_MS);
});

/**
 * WHILE THE APP IS OPEN, KEEP LOOKING.
 *
 * Sending is immediate; RECEIVING was not. A pull happened at launch and when
 * the app came back to the foreground, and nowhere else — so two devices both
 * sitting open never heard each other. The reader ticks an episode on the
 * phone, looks at the tablet, and the tablet does nothing, because from its
 * point of view nothing has happened: it is not going to ask until somebody
 * puts it away and picks it up again.
 *
 * A minute, not a second. The relay is not a conversation — nobody needs their
 * tablet to catch up in real time; they need it to be right when they look at
 * it. One request a minute per open app is a cost worth paying for that, and
 * `syncDevices` returns before touching the network when sync is off, which is
 * almost everybody.
 *
 * Stopped the moment the app is not active, so a phone in a pocket asks for
 * nothing.
 */
const POLL_MS = 60_000;
let poll: ReturnType<typeof setInterval> | null = null;

function stopPolling(): void {
  if (poll !== null) clearInterval(poll);
  poll = null;
}

function startPolling(): void {
  if (poll !== null) return;
  poll = setInterval(() => {
    void syncDevices().catch(() => {});
  }, POLL_MS);
}

AppState.addEventListener('change', (state) => {
  if (state === 'active') startPolling();
  else stopPolling();
});
// The app is already active when this module first loads.
startPolling();

export async function syncDevices(): Promise<SyncOutcome> {
  if (running || !syncEnabled()) return running ? 'done' : 'off';
  running = true;
  try {
    const token = await getToken();
    if (!token) return 'signed-out';

    // Before anything is asked for: a cursor from a different relay is worse
    // than no cursor, because it reads as up to date.
    const owner = relayOwner();
    if (getMeta(FOR) !== owner) {
      setMeta(CURSOR, '0');
      setMeta(FOR, owner);
    }

    try {
      await seedFromBackup();
    } catch {
      // Next sync tries again. A first pull that failed must not take the
      // ordinary push and pull down with it.
    }

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

    /**
     * AFTER the batch and AFTER `setApplyingRemote(false)`.
     *
     * After the batch because a hundred ops arriving together are one thing
     * happening; after the flag because a listener re-reads the database and
     * anything it writes as a result must not be mistaken for a remote apply
     * and swallowed.
     *
     * Guarded on there having been ops at all: an empty poll is the common
     * case -- every device does this on a timer -- and waking every open
     * screen to re-read for nothing is the version of this fix that costs more
     * than the bug did.
     */
    if (res.ops.length > 0) notifyRemoteChange();

    // Past whatever this device wrote itself, which came back in no op.
    if (res.cursor > (Number(getMeta(CURSOR) ?? '0') || 0)) setMeta(CURSOR, String(res.cursor));
    setMeta(AT, String(Date.now()));
    return 'done';
  } finally {
    running = false;
  }
}

/**
 * Re-read when somebody else's change lands, without leaving the screen.
 *
 * WHAT `onChange` MUST DO, and it is the whole of the React Compiler trap the
 * rest of this app has been caught by before: set STATE. A screen that reads
 * the database during render and keeps a counter to force the read again has
 * no counter after compilation — the call does not use it, so memoising it
 * against its arguments is correct and the counter is dead code. `setMovies(getMovies())`
 * is safe for the opposite reason: React sets the state, React knows it
 * changed, and nothing has to be convinced.
 *
 * The callback is held in a ref so a screen can close over fresh props without
 * re-subscribing on every render — the subscription outlives the render, the
 * behaviour does not.
 */
export function useRemoteChange(onChange: () => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => onRemoteChange(() => latest.current()), []);
}
