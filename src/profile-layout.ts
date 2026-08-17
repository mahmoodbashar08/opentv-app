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
  /**
   * Only one of these may exist on a profile.
   *
   * The page's own furniture — banner, bio, counts, activity, lists, a given
   * shelf. Two Banners is not a preference, it is a mistake; two Streaks is a
   * choice somebody can defend. Everything without this flag may be added as
   * many times as somebody likes, which is what a home screen does and what
   * makes the Photo widget useful at all.
   */
  single?: boolean;
  /** Cannot be added by tapping its name: it needs content first. Photo opens
   *  the image library, and an instance with no picture is never created. */
  needsData?: boolean;
  /**
   * How many things it may show, when that is a choice.
   *
   * The APP still decides WHICH ones -- the point of "Watching now" is that it
   * knows, and a widget you have to curate is a list you maintain by hand. What
   * somebody reasonably wants to control is how much of their profile it takes:
   * four posters is a wall, one is a highlight. Stored per instance in `data`,
   * so two copies can show different amounts.
   */
  counts?: readonly number[];
};

/** The banner cannot be removed: it is the identity, and a profile with nothing
 *  on it should still be somebody's. Everything else can go and come back. */
export const LOCKED = 'banners';

export const WIDGETS: Record<string, WidgetSpec> = {
  // ── the page's own furniture, ordered but not sized by the grid ──────────
  banners: { single: true, spans: ['2x1'], span: '2x1', removable: false },
  intro: { single: true, spans: ['2x1'], span: '2x1' },
  counts: { spans: ['2x1'], span: '2x1' },
  stats: { spans: ['2x2'], span: '2x2' },
  /* THE HEATMAP AND THE TIMELINE ARE TWO WIDGETS, not one "Activity".
     A year of squares and a door to every episode you have ever watched are
     different things that happened to share a heading, and bundling them meant
     wanting one obliged you to take the other. */
  /* THREE SIZES, THREE WINDOWS: one month, three, six. The size is not
     decoration here — it is how much time the grid covers, because a six-month
     grid in a small widget has cells nobody can read and a one-month grid in a
     large one is a lot of page saying very little. */
  activity: { spans: ['1x1', '2x1', '2x2'], span: '2x2' },
  timeline: { spans: ['2x1'], span: '2x1' },
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
  topRated: { spans: ['2x1', '2x2'], span: '2x2', sized: true, counts: [1, 2, 3, 4] },
  nowWatching: { spans: ['2x1', '2x2'], span: '2x2', sized: true, counts: [1, 2, 3, 4] },
  /**
   * A POSTER FROM YOUR OWN LIBRARY — the only widget that is not a fact.
   *
   * Every other widget is something the app worked out, and a profile made only
   * of those is a report rather than somebody's page. This one is decoration,
   * and decoration is most of why anybody arranges anything.
   *
   * IT PICKS FROM THE LIBRARY, NOT FROM A GIF SERVICE. Searching Giphy or Tenor
   * would send what somebody is watching to a company that is not TMDB or
   * TheTVDB — the first time this app did that, against a join screen promising
   * the opposite — and it would put unmoderated third-party images on public
   * profiles at exactly the moment the age rating is being re-reviewed. Artwork
   * from the user's own tracked titles can contain nothing that is not already
   * in the app, so there is nothing to moderate and nothing to disclose.
   */
  artwork: { spans: ['1x1', '2x1', '2x2'], span: '1x1', sized: true, needsData: true },
  /** A GIF, searched from Tenor by show name and DOWNLOADED — the widget holds
   *  a filename in Documents, never a URL. See `pick-gif.tsx` for why this is
   *  the app's one third-party search, and how that is disclosed. */
  gif: { spans: ['1x1', '2x1', '2x2'], span: '1x1', sized: true, needsData: true },
};

export const SHELF_PREFIX = 'shelf:';

/** A shelf is a poster rail whatever its key, so it is never in `WIDGETS`. */
export function specOf(id: string): WidgetSpec {
  if (id.startsWith(SHELF_PREFIX)) return { spans: ['2x2'], span: '2x2' };
  return WIDGETS[id] ?? { spans: ['2x1'], span: '2x1' };
}

/**
 * ONE PLACED WIDGET — an INSTANCE, not a type.
 *
 * `uid` exists because a profile may hold the same widget more than once, the
 * way a home screen may hold two clocks. Identity therefore cannot be the
 * widget's name: two Photo widgets are both `photo`, and keying anything on
 * that makes React treat them as one view, drag one and move the other, and
 * remove both when you take off either.
 *
 * `data` is the widget's own content, for the ones that have any. Only Photo
 * uses it today — the filename of a picture in Documents — but it is on the
 * instance rather than in a side table so that removing a widget takes its
 * content with it and duplicating one does not share it.
 */
export type Placed = { uid: string; id: string; span: WidgetSpan; data?: string };

/**
 * What is actually written to disk.
 *
 * `items` is the arrangement. `known` is every widget id this profile has ever
 * had on it, INCLUDING ones since removed -- without it there is no way to tell
 * "the user took this off" from "this build added something new", and the two
 * need opposite treatment. See `normalise`.
 */
export type Saved = { items: Placed[]; known: string[] };

/** Serialise an arrangement, carrying forward everything it has ever held. */
export function serialise(items: readonly Placed[], prevRaw: string | null): string {
  const prev = parseLayout(prevRaw);
  const known = new Set<string>([...(prev?.known ?? []), ...items.map((p) => p.id)]);
  return JSON.stringify({ items, known: [...known] });
}

/** Instances need an id that is unique for the lifetime of the arrangement. */
let counter = 0;
export function newUid(id: string): string {
  counter += 1;
  return `${id}-${Date.now().toString(36)}-${counter}`;
}

/**
 * The arrangement nobody chose.
 *
 * Identity, then the library's numbers, then the widgets about the person, then
 * the shelves. The squares sit between the counts and the shelves because that
 * is where the page already changed subject.
 */
export function defaultLayout(shelfKeys: readonly string[]): Placed[] {
  return CLASSIC(shelfKeys).map((id) => ({ uid: id, id, span: specOf(id).span }));
}

/**
 * THE PROFILE AS IT HAS ALWAYS BEEN -- and the default is nothing more.
 *
 * The new widgets were briefly all switched on by default, which quietly
 * redesigned the profile for everybody, including the people who never open the
 * arranging mode at all. That is the one thing this was not supposed to do: the
 * layout people arrived from TV Time already knowing stays put, and arranging is
 * something you go and do.
 *
 * So this is the old page in its old order, and every widget added since is
 * OPT-IN -- in the picker, absent until somebody puts it there. Reset therefore
 * returns the profile people recognise rather than the one this branch invented.
 */
const CLASSIC = (shelfKeys: readonly string[]): string[] => [
  'banners',
  'intro',
  'counts',
  'activity',
  'timeline',
  'stats',
  'lists',
  ...shelfKeys.map((k) => `${SHELF_PREFIX}${k}`),
  'extra',
];

/** Everything a profile CAN hold, in the order the picker lists it: the page's
 *  own parts, the library's sections, then the widgets, then Poster. */
const CATALOGUE = (shelfKeys: readonly string[]): string[] => [
  ...CLASSIC(shelfKeys).filter((id) => id !== 'extra'),
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
  'artwork',
  'gif',
];

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
export function normalise(stored: Saved | readonly Placed[] | null, shelfKeys: readonly string[]): Placed[] {
  const wanted = defaultLayout(shelfKeys);
  /*
   * VALID means "in the catalogue", not "in the default arrangement".
   *
   * Those were the same list until the default went back to the classic page.
   * Checking against the default would now throw away every widget somebody had
   * deliberately added — Streak, Top genre, a Poster — on the next read, since
   * none of them is on an untouched profile. What may be KEPT is everything the
   * build knows; what ARRIVES on its own is only the classic page.
   */
  // Both lists: the picker deliberately omits `extra` (it is whatever the
  // caller passed as children, not something anybody chooses), but a stored
  // layout containing it is perfectly valid and must not be thrown away.
  const valid = new Set([...CATALOGUE(shelfKeys), ...CLASSIC(shelfKeys)]);
  const known = { has: (id: string) => valid.has(id) };
  const saved: Saved | null = Array.isArray(stored)
    ? { items: stored as Placed[], known: (stored as Placed[]).map((p) => p.id) }
    : ((stored as Saved | null) ?? null);
  if (!saved || saved.items.length === 0) return wanted;
  const everKnown = new Set(saved.known);

  const out: Placed[] = [];
  const seen = new Set<string>();
  const uids = new Set<string>();
  for (const p of saved.items) {
    const isShelf = p.id.startsWith(SHELF_PREFIX);
    if (!known.has(p.id) && !isShelf) continue;
    const spec = specOf(p.id);
    /*
     * DUPLICATES ARE ALLOWED, EXCEPT FOR WHO YOU ARE.
     *
     * Two Followers counts or two Streaks is a strange profile, not a broken
     * one, and it comes off as easily as it went on -- so nearly everything may
     * be repeated. The banner and the bio are the exceptions, because they are
     * not widgets about a library, they are the person: a second name and a
     * second bio is not a preference anybody holds, it is a mistake.
     */
    if (spec.single && seen.has(p.id)) continue;
    seen.add(p.id);
    // A repeated `uid` would be the same React key twice — one view for two
    // widgets. Re-mint rather than drop: the widget is real, its id is not.
    const uid = p.uid && !uids.has(p.uid) ? p.uid : newUid(p.id);
    uids.add(uid);
    out.push({ uid, id: p.id, span: spec.spans.includes(p.span) ? p.span : spec.span, data: p.data });
  }

  // The banner is not optional. Back at the top, where it was.
  if (!seen.has(LOCKED)) {
    out.unshift({ uid: LOCKED, id: LOCKED, span: specOf(LOCKED).span });
    seen.add(LOCKED);
  }

  // Anything this build added since the layout was saved. Appended rather than
  // slotted into its default position: the user's order is theirs, and a new
  // widget appearing in the middle of it would read as a rearrangement they did
  // not make. `extra` stays last because it is the caller's own children.
  const tail = out.findIndex((p) => p.id === 'extra');
  /*
   * WIDGETS THIS PROFILE HAS NEVER HEARD OF -- and `known` is the whole point
   * of that distinction.
   *
   * This used to append anything not currently PRESENT, which quietly made
   * removal impossible: taking a widget off left it absent, absent read as new,
   * and the next read put it back at the bottom of the page. Deleting something
   * appeared to move it to the end, for ever.
   *
   * `known` records every widget id the arrangement has ever contained, so a
   * removed widget stays removed while a widget added in a later release still
   * arrives on its own. The two cases look identical in the item list and can
   * only be told apart by remembering.
   */
  const fresh = wanted.filter((p) => !everKnown.has(p.id) && !seen.has(p.id) && !specOf(p.id).needsData);
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

/**
 * What the picker offers: EVERYTHING, ALWAYS, IN THE PROFILE'S OWN ORDER.
 *
 * It used to hide whatever was already placed, which meant the list changed
 * shape with the profile -- Followers vanished once you had Followers, so Stats
 * moved to the top, and the row somebody reached for last time was somewhere
 * else. A picker that reorders itself cannot be learned.
 *
 * So the order is the default arrangement's, unconditionally: the page's
 * furniture first, then the widgets that read the library, then the shelves,
 * then Poster. Whether a row can be USED today is a separate question, answered
 * by `alreadyPlaced` -- the single-instance blocks show as placed rather than
 * disappearing, which also tells somebody where the row went.
 */
export function availableToAdd(_layout: readonly Placed[], shelfKeys: readonly string[]): string[] {
  return CATALOGUE(shelfKeys);
}

/** How many items an instance shows: its stored choice, or the widget's most
 *  generous default. */
export function countOf(id: string, data: string | undefined): number {
  const allowed = specOf(id).counts;
  if (!allowed?.length) return 0;
  const n = Number(data);
  return allowed.includes(n) ? n : allowed[allowed.length - 1]!;
}

/** True when this widget is on the profile already AND may only be there once
 *  -- the banner and the bio. Its row is shown, ticked, and does nothing. */
export function alreadyPlaced(id: string, layout: readonly Placed[]): boolean {
  return specOf(id).single === true && layout.some((p) => p.id === id);
}

/**
 * A saved arrangement, announced.
 *
 * The Add sheet and the poster picker are TRANSPARENT modals, so the Profile
 * tab underneath is never blurred — and a screen that is never blurred never
 * re-runs its focus effect. Without this it carried on drawing the arrangement
 * it had loaded at startup, and adding a widget did visibly nothing.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onLayoutSaved(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyLayoutSaved(): void {
  for (const fn of listeners) fn();
}

/**
 * The strings each widget is named by, so the picker and the grid cannot drift.
 * A placeholder on the grid must say the same word as the row that added it.
 */
export const WIDGET_NAME: Record<string, string> = {
  banners: 'profile.widgetBanner',
  intro: 'profile.widgetIntro',
  counts: 'profile.widgetCounts',
  stats: 'stats.title',
  activity: 'profile.widgetActivity',
  timeline: 'timeline.entry',
  lists: 'listsIndex.title',
  extra: 'profile.widgetExtra',
  since: 'profile.blockSince',
  character: 'profile.blockCharacter',
  streak: 'profile.blockStreak',
  genre: 'profile.widgetGenre',
  thisYear: 'profile.widgetThisYearShort',
  binge: 'profile.widgetBinge',
  primeTime: 'profile.widgetPrimeTime',
  finished: 'profile.widgetFinished',
  rated: 'profile.widgetRated',
  firstEver: 'profile.widgetFirstEver',
  watchlist: 'profile.widgetWatchlist',
  emotions: 'profile.widgetEmotions',
  topRated: 'profile.widgetTopRated',
  nowWatching: 'profile.widgetNowWatching',
  artwork: 'profile.widgetPhoto',
  gif: 'profile.widgetGif',
  'shelf:shows': 'stats.headers.shows',
  'shelf:fav-shows': 'profile.sectionFavoriteShows',
  'shelf:movies': 'stats.headers.movies',
  'shelf:fav-movies': 'profile.sectionFavoriteMovies',
};

/**
 * The arrangement as it goes to the server: places AND values.
 *
 * THE SERVER CANNOT WORK ANY OF THIS OUT. It has no watch-history table by
 * design, so "12 days in a row" and "Drama, 41%" have to travel with the
 * widget or the widget cannot exist on anybody else's screen. That makes this
 * function the entire privacy surface of the feature — what it declines to put
 * in the array is what never leaves the phone.
 *
 * Three rules, in order of how much they matter:
 *
 *   1. `private` widgets are dropped. The hour somebody watches at, their first
 *      ever episode, what is on their watchlist: facts about a person's habits
 *      rather than their library, and the profile they belong to is the only
 *      screen that shows them.
 *   2. Widgets with nothing to say are dropped. A visitor should see the
 *      profile as its owner sees it, and an owner does not see an empty widget.
 *   3. The page's own furniture publishes its PLACE only — the banner, the
 *      shelves, Lists, Stats. A visitor's copy of those is built from what the
 *      server already holds (`profile_titles`, `profile_stats`), so sending
 *      their contents again would be a second, disagreeing copy.
 */
export type PublishedWidget = { id: string; span: WidgetSpan; data?: string; value?: unknown };

export function publishableWidgets(
  layout: readonly Placed[],
  valueOf: (id: string, span: WidgetSpan, data?: string) => unknown,
): PublishedWidget[] {
  const out: PublishedWidget[] = [];
  for (const p of layout) {
    const spec = specOf(p.id);
    if (spec.private) continue;
    if (!spec.sized) {
      // Furniture: its place, drawn from the server's own copy of the library.
      out.push({ id: p.id, span: p.span });
      continue;
    }
    const value = valueOf(p.id, p.span, p.data);
    if (value == null) continue;
    out.push({ id: p.id, span: p.span, ...(p.data != null ? { data: p.data } : {}), value });
  }
  return out;
}

/**
 * A published arrangement, read back on somebody else's phone.
 *
 * TOLERANT BY DESIGN, and not merely defensive: this JSON was written by an app
 * that may be several releases newer than the one reading it, and containing a
 * widget this build has never heard of is the NORMAL case, not a corrupt one.
 * Unknown ids are dropped and everything around them still draws — a profile
 * that renders nothing because one square was from the future would be the
 * worst possible failure here.
 */
export function parsePublished(raw: string | null | undefined): PublishedWidget[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const out: PublishedWidget[] = [];
    for (const item of v) {
      const o = item as { id?: unknown; span?: unknown; data?: unknown; value?: unknown };
      if (typeof o?.id !== 'string') continue;
      if (!(o.id in WIDGETS) && !o.id.startsWith(SHELF_PREFIX)) continue;
      const span = o.span === '1x1' || o.span === '2x1' || o.span === '2x2' ? o.span : specOf(o.id).span;
      out.push({
        id: o.id,
        span: specOf(o.id).spans.includes(span) ? span : specOf(o.id).span,
        ...(typeof o.data === 'string' ? { data: o.data } : {}),
        value: o.value,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Emotion index → the i18n key the rest of the app uses for it. */
export const emotionKey = (i: number): string => `media.emotions.${EMOTION_NAMES[i] ?? 'shocked'}`;

/** Serialise / parse, tolerant of anything: a corrupt value is no preference,
 *  not a crash on the profile tab. */
export function parseLayout(raw: string | null): Saved | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    // Layouts written before `known` existed are a bare array. Everything in
    // one has by definition been on the profile, so its ids are its `known`.
    const stored = Array.isArray(parsed) ? null : (parsed as Saved | null);
    const v: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(stored?.items) ? stored.items : [];
    const out: Placed[] = [];
    for (const item of v) {
      const o = item as { uid?: unknown; id?: unknown; span?: unknown; data?: unknown };
      if (typeof o?.id !== 'string') continue;
      const span = o.span === '1x1' || o.span === '2x1' || o.span === '2x2' ? o.span : '1x1';
      out.push({
        // Layouts written before instances existed have no `uid`; `normalise`
        // mints one rather than treating the row as unreadable.
        uid: typeof o.uid === 'string' ? o.uid : '',
        id: o.id,
        span,
        data: typeof o.data === 'string' ? o.data : undefined,
      });
    }
    if (!out.length) return null;
    const known = Array.isArray(stored?.known)
      ? stored.known.filter((k): k is string => typeof k === 'string')
      : out.map((p) => p.id);
    return { items: out, known };
  } catch {
    return null;
  }
}
