import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, I18nManager, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { ensureShowTracked, remapShowId, setMovieMatch, setMovieMatchTvdb, setShowName, setShowPoster } from '@/db';
import { tapLight } from '@/haptics';
import { restoreWatchesFromExport } from '@/importer';
import { linkShowToMovie, linkShowToSeries } from '@/show-meta-fetch';
import { tmdb } from '@/tmdb';
import { tvdbSearchMovies } from '@/tvdb';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

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
  // for a SHOW fix, results are split into Shows / Movies and default to Shows,
  // so a normal show can't be matched to a movie by accident. Movies is a
  // deliberate second tab for the rare TV-movie that TV Time tracked as a show.
  const [kind, setKind] = useState<'tv' | 'movie'>('tv');

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
        // TheTVDB + TMDB in parallel. A movie only reaches Fix match because the
        // TMDB auto-match already failed, and TV Time is TheTVDB-native — so show
        // TheTVDB matches FIRST, with TMDB (the movie database) listed after.
        const [d, tv] = await Promise.all([hit(`/search/movie?query=${term}`), tvdbSearchMovies(q.trim())]);
        if (mine !== seq.current) return;
        setResults([
          ...tv.slice(0, 8).map((r) => ({
            id: r.tvdbId,
            media: 'movie' as const,
            source: 'tvdb' as const,
            title: r.name,
            tvdbImage: r.image,
            tvdbYear: r.year,
          })),
          ...(d.results ?? []).slice(0, 15).map((r) => ({ ...r, media: 'movie' as const, source: 'tmdb' as const })),
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
    if (linking != null) return;
    if (!name) {
      Alert.alert(t('fixMatch.title'), t('fixMatch.noTitleAlertBody'));
      return;
    }
    try {
      await applyMatch(r);
    } catch (e) {
      // surface any failure instead of the tap silently doing nothing
      setLinking(null);
      Alert.alert(t('fixMatch.applyFailedTitle'), e instanceof Error ? e.message : String(e));
    }
  };

  const applyMatch = async (r: Result) => {
    if (r.source === 'tvdb') {
      // TheTVDB pick (movies only for now): save its poster + year, no tmdbId
      setMovieMatchTvdb(name, r.tvdbImage ?? null, r.tvdbYear ?? null);
      tapLight();
      router.back();
      return;
    }
    if (isShow) {
      setLinking(r.id);
      let canonical = Number(id);
      try {
        // TV Time may have exported this show under a now-deprecated TVDB id.
        // The picked TMDB entry knows the CURRENT one — re-key the library row
        // onto it so search/Explore (which use the current id) recognise the
        // show instead of offering "Add show" and spawning a duplicate. This is
        // one quick request (or none), so it's fine to await before opening.
        if (r.media === 'tv') {
          const ext = await tmdb<{ tvdb_id?: number }>(`/tv/${r.id}/external_ids`).catch(() => null);
          if (ext?.tvdb_id && ext.tvdb_id !== canonical) canonical = remapShowId(canonical, ext.tvdb_id);
        }
        // a TV movie is a one-episode season (/movie); a series pulls its
        // seasons. Both are now abort-guarded end to end, so we await the match
        // — that way the caller (import "Needs attention", the show page) sees
        // the result the moment we return instead of a still-empty entry.
        const meta =
          r.media === 'movie' ? await linkShowToMovie(canonical, r.id) : await linkShowToSeries(canonical, r.id);
        // a "needs attention" entry may have no shows row at all — caching
        // metadata isn't enough to make it tracked. Guarantee the library row
        // exists (and is followed) so it appears in the profile and search
        // recognises it instead of offering "Add show".
        ensureShowTracked(canonical, meta?.name ?? name, meta?.poster ?? null);
        if (meta?.poster) setShowPoster(canonical, meta.poster);
        if (meta?.name) setShowName(canonical, meta.name);
        // the watches for this show may live in the export under the matched id
        // (or the old one) but never made it into the library — pull them from
        // the preserved export now, so "mark my history" actually happens
        restoreWatchesFromExport([canonical, Number(id)]);
      } finally {
        setLinking(null);
      }
      tapLight();
      // return to wherever this was launched from (the import "Needs attention"
      // list, the show page). If we re-keyed, the row now lives under the new id
      // and a showRemap breadcrumb points the old id at it, so both the summary's
      // "fixed" check and any stale /show/<oldId> link resolve correctly.
      router.back();
      return;
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
      <NavHeader title={t('fixMatch.title')} />
      <View style={{ paddingHorizontal: space.lg, gap: 12, flex: 1 }}>
        <Text style={styles.sub}>
          {isShow ? t('fixMatch.subShow', { name: name ?? '' }) : t('fixMatch.subMovie', { name: name ?? '' })}
        </Text>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={17} color={colors.dim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void search(query)}
            placeholder={isShow ? t('fixMatch.searchPlaceholderShow') : t('fixMatch.searchPlaceholderMovie')}
            placeholderTextColor={colors.faint}
            style={styles.input}
            returnKeyType="search"
            autoCorrect={false}
          />
        </View>
        {isShow && (results?.length ?? 0) > 0 && (
          <View style={styles.seg}>
            {(['tv', 'movie'] as const).map((k) => {
              const n = (results ?? []).filter((r) => r.media === k).length;
              const on = kind === k;
              return (
                <Pressable key={k} style={[styles.segTab, on && styles.segTabOn]} onPress={() => setKind(k)}>
                  <Text style={[styles.segText, on && styles.segTextOn]}>
                    {k === 'tv' ? t('fixMatch.tabShows') : t('fixMatch.tabMovies')}
                    {n > 0 ? ` ${n}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {busy ? (
          <ActivityIndicator color={colors.yellow} style={{ marginTop: 30 }} />
        ) : (
          <FlatList
            data={isShow ? (results ?? []).filter((r) => r.media === kind) : (results ?? [])}
            // id alone collides: TMDB numbers series and movies separately, and
            // TheTVDB uses its own id space too
            keyExtractor={(r) => `${r.source}-${r.media}-${r.id}`}
            contentContainerStyle={{ paddingBottom: 30 }}
            ListEmptyComponent={
              results ? (
                <Text style={styles.empty}>
                  {isShow && kind === 'movie'
                    ? t('fixMatch.emptyNoTvMovies')
                    : isShow && kind === 'tv' && results.length > 0
                      ? t('fixMatch.emptyNoShowMatches')
                      : t('fixMatch.emptyNoResults')}
                </Text>
              ) : null
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
                      item.media === 'tv' ? t('fixMatch.kindShow') : t('fixMatch.kindMovie'),
                      yearOf(item),
                      originalOf(item) !== titleOf(item) ? originalOf(item) : null,
                    ]
                      .filter(Boolean)
                      .join(' • ')}
                  </Text>
                  <Text style={[styles.source, item.source === 'tvdb' ? { color: colors.green } : { color: colors.dim }]}>
                    {item.source === 'tvdb' ? t('fixMatch.sourceTvdb') : t('fixMatch.sourceTmdb')}
                  </Text>
                </View>
                {linking === item.id ? (
                  <ActivityIndicator color={colors.yellow} size="small" />
                ) : (
                  <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.faint} />
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
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 3,
    gap: 3,
  },
  segTab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.card - 3 },
  segTabOn: { backgroundColor: colors.card },
  segText: { color: colors.dim, fontSize: 13.5, fontWeight: '700' },
  segTextOn: { color: colors.text },
  empty: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 30 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  poster: { width: 46, height: 69, borderRadius: 6, backgroundColor: colors.card },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  rTitle: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  rSub: { color: colors.dim, fontSize: 13 },
  source: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 1 },
});
