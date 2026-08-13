/**
 * The watch timeline: everything you have ever watched, newest first, grouped
 * by the day you watched it.
 *
 * THIS IS THE FEATURE ONLY THIS APP CAN HAVE. Every tracker can tell you what
 * you watched; almost none of them know WHEN, because almost none of them
 * imported seven years of TV Time history with its dates intact. "Yesterday
 * you watched S01E01, today a film" is a diary somebody kept without meaning
 * to, and this is where they read it back.
 *
 * PAGED, because for the people this app was built for it is thousands of rows
 * going back to 2018. `watchTimeline` reads a page at a time in SQL; the list
 * asks for the next one when the reader nears the bottom.
 *
 * A LINE, NOT A LIST. The rail down the left is the point: it makes the gaps
 * visible. A plain list of rows says what was watched; a continuous line with
 * dots on it says "these two happened on the same evening, and then nothing
 * for three weeks", which is the thing a history is actually read for. It is
 * drawn as a strip behind each row rather than one long view, so it costs
 * nothing on a list that is thousands of rows deep.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { getMeta } from '@/db';
import { isPlus, usePlus } from '@/plus';
import { watchTimeline, type TimelineRow } from '@/stats-calc';
import { colors, radius, space } from '@/theme';

const PAGE = 60;

/** A day heading, or one thing watched. One list, two row shapes. */
type Row = { kind: 'day'; key: string; day: string } | (TimelineRow & { kind: 'episode' | 'movie' });

/** Insert a heading before the first row of each day. */
function withDayHeadings(rows: readonly TimelineRow[]): Row[] {
  const out: Row[] = [];
  let last = '';
  for (const r of rows) {
    if (r.day !== last) {
      out.push({ kind: 'day', key: `d${r.day}`, day: r.day });
      last = r.day;
    }
    out.push(r);
  }
  return out;
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((startOfToday.getTime() - d.getTime()) / 86_400_000);
  // Only the two days with names of their own. "3 days ago" is worse than a
  // date once you are scrolling through years.
  if (diff === 0) return t('timeline.today');
  if (diff === 1) return t('timeline.yesterday');
  return d.toLocaleDateString(currentLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export default function TimelineScreen() {
  const plus = usePlus();
  // The rail wears the profile's theme, so this screen belongs to the same
  // profile the heatmap does. Read once at mount, not during render.
  const [accent] = useState(() => getMeta('profileThemeColor') || colors.yellow);
  // The first page in the initialiser rather than an effect: it runs once at
  // mount, before paint, so the list is never briefly empty — and an effect
  // that setStates synchronously is the cascading-render the lint rule warns
  // about. `isPlus()` and not the hook, because this is not render.
  const [rows, setRows] = useState<TimelineRow[]>(() => (isPlus() ? watchTimeline(PAGE, 0) : []));
  const [done, setDone] = useState(false);

  const loadMore = useCallback(() => {
    if (done) return;
    setRows((prev) => {
      const next = watchTimeline(PAGE, prev.length);
      if (next.length < PAGE) setDone(true);
      // Concatenated rather than re-read from zero: re-reading would re-run
      // every page's query on every scroll.
      return next.length === 0 ? prev : [...prev, ...next];
    });
  }, [done]);

  if (!plus) {
    return (
      <Screen>
        <NavHeader title={t('timeline.title')} close />
        <View style={s.locked}>
          <Text style={s.lockedTitle}>{t('timeline.lockedTitle')}</Text>
          <Text style={s.lockedBody}>{t('timeline.lockedBody')}</Text>
          <Pressable
            style={s.cta}
            onPress={() => {
              tapLight();
              router.push('/paywall?from=timeline');
            }}>
            <Text style={s.ctaText}>{t('plus.settingsRow')}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const data = withDayHeadings(rows);

  return (
    <Screen>
      <NavHeader title={t('timeline.title')} close />
      <FlatList
        data={data}
        keyExtractor={(r) => r.key}
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        contentContainerStyle={{ paddingBottom: 30 }}
        ListEmptyComponent={<Text style={s.empty}>{t('timeline.empty')}</Text>}
        renderItem={({ item, index }) =>
          item.kind === 'day' ? (
            <View style={s.dayRow}>
              {/* The rail runs through the heading too, but only below the
                  marker on the very first one — a line above the top entry
                  would promise history that is not there. */}
              <View style={s.rail}>
                <View style={[s.line, index === 0 && s.lineFromMiddle]} />
                <View style={[s.dayDot, { borderColor: accent }]} />
              </View>
              <Text style={s.day}>{dayLabel(item.day)}</Text>
            </View>
          ) : (
            <Pressable
              style={s.row}
              onPress={() => {
                tapLight();
                if (item.kind === 'movie') router.push(`/movie/${encodeURIComponent(item.title)}`);
                else if (item.tvdbId != null) router.push(`/show/${item.tvdbId}`);
              }}>
              <View style={s.rail}>
                <View style={s.line} />
                <View style={[s.dot, { backgroundColor: accent }]} />
              </View>
              {item.poster ? (
                <Image source={{ uri: item.poster }} style={s.poster} contentFit="cover" cachePolicy="disk" />
              ) : (
                <View style={[s.poster, s.posterEmpty]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={s.code} numberOfLines={1}>
                  {item.code}
                  {item.rewatch ? '  ↻' : ''}
                </Text>
              </View>
            </Pressable>
          )
        }
      />
    </Screen>
  );
}

const RAIL_W = 26;

const s = StyleSheet.create({
  // The rail column: a hairline down the middle with the marker on top of it.
  rail: { width: RAIL_W, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  line: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: colors.line },
  // The first marker starts the line rather than sitting on one.
  lineFromMiddle: { top: '50%' },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  dayDot: { width: 13, height: 13, borderRadius: 6.5, borderWidth: 2.5, backgroundColor: colors.bg },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingStart: space.lg, paddingTop: 16, paddingBottom: 6 },
  day: {
    color: colors.dim,
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingStart: space.lg, paddingEnd: space.lg, paddingVertical: 6 },
  poster: { width: 38, height: 57, borderRadius: 5, backgroundColor: colors.raise },
  posterEmpty: { backgroundColor: colors.pillGrey },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  code: { color: colors.faint, fontSize: 12.5, marginTop: 2 },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 40, paddingHorizontal: space.lg },
  locked: { padding: space.lg, gap: 10, alignItems: 'center', marginTop: 40 },
  lockedTitle: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  lockedBody: { color: colors.dim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  cta: {
    marginTop: 8,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  ctaText: { color: colors.onYellow, fontWeight: '800', fontSize: 15 },
});
