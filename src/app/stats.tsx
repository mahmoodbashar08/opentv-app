import { Image } from 'expo-image';
import { router } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Bars, NavHeader, Screen, StatCard, StatTable, TopTabs } from '@/components/ui';
import { badges, charVotes } from '@/bundled-data';
import { tapLight } from '@/haptics';
import { getCharacterVoteStats } from '@/db';
import { currentLocale, t } from '@/i18n';
import { isSeedLibrary } from '@/library';
import { formatCount } from '@/locale-resolve';
import { PLUS_AVAILABLE, requirePlus, usePlus } from '@/plus';
import { computeMovieStats, computeShowStats } from '@/stats-calc';
import { colors, radius, space } from '@/theme';

const TABS = ['Shows', 'Movies'] as const;

/** StatCard inner width. Derived per render from the LIVE window width rather
 *  than once at module load — on iPad the window changes on rotation, and a
 *  value captured at import time leaves every page sized for the old one.
 *  StatCard itself runs full width (cards aren't capped — only prose/forms
 *  are), so this must track the raw window width too, or a wide iPad gets a
 *  page sized for a 700pt card crammed into a much wider one. */
function usePageWidth(): number {
  const { width } = useWindowDimensions();
  return width - 2 * space.lg - 2 * space.lg;
}

const compareSoon = () => Alert.alert(t('stats.comingSoonTitle'), t('stats.comingSoonBody'));

function ClockRow({ months, days, hours }: { months: number; days: number; hours: number }) {
  return (
    <View style={styles.clockRow}>
      {(
        [
          [months, t('stats.clock.months')],
          [days, t('stats.clock.days')],
          [hours, t('stats.clock.hours')],
        ] as const
      ).map(([v, u]) => (
        <View key={u} style={{ alignItems: 'center' }}>
          <Text style={styles.clockNum}>{v}</Text>
          <Text style={styles.clockUnit}>{u}</Text>
        </View>
      ))}
    </View>
  );
}

/** Card whose content swipes horizontally with page dots, like the real app. */
function PagedCard({ title, pages }: { title: string; pages: ReactNode[] }) {
  const [page, setPage] = useState(0);
  const PAGE_W = usePageWidth();
  return (
    <StatCard title={title}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / PAGE_W))}>
        {pages.map((p, i) => (
          <View key={i} style={{ width: PAGE_W }}>
            {p}
          </View>
        ))}
      </ScrollView>
      {pages.length > 1 && (
        <View style={styles.dots}>
          {pages.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && { backgroundColor: colors.yellow }]} />
          ))}
        </View>
      )}
    </StatCard>
  );
}

function AllTime() {
  return <Text style={styles.allTime}>{t('stats.allTime')}</Text>;
}

/**
 * The door to the Plus dashboard. Shown to EVERYONE — a locked door that is
 * visible is an offer; a hidden one is a feature nobody knows exists. The gate
 * itself is `requirePlus`, which either lets the tap through or opens the
 * paywall, so nothing here has to know what the entitlement costs.
 */
function DeepStatsRow() {
  const plus = usePlus();
  // Dark until Plus can be bought — see PLUS_AVAILABLE.
  if (!PLUS_AVAILABLE) return null;
  return (
    <Pressable
      style={styles.deepRow}
      onPress={() => {
        tapLight();
        if (requirePlus('deep_stats')) router.push('/deep-stats');
      }}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.deepTitle}>{t('plus.stats.entry')}</Text>
          {!plus && <Text style={styles.plusChip}>{t('plus.stats.chip')}</Text>}
        </View>
        <Text style={styles.deepSub}>{t('plus.stats.entrySub')}</Text>
      </View>
      <Text style={styles.deepChevron}>{'\u203A'}</Text>
    </Pressable>
  );
}

export default function StatsScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Shows');
  const s = useMemo(() => computeShowStats(), []);
  const m = useMemo(() => computeMovieStats(), []);
  const seedLib = isSeedLibrary();
  // imported/fresh libraries vote in the db; the demo library keeps its
  // bundled numbers
  const cv = seedLib
    ? { total: charVotes.total, shows: charVotes.shows, top: charVotes.top.map((c) => ({ show: c.show, name: c.name as string | null, count: c.count })) }
    : getCharacterVoteStats();

  return (
    <Screen>
      <NavHeader title={t('stats.title')} />
      <TopTabs
        tabs={TABS}
        labels={{ Shows: t('stats.tabs.shows'), Movies: t('stats.tabs.movies') }}
        active={tab}
        onChange={setTab}
      />
      <ScrollView contentContainerStyle={{ paddingVertical: 14, paddingBottom: 40 }}>
        <DeepStatsRow />
        {tab === 'Shows' ? (
          <>
            <PagedCard
              title={t('stats.shows.timeSpent')}
              pages={[
                <View key="clock">
                  <ClockRow {...s.clock} />
                  <Text style={styles.sub}>{t('stats.hoursLast7Days', { count: s.last7dHours })}</Text>
                  <Text style={styles.compare} onPress={compareSoon}>
                    {t('stats.compareWithFollowers')}
                  </Text>
                </View>,
                <Bars key="chart" values={s.weeklyHours} labels={s.weekLabels} axis={t('stats.axis.perWeek')} />,
              ]}
            />

            <PagedCard
              title={t('stats.shows.episodesWatched')}
              pages={[
                <View key="total">
                  <Text style={styles.bigNum}>{formatCount(s.totals.episodes, currentLocale())}</Text>
                  <Text style={styles.sub}>{t('stats.countLast7Days', { count: s.last7dEpisodes })}</Text>
                </View>,
                <Bars key="chart" values={s.weekly} labels={s.weekLabels} axis={t('stats.axis.perWeek')} />,
              ]}
            />

            {s.marathons.length > 0 && (
              <StatCard title={t('stats.shows.biggestMarathons')}>
                <StatTable
                  headers={{ name: t('stats.headers.show'), a: t('stats.headers.episodes'), b: t('stats.headers.hours') }}
                  rows={s.marathons.map((x) => ({ name: x.name, a: String(x.count), b: String(x.hours) }))}
                />
              </StatCard>
            )}

            <StatCard title={t('stats.shows.addedShows')}>
              <Text style={styles.bigNum}>{s.addedShows}</Text>
              <Text style={styles.sub}>{t('stats.shows.inProduction', { count: s.inProduction })}</Text>
            </StatCard>

            {s.genres.length > 0 && (
              <StatCard title={t('stats.shows.topGenres')}>
                <StatTable
                  headers={{ name: t('stats.headers.genre'), a: t('stats.headers.shows') }}
                  rows={s.genres.map((g) => ({ name: g.name, a: String(g.count) }))}
                />
              </StatCard>
            )}

            {s.networks.length > 0 && (
              <StatCard title={t('stats.shows.topNetworks')}>
                <StatTable
                  headers={{ name: t('stats.headers.network'), a: t('stats.headers.shows') }}
                  rows={s.networks.map((n) => ({ name: n.name, a: String(n.count) }))}
                />
              </StatCard>
            )}

            <StatCard title={t('stats.votedRatings')}>
              <Text style={styles.bigNum}>{s.votes}</Text>
              <Text style={styles.sub}>{t('stats.shows.onShows', { count: s.voteShows })}</Text>
            </StatCard>

            {s.mostVoted.length > 0 && (
              <StatCard title={t('stats.shows.mostVotedRating')}>
                <StatTable
                  headers={{ name: t('stats.headers.show'), a: t('stats.headers.rating') }}
                  rows={s.mostVoted.map((v) => ({ name: v.name, a: `${v.label} (×${v.count})` }))}
                />
                <AllTime />
              </StatCard>
            )}

            <StatCard title={t('stats.characterVotes')}>
              <Text style={styles.bigNum}>{cv.total}</Text>
              <Text style={styles.sub}>{t('stats.shows.onShows', { count: cv.shows })}</Text>
            </StatCard>

            {cv.top.length > 0 && (
            <StatCard title={t('stats.shows.mostVotedCharacters')}>
              <StatTable
                headers={{ name: t('stats.headers.show'), a: t('stats.headers.rating') }}
                rows={cv.top.map((c) => ({
                  name: c.show,
                  a: `${c.name ?? t('stats.character')} (×${c.count})`,
                }))}
              />
              <AllTime />
            </StatCard>
            )}

            <StatCard title={t('stats.shows.comments')}>
              <Text style={styles.bigNum}>{s.showComments}</Text>
              <Text style={styles.compare} onPress={compareSoon}>
                {t('stats.compareWithFollowers')}
              </Text>
            </StatCard>

            <StatCard title={t('stats.earnedLikes')}>
              <Text style={styles.bigNum}>{s.likes}</Text>
              <Text style={styles.sub}>{t('stats.shows.likesPerComment', { count: s.likes })}</Text>
            </StatCard>

            <StatCard title={t('stats.shows.episodeComments')}>
              <Bars
                values={s.commentsByMonth.map((c) => c.value)}
                labels={s.commentsByMonth.map((c) => c.label)}
                axis={t('stats.axis.perMonth')}
              />
            </StatCard>

            <StatCard title={t('stats.shows.remaining')}>
              <Text style={styles.bigNum}>{formatCount(s.remaining, currentLocale())}</Text>
              <Text style={styles.sub}>{t('stats.shows.onStartedShows', { count: s.started })}</Text>
            </StatCard>

            <StatCard title={t('stats.shows.upcoming')}>
              <Bars
                values={s.upcoming.map((u) => u.episodes)}
                labels={s.upcoming.map((u) => u.label)}
                color="#78BE3D"
                axis={t('stats.axis.episodes')}
              />
            </StatCard>

            <StatCard title={t('stats.catchingUpTitle')}>
              <Text style={styles.bigNum}>{t('stats.shows.pace', { pace: s.pace.toFixed(2) })}</Text>
              <Text style={styles.sub}>{t('stats.shows.basedOnRecent')}</Text>
            </StatCard>

            <StatCard title={t('stats.timeToWatch')}>
              <Text style={styles.bigNum}>{formatCount(s.timeToWatchHours, currentLocale())}</Text>
              <Text style={styles.sub}>{t('stats.hoursLabel')}</Text>
            </StatCard>

            <StatCard title={t('stats.futureWatchTime')}>
              <Bars
                values={s.upcoming.map((u) => u.hours)}
                labels={s.upcoming.map((u) => u.label)}
                color="#78BE3D"
                axis={t('stats.axis.hours')}
              />
            </StatCard>

            <StatCard title={t('stats.shows.catchUpTitle')}>
              <Text style={styles.bigNum}>
                {s.catchUpDate
                  ? s.catchUpDate.toISOString().slice(0, 10)
                  : s.remaining === 0
                    ? t('stats.caughtUp')
                    : t('stats.neverAtThisPace')}
              </Text>
              <Text style={styles.sub}>{t('stats.shows.basedOnRecent')}</Text>
            </StatCard>

            {seedLib && (
            <StatCard title={t('stats.shows.appBadges', { count: badges.app.filter((b) => b.unlocked).length })}>
              <View style={styles.badgeGrid}>
                {badges.app.map((b) => (
                  <Pressable
                    key={b.id}
                    style={[styles.appBadge, !b.unlocked && { opacity: 0.3 }]}
                    disabled={!b.unlocked}
                    onPress={() => router.push(`/badge/${encodeURIComponent(b.id)}`)}>
                    <Text style={{ fontSize: 30 }}>🏅</Text>
                    <Text style={styles.badgeLabel} numberOfLines={1}>
                      {b.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </StatCard>
            )}

            <StatCard title={t('stats.shows.watchBadges', { count: seedLib ? badges.watch.length : s.badges.length })}>
              <View style={styles.badgeGrid}>
                {(seedLib ? badges.watch : []).map((b) => (
                  <Pressable key={b.id} style={styles.appBadge} onPress={() => router.push(`/badge/${encodeURIComponent(b.id)}`)}>
                    <Text style={{ fontSize: 30 }}>🏅</Text>
                    <Text style={styles.badgeLabel} numberOfLines={1}>
                      {b.show}
                    </Text>
                    <Text style={styles.badgeTier}>{b.detail}</Text>
                  </Pressable>
                ))}
                {!seedLib &&
                  s.badges.map((b, i) => (
                    <View key={i} style={styles.appBadge}>
                      <Text style={{ fontSize: 30 }}>🏅</Text>
                      <Text style={styles.badgeLabel} numberOfLines={1}>
                        {b.show}
                      </Text>
                      <Text style={styles.badgeTier}>{b.label}</Text>
                    </View>
                  ))}
              </View>
            </StatCard>

            <StatCard title={t('stats.shows.ratingsBadges')}>
              <Text style={styles.bigNum}>0</Text>
            </StatCard>
            <StatCard title={t('stats.shows.commentBadges')}>
              <Text style={styles.bigNum}>0</Text>
            </StatCard>
            <StatCard title={t('stats.shows.followBadges')}>
              <Text style={styles.bigNum}>0</Text>
            </StatCard>
          </>
        ) : (
          <>
            <PagedCard
              title={t('stats.movies.timeSpent')}
              pages={[
                <View key="clock">
                  <ClockRow {...m.clock} />
                  <Text style={styles.sub}>{t('stats.hoursLast7Days', { count: m.last7dHours })}</Text>
                  <Text style={styles.compare} onPress={compareSoon}>
                    {t('stats.compareWithFollowers')}
                  </Text>
                </View>,
                <Bars key="chart" values={m.weeklyHours} labels={m.weekLabels} axis={t('stats.axis.perWeek')} />,
              ]}
            />

            <PagedCard
              title={t('stats.movies.watched')}
              pages={[
                <View key="total">
                  <Text style={styles.bigNum}>{m.watched}</Text>
                  <Text style={styles.sub}>{t('stats.countLast7Days', { count: m.last7dCount })}</Text>
                </View>,
                <Bars key="chart" values={m.weekly} labels={m.weekLabels} axis={t('stats.axis.perWeek')} />,
              ]}
            />

            <StatCard title={t('stats.movies.added')}>
              <Text style={styles.bigNum}>{m.added}</Text>
              <Text style={styles.sub}>{t('stats.movies.onWatchlist', { count: m.watchlist })}</Text>
            </StatCard>

            {m.genres.length > 0 && (
              <StatCard title={t('stats.movies.topGenres')}>
                <StatTable
                  headers={{ name: t('stats.headers.genre'), a: t('stats.headers.movies') }}
                  rows={m.genres.map((g) => ({ name: g.name, a: String(g.count) }))}
                />
              </StatCard>
            )}

            <StatCard title={t('stats.votedRatings')}>
              <Text style={styles.bigNum}>{m.rated}</Text>
              <Text style={styles.sub}>{t('stats.movies.onMovies', { count: m.rated })}</Text>
            </StatCard>

            <StatCard title={t('stats.characterVotes')}>
              <Text style={styles.bigNum}>{seedLib ? charVotes.movies.total : 0}</Text>
              <Text style={styles.sub}>{t('stats.movies.onMovies', { count: seedLib ? charVotes.movies.count : 0 })}</Text>
            </StatCard>

            <StatCard title={t('stats.movies.comments')}>
              <Text style={styles.bigNum}>{m.comments}</Text>
              <Text style={styles.sub}>{t('stats.movies.overMovies', { count: m.commentMovies })}</Text>
              <Text style={styles.compare} onPress={compareSoon}>
                {t('stats.compareWithFollowers')}
              </Text>
            </StatCard>

            <StatCard title={t('stats.earnedLikes')}>
              <Text style={styles.bigNum}>{m.commentLikes}</Text>
              <Text style={styles.sub}>
                {t('stats.movies.likesPerComment', { count: m.comments > 0 ? Math.round(m.commentLikes / m.comments) : 0 })}
              </Text>
            </StatCard>

            <StatCard title={t('stats.movies.commentsPerMonth')}>
              <Bars
                values={m.commentsByMonth.map((c) => c.value)}
                labels={m.commentsByMonth.map((c) => c.label)}
                axis={t('stats.axis.perMonth')}
              />
            </StatCard>

            <StatCard title={t('stats.movies.remaining')}>
              <Text style={styles.bigNum}>{m.remaining}</Text>
              <Text style={styles.sub}>{t('stats.movies.notYetReleased')}</Text>
            </StatCard>

            <StatCard title={t('stats.movies.upcoming')}>
              <Bars
                values={m.upcoming.map((u) => u.count)}
                labels={m.upcoming.map((u) => u.label)}
                color="#78BE3D"
                axis={t('stats.axis.movies')}
              />
            </StatCard>

            <StatCard title={t('stats.catchingUpTitle')}>
              <Text style={styles.bigNum}>{t('stats.movies.pace', { pace: m.pace.toFixed(2) })}</Text>
              <Text style={styles.sub}>{t('stats.movies.basedOnRecent')}</Text>
            </StatCard>

            <StatCard title={t('stats.timeToWatch')}>
              <Text style={styles.bigNum}>{formatCount(m.timeToWatchHours, currentLocale())}</Text>
              <Text style={styles.sub}>{t('stats.hoursLabel')}</Text>
            </StatCard>

            <StatCard title={t('stats.futureWatchTime')}>
              <Bars
                values={m.upcoming.map((u) => u.hours)}
                labels={m.upcoming.map((u) => u.label)}
                color="#78BE3D"
                axis={t('stats.axis.hours')}
              />
            </StatCard>

            <StatCard title={t('stats.movies.catchUpTitle')}>
              <Text style={styles.bigNum}>
                {m.catchUpDate
                  ? m.catchUpDate.toISOString().slice(0, 10)
                  : m.remaining === 0
                    ? t('stats.caughtUp')
                    : t('stats.neverAtThisPace')}
              </Text>
              <Text style={styles.sub}>{t('stats.movies.basedOnRecent')}</Text>
            </StatCard>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  clockRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 },
  clockNum: { color: colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  clockUnit: { color: colors.dim, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  sub: { color: colors.dim, fontSize: 13, marginTop: 8 },
  // hidden until accounts/community exist — "compare with people you follow"
  // implies other users, which OpenTV doesn't have yet (Owdver's review). Flip
  // display back on and wire compareSoon to the real feature when it ships.
  compare: { display: 'none', color: colors.blue, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.5, marginTop: 14, textAlign: 'center' },
  bigNum: { color: colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  allTime: { color: colors.faint, fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginTop: 14 },
  dots: { flexDirection: 'row', gap: 6, alignSelf: 'center', marginTop: 12 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#4A4A4E' },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4, justifyContent: 'space-between' },
  appBadge: { width: '21%', alignItems: 'center', gap: 4 },
  appBadgeImg: { width: 68, height: 68 },
  badgeLabel: { color: colors.text, fontSize: 10, fontWeight: '600' },
  badgeTier: { color: colors.dim, fontSize: 9 },
  deepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    marginHorizontal: space.lg,
    marginBottom: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  deepTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  deepSub: { color: colors.dim, fontSize: 12.5, marginTop: 3 },
  plusChip: {
    color: colors.onYellow,
    backgroundColor: colors.yellow,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.8,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  deepChevron: { color: colors.faint, fontSize: 22, fontWeight: '300' },
});
