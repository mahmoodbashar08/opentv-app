/**
 * The live room, phone half: the window and key the server agrees with, the
 * fold that keeps a reconnect from duplicating the stream, and the connection's
 * promises — nothing sent unless joined, `join` first and only when watched,
 * backoff on a drop, the closed state on the night's end.
 */
import {
  EMPTY_ROOM,
  foldRoom,
  parseRoomKey,
  parseRoomMessage,
  roomBackoffMs,
  roomKey,
  roomWindow,
  roomWithout,
  type RoomMessage,
  type RoomShell,
} from './pure';

// ── the module's surroundings, stubbed ─────────────────────────────────────

const meta = new Map<string, string>();
jest.mock('./db', () => ({
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => void meta.set(k, v),
  hasWatchedTarget: () => watched,
}));
let watched = true;

let joined = true;
jest.mock('./community-session', () => ({
  isJoined: () => joined,
  getToken: () => Promise.resolve(joined ? 'tok' : null),
}));

let requested: string[] = [];
let answer: () => unknown = () => ({ open: true, watching: 3 });
jest.mock('./api', () => {
  class ApiError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
    ) {
      super(code);
    }
  }
  return {
    ApiError,
    api: (path: string) => {
      requested.push(path);
      try {
        return Promise.resolve(answer());
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
});

const tracked: string[] = [];
jest.mock('./analytics', () => ({ track: (n: string) => void tracked.push(n) }));
jest.mock('./metadata', () => ({ showMeta: () => ({ episodes: { '5-16': { air: today } } }) }));

const appState: { currentState: string; listener: ((s: string) => void) | null } = { currentState: 'active', listener: null };
jest.mock(
  'react-native',
  () => ({
    AppState: {
      get currentState() {
        return appState.currentState;
      },
      addEventListener: (_: string, fn: (s: string) => void) => {
        appState.listener = fn;
        return { remove: () => (appState.listener = null) };
      },
    },
  }),
  { virtual: true },
);

/** A socket the test drives by hand. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  constructor(
    readonly url: string,
    _protocols: string[],
    readonly options: { headers: Record<string, string> },
  ) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

const today = new Date().toISOString().slice(0, 10);
const KEY = `tvdb:81189:5:16:${today}`;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const room = require('./community-room') as typeof import('./community-room');

const flush = () => new Promise((r) => setImmediate(r));
const ali: RoomShell = { id: 'p_a', handle: 'ali', display_name: null, avatar_key: null };
const sara: RoomShell = { id: 'p_s', handle: 'sara', display_name: 'Sara', avatar_key: null };

beforeEach(() => {
  meta.clear();
  requested = [];
  tracked.length = 0;
  FakeSocket.all = [];
  joined = true;
  watched = true;
  answer = () => ({ open: true, watching: 3 });
  appState.currentState = 'active';
});

// ── pure ───────────────────────────────────────────────────────────────────

describe('roomWindow — the server function, mirrored', () => {
  const opens = Date.parse('2026-10-13T00:00:00.000Z');
  it('opens at midnight UTC on the air date, inclusive', () => {
    expect(roomWindow('2026-10-13', opens)?.open).toBe(true);
    expect(roomWindow('2026-10-13', opens - 1)?.open).toBe(false);
  });
  it('closes 48 hours later, exclusive', () => {
    expect(roomWindow('2026-10-13', opens + 48 * 3600_000 - 1)?.open).toBe(true);
    expect(roomWindow('2026-10-13', opens + 48 * 3600_000)?.open).toBe(false);
  });
  it('is null for a day that does not exist', () => {
    expect(roomWindow('2026-02-31', opens)).toBeNull();
    expect(roomWindow('13/10/2026', opens)).toBeNull();
  });
});

describe('roomKey', () => {
  it('builds the shape the server parses, and parses back', () => {
    expect(roomKey(81189, 5, 16, '2026-10-13')).toBe('tvdb:81189:5:16:2026-10-13');
    expect(parseRoomKey('tvdb:81189:5:16:2026-10-13')).toEqual({ tvdbId: 81189, season: 5, episode: 16, air: '2026-10-13' });
  });
  it('gives specials a room', () => {
    expect(roomKey(1, 0, 0, '2026-10-13')).toBe('tvdb:1:0:0:2026-10-13');
  });
  it('is null wherever the server would answer 400', () => {
    expect(roomKey(81189, 5, 16, null)).toBeNull();
    expect(roomKey(81189, 5, 16, '2026-02-30')).toBeNull();
    expect(roomKey(0, 5, 16, '2026-10-13')).toBeNull();
    expect(roomKey(1, 10000, 1, '2026-10-13')).toBeNull();
    expect(roomKey(1, 1, 100000, '2026-10-13')).toBeNull();
    expect(roomKey(1.5, 1, 1, '2026-10-13')).toBeNull();
    expect(parseRoomKey('tvdb:01:1:1:2026-10-13')).toBeNull();
  });
});

it('backs off 1, 2, 4, 8, 16, then 30 s for ever', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 50].map(roomBackoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

describe('foldRoom', () => {
  const react = (who: RoomShell, at: string): RoomMessage => ({ t: 'react', who, emotion: 'shocked', at });
  const hello = (n: number): RoomMessage => ({
    t: 'hello',
    watching: 2,
    faces: [ali, sara],
    recent: Array.from({ length: n }, (_, i) => ({ who: ali, emotion: 'sad' as const, at: `t${i}` })),
  });

  it('hello REPLACES the stream, so a reconnect never shows a reaction twice', () => {
    let v = foldRoom(EMPTY_ROOM, hello(3));
    v = foldRoom(v, react(sara, 'late'));
    v = foldRoom(v, hello(4)); // the reconnect: the server's last 50, which include "late"
    expect(v.stream).toHaveLength(4);
  });
  it('presence replaces count and faces and keeps the stream', () => {
    let v = foldRoom(EMPTY_ROOM, hello(2));
    v = foldRoom(v, { t: 'presence', watching: 1, faces: [ali] });
    expect(v).toMatchObject({ watching: 1, faces: [ali] });
    expect(v.stream).toHaveLength(2);
  });
  it('react appends at the end (newest last), pong and error change nothing', () => {
    let v = foldRoom(EMPTY_ROOM, react(ali, 'a'));
    v = foldRoom(v, react(sara, 'b'));
    expect(v.stream.map((r) => r.at)).toEqual(['a', 'b']);
    expect(foldRoom(v, { t: 'pong' })).toBe(v);
    expect(foldRoom(v, { t: 'error', code: 'rate_limited' })).toBe(v);
  });
  it('a block takes the person out of faces and stream at once', () => {
    const v = roomWithout(foldRoom(foldRoom(EMPTY_ROOM, hello(2)), react(sara, 'x')), 'p_a');
    expect(v.faces).toEqual([sara]);
    expect(v.stream.map((r) => r.who.id)).toEqual(['p_s']);
  });
});

describe('parseRoomMessage', () => {
  it('reads the five server messages', () => {
    expect(parseRoomMessage(JSON.stringify({ t: 'react', who: ali, emotion: 'tense', at: 'x' }))).toEqual({
      t: 'react',
      who: ali,
      emotion: 'tense',
      at: 'x',
    });
    expect(parseRoomMessage('{"t":"pong"}')).toEqual({ t: 'pong' });
  });
  it('drops what it does not understand instead of throwing', () => {
    expect(parseRoomMessage('<html>')).toBeNull();
    expect(parseRoomMessage('{"t":"react","who":{"id":"p"},"emotion":"happy","at":"x"}')).toBeNull();
    expect(parseRoomMessage('{"t":"something-new"}')).toBeNull();
    // A bad reaction inside hello is dropped; the rest of hello stands.
    const h = parseRoomMessage(JSON.stringify({ t: 'hello', watching: 1, faces: [ali, 7], recent: [{ who: ali, emotion: 'nope', at: 'x' }] }));
    expect(h).toEqual({ t: 'hello', watching: 1, faces: [ali], recent: [] });
  });
});

// ── the count teaser ───────────────────────────────────────────────────────

describe('fetchRoomCount', () => {
  it('asks nothing of a phone that never joined', async () => {
    joined = false;
    expect(await room.fetchRoomCount(KEY)).toBeNull();
    expect(requested).toEqual([]);
  });
  it('asks nothing outside the window', async () => {
    expect(await room.fetchRoomCount('tvdb:81189:5:16:2020-01-01')).toBeNull();
    expect(requested).toEqual([]);
  });
  it('answers from memory inside the minute', async () => {
    const key = `tvdb:7:1:1:${today}`;
    expect(await room.fetchRoomCount(key)).toEqual({ open: true, watching: 3 });
    expect(await room.fetchRoomCount(key)).toEqual({ open: true, watching: 3 });
    expect(requested).toEqual([`/v1/rooms/${key}`]);
  });
  it('a server without rooms is never asked again', async () => {
    const { ApiError } = jest.requireMock('./api') as { ApiError: new (c: string, s: number) => Error };
    answer = () => {
      throw new ApiError('not_configured', 503);
    };
    expect(await room.fetchRoomCount(`tvdb:8:1:1:${today}`)).toBeNull();
    expect(room.roomsOffHere()).toBe(true);
    expect(await room.fetchRoomCount(`tvdb:9:1:1:${today}`)).toBeNull();
    expect(requested).toHaveLength(1);
  });
});

// ── the connection ─────────────────────────────────────────────────────────

describe('openRoom', () => {
  const phases: string[] = [];
  const messages: RoomMessage[] = [];
  const on = { message: (m: RoomMessage) => void messages.push(m), phase: (p: string) => void phases.push(p) };
  beforeEach(() => {
    phases.length = 0;
    messages.length = 0;
  });

  it('carries the token on the upgrade and says join, watched, first', async () => {
    const h = room.openRoom(KEY, on);
    await flush();
    const s = FakeSocket.all[0]!;
    expect(s.url).toMatch(new RegExp(`^wss://[^/]+/v1/rooms/${KEY}/ws$`));
    expect(s.options.headers.Authorization).toBe('Bearer tok');
    s.open();
    expect(JSON.parse(s.sent[0]!)).toEqual({ t: 'join', watched: true });
    s.receive({ t: 'hello', watching: 1, faces: [ali], recent: [] });
    expect(phases.at(-1)).toBe('live');
    h.close();
  });

  it('never connects for an episode not marked watched here', async () => {
    watched = false;
    room.openRoom(KEY, on);
    await flush();
    expect(FakeSocket.all).toHaveLength(0);
    expect(phases.at(-1)).toBe('unwatched');
  });

  it('one reaction a second, and only once live', async () => {
    const h = room.openRoom(KEY, on);
    await flush();
    const s = FakeSocket.all[0]!;
    s.open();
    expect(h.react('sad')).toBe(false); // no hello yet
    s.receive({ t: 'hello', watching: 1, faces: [], recent: [] });
    expect(h.react('sad')).toBe(true);
    expect(h.react('sad')).toBe(false);
    expect(s.sent.filter((m) => m.includes('react'))).toHaveLength(1);
    expect(tracked).toContain('room_react');
    h.close();
  });

  it('reconnects after a drop, with backoff', async () => {
    jest.useFakeTimers();
    try {
      const h = room.openRoom(KEY, on);
      await Promise.resolve();
      await Promise.resolve();
      const s = FakeSocket.all[0]!;
      s.open();
      s.drop(1006);
      expect(phases.at(-1)).toBe('connecting');
      expect(FakeSocket.all).toHaveLength(1);
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      expect(FakeSocket.all).toHaveLength(2);
      h.close();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the night ending is the closed state, not a reconnect', async () => {
    room.openRoom(KEY, on);
    await flush();
    const s = FakeSocket.all[0]!;
    s.open();
    s.drop(1000, 'closed');
    await flush();
    expect(phases.at(-1)).toBe('closed');
    expect(tracked).toContain('room_closed_seen');
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('a refused upgrade asks the door once: a shut window is the closed state', async () => {
    answer = () => ({ open: false, watching: 0 });
    room.openRoom(KEY, on);
    await flush();
    FakeSocket.all[0]!.drop(1006); // never opened
    await flush();
    expect(requested).toEqual([`/v1/rooms/${KEY}`]);
    expect(phases.at(-1)).toBe('closed');
  });

  it('background closes the socket; foreground opens a fresh one', async () => {
    const h = room.openRoom(KEY, on);
    await flush();
    const first = FakeSocket.all[0]!;
    first.open();
    appState.listener?.('background');
    expect(first.readyState).toBe(3);
    first.drop(1000); // the close we asked for: ignored
    appState.listener?.('active');
    await flush();
    expect(FakeSocket.all).toHaveLength(2);
    h.close();
  });
});
