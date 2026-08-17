/**
 * WHAT A PROFILE IS MADE OF, and what the owner is allowed to do to it.
 *
 * The page used to be a fixed run of sections. It is now a list of widgets with
 * a size each, which the owner can reorder, resize and remove — so this file
 * has to answer three questions the old page never had to:
 *
 *   - which widgets exist, and which sizes each one can honestly be drawn at
 *   - what the arrangement is when nobody has chosen one
 *   - what to do with a stored arrangement that no longer matches the code
 *
 * The third is the one that bites. A saved layout outlives the release that
 * wrote it: widgets get added, renamed and dropped, and somebody upgrading from
 * a version that had eleven of them must not open a broken profile. So the
 * stored list is treated as a PREFERENCE, never as the truth — `normalise()`
 * drops ids the build no longer knows, clamps sizes a widget can no longer be,
 * appends anything new at the end, and always puts the banner back.
 */

import { EMOTION_NAMES } from '@/pure';

export type WidgetSpan = '1x1' | '2x1' | '2x2';

export type WidgetSpec = {
  /** Sizes this widget can be drawn at, smallest first. One entry means fixed. */
  spans: readonly WidgetSpan[];
  /** Size when nobody has chosen. */
  span: WidgetSpan;
  /** False for the banner alone — see `LOCKED`. */
  removable?: boolean;
  /**
   * Whether the grid owns this widget's box. The small widgets are drawn here
   * and snap to the cell; the older sections (banner, activity, lists, the
   * shelves) bring their own layout and are only ORDERED by the grid. Forcing a
   * poster rail into a 2x2 either clips the posters or pads them, and neither
   * is better than letting the content say how tall it is.
   */
  sized?: boolean;
  /**
   * Own profile only. The server holds no watch history by design, so a
   * visitor's copy of a profile is built from published aggregates — there is
   * nothing there to answer "what hour do you watch at". Publishing that would
   * be a decision about privacy, not about layout, so these simply do not
   * appear on somebody else's screen.
   */
  private?: boolean;
};

/** The banner cannot be removed: it is the identity, and a profile with nothing
 *  on it should still be somebody's. Everything else can go and come back. */
export const LOCKED = 'banners';

export const WIDGETS: Record<string, WidgetSpec> = {
  // ── the page's own furniture, ordered but not sized by the grid ──────────
  banners: { spans: ['2x1'], span: '2x1', removable: false },
  intro: { spans: ['2x1'], span: '2x1' },
  counts: { spans: ['2x1'], span: '2x1' },
  stats: { spans: ['2x2'], span: '2x2' },
  activity: { spans: ['2x2'], span: '2x2' },
  lists: { spans: ['2x2'], span: '2x2' },
  extra: { spans: ['2x1'], span: '2x1' },

  // ── the widgets, which the grid does own ─────────────────────────────────
  since: { spans: ['1x1'], span: '1x1', sized: true },
  character: { spans: ['1x1', '2x1'], span: '1x1', sized: true },
  streak: { spans: ['1x1'], span: '1x1', sized: true },
  genre: { spans: ['1x1', '2x1'], span: '1x1', sized: true },
  thisYear: { spans: ['1x1'], span: '1x1', sized: true },
  binge: { spans: ['1x1', '2x1'], span: '1x1', sized: true },
  primeTime: { spans: ['1x1'], span: '1x1', sized: true, private: true },
  finished: { spans: ['1x1'], span: '1x1', sized: true },
  rated: { spans: ['1x1', '2x1'], span: '1x1', sized: true },
  firstEver: { spans: ['1x1', '2x1'], span: '1x1', sized: true, private: true },
  watchlist: { spans: ['1x1'], span: '1x1', sized: true, private: true },
  emotions: { spans: ['1x1', '2x1'], span: '2x1', sized: true },
  topRated: { spans: ['2x1', '2x2'], span: '2x2', sized: true },
  nowWatching: { spans: ['2x2'], span: '2x2', sized: true },
};

export const SHELF_PREFIX = 'shelf:';

/** A shelf is a poster rail whatever its key, so it is never in `WIDGETS`. */
export function specOf(id: string): WidgetSpec {
  if (id.startsWith(SHELF_PREFIX)) return { spans: ['2x2'], span: '2x2' };
  return WIDGETS[id] ?? { spans: ['2x1'], span: '2x1' };
}

export type Placed = { id: string; span: WidgetSpan };

/**
 * The arrangement nobody chose.
 *
 * Identity, then the library's numbers, then the widgets about the person, then
 * the shelves. The squares sit between the counts and the shelves because that
 * is where the page already changed subject.
 */
export function defaultLayout(shelfKeys: readonly string[]): Placed[] {
  const ids = [
    'banners',
    'intro',
    'counts',
    'activity',
    'stats',
    'since',
    'character',
    'streak',
    'genre',
    'thisYear',
    'binge',
    'primeTime',
    'finished',
    'rated',
    'firstEver',
    'watchlist',
    'emotions',
    'topRated',
    'nowWatching',
    'lists',
    ...shelfKeys.map((k) => `${SHELF_PREFIX}${k}`),
    'extra',
  ];
  return ids.map((id) => ({ id, span: specOf(id).span }));
}

/**
 * Reconcile a stored arrangement with the widgets this build actually has.
 *
 * Everything here exists because a saved layout outlives the release that wrote
 * it. In order: drop what no longer exists, drop duplicates (a bad write must
 * not double a widget), clamp a size the widget can no longer be, put the
 * banner back if it went missing, and append anything the user has never seen
 * so a new widget arrives rather than staying invisible for ever.
 *
 * Removed widgets are simply ABSENT from the list. There is no `hidden` flag,
 * because two ways to not-show something is how a profile ends up hiding a
 * widget the picker says is visible.
 */
export function normalise(stored: readonly Placed[] | null, shelfKeys: readonly string[]): Placed[] {
  const wanted = defaultLayout(shelfKeys);
  const known = new Map(wanted.map((p) => [p.id, p]));
  if (!stored || stored.length === 0) return wanted;

  const out: Placed[] = [];
  const seen = new Set<string>();
  for (const p of stored) {
    const spec = known.has(p.id) ? specOf(p.id) : null;
    if (!spec || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, span: spec.spans.includes(p.span) ? p.span : spec.span });
  }

  // The banner is not optional. Back at the top, where it was.
  if (!seen.has(LOCKED)) {
    out.unshift({ id: LOCKED, span: specOf(LOCKED).span });
    seen.add(LOCKED);
  }

  // Anything this build added since the layout was saved. Appended rather than
  // slotted into its default position: the user's order is theirs, and a new
  // widget appearing in the middle of it would read as a rearrangement they did
  // not make. `extra` stays last because it is the caller's own children.
  const tail = out.findIndex((p) => p.id === 'extra');
  const fresh = wanted.filter((p) => !seen.has(p.id));
  if (tail >= 0) out.splice(tail, 0, ...fresh);
  else out.push(...fresh);
  return out;
}

/** The next size in a widget's list, wrapping. What the resize control does. */
export function nextSpan(id: string, current: WidgetSpan): WidgetSpan {
  const { spans } = specOf(id);
  const i = spans.indexOf(current);
  return spans[(i + 1) % spans.length] ?? spans[0]!;
}

/** Widgets the owner has removed, in catalogue order — what the picker offers. */
export function availableToAdd(layout: readonly Placed[], shelfKeys: readonly string[]): string[] {
  const have = new Set(layout.map((p) => p.id));
  return defaultLayout(shelfKeys)
    .map((p) => p.id)
    .filter((id) => !have.has(id));
}

/** Emotion index → the i18n key the rest of the app uses for it. */
export const emotionKey = (i: number): string => `media.emotions.${EMOTION_NAMES[i] ?? 'shocked'}`;

/** Serialise / parse, tolerant of anything: a corrupt value is no preference,
 *  not a crash on the profile tab. */
export function parseLayout(raw: string | null): Placed[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    const out: Placed[] = [];
    for (const item of v) {
      const o = item as { id?: unknown; span?: unknown };
      if (typeof o?.id !== 'string') continue;
      const span = o.span === '1x1' || o.span === '2x1' || o.span === '2x2' ? o.span : '1x1';
      out.push({ id: o.id, span });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
