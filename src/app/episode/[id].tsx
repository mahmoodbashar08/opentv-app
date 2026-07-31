import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { I18nManager, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { GestureType } from 'react-native-gesture-handler';
import { FlatList, Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { useSwipeDown } from '@/components/swipe-down';
import { CheckCircle, ContentColumn, useDetailPaneStyle, useDetailWidth } from '@/components/ui';
import seed from '@/seed';
import db, { addShow, getCharacterVote, getEpisodeVote, getEpisodeWatchedOn, getRewatchCount, getRewatchDates, getSeasonEpisodes, getWatch, setCharacterVote, setEpisodeRating, setEpisodeWatchedOn, toggleEpisodeEmotion } from '@/db';
import type { Aggregate, CommunityEmotion, SeasonAggregates } from '@/community-ratings';
import { useJoined } from '@/community-session';
import {
  clearCharacterVote,
  postCharacterVote,
  postRating,
  useCharacterVotes,
  useSeasonAggregates,
  useVoteSettling,
} from '@/community-ratings';
import { tapSelection } from '@/haptics';
import { markWatchedWithPrompt } from '@/mark';
import { absoluteEpisode, episodeMeta, seasonTotal, showMeta } from '@/metadata';
import { fetchShowMeta, showMetaIsStale } from '@/show-meta-fetch';
import { characterFace, characterPercents, emotionNames, emotionPercents, nextPage, orderPollCast, pollLabel, starPercents, swipeDirection } from '@/pure';
import { colors, radius, space } from '@/theme';
import { currentLocale, t } from '@/i18n';

const STARS = ['media.stars.bad', 'media.stars.ok', 'media.stars.good', 'media.stars.super', 'media.stars.wow'] as const;

// TV Time's full 12-emotion set, 3 rows of 4 — indexes line up with the
// imported vote ids (db.ts stores the value as index + 28), so the order
// below must never change: swap labels in place, don't reorder/add/remove.
const EMOTIONS = [
  { face: '😯', label: 'media.emotions.shocked' },
  { face: '😤', label: 'media.emotions.frustrated' },
  { face: '😭', label: 'media.emotions.sad' },
  { face: '🤔', label: 'media.emotions.reflective' },
  { face: '🥹', label: 'media.emotions.touched' },
  { face: '😆', label: 'media.emotions.amused' },
  { face: '😱', label: 'media.emotions.scared' },
  { face: '😑', label: 'media.emotions.bored' },
  { face: '😌', label: 'media.emotions.understood' },
  { face: '🤩', label: 'media.emotions.thrilled' },
  { face: '🙃', label: 'media.emotions.confused' },
  { face: '😬', label: 'media.emotions.tense' },
] as const;

/**
 * The community name for each local emotion, by index.
 *
 * The server's allow-list is now TV Time's own twelve, so every face a user can
 * tap has a real counterpart and nothing is silently dropped. An earlier draft
 * folded these onto six invented buckets, which lost reflective, bored,
 * understood and confused entirely and merged shocked with thrilled.
 *
 * Index-locked to EMOTIONS above, which is index-locked to the database, which
 * is index-locked to `EMOTIONS` in `backend/src/pure.ts`. Reorder one and you
 * must reorder all of them.
 */
const SERVER_EMOTION: readonly CommunityEmotion[] = [
  'shocked', // 😯
  'frustrated', // 😤
  'sad', // 😭
  'reflective', // 🤔
  'touched', // 🥹
  'amused', // 😆
  'scared', // 😱
  'bored', // 😑
  'understood', // 😌
  'thrilled', // 🤩
  'confused', // 🙃
  'tense', // 😬
];

/**
 * What everyone else thought, read straight off the aggregate.
 *
 * WHAT THIS REPLACED, AND WHY. Phase 3 rendered one row: an average out of ten
 * and the single most-picked emotion. design/referance/12-episode-page-top.png
 * asks for something else entirely — a percentage under EVERY star and under
 * EVERY emotion tile, so the shape of the opinion is visible rather than its
 * mean. "82% gave it five stars" and "8.6/10" are not the same sentence, and
 * only one of them can be read off a mean.
 *
 * `null` / `{}` when there is nothing to show, which is what keeps the "no
 * votes" screen looking exactly as it did before any of this existed: no zeroes
 * under the stars, no placeholder, no "be the first to rate" chore.
 */
function communityPercents(agg?: Aggregate): {
  stars: number[] | null;
  emotions: Record<string, number>;
} {
  if (!agg || agg.vote_count <= 0) return { stars: null, emotions: {} };
  return {
    stars: starPercents(agg.score_counts, agg.vote_count),
    // Over the SELECTIONS, not over `vote_count`. Since the set contract those
    // are two different scales — one person picking two faces is two
    // selections and one vote — and dividing by the vote count printed both
    // faces at 100%.
    emotions: emotionPercents(agg.emotion_counts),
  };
}

// only these two fields are ever used — both the library db and the bundled
// seed satisfy the shape, so imported/added shows work like bundled ones
type Show = { tvdbId: number; name: string };

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

function EpisodePage({
  show,
  season,
  ep,
  agg,
  onScroll,
  onScrollBeginDrag,
  onScrollSettled,
  simRef,
  onAdded,
  tvdbId,
}: {
  show?: Show;
  season: number;
  ep: number;
  /** This episode's community rollup, prefetched for the whole season. */
  agg?: Aggregate;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag: () => void;
  onScrollSettled: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  simRef: MutableRefObject<GestureType | undefined>;
  /** Called after this page adds the show, so the pager re-reads and every
   *  control on the page stops being inert. */
  onAdded: () => void;
  /** The id from the ROUTE. `show` is undefined for a title that is not in the
   *  library, and that is exactly when it is needed. */
  tvdbId: number;
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
  // Which comments screen the Comments row leads to — see `openComments`.
  const joined = useJoined();
  const [, bumpMeta] = useState(0);

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
      // The setters are listed even though useState guarantees they are stable:
      // React Compiler infers them and refuses to compile the whole component
      // when the manual list disagrees with what it inferred. The cost of
      // omitting them is that this page loses its optimisation entirely.
    }, [show, season, ep, setWatched, setWatchedAt, setStars, setEmotions, setRewatches, setFavChar]),
  );

  // load the show's cast if it isn't cached yet, so "Who was your favorite?"
  // appears on EVERY show — not only ones whose metadata already arrived. And
  // silently upgrade anime cached before AniList existed (cast, but no real
  // character art) so their characters show WITHOUT the user hitting refresh.
  const metaUpgraded = useRef(new Set<number>());
  useEffect(() => {
    if (!show) return;
    const m = showMeta(show.tvdbId);
    if (!m || showMetaIsStale(m)) {
      void fetchShowMeta(show.tvdbId).then(() => bumpMeta((t) => t + 1));
      return;
    }
    // animation with no character art yet → re-pull once; doFetch adds AniList
    // characters if it's actually anime, otherwise it just keeps the cast
    const animation = (m.genres ?? []).includes('Animation');
    if (animation && !m.characters?.length && !metaUpgraded.current.has(show.tvdbId)) {
      metaUpgraded.current.add(show.tvdbId);
      void fetchShowMeta(show.tvdbId, m.tmdbId, true).then(() => bumpMeta((t) => t + 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.tvdbId]);

  /**
   * Tell the community, if there is one. Fire and forget: this returns
   * immediately, cannot throw, and does nothing at all when not joined.
   *
   * Local stars are 1–5, the server's scale is 1–10, so a star is worth two —
   * a whole-number doubling rather than a rescale, so a five-star rating is a
   * clean 10 and nothing lands between the app's own steps.
   *
   * Called with the values being written, not with the state variables: both
   * `setStars` and `setEmotions` are asynchronous, so reading them here would
   * send the vote the user had a moment ago.
   *
   * ALL of the selected feelings go, every time. This used to send the single
   * lowest-indexed one, so picking a second face on an episode changed nothing
   * anybody else could see. `emotions` is the whole current selection and the
   * server replaces its stored set with it — which is also what makes
   * un-tapping a face actually remove it.
   */
  /**
   * `into` is the show the caller just resolved. It matters on the FIRST vote
   * for a title that was not in the library: `ensureShow` has added the row,
   * but this render's `show` prop is still the stale undefined it had when the
   * frame began, so reading the prop here would skip the server for exactly one
   * vote — the one the user just cast — and nothing would ever go back for it.
   */
  const tellCommunity = (nextStars: number | null, nextEmotions: ReadonlySet<number>, into?: Show | null) => {
    const target = into ?? show;
    if (!target) return;
    postRating({
      source: 'tvdb',
      key: String(target.tvdbId),
      season,
      episode: ep,
      score: nextStars != null ? (nextStars + 1) * 2 : null,
      emotions: emotionNames(nextEmotions),
    });
  };

  // highlight first, persist second — a db hiccup must never eat the tap
  const rate = (i: number) => {
    setStars(i);
    try {
      // Rating a show you have not tracked starts tracking it, for the reason
      // `ensureShow` gives: the alternative is a control that lights up and
      // saves nothing.
      const s = ensureShow();
      if (s) setEpisodeRating(s.tvdbId, season, ep, i + 1);
    } catch {}
    tellCommunity(i, emotions, ensureShow());
  };
  const feel = (i: number) => {
    const next = new Set(emotions);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setEmotions(next);
    try {
      const s = ensureShow();
      if (s) toggleEpisodeEmotion(s.tvdbId, season, ep, i);
    } catch {}
    tellCommunity(stars, next, ensureShow());
  };
  const pickCharacter = (name: string) => {
    const target = ensureShow();
    if (!target) return;
    tapSelection();
    // write first, then read back — the check must show what the db actually
    // holds, never an optimistic guess ("sometimes voting doesn't save")
    try {
      setCharacterVote(target.tvdbId, season, ep, name);
    } catch {}
    const now = getCharacterVote(target.tvdbId, season, ep)?.name ?? null;
    setFavChar(now);
    // Both directions reach the server. The community question is per SHOW, so
    // clearing here withdraws this person's favourite for the whole show —
    // which is what the local toggle just did too.
    if (now) {
      postCharacterVote({ source: 'tvdb', key: String(target.tvdbId), character: now, season, episode: ep });
    } else {
      clearCharacterVote('tvdb', String(target.tvdbId));
    }
  };

  /**
   * The show, adding it to the library first if this is a title the user has
   * only browsed to.
   *
   * WHY IT HAS TO EXIST. Every control on this page — the watched check, the
   * stars, the feelings, the favourite — is guarded on `show`, and `show` is
   * only ever the row in the local `shows` table. Open an episode of something
   * you have not tracked (from search, from a list, from a comment) and the
   * page renders perfectly from cached metadata while doing NOTHING: taps fell
   * into `if (!show) return` and the user was told nothing at all.
   *
   * Marking an episode watched is the moment to start tracking the show — the
   * film screen has always worked that way, and TV Time does too. The other
   * controls do not add anything on their own: rating an episode you have not
   * marked is a stranger act, and they become live the moment the show exists.
   */
  const ensureShow = (): Show | null => {
    if (show) return show;
    if (!tvdbId) return null;
    const meta = showMeta(tvdbId);
    const name = meta?.name;
    if (!name) return null;   // nothing known about it — adding a nameless row helps nobody
    try {
      addShow(tvdbId, name, meta?.poster ?? null);
    } catch {
      return null;
    }
    onAdded();
    return { tvdbId, name };
  };

  const toggleWatched = () => {
    // `target`, not `show`: shadowing the prop here is what made React Compiler
    // give up on this whole component.
    const target = ensureShow();
    if (!target) return;
    if (watched) {
      router.push(`/mark-as?show=${target.tvdbId}&s=${season}&e=${ep}`);
    } else {
      markWatchedWithPrompt(target.tvdbId, season, ep, () => {
        // re-read: Cancel in the prompt reverts the mark
        const w = getWatch(target.tvdbId, season, ep);
        setWatched(w != null);
        setWatchedAt(w?.watchedAt ?? null);
      });
    }
  };

  /**
   * What everyone else thought — REVEALED BY YOUR OWN VOTE, not before it.
   *
   * Showing the percentages on arrival made the screen read as though it were
   * telling you the answer before asking the question, and it biases the
   * answer: a row of numbers under the stars is a suggestion. TV Time asked
   * first and showed the room afterwards, and this is the same bargain — you
   * say what you thought, and then you find out what everybody else did.
   *
   * IT ALSO MAKES THE REVEAL INSTANT. The gate is local state, flipped by the
   * tap itself, so the percentages appear on the same frame as the star fills
   * rather than waiting on the round trip that updates them.
   */
  const voted = stars != null || emotions.size > 0;
  // CALCULATE, THEN SHOW. While the vote just cast is still in the air the
  // rollup on this device is the one from BEFORE it — a single voter reads as
  // "100%", which then corrects itself to "50%" under the reader's eye. The
  // first number was never true and it is the one that sticks, so nothing is
  // shown until the figure has settled. See `useVoteSettling`.
  const settling = useVoteSettling('tvdb', show ? String(show.tvdbId) : null, season, ep);
  const { stars: starPct, emotions: emoPct } =
    voted && !settling ? communityPercents(agg) : { stars: null, emotions: {} as Record<string, number> };

  // The favourite is asked per episode and counted per SHOW, so one rollup
  // serves every episode of the series. {} until somebody with a NAMED vote has
  // been counted — archive votes carry no name and cannot be.
  const charVotes = useCharacterVotes('tvdb', show ? String(show.tvdbId) : null);
  const charPct = characterPercents(charVotes?.items, charVotes?.total);

  const code = `S${String(season).padStart(2, '0')} | E${String(ep).padStart(2, '0')}`;
  const absRaw = show ? absoluteEpisode(show.tvdbId, season, ep) : undefined;
  const showName = show?.name ?? t('episode.genericShowLabel');
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

  // "where did you watch" tiles: your region's providers + Computer/TV/Other/Unofficial.
  // `name` is the value persisted to the database (setEpisodeWatchedOn) — it
  // must stay a stable English identifier across locales; `labelKey` is what's shown.
  const watchTiles: { name: string; logo?: string | null; icon: string | null; labelKey?: Parameters<typeof t>[0] }[] = [
    ...(sm?.providers ?? []).map((p) => ({ name: p.name ?? '?', logo: p.logo, icon: null as string | null })),
    { name: 'Computer', logo: null, icon: 'desktop-outline', labelKey: 'episode.watchTiles.computer' as const },
    { name: 'TV', logo: null, icon: 'tv-outline', labelKey: 'episode.watchTiles.tv' as const },
    { name: 'Other', logo: null, icon: 'ellipsis-horizontal-circle-outline', labelKey: 'media.watchTiles.other' as const },
    { name: 'Unofficial', logo: null, icon: 'skull-outline', labelKey: 'media.watchTiles.unofficial' as const },
  ];
  // a saved source must always be visible, even when the provider list for
  // this show doesn't include it (imported data, changed catalogs)
  if (watchedOn && !watchTiles.some((tile) => tile.name === watchedOn)) {
    watchTiles.unshift({ name: watchedOn, logo: null, icon: 'tv-outline' });
  }

  /**
   * ONE comments destination.
   *
   * The archive and the community thread hold the SAME comments — the archive
   * is what this phone imported, and seeding puts it on the server. This screen
   * offered both as separate rows, which asked the reader to hold a distinction
   * that is ours and not theirs.
   *
   * Joined → the thread, which contains the archive and can be written to. Not
   * joined → the archive, because that user has no server and must not acquire
   * one by tapping Comments.
   */
  const openComments = () => {
    if (joined) {
      openCommunityThread();
      return;
    }
    router.push(`/comments?title=${encodeURIComponent(showName)}`);
  };

  /**
   * The COMMUNITY thread for this episode — a different thing from the row
   * above, which is this user's own imported TV Time comments. Kept as two
   * rows on purpose: one is their archive, the other is everyone else.
   *
   * Reached from `openComments` once the reader has joined. Reading a thread
   * needs no account, but somebody who has not joined has no server at all, so
   * they are shown the local archive instead — see `openComments`.
   */
  const openCommunityThread = () => {
    if (!show) return;
    tapSelection();
    // One template literal, not a concatenation: expo-router's typed routes
    // only recognise `/thread?${string}` as a route when the whole string is
    // built in one piece.
    // The EPISODE's own name in the header, not the series'. This thread is
    // about one episode, and titling it with the show made every episode's
    // comments look like the same screen — and indistinguishable from the
    // show-level thread, which really is titled with the series.
    const name = em?.title ?? (ep === 0 ? t('show.episodeUnknownTitle') : null);
    const label = name ? `${name} · S${season}E${ep}` : `${showName} S${season}E${ep}`;
    router.push(
      `/thread?source=tvdb&key=${show.tvdbId}&season=${season}&episode=${ep}&title=${encodeURIComponent(label)}`,
    );
  };

  // live width, so a page is sized for the CURRENT orientation rather than the
  // one the module happened to load in
  // the pane's width when beside the list, the window's otherwise
  const W = useDetailWidth();

  return (
    <View style={{ width: W, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: watched ? 96 : 30 }}
        showsVerticalScrollIndicator={false}
        simultaneousHandlers={simRef}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollSettled}
        onMomentumScrollEnd={onScrollSettled}
        scrollEventThrottle={32}
        bounces>
        {/* black episode card on the grey page surface */}
        <View style={[styles.card, { padding: 0 }]}>
          <View style={styles.still}>
            {/* The episode's own still, or the SHOW's backdrop behind a scrim.
                An episode the catalogue never listed has no picture and never
                will, and a flat black rectangle where every other episode has
                artwork reads as a broken page rather than a missing record. */}
            {em?.still ? (
              <Image source={{ uri: em.still }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
            ) : sm?.backdrop ? (
              <>
                <Image
                  source={{ uri: sm.backdrop }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="disk"
                />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
              </>
            ) : null}
            <Pressable style={styles.showPill} onPress={() => show && router.push(`/show/${show.tvdbId}`)}>
              <Text style={styles.showPillText} numberOfLines={1}>
                {showName.toUpperCase()} ›
              </Text>
            </Pressable>
            <Pressable
              hitSlop={10}
              style={{ position: 'absolute', top: 12, end: 12 }}
              onPress={() =>
                show && router.push(`/share-card?type=episode&id=${show.tvdbId}&season=${season}&episode=${ep}`)
              }>
              <Ionicons name="share-outline" size={20} color={colors.text} />
            </Pressable>
            {/* TV Time overlays the code + title on the still's bottom edge */}
            <View style={styles.titleOverlay}>
              <Text style={styles.code}>
                {code}
                {abs != null ? ` (E${String(abs).padStart(2, '0')})` : ''}
              </Text>
              {/* An episode the catalogues do not have. TV Time files the
                  broadcast that precedes a season's first episode at position
                  zero, and neither TheTVDB nor TMDB carries it — so there is no
                  title, no still and no air date, and "Episode 0" over an empty
                  page reads as a bug in the app rather than a gap in the data.

                  "Unknown" and not "Special" because that is what is actually
                  known: the app cannot tell what the broadcast was, only that
                  the user watched something the catalogue has no record of.
                  Only when the catalogue offers nothing — a listed special
                  keeps its own name. */}
              <Text style={styles.epTitle}>
                {em?.title ?? (ep === 0 ? t('show.episodeUnknownTitle') : t('show.episodeFallbackTitle', { n: ep }))}
              </Text>
              {/* WHY THIS PAGE IS BARE, said once. TV Time knew this broadcast
                  and neither TheTVDB nor TMDB carries it, so there is no title,
                  no still and no synopsis to fetch — the page holds the user's
                  own watch, rating, feelings and comments and nothing else.
                  Without the line it reads as the app having lost the data it
                  is in fact the only place still keeping. */}
              {!em?.title && !em?.still && (
                <Text style={styles.notInCatalogue}>{t('show.episodeNotInCatalogue')}</Text>
              )}
            </View>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.dim} />
            <Text style={styles.metaText}>{em?.air ? shortDate(em.air) : '—'}</Text>
            <Ionicons name="eye-outline" size={17} color={colors.dim} style={{ marginStart: 10 }} />
            {/* first watch, with every rewatch date stacked directly beneath it */}
            <View style={{ flex: 1, marginStart: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={styles.metaText}>{watchedAt ? shortDate(watchedAt) : t('media.notWatched')}</Text>
                {rewatches > 0 && <Text style={[styles.metaText, { color: colors.yellow }]}>{`↻ ×${rewatches}`}</Text>}
              </View>
              {rwDates.length > 0 && (
                <Text style={[styles.metaText, { color: colors.yellow, marginTop: 3 }]}>
                  {rwDates.map(shortDate).join(' · ')}
                </Text>
              )}
            </View>
            <View style={{ marginStart: 'auto' }}>
              <CheckCircle watched={watched} onPress={toggleWatched} size={42} />
            </View>
          </View>
        </View>

        {/* the tracking questions only exist once you've watched it, like the real app */}
        {watched && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('media.whereDidYouWatchPoll')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, flexGrow: 1, justifyContent: 'center' }}>
              {watchTiles.map((tile, i) => (
                <Pressable
                  key={tile.name}
                  style={{ width: 82, alignItems: 'center' }}
                  onPress={() => {
                    const next = watchedOn === tile.name ? null : tile.name;
                    setWatchedOn(next);
                    if (show) setEpisodeWatchedOn(show.tvdbId, season, ep, next);
                  }}>
                  <View style={[styles.provTile, watchedOn === tile.name && { borderWidth: 1.5, borderColor: colors.yellow }]}>
                    {tile.logo ? (
                      <Image source={{ uri: tile.logo }} style={{ width: 34, height: 34, borderRadius: 8 }} cachePolicy="disk" />
                    ) : (
                      <Ionicons
                        name={(tile.icon ?? 'ellipsis-horizontal') as 'ellipsis-horizontal'}
                        size={30}
                        color={tile.name === 'Unofficial' ? '#E4364C' : colors.text}
                      />
                    )}
                  </View>
                  <Text style={styles.provLabel} numberOfLines={2}>
                    {(tile.labelKey ? t(tile.labelKey) : tile.name).toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.hair} />
            <Text style={styles.label}>{t('episode.ratePollLabel')}</Text>
            {/* stars in the box, names and figures under it — the design's
                layout (design/referance/12-episode-page-top.png), and the only
                one that leaves room for a percentage per column */}
            <View style={styles.rateBox}>
              {STARS.map((lblKey, i) => (
                <Pressable key={lblKey} style={styles.starCell} onPress={() => rate(i)}>
                  <Text style={{ fontSize: 29, color: stars != null && i <= stars ? colors.yellow : '#9A9A9F' }}>★</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.starLegend}>
              {STARS.map((lblKey, i) => (
                // the label keeps its own colour until there are figures to
                // rank it against — an unrated episode must look exactly as it
                // did before any of this existed
                <View key={lblKey} style={styles.starCell}>
                  <Text style={[styles.starLabel, starPct != null && (i === stars ? styles.starLabelMine : styles.starLabelOther)]}>
                    {t(lblKey)}
                  </Text>
                  {starPct != null && (
                    <Text style={[styles.starPct, i === stars && styles.starPctMine]}>{`${starPct[i] ?? 0}%`}</Text>
                  )}
                </View>
              ))}
            </View>

            <View style={styles.hair} />
            <Text style={styles.label}>{t('media.howDidYouFeelPoll')}</Text>
            <View style={styles.emoGrid}>
              {EMOTIONS.map((e, i) => {
                // a tile shows a figure only where the community has one: an
                // emotion nobody picked is absent from the blob, and printing
                // "0%" under all twelve is noise, not information
                const name = SERVER_EMOTION[i];
                const pct = name != null ? emoPct[name] : undefined;
                return (
                  <Pressable key={e.label} style={[styles.emo, emotions.has(i) && { backgroundColor: colors.yellow }]} onPress={() => feel(i)}>
                    <Text style={{ fontSize: 24 }}>{e.face}</Text>
                    <Text style={[styles.emoLabel, emotions.has(i) && { color: colors.onYellow }]}>{t(e.label)}</Text>
                    {pct != null && (
                      <Text style={[styles.emoPct, emotions.has(i) && { color: colors.onYellow }]}>{`${pct}%`}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* real character art where we have it (anime); cast photos otherwise */}
            {!!(sm?.characters?.length || sm?.cast?.length) && (
              <>
                <View style={styles.hair} />
                <Text style={styles.label}>{t('media.whoWasFavoritePoll')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {sm?.characters?.length
                    ? orderPollCast(sm.characters.slice(0, 20), charPct).map((c, i) => {
                        const picked = favChar === c.name;
                        // Everyone else steps back once an answer exists — same
                        // rule as the film screen's poll.
                        const dimmed = favChar != null && !picked;
                        return (
                          <Pressable
                            key={`${c.name}-${i}`}
                            style={[{ width: 96, alignItems: 'center' }, dimmed && styles.charDim]}
                            onPress={() => pickCharacter(c.name)}>
                            <View style={[styles.charCard, picked && styles.charPicked]}>
                              <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                              {picked && (
                                <View style={styles.charCheck}>
                                  <Ionicons name="checkmark" size={14} color={colors.onYellow} />
                                </View>
                              )}
                            </View>
                            <Text style={[styles.charName, picked && { color: colors.yellow }]} numberOfLines={1}>
                              {c.name.toUpperCase()}
                            </Text>
                            {charPct[c.name] != null && <Text style={styles.charPct}>{`${charPct[c.name]}%`}</Text>}
                          </Pressable>
                        );
                      })
                    : orderPollCast(sm!.cast!.slice(0, 20), charPct).map((c, i) => {
                        const label = pollLabel(c);
                        // The CHARACTER's face, the performer's only as a
                        // fallback — this row asks who your favourite CHARACTER
                        // was, and used to answer it with a headshot of the
                        // voice actor.
                        const face = characterFace(c);
                        const picked = !!label && favChar === label;
                        const dimmed = favChar != null && !picked;
                        return (
                          <Pressable
                            key={`${c.name}-${i}`}
                            style={[{ width: 96, alignItems: 'center' }, dimmed && styles.charDim]}
                            onPress={() => label && pickCharacter(label)}>
                            <View style={[styles.charCard, picked && styles.charPicked]}>
                              {face ? (
                                <Image source={{ uri: face }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                              ) : (
                                <Ionicons name="person" size={30} color="#B9B9C0" />
                              )}
                              {picked && (
                                <View style={styles.charCheck}>
                                  <Ionicons name="checkmark" size={14} color={colors.onYellow} />
                                </View>
                              )}
                            </View>
                            <Text style={[styles.charName, picked && { color: colors.yellow }]} numberOfLines={1}>
                              {label.toUpperCase()}
                            </Text>
                            {charPct[label] != null && <Text style={styles.charPct}>{`${charPct[label]}%`}</Text>}
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
            <Text style={styles.h2}>{t('media.whereToWatch')}</Text>
            <Ionicons name="settings-outline" size={18} color={colors.dim} />
          </View>
          <Text style={{ color: colors.text, fontSize: 15, marginTop: 10 }}>
            {sm?.providers?.length ? sm.providers.map((p) => p.name).join(' · ') : t('media.providersUnavailable')}
          </Text>

          <View style={styles.hair} />
          <Text style={styles.h2}>{t('episode.episodeInfoTitle')}</Text>
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
          {/* the only prose paragraph on this screen — capped so a 1366pt
              iPad doesn't render the synopsis as one enormous line; the rest
              of this page (rows, controls, rating/emotion pickers) is full width */}
          <ContentColumn>
            <Text style={styles.synopsis}>
              {em?.overview ?? t('episode.noSynopsis')}
            </Text>
          </ContentColumn>
        </View>

        {/* unwatched: plain comments row card, like the real app. When watched
            the blue pill below is the entry instead, so this must not also
            render or the screen has two doors to one place. */}
        {!watched && (
          <Pressable style={[styles.card, styles.commentsRow]} onPress={openComments}>
            <View style={{ flex: 1 }}>
              <Text style={styles.h2}>{t('show.commentsTitle')}</Text>
              {joined && (
                <Text style={{ color: colors.dim, fontSize: 13, marginTop: 3 }}>
                  {t('community.comments.rowSub')}
                </Text>
              )}
            </View>
            <Text style={{ color: colors.dim, fontSize: 16 }}>›</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* watched: the blue comments pill floats over the content */}
      {watched && (
        <Pressable style={styles.commentsPillFloat} onPress={openComments}>
          <Text style={styles.commentsText}>{t('media.commentsPill')}</Text>
          <Ionicons name={I18nManager.isRTL ? 'arrow-back' : 'arrow-forward'} size={16} color="#FFF" />
        </Pressable>
      )}
    </View>
  );
}

export default function EpisodePagerScreen() {
  // the pane's width when beside the list, the window's otherwise
  const W = useDetailWidth();
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
  // Bumped when a page adds the show, so the line above re-runs and `show`
  // stops being undefined — otherwise the controls would stay inert until the
  // screen was closed and reopened.
  const [, bumpLibrary] = useReducer((n: number) => n + 1, 0);

  // pager length: the real season length from metadata when we have it; for
  // shows without metadata, at least every episode you've watched is reachable
  const watchedMax = show ? Math.max(0, ...getSeasonEpisodes(show.tvdbId, season).map((e) => e.episode)) : 0;
  const watchedZero = show ? getSeasonEpisodes(show.tvdbId, season).some((e) => e.episode === 0) : false;
  const total = Math.max(show ? (seasonTotal(show.tvdbId, season) ?? 0) : 0, watchedMax, startEp);
  /**
   * A SEASON CAN START AT ZERO.
   *
   * This pager was built as 1…total and its index as `startEp - 1`, so a link
   * to episode 0 asked for index -1 — invalid, and React Native said so in the
   * log — and the screen quietly showed episode 1 instead. Opening a comment
   * on S4E0 landed on S4E1 and reported no comments, which is true of E1 and
   * says nothing about the episode that was asked for.
   *
   * TV Time files a special that precedes a season's first episode as episode
   * zero (the reference export has one: the Attack on Titan recap that ran the
   * day before Final Season Part 2). TheTVDB does not list it, so `seasonTotal`
   * cannot know about it — the ONLY evidence is that something links to it or
   * that it was watched. Both are checked, so a season only gains a zero when
   * one genuinely exists.
   */
  const first = startEp === 0 || watchedZero ? 0 : 1;
  const episodes = Array.from({ length: Math.max(0, total - first + 1) }, (_, i) => i + first);
  // The POSITION of the requested episode, not the number: they differ by one
  // exactly when the season starts at zero, and that difference was the bug.
  const [index, setIndex] = useState(() => Math.max(0, startEp - first));

  // One request for the whole season, issued here rather than inside each page:
  // the pager mounts every episode's page as you swipe, so a per-page fetch
  // would be one call per episode and a visible pop-in on each swipe. Empty
  // when not joined — which is what makes the community row disappear entirely
  // for people who never joined, with no branch in the page itself.
  const aggregates: SeasonAggregates = useSeasonAggregates(show?.tvdbId, season);

  // page-control style dots: a 5-dot window that follows the current episode,
  // with a smaller edge dot whenever more episodes exist past the window
  const dotCount = Math.min(episodes.length, 5);
  const dotStart = Math.min(Math.max(index - 2, 0), Math.max(episodes.length - dotCount, 0));

  const insets = useSafeAreaInsets();
  const { gesture, headerGesture, animatedStyle, onScroll, onScrollBeginDrag, onScrollSettled, setAtTop } = useSwipeDown();
  // on a wide screen this screen sits beside the list instead of covering it
  const paneStyle = useDetailPaneStyle();

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
  // The episode NUMBER at this position, not the position plus one: in a season
  // that starts at zero those differ, and the header would name the wrong
  // episode all the way along.
  const headerCode = `S${String(season).padStart(2, '0')} | E${String(episodes[index] ?? startEp).padStart(2, '0')}`;

  // RTL only: stop depending on React Native's RTL horizontal-scroll geometry
  // entirely rather than modelling it. Five earlier commits tried mirroring
  // offsets / `direction: 'ltr'` pins / index-based scrollTo APIs and each was
  // verified wrong on a physical iPhone in a way that never reproduced on a
  // simulator (see 6e824e2, which reverted all of them). Under RTL this
  // screen renders exactly one page and steps `index` with a plain swipe
  // gesture instead — no contentOffset, no getItemLayout, no
  // initialScrollIndex, nothing whose correctness depends on how RN's RTL
  // scroll maths works. The LTR FlatList below is untouched.
  //
  // Direction is NOT flipped for RTL: a physical left swipe steps forward
  // (direction 1) exactly as it does in the LTR pager below. Reversing it
  // would reintroduce the same direction-dependent reasoning that produced
  // five wrong fixes; if the owner wants RTL swipe direction mirrored, that
  // is a separate, deliberate decision to make on a device that can verify it.
  const dragX = useSharedValue(0);
  const pageAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dragX.value }] }));

  // same side effects onMomentumScrollEnd runs for the LTR FlatList below:
  // land on the new page's cached scroll offset and resync titleMode/atTop,
  // since changing `index` this way fires no scroll event of its own.
  const applyPagerStep = useCallback(
    (direction: 1 | -1) => {
      setIndex((prev) => {
        const next = nextPage(prev, episodes.length, direction);
        const y = pageOffsets.current[next] ?? 0;
        setAtTop(y <= 2);
        setTitleMode(y > 60);
        return next;
      });
    },
    [episodes.length, setAtTop],
  );

  // activeOffsetX / failOffsetY mirror the vertical dismiss pan's own
  // activeOffsetY / failOffsetX (see useSwipeDown) so the two axes stay
  // mutually exclusive and neither gesture can swallow the other's touch.
  const hGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-15, 15])
        .onUpdate((e) => {
          dragX.value = e.translationX;
        })
        .onEnd((e) => {
          const dir = swipeDirection(e.translationX, e.velocityX, W, I18nManager.isRTL);
          dragX.value = withTiming(0, { duration: 150 });
          if (dir !== 0) runOnJS(applyPagerStep)(dir);
        }),
    [W, dragX, applyPagerStep],
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }, animatedStyle, paneStyle]}>
        {/* header right under the status bar: close + pager dots — it never
            scrolls, so dragging it down always dismisses */}
        <GestureDetector gesture={headerGesture}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: 'absolute', start: 14 }}>
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
        {!I18nManager.isRTL && (
          <FlatList
            style={{ backgroundColor: '#1D1D1D' }}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            simultaneousHandlers={panRef}
            data={episodes}
            // The community numbers arrive AFTER the first paint — one request
            // per season, resolved a few hundred ms in. FlatList caches its
            // rendered items and will not call renderItem again just because
            // the parent re-rendered, so without this the percentages only
            // appeared on a SECOND visit, once the cache was warm enough to be
            // read synchronously during the first render.
            extraData={aggregates}
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
                tvdbId={tvdbId}
                onAdded={bumpLibrary}
                season={season}
                ep={item}
                agg={aggregates[item]}
                simRef={panRef}
                onScroll={(e) => {
                  const y = e.nativeEvent.contentOffset.y;
                  pageOffsets.current[i] = y;
                  if (i === index) setTitleMode(y > 60);
                  onScroll(e);
                }}
                onScrollBeginDrag={onScrollBeginDrag}
                onScrollSettled={(e) => {
                  const y = e.nativeEvent.contentOffset.y;
                  pageOffsets.current[i] = y;
                  if (i === index) setTitleMode(y > 60);
                  onScrollSettled(e);
                }}
              />
            )}
          />
        )}

        {/* RTL: a single rendered page, stepped by index — see the comment
            above `dragX` for why this does not use a scrolling FlatList */}
        {I18nManager.isRTL && (
          <GestureDetector gesture={hGesture}>
            <Animated.View style={[{ flex: 1, backgroundColor: '#1D1D1D' }, pageAnimatedStyle]}>
              <EpisodePage
                show={show}
                tvdbId={tvdbId}
                onAdded={bumpLibrary}
                season={season}
                ep={episodes[index] ?? startEp}
                agg={aggregates[episodes[index] ?? startEp]}
                simRef={panRef}
                onScroll={(e) => {
                  const y = e.nativeEvent.contentOffset.y;
                  pageOffsets.current[index] = y;
                  setTitleMode(y > 60);
                  onScroll(e);
                }}
                onScrollBeginDrag={onScrollBeginDrag}
                onScrollSettled={(e) => {
                  const y = e.nativeEvent.contentOffset.y;
                  pageOffsets.current[index] = y;
                  setTitleMode(y > 60);
                  onScrollSettled(e);
                }}
              />
            </Animated.View>
          </GestureDetector>
        )}
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
    start: 12,
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
  notInCatalogue: { color: colors.dim, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
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
  /** Shared by the star row and the legend under it so the two line up: equal
   *  flex columns, not two lots of space-around over different content widths. */
  starCell: { flex: 1, alignItems: 'center', gap: 3 },
  starLegend: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    width: '72%',
    alignSelf: 'center',
    marginTop: 6,
  },
  starLabel: { color: '#D5D5DA', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 },
  /** Your own star is the one the eye should find first. */
  starLabelMine: { color: colors.text, fontWeight: '800' },
  starLabelOther: { color: colors.faint },
  starPct: { color: colors.dim, fontSize: 11, fontWeight: '600' },
  starPctMine: { color: colors.text, fontWeight: '800' },
  emoPct: { color: colors.dim, fontSize: 9, fontWeight: '700' },
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
    end: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charName: { color: colors.dim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, marginTop: 7 },
  // The community's share of the vote, exactly the figure under a feelings
  // tile: same size, same weight, same colour. Rendered only when there IS a
  // number — never a 0% and never a placeholder.
  charPct: { color: colors.dim, fontSize: 9, fontWeight: '700', marginTop: 2 },
  // Dimmed, not hidden: the others stay legible and stay tappable, because
  // changing your mind is one tap and must not feel like undoing something.
  charDim: { opacity: 0.4 },
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
