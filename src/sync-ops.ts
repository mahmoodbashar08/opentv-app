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

import { ratingFromTen, wholeStars } from '@/star-rating';

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
  /** `ten: null` is an UNRATE. A device on an older build fails to parse
   *  it and drops the op, which loses the undo but never invents a zero.
   *
   *  TWO SCALES IN ONE OP (2.0.0, half stars). `ten` is the rating out of ten
   *  and is what this build applies. `stars` is the same rating as whole
   *  stars, half rounding up, and exists only for a phone still on 1.7: it
   *  reads `stars` and nothing else, so a bare 7 would arrive there as seven
   *  of its five stars. One op rather than two, because two ops for one tap
   *  would be applied in some order, and the rounded one landing second would
   *  undo the half star on every 2.0.0 phone. */
  | { t: 'movieStars'; name: string; ten: number | null; stars: number | null }
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
  | { t: 'charVote'; show: number; s: number; e: number; name: string | null }
  /*
   * THE PROFILE'S DESIGN, AS A SNAPSHOT (12 Oct). Colours, layout, blocks, an
   * artwork banner and its framing, the yearly goal. Unlike the others this is
   * the WHOLE state, not a step: two devices that each changed one thing would
   * otherwise each replay half a design. The newest snapshot wins, and a device
   * whose own design is newer than an arriving one keeps its own.
   */
  | { t: 'design'; keys: Record<string, string> };

export type Op = { id: string; ts: number; kind: string; payload: string };

/** The `meta` keys that make up a profile's design — and nothing else may ride a design op. */
export const DESIGN_KEYS = [
  'profileThemeColor',
  'profileThemeSecondary',
  'profileThemeName',
  'profileThemeLayout',
  'profileLayout',
  'bannerThemeOff',
  'coverUrl',
  'coverFrame',
  'yearlyGoalOn',
  'yearlyGoalOnProfile',
  'yearlyGoalNudge',
] as const;
const GOAL_YEAR = /^yearlyGoal:\d{4}$/;
/**
 * WHAT A NEVER-WRITTEN KEY MEANS, for the keys where that is not "nothing".
 * The yearly goal and its profile card are ON until switched off, so a device
 * that never touched them sends ON — otherwise the other device keeps whatever
 * it had, and a goal switched off there by mistake would never come back.
 */
const DESIGN_DEFAULTS: Record<string, string> = { yearlyGoalOn: '1', yearlyGoalOnProfile: '1' };
export const isDesignKey = (k: string): boolean => (DESIGN_KEYS as readonly string[]).includes(k) || GOAL_YEAR.test(k);

/** The server refuses a payload over 4096 bytes and with it the whole push; stay well under. */
export const DESIGN_MAX = 3600;

/**
 * The snapshot a device sends. BANNER ONLY WHEN IT HAS AN ADDRESS: every banner
 * is a file in Documents, and only an artwork banner remembers where it came
 * from — a photo from the camera roll cannot travel in a message, so it is left
 * out rather than sent as "no banner". THE BLOCKS GO FIRST when it is too big:
 * an arrangement is the one part that can grow, and a design without it is
 * still a design.
 */
export function designSnapshot(read: (k: string) => string | null, year: number): Record<string, string> {
  // NEVER SET IS NOT EMPTY. Several keys read a missing row as their default
  // and '' as a choice — the yearly goal is ON when its key was never written
  // and OFF when it is '' — so a key this device never set is left out, and
  // the other device keeps its own reading of it (12 Oct).
  const keys: Record<string, string> = {};
  const take = (k: string) => {
    const v = read(k) ?? DESIGN_DEFAULTS[k];
    if (v != null) keys[k] = v;
  };
  for (const k of DESIGN_KEYS) take(k);
  for (const y of [year, year + 1]) take(`yearlyGoal:${y}`);
  if (!keys.coverUrl) {
    delete keys.coverUrl;
    delete keys.coverFrame;
  }
  if (JSON.stringify({ keys }).length > DESIGN_MAX) delete keys.profileLayout;
  return keys;
}

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
      // `null` is meaningful here and `undefined` is not, so the two cannot be
      // collapsed: an op with no `stars` field at all is malformed, while one
      // that says null is somebody taking their rating back.
      //
      // `ten` FIRST; an op without it came from a build before half stars,
      // whose `stars` is whole stars 1–5 and doubles.
      if (!name) return null;
      if ('ten' in o) {
        if (o.ten === null) return { t: 'movieStars', name, ten: null, stars: null };
        const ten = ratingFromTen(o.ten);
        return ten != null ? { t: 'movieStars', name, ten, stars: wholeStars(ten) } : null;
      }
      if (o.stars === null) return { t: 'movieStars', name, ten: null, stars: null };
      const stars = int(o.stars);
      return stars != null && stars >= 1 && stars <= 5 ? { t: 'movieStars', name, ten: stars * 2, stars } : null;
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
    case 'design': {
      const raw = o.keys;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const keys: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        // Only the design's own keys, only as text: a design op must never be
        // a way to write any other row of `meta` on somebody's phone.
        if (isDesignKey(k) && typeof v === 'string') keys[k] = v;
      }
      return Object.keys(keys).length ? { t: 'design', keys } : null;
    }
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
