import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { searchUsers, type UserSearchResult } from '@/community-profiles';
import { FollowChip, PersonRow } from '@/components/person-row';
import { Screen, TopTabs } from '@/components/ui';
import { clearSearchHistory, forgetSearch, getSearchHistory, rememberSearch } from '@/search-history';
import db, { addMovieToWatchlist, addShow, inLibrary, setMovieFavorite, setShowFavorited } from '@/db';
import { searchCatalog, tvdbIdFor, type CatalogItem } from '@/catalog';
import { useJoined } from '@/community-session';
import { tapLight } from '@/haptics';
import { alertNotOnTvdb } from '@/not-on-tvdb';
import { movieRoute, movieYear, type SearchHistoryEntry } from '@/pure';
import { colors, space } from '@/theme';
import { t } from '@/i18n';

const TABS = ['Shows & Movies', 'Users', 'Groups'] as const;
/*
 * WHAT A DEVICE THAT DECLINED THE COMMUNITY IS OFFERED.
 *
 * All three tabs were drawn for everybody, so a person who had said no to the
 * community was given a people search — and typing in it sent a query to our
 * server, which is exactly what the About screen promises never happens.
 * `searchUsers` now refuses at the boundary, but a tab that answers every
 * search with "nobody" is a worse bug than the one it replaced: it looks
 * broken, and it advertises a community to somebody who already declined it.
 *
 * So the tabs themselves are the offer, and the offer depends on the answer.
 */
const LOCAL_TABS = ['Shows & Movies'] as const;

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
  const [history, setHistory] = useState<SearchHistoryEntry[]>(getSearchHistory);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Shows & Movies');
  /* Drives which tabs exist at all — see LOCAL_TABS. Reactive rather than read
     once, so joining from another screen puts them there without a remount. */
  const joined = useJoined();
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
    // ONE ANSWER, from `inLibrary` in db.ts — see the note there for what four
    // disagreeing answers cost. This screen held its own copy of the rule: a
    // name compare for shows and the identity matcher for films.
    for (const r of results) {
      if (inLibrary({ kind: r.kind, name: r.name, tvdbId: r.tvdbId, tmdbId: r.tmdbId, year: r.year })) next.add(r.key);
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, libTick]);

  /** Which of the rows on screen are already favourited. Same tick, same read. */
  const favSet = useMemo(() => {
    const next = new Set<string>();
    if (!results.length) return next;
    const favShows = new Set(
      db.getAllSync<{ tvdbId: number }>('SELECT tvdbId FROM shows WHERE favorited = 1').map((r) => r.tvdbId),
    );
    const favMovies = new Set(
      db
        .getAllSync<{ name: string }>('SELECT name FROM movies WHERE favorited = 1')
        .map((r) => r.name.toLowerCase()),
    );
    for (const r of results) {
      const fav =
        r.kind === 'movie' ? favMovies.has(r.name.trim().toLowerCase()) : r.tvdbId != null && favShows.has(r.tvdbId);
      if (fav) next.add(r.key);
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
        const hits = await searchCatalog(q);
        if (seq.current !== mine) return;
        // Identity, not name: a remote result that merely SHARES a title with
        // something in the library is a different film and must survive. Keyed
        // on name+year so "Amado" (2011) is not swallowed by "Amado" (2022)
        // sitting in the library — that would drop it from the results
        // entirely and leave no way to add it at all.
        const localKey = (kind: string, name: string, year: string | null) =>
          `${kind}:${name.trim().toLowerCase()}:${movieYear(year) ?? ''}`;
        const localNames = new Set(local.map((r) => localKey(r.kind, r.name, r.year)));
        const remote: Result[] = hits
          .map((h) => {
            const kind = h.kind === 'tv' ? ('show' as const) : ('movie' as const);
            const name = h.title.trim();
            return {
              key: h.key,
              kind,
              name,
              poster: h.poster,
              year: (h.sub.match(/\b(\d{4})\b/) ?? [])[1] ?? null,
              tmdbId: h.tmdbId,
              tvdbId: h.tvdbId,
              inLibrary: localNames.has(localKey(kind, name, (h.sub.match(/\b(\d{4})\b/) ?? [])[1] ?? null)),
            };
          })
          .filter((r) => r.name && !localNames.has(localKey(r.kind, r.name, r.year)))
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

  // ── the Users tab ─────────────────────────────────────────────────────────
  //
  // AN EXACT-HANDLE LOOKUP, NOT A SEARCH, and the copy on screen says so. The
  // Worker publishes `/v1/profiles/:handle` and no query endpoint at all — no
  // prefix match, no display-name match, no directory (verified against every
  // route in `backend/src/index.ts`). Inventing a search URL would ship a tab
  // that 404s on every keystroke, so this asks the one question the server can
  // answer: is there somebody with exactly this handle?
  //
  // `searchUsers` never throws and validates the handle locally first, so a
  // half-typed or non-handle query costs no request. It returns zero or one
  // rows, which is why this is still a list.
  //
  // ONE PIECE OF STATE, holding the query it answers. Everything else on screen
  // — which rows to show, whether the spinner is up — is derived from comparing
  // that query with the live one, so there is no "clear the results" setState in
  // the effect body (a cascading render, and the rule `react-hooks/set-state-in-
  // effect` is about) and no window where yesterday's person is shown under
  // today's search box.
  const [users, setUsers] = useState<{ query: string; items: UserSearchResult[] }>({ query: '', items: [] });
  const userSeq = useRef(0);

  /** Keep the words only when nothing was opened from them — see `open`. */
  const rememberQuery = () => {
    const q = query.trim();
    if (q.length >= 2) setHistory(rememberSearch({ kind: 'query', label: q, value: q }));
  };

  const userQuery = tab === 'Users' ? query.trim() : '';
  const userResults = users.query === userQuery ? users.items : [];
  const usersLoading = userQuery !== '' && users.query !== userQuery;

  useEffect(() => {
    const q = tab === 'Users' ? query.trim() : '';
    if (!q) return;
    const mine = ++userSeq.current;
    // Same 350ms as the catalogue search above, for the same reason: one
    // request per pause, not one per keystroke.
    const timer = setTimeout(() => {
      void searchUsers(q).then((found) => {
        // Drop a response that arrives after a newer query.
        if (userSeq.current !== mine) return;
        setUsers({ query: q, items: found });
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, tab]);

  const open = async (item: Result) => {
    // The THING, not the query. Somebody who typed "sev" and opened Severance
    // wants Severance back; the letters were only how they got there.
    setHistory(
      rememberSearch({
        kind: item.kind === 'movie' ? 'movie' : 'show',
        label: item.name,
        value: item.kind === 'movie' ? item.name : String(item.tvdbId ?? item.name),
        poster: item.poster ?? null,
      }),
    );
    if (item.kind === 'movie') {
      // tmdbId is real identity — pass it whenever the result has one, not
      // only when no row exists yet. Title alone can't tell two different
      // films apart once they share a display name (see movie/[name].tsx).
      // poster + year ride along too: this row is often the ONLY place that
      // data exists (TheTVDB gives movies no tmdbId, so the detail screen has
      // nothing else to fetch it from) — dropping them here left the preview
      // blank even though the row we just tapped was showing both.
      router.push(movieRoute(item.name, { tmdbId: item.tmdbId, tvdbId: item.tvdbId, poster: item.poster, year: item.year }) as never);
      return;
    }
    if (item.tvdbId != null) {
      router.push(`/show/${item.tvdbId}`);
      return;
    }
    // TMDB-fallback result: resolve the TVDB id, open in preview — the show
    // page fetches its metadata on its own
    const tvdbId = await tvdbIdFor({ kind: 'tv', tvdbId: item.tvdbId, tmdbId: item.tmdbId } as CatalogItem);
    if (tvdbId) {
      router.push(`/show/${tvdbId}?tmdbId=${item.tmdbId}`);
      return;
    }
    alertNotOnTvdb(item.name);
  };



  /**
   * Favourite without leaving search.
   *
   * Requested on Reddit, and the reason it matters is the cap: a free profile
   * publishes twenty favourites in the owner's drag order, so choosing them is
   * a deliberate sitting-down job. Until now the only route was open the show,
   * find the menu, favourite, go back — twenty times. Search is how anybody
   * finds a specific title, so the heart belongs here.
   *
   * Library rows only. Favouriting something that is not yours yet would have
   * to add it first, and a heart that silently adds a show is a heart nobody
   * trusts.
   */
  const toggleFavourite = (item: Result) => {
    if (!libSet.has(item.key)) return;
    tapLight();
    if (item.kind === 'movie') setMovieFavorite(item.name, !favSet.has(item.key));
    else if (item.tvdbId != null) setShowFavorited(item.tvdbId, !favSet.has(item.key));
    setLibTick((t) => t + 1);
  };

  const add = async (item: Result) => {
    if (libSet.has(item.key)) return;
    if (item.kind === 'movie') {
      addMovieToWatchlist(item.name, item.poster, item.year, item.tmdbId, item.tvdbId);
      setLibTick((t) => t + 1); // re-derive → ✓ appears
      return;
    }
    try {
      // shows key on TVDB ids everywhere — a TheTVDB result already carries
      // one, so only a TMDB-fallback row costs a lookup
      const tvdbId = await tvdbIdFor({ kind: 'tv', tvdbId: item.tvdbId, tmdbId: item.tmdbId } as CatalogItem);
      if (tvdbId) {
        addShow(tvdbId, item.name, item.poster);
        setLibTick((t) => t + 1);
        return;
      }
      // TMDB knows this show but carries no TheTVDB id for it, so there is
      // nothing to key the library row on. Silence here read as a dead button.
      alertNotOnTvdb(item.name);
    } catch {
      // the lookup itself failed — a different problem, and a retry may work
      Alert.alert(t('search.addFailedTitle'), t('search.addFailedBody'), [{ text: t('common.ok') }]);
    }
  };

  return (
    <Screen>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          style={styles.input}
          placeholder={t('search.placeholder')}
          placeholderTextColor={colors.faint}
          value={query}
          onChangeText={setQuery}
          // A search somebody actually submitted is worth keeping even when it
          // found nothing to open — the words were the point then.
          onSubmitEditing={rememberQuery}
          returnKeyType="search"
          autoFocus
          autoCorrect={false}
        />
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.blue, fontSize: 16 }}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
      <TopTabs
        tabs={joined ? TABS : LOCAL_TABS}
        labels={{
          'Shows & Movies': t('search.tabs.showsMovies'),
          Users: t('search.tabs.users'),
          Groups: t('search.tabs.groups'),
        }}
        active={tab}
        onChange={setTab}
      />
      {/* RECENT, while the box is empty. A search screen opened with nothing
          typed is a person who came back for something they already found once;
          an empty screen makes them retype it. */}
      {query.trim() === '' && history.length > 0 ? (
        <FlatList
          data={history}
          keyExtractor={(h) => `${h.kind}:${h.value}`}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.recentHead}>
              <Text style={styles.recentTitle}>{t('search.recent')}</Text>
              <Pressable
                hitSlop={10}
                onPress={() => {
                  clearSearchHistory();
                  setHistory([]);
                }}>
                <Text style={{ color: colors.blue, fontSize: 14 }}>{t('search.clear')}</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                if (item.kind === 'query') {
                  setQuery(item.value);
                  return;
                }
                if (item.kind === 'profile') {
                  router.push(`/profile/${encodeURIComponent(item.value)}`);
                  return;
                }
                if (item.kind === 'movie') {
                  router.push(movieRoute(item.value) as never);
                  return;
                }
                router.push(`/show/${item.value}`);
              }}>
              {item.poster ? (
                <Image source={{ uri: item.poster }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons
                    name={
                      item.kind === 'query'
                        ? 'time-outline'
                        : item.kind === 'profile'
                          ? 'person-outline'
                          : item.kind === 'movie'
                            ? 'film-outline'
                            : 'tv-outline'
                    }
                    size={18}
                    color={colors.dim}
                  />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.label}
                </Text>
              </View>
              <Pressable
                hitSlop={10}
                onPress={() => setHistory(forgetSearch(item.kind, item.value))}>
                <Ionicons name="close" size={16} color={colors.faint} />
              </Pressable>
            </Pressable>
          )}
        />
      ) : tab === 'Shows & Movies' ? (
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
                    {item.kind === 'show' ? t('search.kindSeries') : t('search.kindMovie')}
                    {item.year ? ` · ${item.year}` : ''}
                  </Text>
                </View>
                {inLib ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <Pressable hitSlop={10} onPress={() => toggleFavourite(item)}>
                      <Ionicons
                        name={favSet.has(item.key) ? 'heart' : 'heart-outline'}
                        size={24}
                        color={favSet.has(item.key) ? colors.yellow : colors.dim}
                      />
                    </Pressable>
                    <Ionicons name="checkmark-circle" size={26} color={colors.yellow} />
                  </View>
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
              <Text style={styles.note}>{query ? t('search.noMatches') : t('search.emptyHint')}</Text>
            ) : null
          }
        />
      ) : tab === 'Users' ? (
        <FlatList
          data={userResults}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PersonRow
              person={item}
              // The Users tab is where somebody goes to find a person they
              // already have in mind. Making them open the profile to act on
              // finding them is a step with nothing in it.
              // `GET /v1/users` carries `is_private`, so the chip can say
              // Request from the first frame rather than correcting itself.
              right={<FollowChip id={item.id} isPrivate={item.is_private} />}
              onPress={() => {
                setHistory(
                  rememberSearch({ kind: 'profile', label: `@${item.handle}`, value: item.handle }),
                );
                router.push(`/profile/${encodeURIComponent(item.handle)}`);
              }}
            />
          )}
          ListFooterComponent={
            usersLoading ? <ActivityIndicator color={colors.yellow} style={{ margin: 18 }} /> : null
          }
          ListEmptyComponent={
            !usersLoading ? (
              <Text style={styles.note}>
                {userQuery ? t('search.users.noMatch') : t('search.users.hint')}
              </Text>
            ) : null
          }
        />
      ) : (
        <Text style={styles.note}>
          {t('search.comingSoon', { tab: t('search.tabs.groups') })}
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: 14,
    paddingBottom: 6,
  },
  recentTitle: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
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
