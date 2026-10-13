/**
 * Watching together — the decisions, with nothing to import (2.0.0,
 * DESIGN-community §2). `community-together.ts` does the I/O; everything here
 * is a plain function of its arguments so jest can hold it to account in the
 * preset-free Node runner.
 *
 * A POSITION IS A CURSOR, NOT A HISTORY: the furthest (season, episode) a
 * member has marked watched in one show, overwritten on every change. Null
 * means "not started", and is a real answer rather than a missing one.
 */

export type Position = { season: number; episode: number };

/** "S2E4", or null for not started — the caller says "Not started" in its own language. */
export function positionLabel(p: Position | null | undefined): string | null {
  return p ? `S${p.season}E${p.episode}` : null;
}

/**
 * What was last sent, as one comparable string. `none` for null, so "nothing
 * watched" and "never sent" (no stamp at all) stay two different states:
 * the first owes a DELETE once, the second owes nothing.
 */
export function positionStamp(p: Position | null): string {
  return p ? `${p.season}:${p.episode}` : 'none';
}

/** Furthest first, not-started last. A plain comparator for `sort`. */
export function comparePositions(a: Position | null, b: Position | null): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return b.season - a.season || b.episode - a.episode;
}

/**
 * Episodes into the show, counting from S1E1 — null when a season it has to
 * cross has no known length. Not started is 0.
 */
function absolute(p: Position | null, counts: Readonly<Record<number, number | undefined>>): number | null {
  if (p == null) return 0;
  let n = p.episode;
  for (let s = 1; s < p.season; s++) {
    const c = counts[s];
    if (c == null || !(c > 0)) return null;
    n += c;
  }
  return n;
}

/**
 * How many episodes `theirs` is ahead of `mine` (negative when behind), or null
 * when it cannot be said honestly.
 *
 * INSIDE ONE SEASON NO LENGTHS ARE NEEDED — S2E4 is two ahead of S2E2 whatever
 * the season holds. Across seasons it needs every season length in between
 * (`showMeta(id).seasons[n].count`); with one missing the strip falls back to
 * the bare labels rather than guessing a number.
 */
export function aheadBy(
  theirs: Position | null,
  mine: Position | null,
  counts: Readonly<Record<number, number | undefined>>,
): number | null {
  if (theirs && mine && theirs.season === mine.season) return theirs.episode - mine.episode;
  const a = absolute(theirs, counts);
  const b = absolute(mine, counts);
  return a == null || b == null ? null : a - b;
}

export type TogetherSummary =
  | { kind: 'ahead'; name: string; count: number }
  | { kind: 'behind'; name: string; count: number }
  | { kind: 'level'; name: string }
  | { kind: 'labels'; name: string; theirs: Position | null; mine: Position | null }
  | { kind: 'alone' };

/**
 * The one line under the faces, against the FURTHEST other member: with three
 * friends, the useful news is how far the leader is, not an average.
 */
export function togetherSummary(
  members: readonly { name: string; isMe: boolean; position: Position | null }[],
  counts: Readonly<Record<number, number | undefined>>,
): TogetherSummary {
  const me = members.find((m) => m.isMe);
  const others = members.filter((m) => !m.isMe).sort((a, b) => comparePositions(a.position, b.position));
  const lead = others[0];
  if (!lead) return { kind: 'alone' };
  const mine = me?.position ?? null;
  const d = aheadBy(lead.position, mine, counts);
  if (d == null) return { kind: 'labels', name: lead.name, theirs: lead.position, mine };
  if (d > 0) return { kind: 'ahead', name: lead.name, count: d };
  if (d < 0) return { kind: 'behind', name: lead.name, count: -d };
  return { kind: 'level', name: lead.name };
}

export type ShowResolution = { kind: 'local'; id: number } | { kind: 'absent' } | { kind: 'unreadable' };

/**
 * Which local show a together's TheTVDB id means.
 *
 * THE STALE-ID SPLIT (`remapShowId`): the item carries the id the show had when
 * the together started. If this phone has since re-keyed the show, its watches
 * sit under the new id and the old one leaves a `showRemap:<old>` breadcrumb.
 * Follow it. A chain that ends somewhere the library does not hold is
 * UNREADABLE — progress exists but cannot be found — which is different from
 * ABSENT (never tracked, honestly "Not started"). The first must never publish
 * a value; the second publishes "nothing".
 */
export function resolveTogetherShow(
  key: number,
  known: (id: number) => boolean,
  remap: (id: number) => number | null,
): ShowResolution {
  let id = key;
  const seen = new Set<number>();
  for (let hop = 0; hop < 8; hop++) {
    if (known(id)) return { kind: 'local', id };
    seen.add(id);
    const next = remap(id);
    if (next == null || !(next > 0) || seen.has(next)) return hop === 0 ? { kind: 'absent' } : { kind: 'unreadable' };
    id = next;
  }
  return { kind: 'unreadable' };
}
