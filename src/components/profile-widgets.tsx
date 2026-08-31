/**
 * The widgets a profile can be made of.
 *
 * Every one reads something the phone ALREADY HOLDS and no screen has ever
 * shown back — the oldest date in the import, the hour of the evening you
 * actually watch at, the 1,496 character votes that have sat in SQLite since
 * the first import and appeared nowhere. None of them fetches anything, none of
 * them needs the server, and none of them is a new thing to maintain: they are
 * queries over an archive that was already there.
 *
 * EVERY ONE COLLAPSES WHEN IT HAS NOTHING TO SAY. A widget returning `null`
 * disappears and the grid closes over it, because a fresh install showing a
 * wall of noughts and em-dashes is the worst possible first impression, and
 * "watched nothing" is a different sentence from "has never synced".
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { gridMetrics } from '@/components/ui';
import {
  artworkRef,
  emotionTotal,
  episodesInYear,
  finishedShowCount,
  firstWatch,
  firstWatchDay,
  longestBinge,
  nowWatching,
  primeHour,
  ratedSummary,
  topCharacter,
  topEmotions,
  topGenre,
  topRatedEpisodes,
  watchStreak,
  watchlistCount,
} from '@/db';
import { t } from '@/i18n';
import { documentFileUri } from '@/library';
import { currentLocale } from '@/i18n';
import { countOf, emotionKey, specOf, type WidgetSpan } from '@/profile-layout';
import { isSafeLinkUrl, parseProfileLinks, type LinkService } from '@/pure';
import { colors, radius, space } from '@/theme';

/**
 * One widget's box.
 *
 * Height comes from the grid, never from this file: a 1x1 is one row, a 2x1 is
 * one row across both columns, a 2x2 is two rows PLUS the gutter between them —
 * so a tall widget lines up with two stacked squares beside it instead of being
 * a few pixels out.
 */
export function WidgetBox({
  label,
  span,
  children,
  bare = false,
  hug = false,
}: {
  label: string;
  span: WidgetSpan;
  children: ReactNode;
  /** No label, no padding — for a widget whose content IS the box. */
  bare?: boolean;
  /** Height from the CONTENT, not the grid — for previewing the profile's own
   *  sections, which are content-height on the page too. Forcing those into a
   *  2x2 box drew a card that was two-thirds empty, which is not what will
   *  land on anybody's profile. */
  hug?: boolean;
}) {
  const { height } = gridMetrics(useWindowDimensions().width);
  return (
    <View style={[s.box, bare && { padding: 0 }, !hug && { height: height(span === '2x2' ? 2 : 1) }]}>
      {!bare && (
        <Text style={s.label} numberOfLines={1}>
          {label}
        </Text>
      )}
      <View style={bare ? { flex: 1 } : s.body}>{children}</View>
    </View>
  );
}

/** A number and a caption — the shape most of these take. */
function Figure({ value, sub }: { value: string; sub?: string | null }) {
  return (
    <>
      <Text style={s.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        {value}
      </Text>
      {sub != null && (
        <Text style={s.sub} numberOfLines={2}>
          {sub}
        </Text>
      )}
    </>
  );
}

/** A share, drawn as a bar. Reads at a glance in a way "41%" alone does not. */
function Bar({ pct }: { pct: number }) {
  return (
    <View style={s.barTrack}>
      <View style={[s.barFill, { width: `${Math.max(4, Math.min(100, pct))}%` }]} />
    </View>
  );
}

const day = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The hour, spelled the way people say it.
 *
 * `toLocaleTimeString` with only an hour gives "21:00" or "9 PM" per locale,
 * which is the point — hardcoding "9pm" would have shipped as a bug in five
 * languages, exactly as hardcoding the clock units nearly did.
 */
const hourLabel = (h: number): string =>
  new Date(2026, 0, 1, h).toLocaleTimeString(currentLocale(), { hour: 'numeric' });

/**
 * Draw one widget, or nothing.
 *
 * `own` is false on somebody else's profile. The widgets marked `private` in
 * the catalogue never reach here in that case, but the check is repeated at the
 * draw so a bug in the layout code cannot publish somebody's viewing hours.
 */
/**
 * How a run-of-things widget is resized: BY TOUCHING THE THINGS.
 *
 * The count used to be a sheet of chips -- 1, 2, 3, 4 -- which is a form for a
 * question the card can answer itself. While arranging, each slot carries a
 * minus and there is a plus after the last one, so "three posters, not four" is
 * said by taking one off rather than by opening something and choosing a
 * number. The app still decides WHICH titles; only how many is the owner's.
 */
export type SlotEdit = { editing: boolean; onCount: (n: number) => void };

/**
 * A widget's numbers, wherever they come from.
 *
 * On the owner's phone this is the database. On a VISITOR's phone the database
 * is their own library — reading it would draw the reader's streak on somebody
 * else's profile, which is the single worst bug this feature could have. So a
 * visitor's copy is drawn from the value that travelled with the arrangement,
 * and `published` being present is what says which phone this is.
 */
export type Published = { value?: unknown };

export function renderWidget(
  id: string,
  span: WidgetSpan,
  own: boolean,
  data?: string,
  slots?: SlotEdit,
  published?: Published,
): ReactNode {
  /*
   * THE ONE WIDGET THAT IS NOT ABOUT THE LIBRARY.
   *
   * Everything else here is a fact the app worked out; a profile made only of
   * those is a report. `data` is a filename in Documents — the picture is
   * copied there when it is chosen, so the widget keeps working after the photo
   * library changes, the original is deleted, or the phone is restored.
   *
   * No label and no padding: a picture with a caption over it is a card ABOUT
   * an image, and this is meant to BE one. `expo-image` plays GIFs, so an
   * animated square works with no extra code.
   */
  /*
   * ONE ACCESSOR, TWO SOURCES. `pub` is the published value on a visitor's
   * phone and absent on the owner's. Writing the choice once, here, is what
   * stops a widget somewhere below quietly reading the READER's database and
   * printing their streak on somebody else's profile.
   */
  const pub = published?.value as Record<string, unknown> | undefined;
  const isVisitor = published != null;

  /* A downloaded GIF in Documents. `documentFileUri` returns null when the
     file is gone, so a widget whose picture was deleted collapses rather than
     drawing a grey hole. expo-image animates GIFs with no extra code. */
  if (id === 'gif') {
    const uri = data ? documentFileUri(data) : null;
    if (!uri) return null;
    return (
      <WidgetBox label="" span={span} bare>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      </WidgetBox>
    );
  }

  /**
   * WHERE ELSE TO FIND THIS PERSON.
   *
   * The only widget whose content a user typed, and the only one a stranger can
   * tap through to somewhere else. So the links are re-validated HERE, on the
   * phone that is about to open them, and not merely where they were saved:
   * this code runs on a VISITOR's device against JSON that travelled from
   * somebody else's, and `isSafeLinkUrl` inside `parseProfileLinks` is the last
   * thing between that and `Linking.openURL`.
   *
   * Icons, never text. A row of wordmarks is a link farm; a row of glyphs is an
   * identity, and it reads at a glance in six languages without translating a
   * single service name.
   */
  if (id === 'links') {
    const links = parseProfileLinks(data, span);
    if (links.length === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetLinks')} span={span}>
        <View style={s2.linkGrid}>
          {links.map((l) => (
            <Pressable
              key={`${l.service}:${l.url}`}
              style={s2.linkChip}
              onPress={() => {
                if (isSafeLinkUrl(l.url)) void Linking.openURL(l.url).catch(() => {});
              }}>
              <Ionicons name={linkServiceIcon(l.service)} size={22} color={colors.text} />
            </Pressable>
          ))}
        </View>
      </WidgetBox>
    );
  }

  if (id === 'artwork') {
    // A visitor's phone has never heard of `show:81189`, so the poster travels
    // as a URL with the arrangement.
    const art = isVisitor
      ? (pub as { uri?: string; name?: string } | undefined)?.uri
        ? { uri: String(pub!.uri), name: String(pub!.name ?? '') }
        : null
      : data
        ? artworkRef(data)
        : null;
    // Gone from the library, or its poster never arrived: collapse, like every
    // other widget with nothing to say. A grey rectangle with a title under it
    // is worse than the space it occupies.
    if (!art) return null;
    return (
      <WidgetBox label="" span={span} bare>
        <Image source={{ uri: art.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      </WidgetBox>
    );
  }

  const wide = span !== '1x1';

  if (id === 'since') {
    const year = isVisitor ? (pub?.year as string | undefined) : firstWatchDay()?.slice(0, 4);
    if (!year) return null;
    const years = new Date().getFullYear() - Number(year);
    const d = `${year}-01-01`;
    return (
      <WidgetBox label={t('profile.blockSince')} span={span}>
        <Figure value={year} sub={years > 0 ? t('profile.blockSinceYears', { count: years }) : null} />
      </WidgetBox>
    );
  }

  if (id === 'character') {
    const c = isVisitor
      ? (pub as { name?: string; show?: string | null } | undefined) ?? null
      : topCharacter();
    if (!c?.name) return null;
    return (
      <WidgetBox label={t('profile.blockCharacter')} span={span}>
        <Text style={s.name} numberOfLines={2}>
          {c.name}
        </Text>
        {c.show != null && (
          <Text style={s.sub} numberOfLines={1}>
            {c.show}
          </Text>
        )}
      </WidgetBox>
    );
  }

  if (id === 'streak') {
    /*
     * DRAWN EVEN AT ZERO — because somebody CHOSE it.
     *
     * It used to collapse below two days, which is the right rule for a widget
     * the default page put there: a fresh library should not open onto noughts.
     * But this widget is opt-in now, and a thing somebody deliberately added
     * appearing nowhere is indistinguishable from the add being broken — they
     * tapped, nothing arrived, and there is no way to see why. A zero on a
     * widget you asked for is information; a blank where you put one is a bug
     * report.
     */
    const n = isVisitor ? Number(pub?.n ?? 0) : watchStreak();
    return (
      <WidgetBox label={t('profile.blockStreak')} span={span}>
        <Figure value={String(n)} sub={t('profile.blockStreakDays', { count: n })} />
      </WidgetBox>
    );
  }

  if (id === 'genre') {
    const g = isVisitor ? (pub as { name?: string; pct?: number } | undefined) ?? null : topGenre();
    if (!g?.name) return null;
    return (
      <WidgetBox label={t('profile.widgetGenre')} span={span}>
        <Text style={s.name} numberOfLines={2}>
          {g.name}
        </Text>
        {wide ? <Bar pct={Number(g.pct ?? 0)} /> : null}
        <Text style={s.sub}>{t('profile.widgetGenreShare', { pct: Number(g.pct ?? 0) })}</Text>
      </WidgetBox>
    );
  }

  if (id === 'thisYear') {
    const year = isVisitor ? Number(pub?.year ?? 0) : new Date().getFullYear();
    const n = isVisitor ? Number(pub?.n ?? 0) : episodesInYear(year);
    if (n === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetThisYear', { year: String(year) })} span={span}>
        <Figure value={n.toLocaleString(currentLocale())} sub={t('profile.widgetEpisodes', { count: n })} />
      </WidgetBox>
    );
  }

  if (id === 'binge') {
    const b = isVisitor ? (pub as { n?: number; day?: string } | undefined) ?? null : longestBinge();
    if (!b?.n || b.day == null) return null;
    return (
      <WidgetBox label={t('profile.widgetBinge')} span={span}>
        <Figure value={String(b.n)} sub={wide ? day(String(b.day)) : t('profile.widgetEpisodes', { count: b.n })} />
      </WidgetBox>
    );
  }

  if (id === 'primeTime') {
    if (!own) return null;
    const p = primeHour();
    if (!p) return null;
    return (
      <WidgetBox label={t('profile.widgetPrimeTime')} span={span}>
        <Figure value={hourLabel(p.hour)} sub={t('profile.widgetGenreShare', { pct: p.pct })} />
      </WidgetBox>
    );
  }

  if (id === 'finished') {
    const n = isVisitor ? Number(pub?.n ?? 0) : finishedShowCount();
    if (n === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetFinished')} span={span}>
        <Figure value={String(n)} sub={t('profile.widgetShows', { count: n })} />
      </WidgetBox>
    );
  }

  if (id === 'rated') {
    const r = isVisitor ? (pub as { n?: number; avg?: number } | undefined) ?? null : ratedSummary();
    if (!r?.n) return null;
    return (
      <WidgetBox label={t('profile.widgetRated')} span={span}>
        <Figure
          value={r.n.toLocaleString(currentLocale())}
          sub={t('profile.widgetRatedAvg', { avg: Number(r.avg ?? 0).toFixed(1) })}
        />
      </WidgetBox>
    );
  }

  if (id === 'firstEver') {
    if (!own) return null;
    const f = firstWatch();
    if (!f) return null;
    return (
      <WidgetBox label={t('profile.widgetFirstEver')} span={span}>
        <Text style={s.name} numberOfLines={2}>
          {f.show}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {day(f.day)}
        </Text>
      </WidgetBox>
    );
  }

  if (id === 'watchlist') {
    if (!own) return null;
    const n = watchlistCount();
    if (n === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetWatchlist')} span={span}>
        <Figure value={String(n)} sub={t('profile.widgetFilms', { count: n })} />
      </WidgetBox>
    );
  }

  if (id === 'emotions') {
    const total = isVisitor ? Number(pub?.total ?? 0) : emotionTotal();
    const top = isVisitor
      ? ((pub?.top as { emotion: number; n: number }[] | undefined) ?? [])
      : topEmotions(wide ? 3 : 1);
    if (total === 0 || top.length === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetEmotions')} span={span}>
        {top.map((e) => {
          const pct = Math.round((e.n / total) * 100);
          return (
            <View key={e.emotion} style={{ gap: 2 }}>
              <Text style={wide ? s.sub : s.name} numberOfLines={1}>
                {`${EMOTION_FACES[e.emotion] ?? ''} ${t(emotionKey(e.emotion) as never)}`}
              </Text>
              {wide ? <Bar pct={pct} /> : <Text style={s.sub}>{t('profile.widgetVotes', { count: e.n })}</Text>}
            </View>
          );
        })}
      </WidgetBox>
    );
  }

  if (id === 'topRated') {
    const n = countOf(id, data);
    const eps = isVisitor
      ? ((pub?.eps as ReturnType<typeof topRatedEpisodes> | undefined) ?? [])
      : topRatedEpisodes(n);
    if (eps.length === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetTopRated')} span={span}>
        <View style={s.posterRow}>
          {eps.map((e, i) => (
            <Slot key={`${e.showId}-${e.season}-${e.episode}`} slots={slots} n={n} at={i}>
              {e.poster ? (
                <Image source={{ uri: e.poster }} style={s.poster} contentFit="cover" />
              ) : (
                <View style={[s.poster, s.posterBlank]} />
              )}
              <Text style={s.stars} numberOfLines={1}>
                {'★'.repeat(e.stars)}
              </Text>
            </Slot>
          ))}
          <AddSlot id={id} slots={slots} n={n} />
        </View>
      </WidgetBox>
    );
  }

  if (id === 'nowWatching') {
    const n = countOf(id, data);
    const shows = isVisitor
      ? ((pub?.shows as ReturnType<typeof nowWatching> | undefined) ?? [])
      : nowWatching(n);
    if (shows.length === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetNowWatching')} span={span}>
        <View style={s.posterRow}>
          {shows.map((sh, i) => (
            <Slot key={sh.tvdbId} slots={slots} n={n} at={i}>
              {sh.poster ? (
                <Image source={{ uri: sh.poster }} style={s.poster} contentFit="cover" />
              ) : (
                <View style={[s.poster, s.posterBlank]} />
              )}
              <Text style={s.sub} numberOfLines={1}>
                {sh.name}
              </Text>
            </Slot>
          ))}
          <AddSlot id={id} slots={slots} n={n} />
        </View>
      </WidgetBox>
    );
  }

  return null;
}

/** One thing in a run, with a minus on it while arranging. Taking a slot off
 *  removes THAT position, so the widget simply shows one fewer. */
function Slot({ slots, n, children }: { slots?: SlotEdit; n: number; at: number; children: ReactNode }) {
  return (
    <View style={s.posterCell}>
      {children}
      {slots?.editing && n > 1 && (
        <Pressable style={s.slotMinus} hitSlop={8} onPress={() => slots.onCount(n - 1)}>
          <Ionicons name="remove" size={13} color="#000" />
        </Pressable>
      )}
    </View>
  );
}

/** The empty place after the last one, while arranging. Present only when there
 *  is room: an add that cannot add is a button that lies. */
function AddSlot({ id, slots, n }: { id: string; slots?: SlotEdit; n: number }) {
  const counts = specOf(id).counts;
  const max = counts?.[counts.length - 1] ?? 0;
  if (!slots?.editing || n >= max) return null;
  return (
    <Pressable style={[s.posterCell, s.addSlot]} onPress={() => slots.onCount(n + 1)}>
      <Ionicons name="add" size={22} color={colors.dim} />
    </Pressable>
  );
}

/**
 * What a widget says about somebody, as data rather than as a drawing.
 *
 * This is the same set of queries `renderWidget` runs, returned instead of
 * rendered — so a visitor's copy of a widget cannot disagree with the owner's:
 * one place decides what "Top genre" means, and the other end only draws it.
 *
 * Null means "nothing to say", and the publisher drops those: an owner does not
 * see an empty widget, so a visitor should not either.
 */
export function widgetValue(id: string, span: WidgetSpan, data?: string): unknown {
  switch (id) {
    case 'since': {
      const d = firstWatchDay();
      return d ? { year: d.slice(0, 4) } : null;
    }
    case 'character': {
      const c = topCharacter();
      return c ? { name: c.name, show: c.show } : null;
    }
    case 'streak': {
      // Published at zero, like the widget draws at zero: somebody CHOSE this.
      return { n: watchStreak() };
    }
    case 'genre': {
      const g = topGenre();
      return g ? { name: g.name, pct: g.pct } : null;
    }
    case 'thisYear': {
      const year = new Date().getFullYear();
      const n = episodesInYear(year);
      return n > 0 ? { year, n } : null;
    }
    case 'binge': {
      const b = longestBinge();
      return b ? { n: b.n, day: b.day } : null;
    }
    case 'finished': {
      const n = finishedShowCount();
      return n > 0 ? { n } : null;
    }
    case 'rated': {
      const r = ratedSummary();
      return r ? { n: r.n, avg: r.avg } : null;
    }
    case 'emotions': {
      const total = emotionTotal();
      const top = topEmotions(span === '1x1' ? 1 : 3);
      return total > 0 && top.length > 0 ? { total, top } : null;
    }
    case 'topRated': {
      const eps = topRatedEpisodes(countOf(id, data));
      return eps.length > 0 ? { eps } : null;
    }
    case 'nowWatching': {
      const shows = nowWatching(countOf(id, data));
      return shows.length > 0 ? { shows } : null;
    }
    case 'artwork': {
      // The POSTER URL, not the library reference. A visitor's phone has never
      // heard of this show and cannot look up `show:81189`.
      const art = data ? artworkRef(data) : null;
      return art ? { uri: art.uri, name: art.name } : null;
    }
    case 'gif': {
      // A filename in the owner's Documents is meaningless anywhere else, so a
      // published GIF needs a real URL. `data` holds the file; the widget row
      // keeps the source it came from.
      return data ? { file: data } : null;
    }
    default:
      return null;
  }
}

/** Indexed exactly as `episode_emotions.emotion` is written — see the note on
 *  `EMOTIONS` in `app/episode/[id].tsx`: never reorder, only relabel. */
const EMOTION_FACES = ['😯', '😤', '😭', '🤔', '🥹', '😆', '😱', '😑', '😌', '🤩', '🙃', '😬'] as const;

/**
 * The glyph for each service.
 *
 * Ionicons carries most of these as brand logos already, so a service looks
 * like itself without shipping any artwork. `website` gets a globe — the one
 * slot that is not a named service should not pretend to be one.
 */
export function linkServiceIcon(service: LinkService): keyof typeof Ionicons.glyphMap {
  switch (service) {
    case 'instagram':
      return 'logo-instagram';
    case 'tiktok':
      return 'logo-tiktok';
    case 'x':
      return 'logo-twitter';
    case 'youtube':
      return 'logo-youtube';
    case 'reddit':
      return 'logo-reddit';
    case 'discord':
      return 'logo-discord';
    case 'letterboxd':
      return 'film-outline';
    default:
      return 'globe-outline';
  }
}

const s2 = StyleSheet.create({
  linkGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  /* 44 is the smallest target anybody taps with confidence, and it is why the
     capacity is four and eight rather than whatever would fit. */
  linkChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.liftStrong,
  },
});

const s = StyleSheet.create({
  box: {
    flex: 1,
    /*
     * A TRANSLUCENT SURFACE, NOT A COLOUR OF ITS OWN.
     *
     * This was `colors.bg` — pure black — which is right on a plain profile and
     * wrong on a themed one: the page wears a wash mixed from the theme colour,
     * so a black box sat in the middle of it as a hole. Reported as "I added
     * this widget but it's dark".
     *
     * White at 5% lifts whatever is behind it instead of replacing it, so the
     * same widget looks right on black, on a theme, and on the Add sheet's card
     * — without any of them having to tell it what colour they are.
     */
    backgroundColor: colors.lift,
    borderWidth: 1,
    // Translucent for the same reason as the fill: `colors.line` is a fixed
    // dark grey, which reads as a black outline on a themed page. A white
    // hairline at 12% is an edge on anything behind it.
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 12,
    overflow: 'hidden',
  },
  label: { color: colors.faint, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase' },
  body: { flex: 1, justifyContent: 'center', gap: 4 },
  big: { color: colors.text, fontSize: 34, fontWeight: '900', letterSpacing: -1, lineHeight: 36 },
  name: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sub: { color: colors.dim, fontSize: 12 },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3, backgroundColor: colors.yellow },
  posterRow: { flexDirection: 'row', gap: space.sm, flex: 1 },
  posterCell: { flex: 1, gap: 4 },
  poster: { flex: 1, borderRadius: 6, backgroundColor: colors.card },
  posterBlank: { borderWidth: 1, borderColor: colors.line },
  stars: { color: colors.yellow, fontSize: 11 },
  slotMinus: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E8E8EA',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  addSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
  },
});
