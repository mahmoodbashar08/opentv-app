/**
 * What one device tells another it just did.
 *
 * INTENT, NOT ROWS. An op says "watched S2E3 of 72454", never "insert this
 * row". Replaying intent through the app's own `markWatched` keeps every
 * derived thing — the episode counter, the streak, the widget, the calendar —
 * correct by construction. Shipping the row would mean shipping `episodesSeen`
 * with it, and two devices that disagree about a derived number have no way to
 * settle the argument.
 *
 * ABSENCES ARE OPS TOO, and they are the whole reason this exists rather than
 * a second use of the backup ZIP. That ZIP is a TV Time-format export, and
 * every row in a TV Time export is something you HAVE. Un-marking an episode,
 * taking a rating back and deleting a film are absences — unwritable in a
 * format made of presences — so a ZIP-based sync silently resurrects
 * everything you deleted on the other device, on every sync, for ever.
 *
 * THIS FILE IS PURE so the decisions can be tested without a database or a
 * network: an op is made here, validated here, and ordered here. Applying it
 * is `device-sync.ts`, which is the only part that needs either.
 */

/** Everything a device can tell another device. Deliberately small: this is
 *  the set of things somebody does several times a day and would notice being
 *  wrong on a second device. Comments, lists and character votes publish
 *  through the community already and are not here yet. */
export type Action =
  | { t: 'watch'; show: number; s: number; e: number; at: string }
  | { t: 'unwatch'; show: number; s: number; e: number }
  | { t: 'rewatch'; show: number; s: number; e: number }
  | { t: 'rate'; show: number; s: number; e: number; stars: number }
  | { t: 'unrate'; show: number; s: number; e: number }
  | { t: 'showFlag'; show: number; flag: 'followed' | 'favorited' | 'archived' | 'finished'; on: boolean }
  | { t: 'showDelete'; show: number }
  | { t: 'movieWatch'; name: string; on: boolean }
  | { t: 'movieStars'; name: string; stars: number }
  | { t: 'movieRewatch'; name: string }
  | { t: 'movieDelete'; name: string }
  | { t: 'movieAdd'; name: string; poster: string | null; year: string | null; tmdbId: number | null }
  /*
   * A FEELING AND A FAVOURITE CHARACTER — carried as the RESULTING state, not
   * as "toggle it". Both controls are toggles in the app, and a toggle applied
   * twice is its own opposite: two devices replaying the same op would end up
   * disagreeing about a thing they had both been told. `on` and a name say what
   * is true, which arrives at the same answer however many times it lands.
   */
  | { t: 'emotion'; show: number; s: number; e: number; emotion: number; on: boolean }
  | { t: 'charVote'; show: number; s: number; e: number; name: string | null };

export type Op = { id: string; ts: number; kind: string; payload: string };

/** What comes back down, with the server's own sequence attached. */
export type RemoteOp = { seq: number; ts: number; kind: string; payload: string };

const SHOW_FLAGS = ['followed', 'favorited', 'archived', 'finished'] as const;

/**
 * An op id nobody else can collide with.
 *
 * DEVICE AND COUNTER, NOT A CLOCK. Two marks inside the same millisecond are
 * ordinary — tick a season and it happens dozens of times — and a clock-based
 * id would silently drop all but one of them at the server's unique index. The
 * counter is per device and only ever goes up.
 */
export function opId(device: string, n: number): string {
  return `${device}:${n}`;
}

export function makeOp(device: string, n: number, a: Action, now = Date.now()): Op {
  const { t, ...rest } = a;
  return { id: opId(device, n), ts: now, kind: t, payload: JSON.stringify(rest) };
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * An op from another device, turned back into something to do — or `null`.
 *
 * NULL IS A NORMAL ANSWER, not an error. A newer build will send kinds this
 * one has never heard of, and the only safe reading of "I do not understand
 * this" is to skip it and keep going. Refusing the whole batch would wedge an
 * older phone for good the first time the other one updated.
 */
export function parseOp(kind: string, payload: string): Action | null {
  let o: Record<string, unknown>;
  try {
    const j: unknown = JSON.parse(payload);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    o = j as Record<string, unknown>;
  } catch {
    return null;
  }
  const show = int(o.show);
  const s = int(o.s);
  const e = int(o.e);
  const name = str(o.name);
  const ep = show != null && s != null && e != null;

  switch (kind) {
    case 'watch':
      return ep ? { t: 'watch', show, s, e, at: str(o.at) ?? '' } : null;
    case 'unwatch':
      return ep ? { t: 'unwatch', show, s, e } : null;
    case 'rewatch':
      return ep ? { t: 'rewatch', show, s, e } : null;
    case 'rate': {
      const stars = int(o.stars);
      // Zero is not a rating here — `clearEpisodeRating` exists precisely so a
      // taken-back rating and a score of zero stay different facts.
      return ep && stars != null && stars >= 1 && stars <= 10 ? { t: 'rate', show, s, e, stars } : null;
    }
    case 'unrate':
      return ep ? { t: 'unrate', show, s, e } : null;
    case 'showFlag': {
      const flag = SHOW_FLAGS.find((f) => f === o.flag);
      return show != null && flag && typeof o.on === 'boolean' ? { t: 'showFlag', show, flag, on: o.on } : null;
    }
    case 'showDelete':
      return show != null ? { t: 'showDelete', show } : null;
    case 'movieWatch':
      return name && typeof o.on === 'boolean' ? { t: 'movieWatch', name, on: o.on } : null;
    case 'movieStars': {
      const stars = int(o.stars);
      return name && stars != null && stars >= 0 && stars <= 10 ? { t: 'movieStars', name, stars } : null;
    }
    case 'emotion': {
      const emotion = int(o.emotion);
      return show != null && s != null && e != null && emotion != null
        ? { t: 'emotion', show, s, e, emotion, on: o.on === true }
        : null;
    }
    case 'charVote':
      // A null name is a vote being taken back, which is a real thing to say.
      return show != null && s != null && e != null
        ? { t: 'charVote', show, s, e, name: str(o.name) }
        : null;
    case 'movieRewatch':
      return name ? { t: 'movieRewatch', name } : null;
    case 'movieDelete':
      return name ? { t: 'movieDelete', name } : null;
    case 'movieAdd':
      return name
        ? { t: 'movieAdd', name, poster: str(o.poster), year: str(o.year), tmdbId: int(o.tmdbId) }
        : null;
    default:
      return null;
  }
}

/**
 * The order to apply what came back.
 *
 * BY THE DEVICE CLOCK FIRST, because that is the order the person did things
 * in, and these ops are not commutative: rate then unrate leaves nothing,
 * unrate then rate leaves a rating. Arrival order at the server is not that
 * order — a phone that was offline all morning pushes its morning after the
 * tablet pushed its afternoon.
 *
 * SEQ BREAKS THE TIE, so the result never depends on the sort being stable or
 * on two clocks agreeing to the millisecond.
 */
export function orderOps<T extends { seq: number; ts: number }>(ops: readonly T[]): T[] {
  return [...ops].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}
