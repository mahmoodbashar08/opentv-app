import { Image } from 'expo-image';
import { router } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Alert, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen, StatCard, TopTabs } from '@/components/ui';
import { badges, charVotes } from '@/bundled-data';
import { isSeedLibrary } from '@/library';
import { computeMovieStats, computeShowStats } from '@/stats-calc';
import { colors, radius, space } from '@/theme';

const TABS = ['Shows', 'Movies'] as const;
const W = Dimensions.get('window').width;
const PAGE_W = W - 2 * space.lg - 2 * space.lg; // StatCard inner width

const compareSoon = () =>
  Alert.alert('Coming soon', 'Comparing with the people you follow arrives with accounts.');

function ClockRow({ months, days, hours }: { months: number; days: number; hours: number }) {
  return (
    <View style={styles.clockRow}>
      {(
        [
          [months, 'MONTHS'],
          [days, 'DAYS'],
          [hours, 'HOURS'],
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

function Bars({
  values,
  labels,
  color = '#B9B9BE',
  axis,
}: {
  values: number[];
  labels?: string[];
  color?: string;
  axis?: string;
}) {
  const max = Math.max(...values, 1);
  return (
    <View>
      <View style={styles.bars}>
        {values.map((v, i) => (
          <View key={i} style={styles.barSlot}>
            {v > 0 && <Text style={styles.barValue}>{v}</Text>}
            <View style={[styles.bar, { backgroundColor: color, height: Math.max((v / max) * 58, v > 0 ? 5 : 2) }]} />
            {labels && <Text style={styles.barLabel}>{labels[i]}</Text>}
          </View>
        ))}
      </View>
      {axis && <Text style={styles.axis}>{axis}</Text>}
    </View>
  );
}

function Table({
  rows,
  headers,
}: {
  rows: { name: string; a: string; b?: string }[];
  headers?: { name: string; a: string; b?: string };
}) {
  return (
    <View style={{ gap: 9 }}>
      {headers && (
        <View style={styles.tableRow}>
          <Text style={[styles.tableHead, { flex: 1 }]}>{headers.name.toUpperCase()}</Text>
          <Text style={[styles.tableHead, styles.tableColA]}>{headers.a.toUpperCase()}</Text>
          {headers.b != null && <Text style={[styles.tableHead, styles.tableColB]}>{headers.b.toUpperCase()}</Text>}
        </View>
      )}
      {rows.map((r, i) => (
        <View key={`${r.name}-${i}`} style={styles.tableRow}>
          <Text style={styles.tableName} numberOfLines={1}>
            {r.name}
          </Text>
          <Text style={[styles.tableRight, styles.tableColA]}>{r.a}</Text>
          {r.b != null && <Text style={[styles.tableRight, styles.tableColB]}>{r.b}</Text>}
        </View>
      ))}
    </View>
  );
}

/** Card whose content swipes horizontally with page dots, like the real app. */
function PagedCard({ title, pages }: { title: string; pages: ReactNode[] }) {
  const [page, setPage] = useState(0);
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
  return <Text style={styles.allTime}>ALL TIME</Text>;
}

export default function StatsScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Shows');
  const s = useMemo(() => computeShowStats(), []);
  const m = useMemo(() => computeMovieStats(), []);
  const seedLib = isSeedLibrary();

  return (
    <Screen>
      <NavHeader title="Stats" />
      <TopTabs tabs={TABS} active={tab} onChange={setTab} />
      <ScrollView contentContainerStyle={{ paddingVertical: 14, paddingBottom: 40 }}>
        {tab === 'Shows' ? (
          <>
            <PagedCard
              title="Time spent watching episodes"
              pages={[
                <View key="clock">
                  <ClockRow {...s.clock} />
                  <Text style={styles.sub}>{s.last7dHours} hours in the last 7 days</Text>
                  <Text style={styles.compare} onPress={compareSoon}>
                    COMPARE WITH THE PEOPLE YOU FOLLOW
                  </Text>
                </View>,
                <Bars key="chart" values={s.weeklyHours} labels={s.weekLabels} axis="PER WEEK" />,
              ]}
            />

            <PagedCard
              title="Episodes watched"
              pages={[
                <View key="total">
                  <Text style={styles.bigNum}>{s.totals.episodes.toLocaleString()}</Text>
                  <Text style={styles.sub}>{s.last7dEpisodes} in the last 7 days</Text>
                </View>,
                <Bars key="chart" values={s.weekly} labels={s.weekLabels} axis="PER WEEK" />,
              ]}
            />

            {s.marathons.length > 0 && (
              <StatCard title="Biggest marathons">
                <Table
                  headers={{ name: 'Show', a: 'Episodes', b: 'Hours' }}
                  rows={s.marathons.map((x) => ({ name: x.name, a: String(x.count), b: String(x.hours) }))}
                />
              </StatCard>
            )}

            <StatCard title="Added shows">
              <Text style={styles.bigNum}>{s.addedShows}</Text>
              <Text style={styles.sub}>{s.inProduction} in production</Text>
            </StatCard>

            {s.genres.length > 0 && (
              <StatCard title="Top show genres">
                <Table headers={{ name: 'Genre', a: 'Shows' }} rows={s.genres.map((g) => ({ name: g.name, a: String(g.count) }))} />
              </StatCard>
            )}

            {s.networks.length > 0 && (
              <StatCard title="Top show networks">
                <Table headers={{ name: 'Network', a: 'Shows' }} rows={s.networks.map((n) => ({ name: n.name, a: String(n.count) }))} />
              </StatCard>
            )}

            <StatCard title="Voted ratings">
              <Text style={styles.bigNum}>{s.votes}</Text>
              <Text style={styles.sub}>on {s.voteShows} shows</Text>
            </StatCard>

            {s.mostVoted.length > 0 && (
              <StatCard title="Most voted rating per show">
                <Table
                  headers={{ name: 'Show', a: 'Rating' }}
                  rows={s.mostVoted.map((v) => ({ name: v.name, a: `${v.label} (×${v.count})` }))}
                />
                <AllTime />
              </StatCard>
            )}

            <StatCard title="Character votes">
              <Text style={styles.bigNum}>{seedLib ? charVotes.total : 0}</Text>
              <Text style={styles.sub}>on {seedLib ? charVotes.shows : 0} shows</Text>
            </StatCard>

            {seedLib && (
            <StatCard title="Most voted characters per show">
              <Table
                headers={{ name: 'Show', a: 'Rating' }}
                rows={charVotes.top.map((c) => ({
                  name: c.show,
                  a: `${c.name ?? 'Character'} (×${c.count})`,
                }))}
              />
              <AllTime />
            </StatCard>
            )}

            <StatCard title="Show comments">
              <Text style={styles.bigNum}>{s.showComments}</Text>
              <Text style={styles.compare} onPress={compareSoon}>
                COMPARE WITH THE PEOPLE YOU FOLLOW
              </Text>
            </StatCard>

            <StatCard title="Earned likes">
              <Text style={styles.bigNum}>{s.likes}</Text>
              <Text style={styles.sub}>{s.likes} likes per show comment</Text>
            </StatCard>

            <StatCard title="Episode comments">
              <Bars
                values={s.commentsByMonth.map((c) => c.value)}
                labels={s.commentsByMonth.map((c) => c.label)}
                axis="PER MONTH"
              />
            </StatCard>

            <StatCard title="Remaining episodes">
              <Text style={styles.bigNum}>{s.remaining.toLocaleString()}</Text>
              <Text style={styles.sub}>on {s.started} started shows</Text>
            </StatCard>

            <StatCard title="Upcoming episodes">
              <Bars
                values={s.upcoming.map((u) => u.episodes)}
                labels={s.upcoming.map((u) => u.label)}
                color="#78BE3D"
                axis="EPISODES"
              />
            </StatCard>

            <StatCard title="How fast are you catching up?">
              <Text style={styles.bigNum}>{s.pace.toFixed(2)} episodes/week</Text>
              <Text style={styles.sub}>based on episodes you watched in the last two months</Text>
            </StatCard>

            <StatCard title="Time to watch">
              <Text style={styles.bigNum}>{s.timeToWatchHours.toLocaleString()}</Text>
              <Text style={styles.sub}>hours</Text>
            </StatCard>

            <StatCard title="Future watch time">
              <Bars
                values={s.upcoming.map((u) => u.hours)}
                labels={s.upcoming.map((u) => u.label)}
                color="#78BE3D"
                axis="HOURS"
              />
            </StatCard>

            <StatCard title="When will you catch up on your episodes">
              <Text style={styles.bigNum}>
                {s.catchUpDate
                  ? s.catchUpDate.toISOString().slice(0, 10)
                  : s.remaining === 0
                    ? 'You are caught up!'
                    : 'Never at this pace 😅'}
              </Text>
              <Text style={styles.sub}>based on episodes you watched in the last two months</Text>
            </StatCard>

            {seedLib && (
            <StatCard title={`App badges · ${badges.app.filter((b) => b.unlocked).length}`}>
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

            <StatCard title={`Watch badges · ${seedLib ? badges.watch.length : s.badges.length}`}>
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

            <StatCard title="Ratings badges">
              <Text style={styles.bigNum}>0</Text>
            </StatCard>
            <StatCard title="Comment badges">
              <Text style={styles.bigNum}>0</Text>
            </StatCard>
            <StatCard title="Follow badges">
              <Text style={styles.bigNum}>0</Text>
            </StatCard>
          </>
        ) : (
          <>
            <PagedCard
              title="Time spent watching movies"
              pages={[
                <View key="clock">
                  <ClockRow {...m.clock} />
                  <Text style={styles.sub}>{m.last7dHours} hours in the last 7 days</Text>
                  <Text style={styles.compare} onPress={compareSoon}>
                    COMPARE WITH THE PEOPLE YOU FOLLOW
                  </Text>
                </View>,
                <Bars key="chart" values={m.weeklyHours} labels={m.weekLabels} axis="PER WEEK" />,
              ]}
            />

            <PagedCard
              title="Movies watched"
              pages={[
                <View key="total">
                  <Text style={styles.bigNum}>{m.watched}</Text>
                  <Text style={styles.sub}>{m.last7dCount} in the last 7 days</Text>
                </View>,
                <Bars key="chart" values={m.weekly} labels={m.weekLabels} axis="PER WEEK" />,
              ]}
            />

            <StatCard title="Added movies">
              <Text style={styles.bigNum}>{m.added}</Text>
              <Text style={styles.sub}>{m.watchlist} on your watchlist</Text>
            </StatCard>

            {m.genres.length > 0 && (
              <StatCard title="Top movie genres">
                <Table headers={{ name: 'Genre', a: 'Movies' }} rows={m.genres.map((g) => ({ name: g.name, a: String(g.count) }))} />
              </StatCard>
            )}

            <StatCard title="Voted ratings">
              <Text style={styles.bigNum}>{m.rated}</Text>
              <Text style={styles.sub}>on {m.rated} movies</Text>
            </StatCard>

            <StatCard title="Character votes">
              <Text style={styles.bigNum}>{seedLib ? charVotes.movies.total : 0}</Text>
              <Text style={styles.sub}>on {seedLib ? charVotes.movies.count : 0} movies</Text>
            </StatCard>

            <StatCard title="Movie comments">
              <Text style={styles.bigNum}>{m.comments}</Text>
              <Text style={styles.sub}>over {m.commentMovies} movies</Text>
              <Text style={styles.compare} onPress={compareSoon}>
                COMPARE WITH THE PEOPLE YOU FOLLOW
              </Text>
            </StatCard>

            <StatCard title="Earned likes">
              <Text style={styles.bigNum}>{m.commentLikes}</Text>
              <Text style={styles.sub}>
                {m.comments > 0 ? Math.round(m.commentLikes / m.comments) : 0} likes per movie comment
              </Text>
            </StatCard>

            <StatCard title="Movie comments per month">
              <Bars
                values={m.commentsByMonth.map((c) => c.value)}
                labels={m.commentsByMonth.map((c) => c.label)}
                axis="PER MONTH"
              />
            </StatCard>

            <StatCard title="Remaining movies">
              <Text style={styles.bigNum}>{m.remaining}</Text>
              <Text style={styles.sub}>not yet released, from your watchlist</Text>
            </StatCard>

            <StatCard title="Upcoming movies">
              <Bars
                values={m.upcoming.map((u) => u.count)}
                labels={m.upcoming.map((u) => u.label)}
                color="#78BE3D"
                axis="MOVIES"
              />
            </StatCard>

            <StatCard title="How fast are you catching up?">
              <Text style={styles.bigNum}>{m.pace.toFixed(2)} movies/week</Text>
              <Text style={styles.sub}>based on movies you watched in the last two months</Text>
            </StatCard>

            <StatCard title="Time to watch">
              <Text style={styles.bigNum}>{m.timeToWatchHours.toLocaleString()}</Text>
              <Text style={styles.sub}>hours</Text>
            </StatCard>

            <StatCard title="Future watch time">
              <Bars
                values={m.upcoming.map((u) => u.hours)}
                labels={m.upcoming.map((u) => u.label)}
                color="#78BE3D"
                axis="HOURS"
              />
            </StatCard>

            <StatCard title="When will you catch up on your movies">
              <Text style={styles.bigNum}>
                {m.catchUpDate
                  ? m.catchUpDate.toISOString().slice(0, 10)
                  : m.remaining === 0
                    ? 'You are caught up!'
                    : 'Never at this pace 😅'}
              </Text>
              <Text style={styles.sub}>based on movies you watched in the last two months</Text>
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
  compare: { color: colors.blue, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.5, marginTop: 14, textAlign: 'center' },
  bigNum: { color: colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 92, marginTop: 6 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '58%', borderRadius: 3 },
  barValue: { color: colors.dim, fontSize: 8.5, marginBottom: 3, fontVariant: ['tabular-nums'] },
  barLabel: { color: colors.faint, fontSize: 8.5, marginTop: 4, fontVariant: ['tabular-nums'] },
  axis: { color: colors.faint, fontSize: 10, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginTop: 8 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tableHead: { color: colors.faint, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6 },
  tableName: { color: colors.text, fontSize: 15, flex: 1 },
  tableRight: { color: colors.dim, fontSize: 14, fontVariant: ['tabular-nums'] },
  tableColA: { minWidth: 76, textAlign: 'right' },
  tableColB: { minWidth: 48, textAlign: 'right' },
  allTime: { color: colors.faint, fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginTop: 14 },
  dots: { flexDirection: 'row', gap: 6, alignSelf: 'center', marginTop: 12 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#4A4A4E' },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4, justifyContent: 'space-between' },
  appBadge: { width: '21%', alignItems: 'center', gap: 4 },
  appBadgeImg: { width: 68, height: 68 },
  badgeLabel: { color: colors.text, fontSize: 10, fontWeight: '600' },
  badgeTier: { color: colors.dim, fontSize: 9 },
});
