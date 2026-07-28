import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureType } from 'react-native-gesture-handler';
import { GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { useSwipeDown } from '@/components/swipe-down';
import { CheckCircle, ContentColumn, TopTabs } from '@/components/ui';
import {
  addMovieToWatchlist,
  deleteMovie,
  getMovie,
  getMovieEmotions,
  setMovieFavorite,
  setMoviePoster,
  setMovieStars,
  setMovieWatched,
  setMovieWatchedOn,
  toggleMovieEmotion,
} from '@/db';
import { movieMeta, runtimeLabel, type MovieMeta } from '@/movie-metadata';
import { tmdb } from '@/tmdb';
import { colors, radius, space } from '@/theme';

const TABS = ['About', 'More'] as const;
const STARS = ['BAD', 'OK', 'GOOD', 'SUPER', 'WOW'] as const;

const WATCH_TILES = [
  { name: 'Theater', icon: 'ticket' as const, tint: colors.yellow },
  { name: 'Other', icon: 'ellipsis-horizontal-circle-outline' as const, tint: colors.text },
  { name: 'Unofficial', icon: 'skull-outline' as const, tint: '#E4364C' },
];
const INTERESTS = ['The cast', 'The premise', 'The creators', 'The studio', 'The franchise or universe', 'Other'] as const;
const IMG = 'https://image.tmdb.org/t/p';

// the full 12-emotion set — indexes line up with the imported vote ids
const EMOTIONS = [
  { face: '😯', label: 'Shocked' },
  { face: '😤', label: 'Frustrated' },
  { face: '😭', label: 'Sad' },
  { face: '🤔', label: 'Reflective' },
  { face: '🥹', label: 'Touched' },
  { face: '😆', label: 'Amused' },
  { face: '😱', label: 'Scared' },
  { face: '😑', label: 'Bored' },
  { face: '😌', label: 'Understood' },
  { face: '🤩', label: 'Thrilled' },
  { face: '🙃', label: 'Confused' },
  { face: '😬', label: 'Tense' },
] as const;

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function countLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type RemoteMeta = MovieMeta & { poster: string | null };

export default function MovieScreen() {
  const insets = useSafeAreaInsets();
  const { name, tmdbId: tmdbIdParam } = useLocalSearchParams<{ name: string; tmdbId?: string }>();
  // re-read the db row on focus — Fix match updates it behind this screen
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useFocusEffect(
    useCallback(() => {
      refresh();
      // the Mark as… sheet may have un-watched or rewatched this movie
      const fresh = name ? getMovie(name) : null;
      if (fresh) {
        setWatched(fresh.watchedAt != null);
        setWatchedAt(fresh.watchedAt);
        setRewatches(fresh.rewatchCount ?? 0);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name]),
  );
  // the database is the source of truth — every change below persists to it
  const dbMovie = name ? getMovie(name) : null;
  const title = dbMovie?.name ?? name ?? 'Movie';
  const tmdbId = dbMovie?.tmdbId ?? (tmdbIdParam ? Number(tmdbIdParam) : null);

  // bundled metadata for library movies; untracked ones fetch live (preview)
  const bundled = movieMeta(tmdbId);
  const [remote, setRemote] = useState<RemoteMeta | null>(null);
  const [trailer, setTrailer] = useState<string | null>(null);
  const mm: MovieMeta | RemoteMeta | undefined = bundled ?? remote ?? undefined;

  useEffect(() => {
    if (!tmdbId) return;
    if (!bundled) {
      tmdb<{
        runtime?: number;
        genres?: { name: string }[];
        release_date?: string;
        overview?: string;
        vote_average?: number;
        vote_count?: number;
        backdrop_path?: string;
        poster_path?: string;
        credits?: { cast?: { name?: string; character?: string; profile_path?: string }[] };
      }>(`/movie/${tmdbId}?append_to_response=credits`)
        .then((d) =>
          setRemote({
            runtime: d.runtime ?? null,
            genres: (d.genres ?? []).map((g) => g.name).slice(0, 4),
            release: d.release_date ?? null,
            overview: d.overview ?? null,
            rating: Math.round((d.vote_average ?? 0) * 10) / 10,
            votes: d.vote_count ?? 0,
            backdrop: d.backdrop_path ? `${IMG}/w780${d.backdrop_path}` : null,
            poster: d.poster_path ? `${IMG}/w342${d.poster_path}` : null,
            cast: (d.credits?.cast ?? []).slice(0, 8).map((c) => ({
              name: c.name ?? null,
              character: c.character ?? null,
              photo: c.profile_path ? `${IMG}/w185${c.profile_path}` : null,
            })),
            providers: [],
          }),
        )
        .catch(() => {});
    }
    tmdb<{ results?: { site?: string; type?: string; key?: string; official?: boolean }[] }>(`/movie/${tmdbId}/videos`)
      .then((v) => {
        const vids = (v.results ?? []).filter((x) => x.site === 'YouTube' && x.key);
        const pick = vids.find((x) => x.type === 'Trailer' && x.official) ?? vids.find((x) => x.type === 'Trailer') ?? vids[0];
        if (pick?.key) setTrailer(pick.key);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  // Fallback for movies TMDB can't match (no tmdbId, no poster): find it on
  // TheTVDB by name and fill in the poster + runtime so it stops showing blank.
  useEffect(() => {
    if (tmdbId || !dbMovie || dbMovie.poster) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tvdbFindMovie } = require('@/tvdb') as typeof import('@/tvdb');
      const hit = await tvdbFindMovie(dbMovie.name, dbMovie.year);
      if (cancelled || !hit?.image || hit.image.includes('/images/missing/')) return;
      // runtime from TheTVDB is minutes; this column stores seconds
      setMoviePoster(dbMovie.name, hit.image, hit.runtime != null ? hit.runtime * 60 : null);
      refresh(); // re-reads dbMovie → poster now shows in the banner and grids
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId, dbMovie?.name, dbMovie?.poster]);

  const { gesture, headerGesture, animatedStyle, onScroll, setAtTop } = useSwipeDown();
  const panRef = useRef<GestureType | undefined>(undefined);
  const pan = useMemo(() => gesture.withRef(panRef), [gesture]);

  const [inDb, setInDb] = useState(dbMovie != null);
  // watched movies open straight on More (your votes); unwatched on About
  const [tab, setTab] = useState<(typeof TABS)[number]>(dbMovie?.watchedAt != null ? 'More' : 'About');
  const [watched, setWatched] = useState(dbMovie?.watchedAt != null);
  const [watchedAt, setWatchedAt] = useState<string | null>(dbMovie?.watchedAt ?? null);
  const [rewatches, setRewatches] = useState<number>(dbMovie?.rewatchCount ?? 0);
  const [stars, setStars] = useState<number | null>(dbMovie?.stars != null ? dbMovie.stars - 1 : null);
  const [emotions, setEmotions] = useState<Set<number>>(new Set(dbMovie ? getMovieEmotions(dbMovie.name) : []));
  const [interest, setInterest] = useState<number | null>(null);
  const [menu, setMenu] = useState<SheetAction[] | null>(null);

  // the ⋯ menu — TV Time-style bottom sheet, matching the show screen
  const openMenu = () => {
    if (!dbMovie) return;
    const favorited = !!dbMovie.favorited;
    const actions: SheetAction[] = [
      {
        icon: favorited ? 'heart-dislike-outline' : 'heart-outline',
        text: favorited ? 'Remove from favorites' : 'Add to favorites',
        onPress: () => {
          setMovieFavorite(dbMovie.name, !favorited);
          refresh();
        },
      },
      {
        icon: 'list-outline',
        text: 'Add to list',
        onPress: () => router.push(`/add-to-list?type=movie&name=${encodeURIComponent(dbMovie.name)}`),
      },
      {
        icon: 'share-outline',
        text: 'Share',
        onPress: () => router.push(`/share-card?type=movie&name=${encodeURIComponent(dbMovie.name)}`),
      },
      {
        icon: 'trash-outline',
        text: 'Remove from library…',
        destructive: true,
        onPress: () =>
          Alert.alert(
            `Remove ${title}?`,
            'This deletes the movie and its ratings from this device. Re-importing your export will NOT bring it back.',
            [
              { text: 'Remove', style: 'destructive', onPress: () => { deleteMovie(dbMovie.name); router.back(); } },
              { text: 'Cancel', style: 'cancel' },
            ],
          ),
      },
    ];
    setMenu(actions);
  };
  const [watchedOn, setWatchedOn] = useState<number | null>(() => {
    const i = WATCH_TILES.findIndex((t) => t.name === dbMovie?.watchedOn);
    return i >= 0 ? i : null;
  });

  const ensureInDb = () => {
    if (inDb) return;
    addMovieToWatchlist(title, (remote?.poster ?? null) as string | null, (mm?.release ?? '').slice(0, 4) || null, tmdbId);
    setInDb(true);
  };
  const addToWatchlist = () => {
    ensureInDb();
  };

  const markWatchedNow = () => {
    ensureInDb();
    setWatched(true);
    setWatchedAt(new Date().toISOString());
    try {
      setMovieWatched(title, true);
    } catch {}
  };
  const toggleWatched = () => {
    if (!watched) {
      markWatchedNow();
      return;
    }
    // same as episodes: the check on a watched movie opens Mark as…
    router.push(`/mark-as?movie=${encodeURIComponent(title)}`);
  };

  // votes require the movie to be watched first, like the real app
  const requireWatched = (apply: () => void) => {
    if (watched) {
      apply();
      return;
    }
    Alert.alert('Watched this movie?', 'To log your vote, the movie needs to be marked as watched.', [
      {
        text: 'Mark as watched',
        onPress: () => {
          markWatchedNow();
          apply();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const rate = (i: number) =>
    requireWatched(() => {
      setStars(i);
      try {
        setMovieStars(title, i + 1);
      } catch {}
    });
  const feel = (i: number) =>
    requireWatched(() => {
      setEmotions((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
      try {
        toggleMovieEmotion(title, i);
      } catch {}
    });

  const goComments = () => router.push(`/comments?title=${encodeURIComponent(title)}`);
  const openComments = () => {
    if (watched) {
      goComments();
      return;
    }
    Alert.alert('Spoilers ahead!', "You haven't watched this movie. Are you sure you want to read the comments?", [
      { text: 'Display anyway', onPress: goComments },
      {
        text: "I've watched this movie",
        onPress: () => {
          markWatchedNow();
          goComments();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const rating5 = mm?.rating ? mm.rating / 2 : null;
  const filled = rating5 ? Math.round(rating5) : 0;


  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1, backgroundColor: colors.bg }, animatedStyle]}>
        {/* banner: backdrop with title + runtime · genres overlaid, like the real app */}
        <GestureDetector gesture={headerGesture}>
          <View style={[styles.backdrop, { height: insets.top + 230 }]}>
            {(mm?.backdrop ?? dbMovie?.poster) && (
              <>
                <Image
                  source={{ uri: mm?.backdrop ?? dbMovie?.poster ?? undefined }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="disk"
                />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.30)' }]} />
              </>
            )}
            <View style={[styles.backdropBar, { marginTop: insets.top + 4 }]}>
              <Pressable onPress={() => router.back()} hitSlop={10}>
                <Ionicons name="chevron-down" size={26} color={colors.text} />
              </Pressable>
              <Pressable hitSlop={10} onPress={openMenu}>
                <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.backdropMeta}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
                <Text style={styles.subtitle}>
                  {[runtimeLabel(mm?.runtime), mm?.genres?.join(', ')].filter(Boolean).join(' • ') || 'Movie'}
                </Text>
              </View>
              {/* always rendered so favoriting never reflows/squeezes the title */}
              <View style={[styles.favBadge, !dbMovie?.favorited && { opacity: 0 }]}>
                <Ionicons name="heart" size={20} color="#fff" />
              </View>
            </View>
          </View>
        </GestureDetector>

        {/* release date · watch state · check */}
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={16} color={colors.dim} />
          <Text style={styles.metaText}>{mm?.release ? shortDate(mm.release) : (dbMovie?.year ?? '—')}</Text>
          <Ionicons name="eye-outline" size={17} color={colors.dim} style={{ marginLeft: 10 }} />
          <Text style={styles.metaText}>{watchedAt ? shortDate(watchedAt) : 'Not watched'}</Text>
          {rewatches > 0 && <Text style={[styles.metaText, { color: colors.yellow }]}>{`↻ ×${rewatches}`}</Text>}
          <View style={{ marginLeft: 'auto' }}>
            <CheckCircle watched={watched} onPress={toggleWatched} size={42} />
          </View>
        </View>

        {inDb && !tmdbId && (
          <Pressable
            style={styles.fixMatch}
            onPress={() => router.push(`/fix-match?name=${encodeURIComponent(name ?? title)}`)}>
            <Ionicons name={dbMovie?.poster ? 'checkmark-circle-outline' : 'link-outline'} size={20} color={colors.onYellow} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.fixMatchTitle}>
                {dbMovie?.poster ? 'Matched via TheTVDB' : 'Not matched to the movie database'}
              </Text>
              <Text style={styles.fixMatchSub}>
                {dbMovie?.poster
                  ? 'Match it to the movie database for a more reliable source.'
                  : 'Pick the right movie to add its poster, year and details.'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onYellow} />
          </Pressable>
        )}

        <TopTabs
          tabs={TABS}
          active={tab}
          onChange={(t) => {
            setTab(t);
            setAtTop(true);
          }}
        />

        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ paddingBottom: (tab === 'More' ? 96 : 30) + (inDb ? 0 : 80), paddingTop: 12 }}
            simultaneousHandlers={panRef}
            onScroll={onScroll}
            onScrollEndDrag={onScroll}
            onMomentumScrollEnd={onScroll}
            scrollEventThrottle={32}
            bounces={false}>
            <ContentColumn>
            {tab === 'About' ? (
              <>
                <View style={styles.rowBetween}>
                  <Text style={styles.h2}>Where to watch</Text>
                  <Ionicons name="settings-outline" size={18} color={colors.dim} />
                </View>
                <Text style={[styles.body, { paddingHorizontal: space.lg, marginTop: 2 }]}>
                  {mm?.providers?.length ? mm.providers.map((p) => p.name).join(' · ') : 'Not available'}
                </Text>

                {/* the interests poll only shows for movies in your library */}
                {inDb && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.pollLabel}>WHAT INTERESTS YOU MOST ABOUT THIS MOVIE?</Text>
                    {INTERESTS.map((label, i) => (
                      <Pressable
                        key={label}
                        style={[styles.interestBtn, interest === i && { backgroundColor: colors.yellow }]}
                        onPress={() => setInterest(interest === i ? null : i)}>
                        <Text style={[styles.interestText, interest === i && { color: colors.onYellow }]}>
                          {label.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </>
                )}

                <View style={styles.divider} />
                <Text style={[styles.h2, { paddingHorizontal: space.lg }]}>Movie info</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, marginTop: 8 }}>
                  <View style={styles.tBadge}>
                    <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 13 }}>T</Text>
                  </View>
                  <Text style={{ color: colors.yellow, letterSpacing: 2 }}>
                    {'★'.repeat(filled)}
                    {'☆'.repeat(5 - filled)}
                  </Text>
                  <Text style={styles.caption2}>{rating5 ? `${rating5.toFixed(1)}/5` : '—/5'}</Text>
                  {mm?.votes ? <Text style={styles.caption2}> {countLabel(mm.votes)} ratings</Text> : null}
                </View>
                <Text style={[styles.body, { paddingHorizontal: space.lg, marginTop: 10 }]}>
                  {mm?.overview ?? 'No synopsis available.'}
                </Text>

                {trailer && (
                  <>
                    <View style={styles.divider} />
                    <Pressable
                      style={styles.trailerRow}
                      onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${trailer}`)}>
                      <View style={styles.trailerThumb}>
                        <Image
                          source={{ uri: `https://img.youtube.com/vi/${trailer}/hqdefault.jpg` }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          cachePolicy="disk"
                        />
                        <View style={styles.trailerPlay}>
                          <Ionicons name="play" size={16} color="#FFF" style={{ marginLeft: 2 }} />
                        </View>
                      </View>
                      <View>
                        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Watch trailer</Text>
                        <Text style={styles.caption2}>YouTube</Text>
                      </View>
                    </Pressable>
                  </>
                )}

                {!!mm?.cast?.length && (
                  <>
                    <View style={styles.divider} />
                    <Text style={[styles.h2, { paddingHorizontal: space.lg, marginBottom: 12 }]}>Cast</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: space.lg }}>
                      {mm.cast.map((c, i) => (
                        <View key={`${c.name}-${i}`} style={{ width: 96 }}>
                          <View style={styles.charCard}>
                            {c.photo ? (
                              <Image source={{ uri: c.photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                            ) : (
                              <Ionicons name="person" size={30} color="#B9B9C0" />
                            )}
                          </View>
                          <Text style={styles.castName} numberOfLines={1}>
                            {c.name ?? ''}
                          </Text>
                          <Text style={styles.charName} numberOfLines={1}>
                            {(c.character ?? '').toUpperCase()}
                          </Text>
                        </View>
                      ))}
                    </ScrollView>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.pollLabel}>WHERE DID YOU WATCH?</Text>
                <View style={styles.provRow}>
                  {WATCH_TILES.map((t, i) => (
                    <Pressable
                      key={t.name}
                      style={{ alignItems: 'center', width: 82 }}
                      onPress={() =>
                        requireWatched(() => {
                          const next = watchedOn === i ? null : i;
                          setWatchedOn(next);
                          try {
                            setMovieWatchedOn(title, next == null ? null : WATCH_TILES[next].name);
                          } catch {}
                        })
                      }>
                      <View style={[styles.provTile, watchedOn === i && { borderWidth: 1.5, borderColor: colors.yellow }]}>
                        <Ionicons name={t.icon} size={30} color={t.tint} />
                      </View>
                      <Text style={styles.provLabel}>{t.name.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.divider} />
                <Text style={styles.pollLabel}>RATE THIS MOVIE</Text>
                <View style={styles.rateBox}>
                  {STARS.map((lbl, i) => (
                    <Pressable key={lbl} style={{ alignItems: 'center', gap: 4 }} onPress={() => rate(i)}>
                      <Text style={{ fontSize: 30, color: stars != null && i <= stars ? colors.yellow : '#9A9A9F' }}>★</Text>
                      <Text style={styles.starLabel}>{lbl}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.divider} />
                <Text style={styles.pollLabel}>HOW DID YOU FEEL?</Text>
                <View style={styles.emoGrid}>
                  {EMOTIONS.map((e, i) => (
                    <Pressable
                      key={e.label}
                      style={[styles.emo, emotions.has(i) && { backgroundColor: colors.yellow }]}
                      onPress={() => feel(i)}>
                      <Text style={{ fontSize: 24 }}>{e.face}</Text>
                      <Text style={[styles.emoLabel, emotions.has(i) && { color: colors.onYellow }]}>{e.label}</Text>
                    </Pressable>
                  ))}
                </View>

                {!!mm?.cast?.length && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.pollLabel}>WHO WAS YOUR FAVORITE?</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: space.lg }}>
                      {mm.cast.map((c, i) => (
                        <View key={`${c.name}-${i}`} style={{ width: 96, alignItems: 'center' }}>
                          <View style={styles.charCard}>
                            {c.photo ? (
                              <Image source={{ uri: c.photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                            ) : (
                              <Ionicons name="person" size={30} color="#B9B9C0" />
                            )}
                          </View>
                          <Text style={styles.charName} numberOfLines={1}>
                            {(c.character ?? c.name ?? '').toUpperCase()}
                          </Text>
                        </View>
                      ))}
                    </ScrollView>
                  </>
                )}
              </>
            )}
            </ContentColumn>
          </ScrollView>

          {/* comments float over More, spoiler-guarded while unwatched */}
          {tab === 'More' && inDb && (
            <Pressable style={styles.commentsPill} onPress={openComments}>
              <Text style={styles.commentsText}>COMMENTS</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFF" />
            </Pressable>
          )}

          {/* untracked movies get the full-width add bar, like the real app */}
          {!inDb && (
            <Pressable style={[styles.addBar, { paddingBottom: insets.bottom + 14 }]} onPress={addToWatchlist}>
              <Ionicons name="add" size={24} color={colors.onYellow} />
              <Text style={styles.addBarText}>ADD MOVIE</Text>
            </Pressable>
          )}
        </View>
        <ActionSheet visible={menu != null} title={title} actions={menu ?? []} onClose={() => setMenu(null)} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fixMatch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.yellow,
    borderRadius: radius.card,
    marginHorizontal: space.lg,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fixMatchTitle: { color: colors.onYellow, fontSize: 14.5, fontWeight: '800' },
  fixMatchSub: { color: colors.onYellow, fontSize: 12.5, opacity: 0.75 },
  backdrop: { backgroundColor: '#3A2E50', justifyContent: 'space-between' },
  backdropBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  backdropMeta: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: space.lg, paddingBottom: 14 },
  favBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#E3E3E8', fontSize: 14.5, marginTop: 4 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.lg,
    paddingVertical: 11,
  },
  metaText: { color: '#C9C9CF', fontSize: 14 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: 8,
  },
  h2: { color: colors.text, fontSize: 20, fontWeight: '800' },
  body: { color: '#E3E3E8', fontSize: 14.5, lineHeight: 20 },
  caption2: { color: colors.dim, fontSize: 13.5 },
  divider: { height: 1, backgroundColor: '#3A3A40', marginVertical: 16 },
  pollLabel: {
    color: '#C8C8CD',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 13,
  },
  interestBtn: {
    backgroundColor: '#1C1C1F',
    borderRadius: 8,
    marginHorizontal: space.lg,
    marginBottom: 9,
    paddingVertical: 13,
    alignItems: 'center',
  },
  interestText: { color: colors.text, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.7 },
  tBadge: { backgroundColor: colors.yellow, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 1 },
  provRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  provTile: {
    width: 82,
    height: 62,
    borderRadius: 8,
    backgroundColor: '#232325',
    alignItems: 'center',
    justifyContent: 'center',
  },
  provLabel: {
    color: colors.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 7,
  },
  rateBox: {
    backgroundColor: '#242427',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '78%',
    alignSelf: 'center',
  },
  starLabel: { color: '#D5D5DA', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 },
  emoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  emo: {
    width: '22%',
    backgroundColor: '#1F1F21',
    borderRadius: radius.card,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  emoLabel: { color: colors.dim, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  charCard: {
    width: 96,
    height: 110,
    borderRadius: 6,
    backgroundColor: '#232326',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  castName: { color: colors.text, fontSize: 12.5, marginTop: 6 },
  charName: { color: colors.dim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, marginTop: 3 },
  trailerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.lg },
  trailerThumb: {
    width: 118,
    height: 66,
    borderRadius: 8,
    backgroundColor: '#232326',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailerPlay: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#FFF',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentsPill: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  commentsText: { color: '#FFF', fontSize: 13.5, fontWeight: '700', letterSpacing: 1 },
  addBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 18,
  },
  addBarText: { color: colors.onYellow, fontSize: 16, fontWeight: '900', letterSpacing: 1.5 },
});
