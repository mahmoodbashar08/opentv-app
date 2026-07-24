import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { setMovieMatch, setMovieMatchTvdb, setShowPoster } from '@/db';
import { tapLight } from '@/haptics';
import { linkShowToMovie, linkShowToSeries } from '@/show-meta-fetch';
import { tmdb } from '@/tmdb';
import { tvdbSearchMovies } from '@/tvdb';
import { colors, radius, space } from '@/theme';

type Result = {
  id: number;
  /** which TMDB collection this row came from — decides how it's linked */
  media: 'tv' | 'movie';
  /** which database this row came from */
  source: 'tmdb' | 'tvdb';
  // movies
  title?: string;
  original_title?: string;
  release_date?: string;
  // shows
  name?: string;
  original_name?: string;
  first_air_date?: string;
  poster_path?: string;
  vote_count?: number;
  // TheTVDB rows carry a full image URL + year
  tvdbImage?: string | null;
  tvdbYear?: string | null;
};

/** Manual matching for movies and shows: search the database, pick the right
 * entry, done. The automatic matcher only accepts confident matches — this is
 * the human fallback for renamed, transliterated or obscure titles. */
export default function FixMatchScreen() {
  const { name, type, id } = useLocalSearchParams<{ name: string; type?: string; id?: string }>();
  const isShow = type === 'show';
  // strip a trailing "(YYYY)" disambiguator so the search isn't sabotaged by it
  // (no real title contains "(2021)"), e.g. "Avatar: The Last Airbender (2021)"
  const [query, setQuery] = useState((name ?? '').replace(/\s*\(\d{4}\)\s*$/, '').trim());
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState<number | null>(null);

  // typing fires overlapping requests, and they don't come back in order — a
  // slow "att" landing after "attack" would replace the right results with
  // stale ones. Only the newest search is allowed to write state.
  const seq = useRef(0);

  const search = async (q: string) => {
    if (!q.trim()) return;
    const mine = ++seq.current;
    setBusy(true);
    const term = encodeURIComponent(q.trim());
    const hit = (path: string) =>
      tmdb<{ results: Result[] }>(path).catch(() => ({ results: [] as Result[] }));
    try {
      if (!isShow) {
        // TMDB (the movie database) + TheTVDB in parallel, so you can pick from
        // either — TheTVDB rows are labelled and appear after TMDB's
        const [d, tv] = await Promise.all([hit(`/search/movie?query=${term}`), tvdbSearchMovies(q.trim())]);
        if (mine !== seq.current) return;
        setResults([
          ...(d.results ?? []).slice(0, 15).map((r) => ({ ...r, media: 'movie' as const, source: 'tmdb' as const })),
          ...tv.slice(0, 8).map((r) => ({
            id: r.tvdbId,
            media: 'movie' as const,
            source: 'tvdb' as const,
            title: r.name,
            tvdbImage: r.image,
            tvdbYear: r.year,
          })),
        ]);
        return;
      }
      // TV Time tracked TV movies as shows back when it was TV-only, so a show
      // entry may only exist in TMDB as a movie — searching series alone left
      // those permanently unmatchable. Series stay on top (the common case)
      // with movies listed after, each row labelled so the choice is obvious.
      const [tv, movie] = await Promise.all([
        hit(`/search/tv?query=${term}`),
        hit(`/search/movie?query=${term}`),
      ]);
      if (mine !== seq.current) return;
      setResults([
        ...(tv.results ?? []).slice(0, 12).map((r) => ({ ...r, media: 'tv' as const, source: 'tmdb' as const })),
        ...(movie.results ?? []).slice(0, 8).map((r) => ({ ...r, media: 'movie' as const, source: 'tmdb' as const })),
      ]);
    } catch {
      if (mine === seq.current) setResults([]);
    } finally {
      // a superseded search must not clear the spinner the newer one turned on
      if (mine === seq.current) setBusy(false);
    }
  };

  // search as you type. The first run — the title that failed to match — fires
  // immediately; later keystrokes wait for a pause so a word isn't one request
  // per letter.
  const firstRun = useRef(true);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      seq.current++; // cancel anything in flight
      setResults(null);
      setBusy(false);
      return;
    }
    if (firstRun.current) {
      firstRun.current = false;
      void search(q);
      return;
    }
    const t = setTimeout(() => void search(q), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const choose = async (r: Result) => {
    if (!name || linking != null) return;
    if (r.source === 'tvdb') {
      // TheTVDB pick (movies only for now): save its poster + year, no tmdbId
      setMovieMatchTvdb(name, r.tvdbImage ?? null, r.tvdbYear ?? null);
      tapLight();
      router.back();
      return;
    }
    if (isShow) {
      // fetch + cache full metadata under the show's TVDB id using the picked
      // TMDB entry; from then on the show behaves like any bundled one
      setLinking(r.id);
      try {
        // a movie pick can't go through /tv — it's stored as a one-episode
        // season instead, which is what a TV movie actually is
        const meta =
          r.media === 'movie' ? await linkShowToMovie(Number(id), r.id) : await linkShowToSeries(Number(id), r.id);
        if (meta?.poster) setShowPoster(Number(id), meta.poster);
      } finally {
        setLinking(null);
      }
    } else {
      setMovieMatch(
        name,
        r.id,
        r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
        yearOf(r) || null,
      );
    }
    tapLight();
    router.back();
  };

  // keyed off the ROW's own type, not the screen's — a show search can now
  // return movies, and those carry title/release_date instead of name/first_air
  const titleOf = (r: Result) =>
    (r.source === 'tvdb' ? r.title : r.media === 'tv' ? r.name || r.original_name : r.title || r.original_title) ?? '—';
  const originalOf = (r: Result) =>
    (r.source === 'tvdb' ? null : r.media === 'tv' ? r.original_name : r.original_title) ?? null;
  const yearOf = (r: Result) =>
    r.source === 'tvdb' ? (r.tvdbYear ?? '') : ((r.media === 'tv' ? r.first_air_date : r.release_date) || '').slice(0, 4);

  return (
    <Screen>
      <NavHeader title="Fix match" />
      <View style={{ paddingHorizontal: space.lg, gap: 12, flex: 1 }}>
        <Text style={styles.sub}>
          Pick the correct {isShow ? 'show or movie' : 'movie'} for “{name}” — its poster
          {isShow ? ', episode lists' : ', year'} and details attach to your watch history.
          {isShow ? ' TV movies live under Movie.' : ''}
        </Text>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={17} color={colors.dim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void search(query)}
            placeholder={isShow ? 'Search shows and movies' : 'Search the movie database'}
            placeholderTextColor={colors.faint}
            style={styles.input}
            returnKeyType="search"
            autoCorrect={false}
          />
        </View>
        {busy ? (
          <ActivityIndicator color={colors.yellow} style={{ marginTop: 30 }} />
        ) : (
          <FlatList
            data={results ?? []}
            // id alone collides: TMDB numbers series and movies separately, and
            // TheTVDB uses its own id space too
            keyExtractor={(r) => `${r.source}-${r.media}-${r.id}`}
            contentContainerStyle={{ paddingBottom: 30 }}
            ListEmptyComponent={
              results ? <Text style={styles.empty}>No results — try another spelling or the original title.</Text> : null
            }
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => void choose(item)}>
                {(() => {
                  const uri =
                    item.source === 'tvdb'
                      ? (item.tvdbImage ?? null)
                      : item.poster_path
                        ? `https://image.tmdb.org/t/p/w154${item.poster_path}`
                        : null;
                  return uri ? (
                    <Image source={{ uri }} style={styles.poster} contentFit="cover" cachePolicy="disk" />
                  ) : (
                    <View style={[styles.poster, styles.posterEmpty]}>
                      <Ionicons name={item.media === 'tv' ? 'tv-outline' : 'film-outline'} size={20} color={colors.faint} />
                    </View>
                  );
                })()}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rTitle} numberOfLines={2}>
                    {titleOf(item)}
                  </Text>
                  <Text style={styles.rSub} numberOfLines={1}>
                    {[
                      item.media === 'tv' ? 'Show' : 'Movie',
                      yearOf(item),
                      originalOf(item) !== titleOf(item) ? originalOf(item) : null,
                    ]
                      .filter(Boolean)
                      .join(' • ')}
                  </Text>
                  <Text style={[styles.source, item.source === 'tvdb' ? { color: colors.green } : { color: colors.dim }]}>
                    {item.source === 'tvdb' ? 'TheTVDB' : 'TMDB'}
                  </Text>
                </View>
                {linking === item.id ? (
                  <ActivityIndicator color={colors.yellow} size="small" />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.faint} />
                )}
              </Pressable>
            )}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { color: colors.dim, fontSize: 14, lineHeight: 20 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1B1B1E',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  empty: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 30 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  poster: { width: 46, height: 69, borderRadius: 6, backgroundColor: '#1B1B1E' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  rTitle: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  rSub: { color: colors.dim, fontSize: 13 },
  source: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 1 },
});
