import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen, TopTabs } from '@/components/ui';
import db, { addMovieToWatchlist, addShow, getMovie } from '@/db';
import { tmdb } from '@/tmdb';
import { colors, space } from '@/theme';

const TABS = ['Shows & Movies', 'Users', 'Groups'] as const;

type Result = {
  key: string;
  kind: 'show' | 'movie';
  name: string;
  poster: string | null;
  year: string | null;
  tmdbId: number | null;
  tvdbId: number | null; // known for library shows; resolved on add for TMDB ones
  inLibrary: boolean;
};

// library matches first, then live TMDB results for everything else
function searchLibrary(q: string): Result[] {
  const like = `%${q}%`;
  const shows = db
    .getAllSync<{ tvdbId: number; name: string; posterUrl: string | null }>(
      'SELECT tvdbId, name, posterUrl FROM shows WHERE name LIKE ? LIMIT 10',
      [like],
    )
    .map((s) => ({
      key: `lib-s-${s.tvdbId}`,
      kind: 'show' as const,
      name: s.name,
      poster: s.posterUrl,
      year: null,
      tmdbId: null,
      tvdbId: s.tvdbId,
      inLibrary: true,
    }));
  const movies = db
    .getAllSync<{ name: string; poster: string | null; year: string | null; tmdbId: number | null }>(
      'SELECT name, poster, year, tmdbId FROM movies WHERE name LIKE ? LIMIT 10',
      [like],
    )
    .map((m) => ({
      key: `lib-m-${m.name}`,
      kind: 'movie' as const,
      name: m.name,
      poster: m.poster,
      year: m.year,
      tmdbId: m.tmdbId,
      tvdbId: null,
      inLibrary: true,
    }));
  return [...shows, ...movies];
}

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]>('Shows & Movies');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  // bump on focus so returning from a detail screen (where the item may have
  // been removed or added) re-checks library membership
  const [libTick, setLibTick] = useState(0);
  useFocusEffect(useCallback(() => setLibTick((t) => t + 1), []));

  // keys of results currently in the library — derived fresh from the DB, so
  // the ✓/＋ always reflects reality (recomputes on new results or on focus)
  const libSet = useMemo(() => {
    const next = new Set<string>();
    if (!results.length) return next;
    const showNames = new Set(
      db.getAllSync<{ name: string }>('SELECT name FROM shows').map((r) => r.name.toLowerCase()),
    );
    const movieNames = new Set(
      db
        .getAllSync<{ name: string; originalName: string | null }>('SELECT name, originalName FROM movies')
        .flatMap((r) => [r.name.toLowerCase(), (r.originalName ?? '').toLowerCase()]),
    );
    for (const r of results) {
      const inLib = r.kind === 'movie' ? movieNames.has(r.name.toLowerCase()) : showNames.has(r.name.toLowerCase());
      if (inLib) next.add(r.key);
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, libTick]);
  const seq = useRef(0);

  // debounce, and drop responses that arrive after a newer query
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    const local = searchLibrary(q);
    setResults(local);
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await tmdb<{
          results: {
            media_type: string;
            id: number;
            name?: string;
            title?: string;
            poster_path?: string | null;
            first_air_date?: string;
            release_date?: string;
            vote_count?: number;
          }[];
        }>(`/search/multi?query=${encodeURIComponent(q)}&include_adult=false`);
        if (seq.current !== mine) return;
        const localNames = new Set(local.map((r) => `${r.kind}:${r.name.toLowerCase()}`));
        const remote: Result[] = res.results
          .filter((r) => r.media_type === 'tv' || r.media_type === 'movie')
          .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
          .map((r) => {
            const kind = r.media_type === 'tv' ? ('show' as const) : ('movie' as const);
            const name = (r.name || r.title || '').trim();
            return {
              key: `tmdb-${r.media_type}-${r.id}`,
              kind,
              name,
              poster: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
              year: (r.first_air_date || r.release_date || '').slice(0, 4) || null,
              tmdbId: r.id,
              tvdbId: null,
              inLibrary: localNames.has(`${kind}:${name.toLowerCase()}`),
            };
          })
          .filter((r) => r.name && !localNames.has(`${r.kind}:${r.name.toLowerCase()}`))
          .slice(0, 20);
        setResults([...local, ...remote]);
      } catch {
        // offline or rate-limited: library results stay on screen
      } finally {
        if (seq.current === mine) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const open = async (item: Result) => {
    if (item.kind === 'movie') {
      router.push(`/movie/${encodeURIComponent(item.name)}${getMovie(item.name) ? '' : `?tmdbId=${item.tmdbId ?? ''}`}`);
      return;
    }
    if (item.tvdbId != null) {
      router.push(`/show/${item.tvdbId}`);
      return;
    }
    try {
      // TMDB result: resolve the TVDB id, open in preview — the show page
      // fetches its metadata on its own
      const ext = await tmdb<{ tvdb_id?: number }>(`/tv/${item.tmdbId}/external_ids`);
      if (ext.tvdb_id) router.push(`/show/${ext.tvdb_id}?tmdbId=${item.tmdbId}`);
    } catch {}
  };

  const add = async (item: Result) => {
    if (libSet.has(item.key)) return;
    if (item.kind === 'movie') {
      addMovieToWatchlist(item.name, item.poster, item.year, item.tmdbId);
      setLibTick((t) => t + 1); // re-derive → ✓ appears
      return;
    }
    try {
      // shows key on TVDB ids everywhere — resolve it once, like the explore feed
      const ext = await tmdb<{ tvdb_id?: number }>(`/tv/${item.tmdbId}/external_ids`);
      if (ext.tvdb_id) {
        addShow(ext.tvdb_id, item.name, item.poster);
        setLibTick((t) => t + 1);
      }
    } catch {
      // leave the + visible so they can retry
    }
  };

  return (
    <Screen>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          style={styles.input}
          placeholder="Search shows and movies"
          placeholderTextColor={colors.faint}
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
        />
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.blue, fontSize: 16 }}>Cancel</Text>
        </Pressable>
      </View>
      <TopTabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'Shows & Movies' ? (
        <FlatList
          data={results}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const inLib = libSet.has(item.key);
            return (
              <Pressable style={styles.row} onPress={() => open(item)}>
                {item.poster ? (
                  <Image source={{ uri: item.poster }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name={item.kind === 'show' ? 'tv-outline' : 'film-outline'} size={18} color={colors.dim} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.sub}>
                    {item.kind === 'show' ? 'Series' : 'Movie'}
                    {item.year ? ` · ${item.year}` : ''}
                  </Text>
                </View>
                {inLib ? (
                  <Ionicons name="checkmark-circle" size={26} color={colors.yellow} />
                ) : (
                  <Pressable hitSlop={10} onPress={() => add(item)}>
                    <Ionicons name="add-circle-outline" size={26} color={colors.text} />
                  </Pressable>
                )}
              </Pressable>
            );
          }}
          ListFooterComponent={loading ? <ActivityIndicator color={colors.yellow} style={{ margin: 18 }} /> : null}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.note}>{query ? 'No matches found.' : 'Search your library and all of TMDB.'}</Text>
            ) : null
          }
        />
      ) : (
        <Text style={styles.note}>{tab} search arrives with the social layer — COMING SOON.</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
  },
  input: { color: colors.text, fontSize: 16, flex: 1, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  thumb: { width: 42, height: 60, borderRadius: 4, backgroundColor: colors.raise },
  name: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  sub: { color: colors.faint, fontSize: 12.5, marginTop: 2 },
  note: { color: colors.faint, fontSize: 13, textAlign: 'center', margin: 24 },
});
