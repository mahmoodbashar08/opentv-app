/**
 * The live room — the phone half (2.0.0, DESIGN-community §3; the server's
 * contract is `.worktrees/room/API.md`, and where the two disagree API.md won).
 *
 * On the night an episode airs, a room on its page: who is in it and the
 * twelve feelings as people tap them. Plus to enter; the count is free (D14).
 *
 * WHO EVER TALKS TO THE SERVER. Nothing here sends a byte unless the phone is
 * joined, the episode has an air date in its own metadata and that date's
 * 48-hour window is open (`roomWindow`, the server's function line for line).
 * Outside it the pill does not exist and nothing is asked. A self-hosted
 * server with no rooms answers `not_configured` once, and this phone never
 * asks that server again.
 *
 * THE SERVER CANNOT CHECK "WATCHED", BY DESIGN. It holds no watch history, so
 * the door is the phone's: the pill exists only once the episode is marked
 * watched here, and `join` says `watched: true` only after `hasWatchedTarget`
 * says so. A courtesy lock, which is all the design asks of it.
 *
 * NOTHING IS KEPT. A room reaction is never written to the episode's own
 * feelings (D18) and never reaches SQLite: it lives in the sheet's React state
 * and is gone when the sheet closes.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { track } from '@/analytics';
import { ApiError, api } from '@/api';
import { getToken, isJoined } from '@/community-session';
import { getMeta, hasWatchedTarget, setMeta } from '@/db';
import { showMeta } from '@/metadata';
import { parseRoomKey, parseRoomMessage, roomBackoffMs, roomKey, roomWindow, type EmotionName, type RoomMessage } from '@/pure';
import { serverUrl } from '@/server-url';

/**
 * The server this phone was told has no live rooms. Its ADDRESS rather than a
 * flag: pointing the phone at another server must not carry the answer across
 * — the codebase's oldest bug shape, a stamp kept without what it was made
 * under (CLAUDE.md).
 */
const OFF_KEY = 'roomsOffOn';

/** True when this server said it has no live rooms. Synchronous, for render. */
export function roomsOffHere(): boolean {
  return getMeta(OFF_KEY) === serverUrl();
}

/** The room for an episode, from the phone's own air date. Null → no room, no request. */
export function roomKeyFor(tvdbId: number, season: number, episode: number): string | null {
  return roomKey(tvdbId, season, episode, showMeta(tvdbId)?.episodes?.[`${season}-${episode}`]?.air);
}

/** Whether the key's night is on right now. False for a key that is not a room. */
export function roomOpenNow(key: string, now = Date.now()): boolean {
  const k = parseRoomKey(key);
  return k != null && (roomWindow(k.air, now)?.open ?? false);
}

export type RoomCount = { open: boolean; watching: number };

/**
 * In memory and per launch: the count is a teaser, and a minute-old teaser is
 * as good as a fresh one. Opening the same episode twice in a minute sends one
 * request.
 */
const COUNT_TTL_MS = 60_000;
const counts = new Map<string, { at: number; value: RoomCount }>();

/**
 * `GET /v1/rooms/:key` — never throws; null when there is nothing to show.
 *
 * Asked only when joined and only inside the window, so a member who never
 * opens an airing episode never asks at all. Zero D1 rows on the server.
 */
export async function fetchRoomCount(key: string, fresh = false): Promise<RoomCount | null> {
  if (!isJoined() || roomsOffHere() || !roomOpenNow(key)) return null;
  const hit = counts.get(key);
  if (!fresh && hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.value;
  try {
    const token = await getToken();
    if (!token) return null;
    const res = await api<{ open?: unknown; watching?: unknown }>(`/v1/rooms/${key}`, { token });
    const value: RoomCount = {
      open: res?.open === true,
      watching: typeof res?.watching === 'number' && res.watching > 0 ? Math.floor(res.watching) : 0,
    };
    counts.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    // The translation pattern: a server without the feature says so once and
    // the pill never comes back on it. Anything else is a bad minute.
    if (e instanceof ApiError && e.code === 'not_configured') setMeta(OFF_KEY, serverUrl());
    return null;
  }
}

/**
 * Where the sheet is. `live` once the server's `hello` has arrived — an open
 * socket that has not said hello yet is still `connecting`.
 */
export type RoomPhase = 'connecting' | 'live' | 'closed' | 'unavailable' | 'unwatched' | 'failed';

export type RoomHandle = {
  /** Send a feeling. False when it was not sent (not live, or inside the second). */
  react(emotion: EmotionName): boolean;
  /** Drop the socket and join again — after a block, which the server applies at the door. */
  rejoin(): void;
  /** The sheet is gone: close for good. */
  close(): void;
};

/**
 * React Native's constructor takes a third argument with headers (its own
 * `globals.d.ts` says so); the DOM's, which is the type TypeScript resolves
 * here, does not. The bearer token has to ride on the upgrade request — there
 * is no other place for it that the Worker reads.
 */
type HeaderedWebSocket = new (url: string, protocols: string[], options: { headers: Record<string, string> }) => WebSocket;

/** The server allows one reaction a second per socket; the phone never asks for a second one. */
const REACT_GAP_MS = 1000;
/** A ping the runtime answers without waking the room (API.md). */
const PING_MS = 30_000;
const PING = JSON.stringify({ t: 'ping' });

/**
 * One sheet's connection: open, join, keep alive, reconnect, let go.
 *
 * WHY THE REFUSAL IS GUESSED AT. React Native's WebSocket cannot read a
 * refused upgrade — a 410 and a dead network both arrive as `onerror` then a
 * 1006. So the gates the phone CAN check are checked before connecting (joined,
 * watched, Plus — the caller's `requirePlus`), and a socket that closes without
 * ever having opened asks `GET /v1/rooms/:key` once: a window that has shut
 * means the closed state, a server without rooms means the room is
 * unavailable, and anything else is a dropped connection and the backoff.
 *
 * A POCKET HOLDS NO CONNECTION. Background closes the socket and foreground
 * opens a new one, and the server's `hello` on every (re)join replaces the
 * sheet's whole state (`foldRoom`), so nothing ever shows twice.
 */
export function openRoom(
  key: string,
  on: { message(msg: RoomMessage): void; phase(p: RoomPhase): void },
): RoomHandle {
  const parsed = parseRoomKey(key);
  let ws: WebSocket | null = null;
  let starting = false;
  let stopped = false;
  let foreground = AppState.currentState !== 'background';
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let live = false;
  let lastReact = 0;

  const stopTimers = () => {
    if (retry) clearTimeout(retry);
    if (ping) clearInterval(ping);
    retry = null;
    ping = null;
  };

  /** Close the current socket on purpose. Its `onclose` sees it is no longer current and does nothing. */
  const drop = () => {
    stopTimers();
    live = false;
    const s = ws;
    ws = null;
    try {
      s?.close(1000);
    } catch {
      // Already closing.
    }
  };

  const halt = (p: RoomPhase) => {
    stopped = true;
    drop();
    on.phase(p);
  };

  const schedule = () => {
    if (stopped || !foreground) return;
    on.phase('connecting');
    retry = setTimeout(() => void connect(), roomBackoffMs(attempt++));
  };

  const connect = async () => {
    if (stopped || !foreground || ws || starting) return;
    if (retry) clearTimeout(retry);
    retry = null;
    if (!parsed || !isJoined()) return halt('failed');
    if (roomsOffHere()) return halt('unavailable');
    if (!roomOpenNow(key)) return halt('closed');
    // Re-checked at every (re)join, not once: "unmark" is right there on the
    // episode page, and the sentence the phone sends must stay true.
    if (!hasWatchedTarget('tvdb', String(parsed.tvdbId), parsed.season, parsed.episode)) return halt('unwatched');
    starting = true;
    on.phase('connecting');
    const token = await getToken();
    starting = false;
    if (stopped || !foreground || ws) return;
    if (!token) return halt('failed');

    const sock = new (WebSocket as unknown as HeaderedWebSocket)(`${serverUrl().replace(/^http/, 'ws')}/v1/rooms/${key}/ws`, [], {
      headers: { Authorization: `Bearer ${token}` },
    });
    ws = sock;
    let opened = false;

    sock.onopen = () => {
      if (ws !== sock) return;
      opened = true;
      sock.send(JSON.stringify({ t: 'join', watched: true }));
      ping = setInterval(() => {
        if (ws === sock && sock.readyState === WebSocket.OPEN) sock.send(PING);
      }, PING_MS);
    };

    sock.onmessage = (e) => {
      if (ws !== sock) return;
      const msg = parseRoomMessage(e.data);
      if (!msg) return;
      if (msg.t === 'hello') {
        live = true;
        attempt = 0;
        on.phase('live');
      }
      on.message(msg);
    };

    // `onclose` always follows; that is where the decision is made.
    sock.onerror = () => {};

    sock.onclose = (e) => {
      if (ws !== sock) return; // closed on purpose: background, rejoin, or the sheet went away
      ws = null;
      live = false;
      stopTimers();
      if (stopped || !foreground) return;
      // The 48 hours are over: the alarm closed every socket and emptied the room.
      if (e.code === 1000 && e.reason === 'closed') {
        track('room_closed_seen');
        return halt('closed');
      }
      // join_first / not_watched: the phone broke its own protocol. Retrying
      // would break it again every few seconds.
      if (e.code === 4001 || e.code === 4003) return halt('failed');
      if (opened) return schedule();
      // Never upgraded. Ask the door why, once.
      void fetchRoomCount(key, true).then((c) => {
        if (stopped || ws) return;
        if (roomsOffHere()) return halt('unavailable');
        if (c && !c.open) {
          track('room_closed_seen');
          return halt('closed');
        }
        schedule();
      });
    };
  };

  const onAppState = (state: AppStateStatus) => {
    if (state === 'background') {
      foreground = false;
      drop();
    } else if (state === 'active' && !foreground) {
      foreground = true;
      attempt = 0;
      void connect();
    }
  };
  const sub = AppState.addEventListener('change', onAppState);

  void connect();

  return {
    react(emotion) {
      const now = Date.now();
      if (!live || !ws || ws.readyState !== WebSocket.OPEN || now - lastReact < REACT_GAP_MS) return false;
      lastReact = now;
      ws.send(JSON.stringify({ t: 'react', emotion }));
      // Shape only: that a face was tapped. Never which, never where.
      track('room_react');
      return true;
    },
    rejoin() {
      if (stopped) return;
      drop();
      attempt = 0;
      void connect();
    },
    close() {
      stopped = true;
      sub.remove();
      drop();
    },
  };
}
