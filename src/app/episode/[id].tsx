import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { MutableRefObject } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureType } from 'react-native-gesture-handler';
import { FlatList, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { useSwipeDown } from '@/components/swipe-down';
import { CheckCircle } from '@/components/ui';
import seed from '@/seed';
import db, { getCharacterVote, getEpisodeVote, getEpisodeWatchedOn, getRewatchCount, getRewatchDates, getSeasonEpisodes, getWatch, setCharacterVote, setEpisodeRating, setEpisodeWatchedOn, toggleEpisodeEmotion } from '@/db';
import { markWatchedWithPrompt } from '@/mark';
import { absoluteEpisode, episodeMeta, seasonTotal, showMeta } from '@/metadata';
import { colors, radius, space } from '@/theme';

const W = Dimensions.get('window').width;
const STARS = ['BAD', 'OK', 'GOOD', 'SUPER', 'WOW'] as const;

// TV Time's full 12-emotion set, 3 rows of 4
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

// only these two fields are ever used — both the library db and the bundled
// seed satisfy the shape, so imported/added shows work like bundled ones
type Show = { tvdbId: number; name: string };

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EpisodePage({
  show,
  season,
  ep,
  onScroll,
  simRef,
}: {
  show?: Show;
  season: number;
  ep: number;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  simRef: MutableRefObject<GestureType | undefined>;
}) {
  // real watch state from the database — toggling writes back to it
  const existing = show ? getWatch(show.tvdbId, season, ep) : null;
  const vote = show ? getEpisodeVote(show.tvdbId, season, ep) : { stars: null, emotions: [] };
  const [watched, setWatched] = useState(existing != null);
  const [watchedAt, setWatchedAt] = useState<string | null>(existing?.watchedAt ?? null);
  // your saved votes from the import pre-fill the page; taps persist to the db
  const [stars, setStars] = useState<number | null>(vote.stars != null ? vote.stars - 1 : null);
  const [emotions, setEmotions] = useState<Set<number>>(new Set(vote.emotions));
  const [watchedOn, setWatchedOn] = useState<string | null>(show ? getEpisodeWatchedOn(show.tvdbId, season, ep) : null);
  const [rewatches, setRewatches] = useState(show ? getRewatchCount(show.tvdbId, season, ep) : 0);
  const [favChar, setFavChar] = useState<string | null>(show ? (getCharacterVote(show.tvdbId, season, ep)?.name ?? null) : null);

  // watched check → the Mark as… sheet (Not watched / +1 Rewatched);
  // unwatched check → mark it. Re-read on focus after the sheet closes.
  useFocusEffect(
    useCallback(() => {
      if (!show) return;
      const w = getWatch(show.tvdbId, season, ep);
      setWatched(w != null);
      setWatchedAt(w?.watchedAt ?? null);
      // re-read saved votes too, so imported/just-tapped ones always show
      const v = getEpisodeVote(show.tvdbId, season, ep);
      setStars(v.stars != null ? v.stars - 1 : null);
      setEmotions(new Set(v.emotions));
      // the Mark as… sheet may have just added a rewatch — show it instantly
      setRewatches(getRewatchCount(show.tvdbId, season, ep));
      setFavChar(getCharacterVote(show.tvdbId, season, ep)?.name ?? null);
    }, [show, season, ep]),
  );

  // highlight first, persist second — a db hiccup must never eat the tap
  const rate = (i: number) => {
    setStars(i);
    try {
      if (show) setEpisodeRating(show.tvdbId, season, ep, i + 1);
    } catch {}
  };
  const feel = (i: number) => {
    setEmotions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    try {
      if (show) toggleEpisodeEmotion(show.tvdbId, season, ep, i);
    } catch {}
  };
  const pickCharacter = (name: string) => {
    if (!show) return;
    // write first, then read back — the check must show what the db actually
    // holds, never an optimistic guess ("sometimes voting doesn't save")
    try {
      setCharacterVote(show.tvdbId, season, ep, name);
    } catch {}
    setFavChar(getCharacterVote(show.tvdbId, season, ep)?.name ?? null);
  };

  const toggleWatched = () => {
    if (!show) return;
    if (watched) {
      router.push(`/mark-as?show=${show.tvdbId}&s=${season}&e=${ep}`);
    } else {
      markWatchedWithPrompt(show.tvdbId, season, ep, () => {
        // re-read: Cancel in the prompt reverts the mark
        const w = getWatch(show.tvdbId, season, ep);
        setWatched(w != null);
        setWatchedAt(w?.watchedAt ?? null);
      });
    }
  };

  const code = `S${String(season).padStart(2, '0')} | E${String(ep).padStart(2, '0')}`;
  const absRaw = show ? absoluteEpisode(show.tvdbId, season, ep) : undefined;
  const showName = show?.name ?? 'Show';
  const em = show ? episodeMeta(show.tvdbId, season, ep) : undefined;
  const sm = show ? showMeta(show.tvdbId) : undefined;
  // the overall episode number only helps where fans actually count that way —
  // anime with continuous numbering. On other shows it repeats the episode
  // number (S01E05 "(E05)") and reads as clutter, so it stays hidden there.
  const abs = absRaw != null && absRaw !== ep && (sm?.genres ?? []).includes('Animation') ? absRaw : undefined;
  // every rewatch keeps its own date — listed under the first-watch date
  const rwDates = show && rewatches > 0 ? getRewatchDates(show.tvdbId, season, ep) : [];
  const rating5 = em?.rating ? em.rating / 2 : null;
  const filledStars = rating5 ? Math.round(rating5) : 0;

  // "where did you watch" tiles: your region's providers + Other + Unofficial
  const watchTiles = [
    ...(sm?.providers ?? []).map((p) => ({ name: p.name ?? '?', logo: p.logo, icon: null as string | null })),
    { name: 'Computer', logo: null, icon: 'desktop-outline' as string | null },
    { name: 'TV', logo: null, icon: 'tv-outline' as string | null },
    { name: 'Other', logo: null, icon: 'ellipsis-horizontal-circle-outline' as string | null },
    { name: 'Unofficial', logo: null, icon: 'skull-outline' as string | null },
  ];
  // a saved source must always be visible, even when the provider list for
  // this show doesn't include it (imported data, changed catalogs)
  if (watchedOn && !watchTiles.some((t) => t.name === watchedOn)) {
    watchTiles.unshift({ name: watchedOn, logo: null, icon: 'tv-outline' as string | null });
  }

  const openComments = () => router.push(`/comments?title=${encodeURIComponent(showName)}`);

  return (
    <View style={{ width: W, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: watched ? 96 : 30 }}
        showsVerticalScrollIndicator={false}
        simultaneousHandlers={simRef}
        onScroll={onScroll}
        onScrollEndDrag={onScroll}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={32}
        bounces={false}>
        {/* black episode card on the grey page surface */}
        <View style={[styles.card, { padding: 0 }]}>
          <View style={styles.still}>
            {em?.still && (
              <Image source={{ uri: em.still }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
            )}
            <Pressable style={styles.showPill} onPress={() => show && router.push(`/show/${show.tvdbId}`)}>
              <Text style={styles.showPillText} numberOfLines={1}>
                {showName.toUpperCase()} ›
              </Text>
            </Pressable>
            <Ionicons name="share-outline" size={20} color={colors.text} style={{ position: 'absolute', top: 12, right: 12 }} />
            {/* TV Time overlays the code + title on the still's bottom edge */}
            <View style={styles.titleOverlay}>
              <Text style={styles.code}>
                {code}
                {abs != null ? ` (E${String(abs).padStart(2, '0')})` : ''}
              </Text>
              <Text style={styles.epTitle}>{em?.title ?? `Episode ${ep}`}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.dim} />
            <Text style={styles.metaText}>{em?.air ? shortDate(em.air) : '—'}</Text>
            <Ionicons name="eye-outline" size={17} color={colors.dim} style={{ marginLeft: 10 }} />
            <Text style={styles.metaText}>{watchedAt ? shortDate(watchedAt) : 'Not watched'}</Text>
            {rewatches > 0 && <Text style={[styles.metaText, { color: colors.yellow }]}>{`↻ ×${rewatches}`}</Text>}
            <View style={{ marginLeft: 'auto' }}>
              <CheckCircle watched={watched} onPress={toggleWatched} size={42} />
            </View>
          </View>
          {/* the first watch stays above; every rewatch keeps its own date */}
          {rwDates.length > 0 && (
            <Text style={[styles.metaText, { color: colors.yellow, marginTop: 6 }]} numberOfLines={2}>
              {`↻ Rewatched ${rwDates.map(shortDate).join(' · ')}`}
            </Text>
          )}
        </View>

        {/* the tracking questions only exist once you've watched it, like the real app */}
        {watched && (
          <View style={styles.card}>
            <Text style={styles.label}>WHERE DID YOU WATCH?</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, flexGrow: 1, justifyContent: 'center' }}>
              {watchTiles.map((t, i) => (
                <Pressable
                  key={t.name}
                  style={{ width: 82, alignItems: 'center' }}
                  onPress={() => {
                    const next = watchedOn === t.name ? null : t.name;
                    setWatchedOn(next);
                    if (show) setEpisodeWatchedOn(show.tvdbId, season, ep, next);
                  }}>
                  <View style={[styles.provTile, watchedOn === t.name && { borderWidth: 1.5, borderColor: colors.yellow }]}>
                    {t.logo ? (
                      <Image source={{ uri: t.logo }} style={{ width: 34, height: 34, borderRadius: 8 }} cachePolicy="disk" />
                    ) : (
                      <Ionicons
                        name={(t.icon ?? 'ellipsis-horizontal') as 'ellipsis-horizontal'}
                        size={30}
                        color={t.name === 'Unofficial' ? '#E4364C' : colors.text}
                      />
                    )}
                  </View>
                  <Text style={styles.provLabel} numberOfLines={2}>
                    {t.name.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.hair} />
            <Text style={styles.label}>RATE THIS EPISODE</Text>
            <View style={styles.rateBox}>
              {STARS.map((lbl, i) => (
                <Pressable key={lbl} style={{ alignItems: 'center', gap: 3 }} onPress={() => rate(i)}>
                  <Text style={{ fontSize: 29, color: stars != null && i <= stars ? colors.yellow : '#9A9A9F' }}>★</Text>
                  <Text style={styles.starLabel}>{lbl}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.hair} />
            <Text style={styles.label}>HOW DID YOU FEEL?</Text>
            <View style={styles.emoGrid}>
              {EMOTIONS.map((e, i) => (
                <Pressable key={e.label} style={[styles.emo, emotions.has(i) && { backgroundColor: colors.yellow }]} onPress={() => feel(i)}>
                  <Text style={{ fontSize: 24 }}>{e.face}</Text>
                  <Text style={[styles.emoLabel, emotions.has(i) && { color: colors.onYellow }]}>{e.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* real character art where we have it (anime); cast photos otherwise */}
            {!!(sm?.characters?.length || sm?.cast?.length) && (
              <>
                <View style={styles.hair} />
                <Text style={styles.label}>WHO WAS YOUR FAVORITE?</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {sm?.characters?.length
                    ? sm.characters.slice(0, 8).map((c, i) => (
                        <Pressable key={`${c.name}-${i}`} style={{ width: 96, alignItems: 'center' }} onPress={() => pickCharacter(c.name)}>
                          <View style={[styles.charCard, favChar === c.name && styles.charPicked]}>
                            <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                            {favChar === c.name && (
                              <View style={styles.charCheck}>
                                <Ionicons name="checkmark" size={14} color={colors.onYellow} />
                              </View>
                            )}
                          </View>
                          <Text style={[styles.charName, favChar === c.name && { color: colors.yellow }]} numberOfLines={1}>
                            {c.name.toUpperCase()}
                          </Text>
                        </Pressable>
                      ))
                    : sm!.cast!.slice(0, 8).map((c, i) => {
                        const label = (c.character ?? c.name ?? '').replace(/\s*\(voice\)$/i, '');
                        return (
                          <Pressable key={`${c.name}-${i}`} style={{ width: 96, alignItems: 'center' }} onPress={() => label && pickCharacter(label)}>
                            <View style={[styles.charCard, favChar === label && styles.charPicked]}>
                              {c.photo ? (
                                <Image source={{ uri: c.photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                              ) : (
                                <Ionicons name="person" size={30} color="#B9B9C0" />
                              )}
                              {favChar === label && (
                                <View style={styles.charCheck}>
                                  <Ionicons name="checkmark" size={14} color={colors.onYellow} />
                                </View>
                              )}
                            </View>
                            <Text style={[styles.charName, favChar === label && { color: colors.yellow }]} numberOfLines={1}>
                              {label.toUpperCase()}
                            </Text>
                          </Pressable>
                        );
                      })}
                </ScrollView>
              </>
            )}
          </View>
        )}

        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.h2}>Where to watch</Text>
            <Ionicons name="settings-outline" size={18} color={colors.dim} />
          </View>
          <Text style={{ color: colors.text, fontSize: 15, marginTop: 10 }}>
            {sm?.providers?.length ? sm.providers.map((p) => p.name).join(' · ') : 'Not available'}
          </Text>

          <View style={styles.hair} />
          <Text style={styles.h2}>Episode info</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <View style={styles.tBadge}>
              <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 12 }}>T</Text>
            </View>
            <Text style={{ color: colors.yellow, letterSpacing: 2, fontSize: 15 }}>
              {'★'.repeat(filledStars)}
              {'☆'.repeat(5 - filledStars)}
            </Text>
            <Text style={{ color: colors.dim, fontSize: 13.5 }}>{rating5 ? `${rating5.toFixed(1)}/5` : '—/5'}</Text>
          </View>
          <Text style={styles.synopsis}>
            {em?.overview ?? 'No synopsis available for this episode.'}
          </Text>
        </View>

        {/* unwatched: plain comments row card, like the real app */}
        {!watched && (
          <Pressable style={[styles.card, styles.commentsRow]} onPress={openComments}>
            <Text style={styles.h2}>Comments</Text>
            <Text style={{ color: colors.dim, fontSize: 16 }}>›</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* watched: the blue comments pill floats over the content */}
      {watched && (
        <Pressable style={styles.commentsPillFloat} onPress={openComments}>
          <Text style={styles.commentsText}>COMMENTS</Text>
          <Ionicons name="arrow-forward" size={16} color="#FFF" />
        </Pressable>
      )}
    </View>
  );
}

export default function EpisodePagerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // ids look like "72454-s1e2" — resolve the show from the library first
  // (imported/added shows), falling back to the bundled seed (demo library)
  const m = /^(\d+)-s(\d+)e(\d+)$/.exec(id ?? '');
  const tvdbId = m ? Number(m[1]) : 0;
  const show: Show | undefined =
    (m &&
      (db.getFirstSync<{ tvdbId: number; name: string }>('SELECT tvdbId, name FROM shows WHERE tvdbId = ?', [tvdbId]) ??
        seed.shows.find((s) => s.tvdbId === tvdbId))) ||
    undefined;
  const season = m ? Number(m[2]) : 1;
  const startEp = m ? Number(m[3]) : 1;

  // pager length: the real season length from metadata when we have it; for
  // shows without metadata, at least every episode you've watched is reachable
  const watchedMax = show ? Math.max(0, ...getSeasonEpisodes(show.tvdbId, season).map((e) => e.episode)) : 0;
  const total = Math.max(show ? (seasonTotal(show.tvdbId, season) ?? 0) : 0, watchedMax, startEp);
  const episodes = Array.from({ length: total }, (_, i) => i + 1);
  const [index, setIndex] = useState(startEp - 1);

  // page-control style dots: a 5-dot window that follows the current episode,
  // with a smaller edge dot whenever more episodes exist past the window
  const dotCount = Math.min(episodes.length, 5);
  const dotStart = Math.min(Math.max(index - 2, 0), Math.max(episodes.length - dotCount, 0));

  const insets = useSafeAreaInsets();
  const { gesture, headerGesture, animatedStyle, onScroll, setAtTop } = useSwipeDown();

  // the pager and the page scroll views are native scrolls that grab vertical
  // drags and would cancel the dismiss pan before it activates — they list the
  // pan (via its ref) as a simultaneous handler so both can recognize together
  const panRef = useRef<GestureType | undefined>(undefined);
  const pan = useMemo(() => gesture.withRef(panRef), [gesture]);

  // each page keeps its own scroll offset; on page change no scroll event
  // fires, so remember offsets and re-sync the atTop flag ourselves
  const pageOffsets = useRef<Record<number, number>>({});

  // scrolled into the page → the dots give way to "Show S05 | E35"
  const [titleMode, setTitleMode] = useState(false);
  const headerCode = `S${String(season).padStart(2, '0')} | E${String(index + 1).padStart(2, '0')}`;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }, animatedStyle]}>
        {/* header right under the status bar: close + pager dots — it never
            scrolls, so dragging it down always dismisses */}
        <GestureDetector gesture={headerGesture}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: 'absolute', left: 14 }}>
            <Ionicons name="chevron-down" size={26} color={colors.text} />
          </Pressable>
          {titleMode ? (
            <Text style={styles.headerTitle} numberOfLines={1}>
              {show?.name ?? ''} {headerCode}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {dotStart > 0 && <View style={[styles.dot, styles.dotMini]} />}
              {Array.from({ length: dotCount }, (_, i) => dotStart + i).map((d) => (
                <View key={d} style={[styles.dot, d === index && { backgroundColor: colors.yellow }]} />
              ))}
              {dotStart + dotCount < episodes.length && <View style={[styles.dot, styles.dotMini]} />}
            </View>
          )}
        </View>
        </GestureDetector>

        {/* swipe left/right = previous/next episode; grey page surface like the real app */}
        <FlatList
          style={{ backgroundColor: '#1D1D1D' }}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          simultaneousHandlers={panRef}
          data={episodes}
          keyExtractor={(n) => String(n)}
          initialScrollIndex={Math.min(startEp - 1, episodes.length - 1)}
          contentOffset={{ x: W * Math.min(startEp - 1, episodes.length - 1), y: 0 }}
          getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const page = Math.round(e.nativeEvent.contentOffset.x / W);
            setIndex(page);
            const y = pageOffsets.current[page] ?? 0;
            setAtTop(y <= 2);
            setTitleMode(y > 60);
          }}
          renderItem={({ item, index: i }) => (
            <EpisodePage
              show={show}
              season={season}
              ep={item}
              simRef={panRef}
              onScroll={(e) => {
                const y = e.nativeEvent.contentOffset.y;
                pageOffsets.current[i] = y;
                if (i === index) setTitleMode(y > 60);
                onScroll(e);
              }}
            />
          )}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  header: { height: 46, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '600', maxWidth: '68%' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4A4A4E' },
  dotMini: { width: 5, height: 5, borderRadius: 2.5 },
  // black cards on the grey page, like the real app
  card: {
    backgroundColor: '#000000',
    borderRadius: radius.card,
    marginHorizontal: 10,
    marginTop: 12,
    padding: 14,
    overflow: 'hidden',
  },
  hair: { height: 1, backgroundColor: '#242427', marginVertical: 16, marginHorizontal: -14 },
  still: {
    // slightly taller than 16:9 so the title overlay has room, like the real card
    aspectRatio: 1.6,
    backgroundColor: '#181820',
    justifyContent: 'flex-end',
  },
  titleOverlay: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 44,
    experimental_backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))',
  },
  showPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    borderWidth: 1,
    borderColor: '#FFF',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,.45)',
    maxWidth: '72%',
  },
  showPillText: { color: colors.text, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  code: { color: colors.text, fontSize: 20, fontWeight: '800' },
  epTitle: { color: '#E4E4E9', fontSize: 14.5, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11 },
  metaText: { color: '#C9C9CF', fontSize: 14 },
  label: {
    color: '#C8C8CD',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: 14,
  },
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
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '72%',
    alignSelf: 'center',
  },
  starLabel: { color: '#D5D5DA', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 },
  starPct: { color: colors.dim, fontSize: 9 },
  emoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'space-between' },
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
    backgroundColor: '#E9E9EC',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  charPicked: { borderWidth: 2, borderColor: colors.yellow },
  charCheck: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charName: { color: colors.dim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, marginTop: 7 },
  h2: { color: colors.text, fontSize: 21, fontWeight: '800' },
  tBadge: { backgroundColor: colors.yellow, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  synopsis: { color: '#E3E3E8', fontSize: 15.5, lineHeight: 22, marginTop: 10 },
  commentsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 18 },
  commentsPillFloat: {
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
});
