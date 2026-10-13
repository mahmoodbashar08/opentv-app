/**
 * Watching together — the phone half (2.0.0, DESIGN-community §2; the wire is
 * `.worktrees/together/API.md`).
 *
 * A TOGETHER IS A SHARED LIST OF ONE SHOW whose tick became a position, so
 * invites, membership, leave and report are all `community-shared-lists.ts`.
 * The only new thing that leaves the phone is ONE CURSOR per together: the
 * furthest episode of that show you have marked watched (`furthestWatched`),
 * overwritten on every change, deleted when you stop. No dates, no list of
 * episodes, no other shows — there is still no watch history on the server.
 *
 * NOTHING HAPPENS FOR ANYBODY ELSE. Every path returns before any I/O unless
 * this account is joined AND has stamped `communityTogetherActive` (on create,
 * join, or seeing a together in the index). Steady state for a member who is
 * in one is zero requests too: a position is sent only when its stamp differs.
 *
 * WHY THESE KEYS DIFFER FROM API.md (`togetherSent:<itemId>`, `together:<id>`):
 * one JSON value each, named `community…`, so they ride the existing sign-out
 * and deletion lists exactly (`account.test.ts` insists every cleared key
 * starts with `community`) instead of needing a prefix sweep. And the sent map
 * carries the profile it was sent AS — the three-bugs-one-shape lesson in
 * CLAUDE.md: a stamp that records what was sent but not to whom.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { track } from '@/analytics';
import { ApiError, api } from '@/api';
import { getProfileId, getToken, isJoined } from '@/community-session';
import { fetchSharedList, fetchSharedLists, type SharedListDetail, type SharedListRow } from '@/community-shared-lists';
import { furthestWatched, getMeta, getShowBrief, onLocalChange, onRemoteChange, setMeta, showWatchCount } from '@/db';
import { PLUS_AVAILABLE, requirePlus } from '@/plus';
import { positionStamp, resolveTogetherShow, type ShowResolution } from '@/together-pure';

const ACTIVE_KEY = 'communityTogetherActive';
/** `[{ listId, tvdbId, itemId? }]` — which togethers this account is in. */
const SHOWS_KEY = 'communityTogetherShows';
/** `{ owner, sent: { [itemId]: "2:4" | "none" } }` — what the server was last told. */
const SENT_KEY = 'communityTogetherSent';
/** `{ [listId]: SharedListDetail }` — the last detail, read synchronously by the show page. */
const DETAILS_KEY = 'communityTogetherDetails';
/** When the index was last read, for the once-a-day refresh at launch. */
const INDEX_AT_KEY = 'communityTogetherIndexAt';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The sync idiom's debounce (`device-sync.ts`): a season ticked off in one go is one send. */
const PUSH_AFTER_MS = 1200;

type Entry = { listId: string; tvdbId: number; itemId?: string };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getMeta(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const readShows = (): Entry[] => readJson<Entry[]>(SHOWS_KEY, []).filter((e) => e && typeof e.listId === 'string');
const writeShows = (e: Entry[]) => setMeta(SHOWS_KEY, JSON.stringify(e));
const readDetails = (): Record<string, SharedListDetail> => readJson(DETAILS_KEY, {});
const writeDetails = (d: Record<string, SharedListDetail>) => setMeta(DETAILS_KEY, JSON.stringify(d));

function readSent(): Record<string, string> {
  const v = readJson<{ owner?: string; sent?: Record<string, string> }>(SENT_KEY, {});
  // Sent as somebody else: worth nothing to this account.
  return v.owner === getProfileId() && v.sent ? v.sent : {};
}
const writeSent = (sent: Record<string, string>) => setMeta(SENT_KEY, JSON.stringify({ owner: getProfileId(), sent }));

const active = () => isJoined() && getMeta(ACTIVE_KEY) === '1';

// ── listeners: the `community-feed` pattern ─────────────────────────────────

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

// ── what this phone holds ───────────────────────────────────────────────────

function resolve(key: number): ShowResolution {
  return resolveTogetherShow(
    key,
    (id) => getShowBrief(id) != null || showWatchCount(id) > 0,
    (id) => {
      const to = Number(getMeta(`showRemap:${id}`));
      return Number.isFinite(to) && to > 0 ? to : null;
    },
  );
}

/**
 * Where a together's show stands on this phone: `local` (tracked — progress is
 * read and sent), `absent` (never added — "Add to my shows"), or `unreadable`
 * (re-keyed somewhere the library no longer holds — the dim "can't read your
 * progress" line; reported, never a wrong number sent).
 */
export function togetherShowState(tvdbKey: number): ShowResolution['kind'] {
  return resolve(tvdbKey).kind;
}

/** The togethers about one show page, by the page's own id or the id it was re-keyed to. */
function entriesFor(tvdbId: number): Entry[] {
  return readShows().filter((e) => {
    if (e.tvdbId === tvdbId) return true;
    const r = resolve(e.tvdbId);
    return r.kind === 'local' && r.id === tvdbId;
  });
}

export function cachedTogethersFor(tvdbId: number): SharedListDetail[] {
  const details = readDetails();
  return entriesFor(tvdbId)
    .map((e) => details[e.listId])
    .filter((d): d is SharedListDetail => d != null);
}

export function cachedTogether(listId: string): SharedListDetail | null {
  return readDetails()[listId] ?? null;
}

// ── keeping the memberships current ─────────────────────────────────────────

/** Every together in an index the screens already fetched — costs no request of its own. */
export function noteTogetherIndex(rows: readonly SharedListRow[]): void {
  const togethers = rows.filter((r) => r.kind === 'together' && r.show != null);
  if (togethers.length === 0 && getMeta(ACTIVE_KEY) !== '1') return;
  if (togethers.length > 0) setMeta(ACTIVE_KEY, '1');
  const old = readShows();
  writeShows(
    togethers.map((r) => ({
      listId: r.id,
      tvdbId: Number(r.show?.target_key),
      itemId: old.find((e) => e.listId === r.id)?.itemId,
    })),
  );
  // A together that left the index (deleted by its owner, or left elsewhere) leaves the cache.
  const details = readDetails();
  for (const id of Object.keys(details)) if (!togethers.some((r) => r.id === id)) delete details[id];
  writeDetails(details);
  setMeta(INDEX_AT_KEY, String(Date.now()));
  emit();
  schedulePublish();
}

/** A detail just fetched by a screen. Members only: a visitor has no position to send. */
export function noteTogetherDetail(d: SharedListDetail): void {
  if (d.kind !== 'together' || d.is_member === false) return;
  const item = d.items[0];
  if (!item) return;
  setMeta(ACTIVE_KEY, '1');
  const details = readDetails();
  details[d.id] = d;
  writeDetails(details);
  const shows = readShows().filter((e) => e.listId !== d.id);
  shows.push({ listId: d.id, tvdbId: Number(item.target_key), itemId: item.id });
  writeShows(shows);
  emit();
  schedulePublish();
}

/** Left, deleted, or answered 404: off this phone's books. */
export function forgetTogether(listId: string): void {
  writeShows(readShows().filter((e) => e.listId !== listId));
  const details = readDetails();
  delete details[listId];
  writeDetails(details);
  emit();
}

/** Joined by code. Shape-only analytics: that it happened, never which. */
export function noteTogetherJoined(): void {
  setMeta(ACTIVE_KEY, '1');
  track('together_join');
}

/**
 * Start one. PLUS, always — no free first one (D11). `requirePlus` is the
 * phone's half of the gate; a `plus_required` from the server is the paywall
 * too, the `shared/create` pattern. Null when it did not happen.
 */
export async function startTogether(show: {
  tvdbId: number;
  title: string;
  poster: string | null;
}): Promise<{ id: string; invite_code: string } | null> {
  if (!requirePlus('together')) return null;
  const token = await getToken();
  if (!token) throw new ApiError('unauthenticated', 401, 'Not signed in.');
  try {
    const r = await api<{ id: string; invite_code: string }>('/v1/shared-lists', {
      method: 'POST',
      token,
      body: {
        kind: 'together',
        item: { target_source: 'tvdb', target_key: String(show.tvdbId), title: show.title, poster: show.poster },
      },
    });
    setMeta(ACTIVE_KEY, '1');
    writeShows([...readShows().filter((e) => e.listId !== r.id), { listId: r.id, tvdbId: show.tvdbId }]);
    track('together_create');
    // The creator may be halfway through already: publish without waiting for a tick.
    schedulePublish();
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'plus_required') {
      if (PLUS_AVAILABLE) router.push('/paywall?from=together');
      return null;
    }
    throw e;
  }
}

// ── publishing my cursor ────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
/** A change that landed mid-run: run once more at the end rather than lose it. */
let again = false;

function schedulePublish(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void publishPositions();
  }, PUSH_AFTER_MS);
}

/** Put my new position into the cached detail, so the strip moves with the tap. */
function patchMine(listId: string, itemId: string, season: number | null, episode: number | null): void {
  const details = readDetails();
  const d = details[listId];
  const me = d?.members.find((m) => m.is_me);
  if (!d || !me) return;
  d.items = d.items.map((it) => {
    if (it.id !== itemId) return it;
    const rest = (it.positions ?? []).filter((p) => p.member_id !== me.id);
    return {
      ...it,
      positions:
        season == null || episode == null
          ? rest
          : [...rest, { member_id: me.id, season, episode, updated_at: new Date().toISOString() }],
    };
  });
  writeDetails(details);
}

/**
 * Tell the server where I am in every together — only where it changed.
 *
 * A compare of two short strings per together when nothing moved, so it is
 * safe to call from every tick, launch and foreground. A 404 means the list is
 * gone or I am no longer in it: it is dropped, not retried for ever.
 */
export async function publishPositions(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  if (!active()) return;
  running = true;
  again = false;
  let changed = false;
  try {
    const token = await getToken();
    if (!token) return;
    for (const entry of readShows()) {
      let itemId = entry.itemId;
      try {
        if (!itemId) {
          // The index carries no item id; the first open of the detail does.
          const d = await fetchSharedList(entry.listId);
          noteTogetherDetail(d);
          itemId = d.items[0]?.id;
          if (!itemId) continue;
        }
        const r = resolve(entry.tvdbId);
        if (r.kind === 'unreadable') continue;
        const pos = r.kind === 'local' ? furthestWatched(r.id) : null;
        const stamp = positionStamp(pos);
        const sent = readSent();
        // Never sent and nothing to say: the server already shows "Not started".
        if (sent[itemId] === stamp || (sent[itemId] == null && pos == null)) continue;
        const path = `/v1/shared-lists/${encodeURIComponent(entry.listId)}/items/${encodeURIComponent(itemId)}/position`;
        if (pos) await api(path, { method: 'PUT', token, body: { season: pos.season, episode: pos.episode } });
        else await api(path, { method: 'DELETE', token });
        writeSent({ ...readSent(), [itemId]: stamp });
        patchMine(entry.listId, itemId, pos?.season ?? null, pos?.episode ?? null);
        changed = true;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'not_found') {
          forgetTogether(entry.listId);
        }
        // Anything else (offline, a timeout): the stamp is unchanged, so the
        // next tick, launch or foreground tries again.
      }
    }
  } finally {
    running = false;
    if (changed) emit();
    if (again) schedulePublish();
  }
}

/**
 * Launch and foreground. Returns before any I/O for everybody not in a
 * together; refreshes the index once a day; then publishes whatever changed
 * while the app was shut (an import, Siri, another app's sync).
 */
export async function syncTogetherIfNeeded(): Promise<void> {
  if (!active()) return;
  const at = Number(getMeta(INDEX_AT_KEY) ?? '');
  if (!Number.isFinite(at) || Date.now() - at > DAY_MS) {
    try {
      noteTogetherIndex(await fetchSharedLists());
    } catch {
      // Offline: the cached memberships still publish.
    }
  }
  await publishPositions();
}

let wired = false;
/** Once, from `_layout.tsx`: every local or synced change to the library may move a cursor. */
export function startTogetherSync(): void {
  if (wired) return;
  wired = true;
  const poke = () => {
    if (getMeta(ACTIVE_KEY) === '1') schedulePublish();
  };
  onLocalChange(poke);
  onRemoteChange(poke);
}

/**
 * The togethers for one show, for the show page: the cache at once, a fresh
 * detail on every focus (one request per open, no polling — D12).
 *
 * STATE REACT SETS, never a render-time read plus a counter: the React
 * Compiler would memoise the read away (CLAUDE.md).
 */
export function useTogethersFor(tvdbId: number): SharedListDetail[] {
  const [lists, setLists] = useState<SharedListDetail[]>(() => cachedTogethersFor(tvdbId));
  useEffect(() => {
    const fn = () => setLists(cachedTogethersFor(tvdbId));
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [tvdbId]);
  useFocusEffect(
    useCallback(() => {
      setLists(cachedTogethersFor(tvdbId));
      if (!active()) return;
      for (const { listId: id } of entriesFor(tvdbId)) {
        fetchSharedList(id)
          .then(noteTogetherDetail)
          .catch((e: unknown) => {
            if (e instanceof ApiError && e.code === 'not_found') forgetTogether(id);
          });
      }
    }, [tvdbId]),
  );
  return lists;
}
