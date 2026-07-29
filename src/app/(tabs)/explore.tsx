import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContentColumn, EmptyState, Screen } from '@/components/ui';
import db, { addMovieToWatchlist, addShow, getMovie } from '@/db';
import { trendingFeed, tvdbIdFor, type CatalogItem } from '@/catalog';
import { colors, radius, space } from '@/theme';

type FeedItem = CatalogItem;

function countLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** This week's trending shows + movies — TheTVDB first, TMDB as fallback. */
const loadFeed = (): Promise<FeedItem[]> => trendingFeed(12);

const PILLS = ['Feed', 'Discover', 'Groups', 'Activity'] as const;
type Pill = (typeof PILLS)[number];

const GROUPS = [
  { id: 'anime', name: 'Anime', members: '54.9K', topics: '2.7K', hue: 275 },
  { id: 'kdrama', name: 'K-Drama', members: '47.4K', topics: '2.41K', hue: 210 },
  { id: 'horror', name: 'Horror', members: '30.4K', topics: '1.08K', hue: 0 },
  { id: 'sitcoms', name: 'Sitcoms', members: '25.2K', topics: '806', hue: 45 },
  { id: 'romcom', name: 'Rom-Com', members: '12K', topics: '339', hue: 330 },
  { id: 'disney', name: 'Disney', members: '8.84K', topics: '283', hue: 140 },
];

function FeedCard({ item }: { item: FeedItem }) {
  const [added, setAdded] = useState(false);

  const open = async () => {
    if (item.kind === 'movie') {
      // untracked movies open in preview mode with the ADD MOVIE bar
      router.push(`/movie/${encodeURIComponent(item.title)}${item.tmdbId ? `?tmdbId=${item.tmdbId}` : ''}`);
      return;
    }
    // tracked shows open instantly; anything else resolves its TVDB id and
    // opens in preview — the show page fetches its metadata on its own
    const row = db.getFirstSync<{ tvdbId: number }>('SELECT tvdbId FROM shows WHERE LOWER(name) = ?', [
      item.title.toLowerCase(),
    ]);
    if (row) {
      router.push(`/show/${row.tvdbId}`);
      return;
    }
    const tvdbId = await tvdbIdFor(item);
    if (tvdbId) router.push(`/show/${tvdbId}${item.tmdbId ? `?tmdbId=${item.tmdbId}` : ''}`);
  };

  const add = async () => {
    try {
      if (item.kind === 'movie') {
        addMovieToWatchlist(item.title, item.poster, null, item.tmdbId);
        setAdded(true);
        return;
      }
      // shows are keyed by TVDB id — TheTVDB rows already carry it, so this
      // is usually free; only a TMDB-fallback row costs a lookup
      const tvdbId = await tvdbIdFor(item);
      if (tvdbId) {
        addShow(tvdbId, item.title, item.poster);
        setAdded(true);
      }
    } catch {}
  };

  return (
    <Pressable style={styles.bigCard} onPress={open}>
      <View style={styles.bigArt}>
        {/* the feed only keeps rows that have landscape art, so this is set in
            practice — fall back to the poster rather than render a hole */}
        <Image
          source={{ uri: item.backdrop ?? item.poster ?? undefined }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="disk"
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.18)' }]} />
        {item.kind === 'movie' && (
          <View style={styles.playCircle}>
            <Ionicons name="play" size={26} color="#FFF" style={{ marginLeft: 3 }} />
          </View>
        )}
        <Pressable style={[styles.addBtn, added && { backgroundColor: colors.yellow }]} onPress={add} hitSlop={8}>
          <Ionicons name={added ? 'checkmark' : 'add'} size={20} color={added ? colors.onYellow : colors.yellow} />
        </Pressable>
        <View style={styles.bigMeta}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name={item.kind === 'tv' ? 'tv-outline' : 'film-outline'} size={19} color={colors.text} />
            <Text style={styles.bigTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <Text style={styles.bigSub}>{item.sub}</Text>
        </View>
      </View>
      {item.kind === 'movie' ? (
        <View style={styles.bigDesc}>
          <Text style={{ color: '#E6E6EA', fontSize: 14.5, lineHeight: 20 }} numberOfLines={2}>
            {item.overview}
          </Text>
        </View>
      ) : (
        <View style={styles.watchedBy}>
          <Text style={styles.watchedByLabel}>Watched by</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 }}>
            <View style={styles.watcherCircle}>
              <Ionicons name="person" size={16} color="#B9B9C0" />
            </View>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>+{countLabel(item.votes)}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

export default function ExploreScreen() {
  const [pill, setPill] = useState<Pill>('Feed');
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [feedError, setFeedError] = useState(false);

  useEffect(() => {
    loadFeed()
      .then(setFeed)
      .catch(() => setFeedError(true));
  }, []);

  return (
    <Screen>
      <Pressable style={styles.searchLine} onPress={() => router.push('/search')}>
        <Ionicons name="search" size={18} color={colors.faint} />
        <Text style={styles.searchText}>Search</Text>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, height: 70 }}
        contentContainerStyle={styles.pillRow}>
        {PILLS.map((p) => (
          <Pressable key={p} style={[styles.pill, p === pill && styles.pillActive]} onPress={() => setPill(p)}>
            <Text style={[styles.pillText, p === pill && { color: colors.onYellow }]}>{p}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {pill === 'Feed' && (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {feed === null && !feedError && (
            <View style={{ paddingTop: 80, alignItems: 'center' }}>
              <ActivityIndicator color={colors.yellow} />
            </View>
          )}
          {feedError && (
            <EmptyState
              title="The feed needs internet"
              caption="Trending shows and movies load from the network. Your own library works offline as always."
            />
          )}
          {/* same reason as discover-more: one column of big artwork cards, so
              the column is capped rather than letting each card grow to fill a
              tablet. The pill row above stays full width. */}
          <ContentColumn>{feed?.map((item) => <FeedCard key={item.key} item={item} />)}</ContentColumn>
        </ScrollView>
      )}

      {pill === 'Discover' && (
        <EmptyState
          title="Discover"
          caption="Browse shows and movies with match scores."
          cta="Open Discover"
          onPress={() => router.push('/discover-more')}
        />
      )}

      {pill === 'Groups' && (
        <ScrollView>
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>
              SORT BY <Text style={{ color: colors.blue }}>Popular</Text>
            </Text>
            <Text style={{ color: colors.dim }}>?</Text>
          </View>
          {GROUPS.map((g) => (
            <Pressable key={g.id} style={styles.groupRow} onPress={() => router.push(`/group/${g.id}`)}>
              <View style={[styles.groupThumb, { backgroundColor: `hsl(${g.hue}, 40%, 26%)` }]}>
                <Text style={{ color: 'rgba(255,255,255,.7)', fontWeight: '800' }}>{g.name.slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.groupName}>{g.name}</Text>
                <Text style={styles.groupMeta}>
                  {g.members} 👥 · {g.topics} 💬
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {pill === 'Activity' && (
        <EmptyState title="No activity yet" caption="Friends' activity appears here when accounts arrive." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  searchText: { color: colors.faint, fontSize: 16 },
  pillRow: { gap: 10, paddingHorizontal: space.lg, alignItems: 'center' },
  pill: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.yellow },
  pillText: { color: colors.text, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },

  bigCard: { marginHorizontal: space.lg, marginBottom: 14, borderRadius: radius.card, overflow: 'hidden' },
  bigArt: { aspectRatio: 1.8, backgroundColor: '#22304A', justifyContent: 'flex-end' },
  playCircle: {
    position: 'absolute',
    alignSelf: 'center',
    top: '38%',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: '#FFF',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedBy: { backgroundColor: '#26220E', padding: 13 },
  watchedByLabel: { color: colors.text, fontSize: 16.5, fontWeight: '800' },
  watcherCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#3A3A3E',
    borderWidth: 1.5,
    borderColor: '#0D0D0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderWidth: 2,
    borderColor: colors.yellow,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigMeta: { position: 'absolute', left: 14, bottom: 12, right: 60 },
  bigTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  bigSub: { color: '#E3E3E8', fontSize: 13 },
  bigDesc: { backgroundColor: '#151F33', padding: 13 },

  sortRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: 8,
  },
  sortLabel: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  groupThumb: { width: 62, height: 62, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  groupName: { color: colors.text, fontSize: 17, fontWeight: '700' },
  groupMeta: { color: colors.dim, fontSize: 13.5, marginTop: 2 },
});
