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

import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { gridMetrics } from '@/components/ui';
import {
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
import { currentLocale } from '@/i18n';
import { emotionKey, type WidgetSpan } from '@/profile-layout';
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
}: {
  label: string;
  span: WidgetSpan;
  children: ReactNode;
}) {
  const { height } = gridMetrics(useWindowDimensions().width);
  return (
    <View style={[s.box, { height: height(span === '2x2' ? 2 : 1) }]}>
      <Text style={s.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={s.body}>{children}</View>
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
export function renderWidget(id: string, span: WidgetSpan, own: boolean): ReactNode {
  const wide = span !== '1x1';

  if (id === 'since') {
    const d = firstWatchDay();
    if (!d) return null;
    const years = new Date().getFullYear() - Number(d.slice(0, 4));
    return (
      <WidgetBox label={t('profile.blockSince')} span={span}>
        <Figure value={d.slice(0, 4)} sub={years > 0 ? t('profile.blockSinceYears', { count: years }) : null} />
      </WidgetBox>
    );
  }

  if (id === 'character') {
    const c = topCharacter();
    if (!c) return null;
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
    const n = watchStreak();
    if (n < 2) return null; // a streak of one is not a streak
    return (
      <WidgetBox label={t('profile.blockStreak')} span={span}>
        <Figure value={String(n)} sub={t('profile.blockStreakDays', { count: n })} />
      </WidgetBox>
    );
  }

  if (id === 'genre') {
    const g = topGenre();
    if (!g) return null;
    return (
      <WidgetBox label={t('profile.widgetGenre')} span={span}>
        <Text style={s.name} numberOfLines={2}>
          {g.name}
        </Text>
        {wide ? <Bar pct={g.pct} /> : null}
        <Text style={s.sub}>{t('profile.widgetGenreShare', { pct: g.pct })}</Text>
      </WidgetBox>
    );
  }

  if (id === 'thisYear') {
    const year = new Date().getFullYear();
    const n = episodesInYear(year);
    if (n === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetThisYear', { year: String(year) })} span={span}>
        <Figure value={n.toLocaleString(currentLocale())} sub={t('profile.widgetEpisodes', { count: n })} />
      </WidgetBox>
    );
  }

  if (id === 'binge') {
    const b = longestBinge();
    if (!b) return null;
    return (
      <WidgetBox label={t('profile.widgetBinge')} span={span}>
        <Figure value={String(b.n)} sub={wide ? day(b.day) : t('profile.widgetEpisodes', { count: b.n })} />
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
    const n = finishedShowCount();
    if (n === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetFinished')} span={span}>
        <Figure value={String(n)} sub={t('profile.widgetShows', { count: n })} />
      </WidgetBox>
    );
  }

  if (id === 'rated') {
    const r = ratedSummary();
    if (!r) return null;
    return (
      <WidgetBox label={t('profile.widgetRated')} span={span}>
        <Figure
          value={r.n.toLocaleString(currentLocale())}
          sub={t('profile.widgetRatedAvg', { avg: r.avg.toFixed(1) })}
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
    const total = emotionTotal();
    const top = topEmotions(wide ? 3 : 1);
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
    const eps = topRatedEpisodes(span === '2x2' ? 4 : 2);
    if (eps.length === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetTopRated')} span={span}>
        <View style={s.posterRow}>
          {eps.map((e) => (
            <View key={`${e.showId}-${e.season}-${e.episode}`} style={s.posterCell}>
              {e.poster ? (
                <Image source={{ uri: e.poster }} style={s.poster} contentFit="cover" />
              ) : (
                <View style={[s.poster, s.posterBlank]} />
              )}
              <Text style={s.stars} numberOfLines={1}>
                {'★'.repeat(e.stars)}
              </Text>
            </View>
          ))}
        </View>
      </WidgetBox>
    );
  }

  if (id === 'nowWatching') {
    const shows = nowWatching(4);
    if (shows.length === 0) return null;
    return (
      <WidgetBox label={t('profile.widgetNowWatching')} span={span}>
        <View style={s.posterRow}>
          {shows.map((sh) => (
            <View key={sh.tvdbId} style={s.posterCell}>
              {sh.poster ? (
                <Image source={{ uri: sh.poster }} style={s.poster} contentFit="cover" />
              ) : (
                <View style={[s.poster, s.posterBlank]} />
              )}
              <Text style={s.sub} numberOfLines={1}>
                {sh.name}
              </Text>
            </View>
          ))}
        </View>
      </WidgetBox>
    );
  }

  return null;
}

/** Indexed exactly as `episode_emotions.emotion` is written — see the note on
 *  `EMOTIONS` in `app/episode/[id].tsx`: never reorder, only relabel. */
const EMOTION_FACES = ['😯', '😤', '😭', '🤔', '🥹', '😆', '😱', '😑', '😌', '🤩', '🙃', '😬'] as const;

const s = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
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
});
