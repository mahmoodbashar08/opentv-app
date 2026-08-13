/**
 * DEEP STATS — the Plus dashboard, and the free Stats page's bigger sibling.
 *
 * Everything on this screen is derived on the phone from tables that are
 * already there: watches, ratings, character votes, and the show/film metadata
 * the app has already cached. No request is made to open it, and nothing it
 * computes is sent anywhere. That is the whole reason it can show you your
 * taste without asking you to have an account.
 *
 * The gate is asked TWICE on purpose. `requirePlus` on the Stats row stops the
 * ordinary tap; `usePlus()` here stops a deep link, a restored navigation state
 * or a stale back-stack from walking in behind it.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Bars, NavHeader, Screen, StatCard, StatTable } from '@/components/ui';
import { tapLight, tapSelection } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
import { requirePlus, usePlus } from '@/plus';
import { computeCrowdCompare, computeDeepStats, watchYears } from '@/stats-calc';
import { colors, radius, space } from '@/theme';

/** How many of the crowd rows each half of the comparison shows. */
const CROWD_ROWS = 5;

const one = (n: number) => n.toFixed(1);

function YearChips({ years, year, onChange }: { years: number[]; year: number | null; onChange: (y: number | null) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {[null, ...years].map((y) => (
        <Pressable
          key={y ?? 'all'}
          style={[styles.chip, y === year && styles.chipOn]}
          onPress={() => {
            tapSelection();
            onChange(y);
          }}>
          <Text style={[styles.chipText, y === year && styles.chipTextOn]}>{y ?? t('plus.stats.allTimeChip')}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** The one thing here that leaves the phone, and only when it is tapped. */
function ShareRow({ genres, score }: { genres: string[]; score: number | null }) {
  const card = useRef<View>(null);

  const share = async () => {
    tapLight();
    try {
      // lazy-load: both need the native module from the latest build
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      const uri = await captureRef(card, { format: 'png', quality: 1 });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: t('plus.stats.shareTitle') });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('native module') || msg.includes('RNViewShot')) {
        Alert.alert(t('shareCard.buildNeededTitle'), t('shareCard.buildNeededBody'));
      } else {
        Alert.alert(t('shareCard.shareFailedTitle'), msg);
      }
    }
  };

  return (
    <View style={{ alignItems: 'center', gap: 18, marginTop: 6 }}>
      <View ref={card} collapsable={false} style={styles.card}>
        <Text style={styles.cardKicker}>{t('plus.stats.cardTaste')}</Text>
        {genres.map((g, i) => (
          <Text key={g} style={[styles.cardGenre, i === 0 && { fontSize: 26 }]} numberOfLines={1}>
            {g}
          </Text>
        ))}
        {score != null && (
          <Text style={styles.cardScore}>
            {t('plus.stats.cardContrarian')} {score}
          </Text>
        )}
        <View style={styles.cardBrand}>
          <Text style={styles.cardBrandText}>OPENTV</Text>
          <Text style={styles.cardBrandSub}>{t('plus.stats.cardTagline')}</Text>
        </View>
      </View>
      <Pressable style={styles.shareBtn} onPress={share}>
        <Ionicons name="share-outline" size={18} color={colors.onYellow} />
        <Text style={styles.shareText}>{t('plus.stats.share')}</Text>
      </Pressable>
    </View>
  );
}

function Locked() {
  return (
    <View style={styles.locked}>
      <Text style={styles.lockedTitle}>{t('plus.stats.lockedTitle')}</Text>
      <Text style={styles.lockedBody}>{t('plus.stats.lockedBody')}</Text>
      <Pressable
        style={styles.shareBtn}
        onPress={() => {
          tapLight();
          requirePlus('deep_stats');
        }}>
        <Text style={styles.shareText}>{t('plus.stats.unlock')}</Text>
      </Pressable>
    </View>
  );
}

export default function DeepStatsScreen() {
  const plus = usePlus();
  const [year, setYear] = useState<number | null>(null);
  /**
   * READ IN A CALLBACK, NOT IN RENDER. The React Compiler memoises a
   * render-time read of an external store against its arguments, and a counter
   * named in a dependency list does not save it — the call does not use the
   * counter, so it compiles away and the screen keeps showing the library as it
   * was the first time it opened. State React sets is the invalidation the
   * compiler understands, so the whole dashboard is computed here and held.
   *
   * It is also the cheap place for it: ONE pass over the watch table per focus
   * and per year chip, off the render path entirely, which is what keeps a
   * 30k-watch library from janking the scroll.
   */
  const [data, setData] = useState<{
    years: number[];
    d: ReturnType<typeof computeDeepStats>;
    crowd: ReturnType<typeof computeCrowdCompare>;
  } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!plus) {
        setData(null);
        return;
      }
      setData({ years: watchYears(), d: computeDeepStats(year), crowd: computeCrowdCompare(year) });
    }, [plus, year]),
  );
  const years = data?.years ?? [];
  const d = data?.d ?? null;
  const crowd = data?.crowd ?? null;

  const days = [
    t('plus.stats.days.mon'),
    t('plus.stats.days.tue'),
    t('plus.stats.days.wed'),
    t('plus.stats.days.thu'),
    t('plus.stats.days.fri'),
    t('plus.stats.days.sat'),
    t('plus.stats.days.sun'),
  ];
  // 24 labels would overlap; a mark every six hours still reads as a clock
  const hourLabels = Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? String(h) : ''));

  const locale = currentLocale();
  const hours = (minutes: number) => formatCount(Math.round(minutes / 60), locale);

  return (
    <Screen>
      <NavHeader title={t('plus.stats.title')} close />
      {!plus ? (
        <Locked />
      ) : !d || !crowd ? (
        // the first frame, before the focus effect has read the database — a
        // blank beat, never the locked state, which would flash "pay me" at
        // somebody who already has
        <View style={{ flex: 1 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <YearChips years={years} year={year} onChange={setYear} />

          {d.episodes === 0 ? (
            <Text style={styles.empty}>{t('plus.stats.empty')}</Text>
          ) : (
            <>
              <StatCard title={t('plus.stats.tasteDna')}>
                <StatTable
                  headers={{ name: t('stats.headers.genre'), a: t('stats.headers.hours') }}
                  rows={d.genres.map((g) => ({ name: g.name, a: hours(g.minutes) }))}
                />
                {d.decades.length > 0 && (
                  <>
                    <View style={styles.rule} />
                    <StatTable
                      headers={{ name: t('plus.stats.headers.decade'), a: t('stats.headers.hours') }}
                      rows={d.decades.map((x) => ({ name: x.name, a: hours(x.minutes) }))}
                    />
                  </>
                )}
                {d.networks.length > 0 && (
                  <>
                    <View style={styles.rule} />
                    <StatTable
                      headers={{ name: t('stats.headers.network'), a: t('stats.headers.hours') }}
                      rows={d.networks.map((x) => ({ name: x.name, a: hours(x.minutes) }))}
                    />
                  </>
                )}
              </StatCard>

              <StatCard title={t('plus.stats.topShows')}>
                <StatTable
                  headers={{ name: t('stats.headers.show'), a: t('stats.headers.episodes'), b: t('stats.headers.hours') }}
                  rows={d.topShows.map((x) => ({ name: x.name, a: String(x.episodes), b: hours(x.minutes) }))}
                />
              </StatCard>

              {d.characters.length > 0 && (
                <StatCard title={t('plus.stats.characters')}>
                  <StatTable
                    headers={{ name: t('stats.headers.show'), a: t('plus.stats.headers.character') }}
                    rows={d.characters.map((c) => ({ name: c.show, a: c.name ?? t('stats.character') }))}
                  />
                  <Text style={styles.note}>{t('plus.stats.datelessNote')}</Text>
                </StatCard>
              )}

              <StatCard title={t('plus.stats.binge')}>
                <Text style={styles.bigNum}>{d.binge.biggestDay}</Text>
                <Text style={styles.sub}>
                  {t('plus.stats.biggestDay')}
                  {d.binge.biggestDayDate ? ` — ${t('plus.stats.biggestDayOn', { date: d.binge.biggestDayDate })}` : ''}
                </Text>
                <View style={styles.rule} />
                <StatTable
                  rows={[
                    { name: t('plus.stats.longestStreak'), a: `${d.binge.longestStreak} ${t('plus.stats.daysInARow')}` },
                    { name: t('plus.stats.activeDays'), a: formatCount(d.binge.activeDays, locale) },
                    { name: t('plus.stats.perActiveDay'), a: one(d.binge.perActiveDay) },
                  ]}
                />
              </StatCard>

              <StatCard title={t('plus.stats.ratings')}>
                <Text style={styles.bigNum}>{t(`plus.stats.personality.${d.personality.label}` as 'plus.stats.personality.balanced')}</Text>
                {d.personality.total > 0 && (
                  <Text style={styles.sub}>
                    {t('plus.stats.meanStars', { mean: one(d.personality.mean) })} · {t('plus.stats.spread', { spread: one(d.personality.spread) })}
                  </Text>
                )}
                <Bars values={d.starCounts} labels={['1★', '2★', '3★', '4★', '5★']} color={colors.yellow} />
                {d.personality.label === 'unrated' && <Text style={styles.note}>{t('plus.stats.personalityNeedMore')}</Text>}
              </StatCard>

              <StatCard title={t('plus.stats.when')}>
                <Bars values={d.when.weekdays} labels={days} axis={t('plus.stats.weekAxis')} />
                {d.when.clockIsReal ? (
                  <>
                    <View style={styles.rule} />
                    <Bars values={d.when.hours} labels={hourLabels} axis={t('plus.stats.hourAxis')} compact />
                  </>
                ) : (
                  <Text style={styles.note}>{t('plus.stats.noClock')}</Text>
                )}
              </StatCard>

              <StatCard title={t('plus.stats.crowd')}>
                {crowd.score == null ? (
                  <Text style={styles.note}>{t('plus.stats.crowdNeedMore')}</Text>
                ) : (
                  <>
                    <Text style={styles.bigNum}>{crowd.score}</Text>
                    <Text style={styles.sub}>
                      {t('plus.stats.contrarian')} — {t('plus.stats.contrarianSub')}
                    </Text>
                    <View style={styles.rule} />
                    <Text style={styles.subHead}>{t('plus.stats.disagree')}</Text>
                    <StatTable
                      headers={{ name: t('plus.stats.headers.title'), a: t('plus.stats.headers.you'), b: t('plus.stats.headers.them') }}
                      rows={crowd.rows.slice(0, CROWD_ROWS).map((r) => ({ name: r.name, a: one(r.yours), b: one(r.crowd) }))}
                    />
                    <View style={styles.rule} />
                    <Text style={styles.subHead}>{t('plus.stats.agree')}</Text>
                    <StatTable
                      headers={{ name: t('plus.stats.headers.title'), a: t('plus.stats.headers.you'), b: t('plus.stats.headers.them') }}
                      rows={crowd.rows
                        .slice(-CROWD_ROWS)
                        .reverse()
                        .map((r) => ({ name: r.name, a: one(r.yours), b: one(r.crowd) }))}
                    />
                  </>
                )}
              </StatCard>

              <ShareRow genres={d.genres.slice(0, 3).map((g) => g.name)} score={crowd.score} />
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { gap: 8, paddingHorizontal: space.lg, paddingVertical: 12 },
  chip: { backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: colors.yellow },
  chipText: { color: colors.dim, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: colors.onYellow },
  bigNum: { color: colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sub: { color: colors.dim, fontSize: 13, marginTop: 8 },
  subHead: { color: colors.faint, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  note: { color: colors.faint, fontSize: 12, marginTop: 12, lineHeight: 17 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 16 },
  empty: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 40 },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: space.xxl },
  lockedTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  lockedBody: { color: colors.dim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  card: {
    width: 300,
    backgroundColor: colors.yellow,
    borderRadius: radius.card,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  cardKicker: { color: '#3A3A1E', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  cardGenre: { color: '#141414', fontSize: 19, fontWeight: '900', marginTop: 6 },
  cardScore: { color: '#3A3A1E', fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 16 },
  cardBrand: {
    marginHorizontal: -20,
    backgroundColor: '#0D0D0F',
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardBrandText: { color: colors.text, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8 },
  cardBrandSub: { color: '#C9C9CF', fontSize: 9.5 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  shareText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 1 },
});
