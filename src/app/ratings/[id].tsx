/**
 * Everything about how a show was rated, on its own page.
 *
 * WHY IT LEFT THE ABOUT TAB. The best/worst pair and the grid were rows folded
 * into a tab that already carries where-to-watch, a poll, a cast rail,
 * recommendations, the season chart and comments. Two more collapsible
 * sections there is not a place to read something, it is a place to lose it —
 * and on a real phone that is exactly what happened: both sat below the fold,
 * behind two chevrons, on a page nobody scrolls to the end of.
 *
 * TWO TABS, because there are two questions and they want different shapes.
 * OVERVIEW answers "which one was it" — the best and worst episode, the best
 * and worst season, as cards you can tap. EPISODES answers "how did the whole
 * thing go" — the grid, where an unrated episode is simply an empty cell.
 *
 * THE EXTREMES HERE ARE ACROSS THE WHOLE SHOW, not one season. The chart on
 * the show page is paged by season and its pair follows the page; this is the
 * page somebody opens to ask "which episode", and that answer must not depend
 * on which season they happened to leave open behind them.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { RatingsGrid } from '@/components/ratings-grid';
import { RatingsShareCard } from '@/components/ratings-share-card';
import { NavHeader, Screen, TopTabs } from '@/components/ui';
import { getMeta, getShowRatings } from '@/db';
import { tapSelection } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { getHandle } from '@/community-session';
import { episodeMeta, orderedEpisodes, showMeta } from '@/metadata';
import { fetchSeasonAggregates, readSeasonAggregates } from '@/community-ratings';
import { communityScore, communityScoreFromCounts, ratingGrid } from '@/pure';
import { colors, radius, space } from '@/theme';

const TABS = ['Overview', 'Episodes'] as const;

export default function RatingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tvdbId = Number(id);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const mineCard = useRef<View>(null);
  const theirsCard = useRef<View>(null);

  /*
   * Read ONCE per mount rather than on every render. Nothing on this screen
   * can change a rating — the only way to do that is the episode page, which
   * replaces this one — so there is nothing to invalidate, and the React
   * Compiler holding onto the read is exactly what is wanted here.
   */
  const { episodes, ratings, grid } = useMemo(() => {
    const eps = orderedEpisodes(tvdbId);
    const rs = getShowRatings(tvdbId);
    return { episodes: eps, ratings: rs, grid: ratingGrid(eps, (s, e) => rs.get(`${s}-${e}`) ?? null) };
  }, [tvdbId]);

  const meta = showMeta(tvdbId);
  const name = meta?.name ?? '';
  /** "2014 · 10 episodes" — whatever the show can honestly say about itself. */
  const showSub = [meta?.year, meta?.totalEpisodes ? t('ratings.episodeCount', { count: meta.totalEpisodes }) : null]
    .filter(Boolean)
    .join(' · ');

  /*
   * WHOSE CARD IT IS, AND WHEN IT WAS MADE.
   *
   * The handle when the reader has one, their display name otherwise — a card
   * that says "@" and nothing is worse than a card that says nothing. The date
   * goes on both cards: a community average moves as people vote, and a card
   * with no date is a claim about today being read next month.
   */
  const username = getHandle() ?? getMeta('username') ?? null;
  const madeOn = new Date().toLocaleDateString(currentLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const mineAverage = useMemo(() => {
    const vals = [...ratings.values()];
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [ratings]);

  const { best, worst, flat } = useMemo(() => {
    type P = { season: number; episode: number; value: number };
    let b: P | null = null;
    let w: P | null = null;
    for (const e of episodes) {
      const v = ratings.get(`${e.season}-${e.episode}`);
      if (v == null) continue;
      const p = { season: e.season, episode: e.episode, value: v };
      // First wins a tie: on a five-point scale most of a library ties, and
      // the earliest episode you loved is a stabler answer than whichever one
      // a sort happened to leave on top.
      if (!b || v > b.value) b = p;
      if (!w || v < w.value) w = p;
    }
    /*
     * A TIE IS NOT A PAIR. Rating every episode of a show five stars — which
     * is what most of a TV Time library looks like, since its scale had four
     * points and people used the top one — made the best and the worst the
     * SAME episode, printed twice under two opposite headings. When every
     * rated episode scored the same there is no low point, and saying so is
     * the honest answer.
     */
    if (b && w && b.value === w.value) return { best: b, worst: null, flat: true };
    return { best: b, worst: w, flat: false };
  }, [episodes, ratings]);

  /** Null with fewer than two rated seasons: with one, best and worst are the
   *  same season, and the pair says nothing at all. */
  const seasons = useMemo(() => {
    const rows = grid.seasons
      .map((season) => ({ season, avg: grid.seasonAverage.get(season) ?? null }))
      .filter((r): r is { season: number; avg: number } => r.avg != null);
    if (rows.length < 2) return null;
    const sorted = rows.slice().sort((a, b) => b.avg - a.avg || a.season - b.season);
    return { best: sorted[0]!, worst: sorted[sorted.length - 1]! };
  }, [grid]);

  /*
   * WHAT EVERYBODY ELSE THOUGHT, WHEN YOU HAVE NOT SAID.
   *
   * Opening this page on a show you never rated used to give one sentence and
   * a grey star — technically true and useless, and the first thing tried on
   * a real phone. The community's numbers for the same show are already on the
   * device: the show page fetches a season when you look at it, and this reads
   * that cache and never the network, so a season nobody has opened simply
   * contributes nothing rather than costing a request.
   */
  const readCommunity = () => {
    const seen = [...new Set(episodes.map((e) => e.season))];
    type P = { season: number; episode: number; value: number };
    let b: P | null = null;
    let w: P | null = null;
    /** Per-season means, for the same best/worst pair a rated show gets. */
    const per = new Map<number, number[]>();
    /** The same numbers keyed for the grid, so both tabs draw one source. */
    const cells = new Map<string, number>();
    for (const season of seen) {
      for (const a of Object.values(readSeasonAggregates(tvdbId, season))) {
        if (!a.vote_count) continue;
        const raw =
          a.score_counts === undefined
            ? communityScore(a.vote_count, a.score_sum)
            : communityScoreFromCounts(a.score_counts);
        if (raw == null) continue;
        const value = raw / 2; // the server's 1-10 against this app's five stars
        const p = { season, episode: a.episode, value };
        if (!b || value > b.value) b = p;
        if (!w || value < w.value) w = p;
        if (!per.has(season)) per.set(season, []);
        per.get(season)!.push(value);
        cells.set(`${season}-${a.episode}`, value);
      }
    }
    if (!b || !w || b.episode === w.episode) return null;

    const rows = [...per.entries()]
      .map(([season, vals]) => ({
        season,
        avg: vals.reduce((x, y) => x + y, 0) / vals.length,
        count: vals.length,
      }))
      // Only seasons somebody has actually opened are in the cache, and a
      // season nobody voted on is not a low score — so a pair drawn from one
      // cached season would be a comparison with itself.
      .sort((x, y) => y.avg - x.avg || x.season - y.season);
    const seasons = rows.length >= 2 ? { best: rows[0]!, worst: rows[rows.length - 1]! } : null;

    return { best: b, worst: w, seasons, cells };
  };

  /*
   * HELD IN STATE, NOT MEMOISED AGAINST A COUNTER.
   *
   * `readSeasonAggregates(tvdbId, season)` takes only those two arguments, so
   * the React Compiler is free to cache it against them and ignore any tick
   * added to a dependency list — naming the counter does not save it, because
   * the call does not use it. This project has been bitten by exactly that
   * before (see the note in `useSeasonAggregates`). State that React itself
   * sets is the one invalidation it cannot fold away.
   */
  const [community, setCommunity] = useState<ReturnType<typeof readCommunity>>(() => readCommunity());

  /*
   * FETCH WHAT THE COMMUNITY THOUGHT, rather than only reading what somebody
   * happened to have looked at.
   *
   * This screen read the aggregate cache and nothing else, so opening it on a
   * show whose chart you had never scrolled showed no community grid at all —
   * not "nobody voted", just nothing, with no way to tell the difference.
   *
   * BOUNDED, because a show can have thirty-four seasons and this must not
   * become thirty-four requests on a screen open: the seasons YOU rated first,
   * then the earliest ones, capped at six. `fetchSeasonAggregates` is itself a
   * no-op on a cache that is still fresh, so reopening costs nothing.
   */
  useEffect(() => {
    const mine = [...new Set([...ratings.keys()].map((k) => Number(k.split('-')[0])))];
    const rest = [...new Set(episodes.map((e) => e.season))].filter((s2) => !mine.includes(s2));
    const wanted = [...mine, ...rest].slice(0, 6);
    let alive = true;
    /*
     * READ IN THE CALLBACK, which is the shape both React and this codebase
     * ask for. Setting state straight out of an effect body cascades renders;
     * setting it when the network actually answers is a subscription to an
     * external system, which is what an effect is for.
     */
    void Promise.all(wanted.map((season) => fetchSeasonAggregates(tvdbId, season))).then(() => {
      if (alive) setCommunity(readCommunity());
    });
    return () => {
      alive = false;
    };
    // `readCommunity` closes over the same three, so listing it adds nothing
    // but a new identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvdbId, episodes, ratings]);

  const ratedIn = (season: number) =>
    episodes.filter((e) => e.season === season && ratings.get(`${e.season}-${e.episode}`) != null).length;

  const communityAverage = useMemo(() => {
    const vals = community ? [...community.cells.values()] : [];
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [community]);

  return (
    <Screen>
      <NavHeader title={name} close />
      <TopTabs
        tabs={TABS}
        labels={{ Overview: t('ratings.tabs.overview'), Episodes: t('ratings.tabs.episodes') }}
        active={tab}
        onChange={(v) => setTab(v as (typeof TABS)[number])}
      />
      <ScrollView contentContainerStyle={{ paddingTop: 18, paddingBottom: 40 }}>
        {tab === 'Overview' ? (
          <View style={{ paddingHorizontal: space.lg, gap: 10 }}>
            {/*
              * THE TABS STAY WHATEVER THE ANSWER IS. This screen used to return
              * early with one grey sentence when you had rated nothing — which
              * also took the Episodes tab with it, so the grid could not be
              * reached at all on such a show. The note is a row now, not a
              * replacement for the page.
              */}
            {grid.rated === 0 && (
              <View style={s.noteRow}>
                <Ionicons name="star-outline" size={16} color={colors.faint} />
                <Text style={s.noteText}>{t('ratings.none')}</Text>
              </View>
            )}
            {grid.rated === 0 && community && (
              <>
                <Text style={s.sectionTitle}>{t('ratings.communityHighest')}</Text>
                <EpisodeCard
                  kind="best"
                  tvdbId={tvdbId}
                  season={community.best.season}
                  episode={community.best.episode}
                  value={community.best.value}
                  decimal
                />
                <Text style={s.sectionTitle}>{t('ratings.communityLowest')}</Text>
                <EpisodeCard
                  kind="worst"
                  tvdbId={tvdbId}
                  season={community.worst.season}
                  episode={community.worst.episode}
                  value={community.worst.value}
                  decimal
                />
                {community.seasons && (
                  <>
                    <Text style={s.sectionTitle}>{t('ratings.highestSeason')}</Text>
                    <SeasonCard
                      kind="best"
                      season={community.seasons.best.season}
                      avg={community.seasons.best.avg}
                      rated={community.seasons.best.count}
                    />
                    <Text style={s.sectionTitle}>{t('ratings.lowestSeason')}</Text>
                    <SeasonCard
                      kind="worst"
                      season={community.seasons.worst.season}
                      avg={community.seasons.worst.avg}
                      rated={community.seasons.worst.count}
                    />
                  </>
                )}
              </>
            )}
            {best && (
              <>
                <Text style={s.sectionTitle}>{t('ratings.highestEpisode')}</Text>
                <EpisodeCard kind="best" tvdbId={tvdbId} {...best} />
              </>
            )}
            {worst && (
              <>
                <Text style={s.sectionTitle}>{t('ratings.lowestEpisode')}</Text>
                <EpisodeCard kind="worst" tvdbId={tvdbId} {...worst} />
              </>
            )}
            {flat && <Text style={s.noteText}>{t('ratings.allTheSame')}</Text>}
            {seasons && (
              <>
                <Text style={s.sectionTitle}>{t('ratings.highestSeason')}</Text>
                <SeasonCard
                  kind="best"
                  season={seasons.best.season}
                  avg={seasons.best.avg}
                  rated={ratedIn(seasons.best.season)}
                />
                <Text style={s.sectionTitle}>{t('ratings.lowestSeason')}</Text>
                <SeasonCard
                  kind="worst"
                  season={seasons.worst.season}
                  avg={seasons.worst.avg}
                  rated={ratedIn(seasons.worst.season)}
                />
              </>
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: space.lg }}>
            {/*
              * BOTH GRIDS WHEN THERE ARE BOTH, one under the other and each
              * said aloud. Yours first: this is your library, and the
              * community is the second opinion rather than the headline.
              *
              * Each is wrapped in the view that gets CAPTURED, so the share
              * image is the grid and its heading and nothing else — no tab
              * bar, no scroll position, no half a row at the bottom.
              */}
            {grid.rated > 0 && (
              <GridSection title={t('ratings.yourRatings')} onShare={() => void shareCard(mineCard)}>
                <RatingsGrid episodes={episodes} ratings={ratings} />
              </GridSection>
            )}
            {community && (
              <GridSection
                title={t('ratings.communityRatings')}
                note={grid.rated > 0 ? undefined : t('ratings.gridCommunityNote')}
                onShare={() => void shareCard(theirsCard)}>
                <RatingsGrid episodes={episodes} ratings={community.cells} decimal />
              </GridSection>
            )}
            {grid.rated === 0 && !community && (
              <RatingsGrid episodes={episodes} ratings={new Map()} />
            )}
          </View>
        )}
      </ScrollView>

      {/*
        * THE CAPTURED CARDS, PARKED OFF-SCREEN.
        *
        * `captureRef` photographs a real, laid-out view, so these have to be
        * mounted — but they must not be part of the page, which is scrolled,
        * themed and the wrong shape. Pushed off the left edge rather than
        * hidden: `display: none` has no layout and captures nothing.
        */}
      <View style={s.offscreen} pointerEvents="none">
        {grid.rated > 0 && (
          <View ref={mineCard} collapsable={false}>
            <RatingsShareCard
              show={name}
              heading={t('ratings.yourRatings')}
              who={username}
              madeOn={madeOn}
              poster={meta?.poster}
              sub={showSub}
              average={mineAverage}
              rated={grid.rated}
              ratedLabel={t('ratings.figureRated')}
              averageLabel={t('ratings.figureAverage')}>
              <RatingsGrid episodes={episodes} ratings={ratings} onPicture maxRows />
            </RatingsShareCard>
          </View>
        )}
        {community && (
          <View ref={theirsCard} collapsable={false}>
            <RatingsShareCard
              show={name}
              heading={t('ratings.communityRatings')}
              madeOn={madeOn}
              poster={meta?.poster}
              sub={showSub}
              average={communityAverage}
              rated={community.cells.size}
              ratedLabel={t('ratings.figureRated')}
              averageLabel={t('ratings.figureAverage')}>
              <RatingsGrid episodes={episodes} ratings={community.cells} decimal onPicture maxRows />
            </RatingsShareCard>
          </View>
        )}
      </View>
    </Screen>
  );
}

/**
 * A grid on the page, with the control that turns it into a picture.
 *
 * The share BUTTON lives here and the share CARD lives in
 * `ratings-share-card.tsx`, rendered off-screen: what is captured is composed
 * for being looked at on its own — poster, title, figures, brand — and not the
 * page as it happens to be scrolled.
 */
function GridSection({
  title,
  note,
  onShare,
  children,
}: {
  title: string;
  note?: string;
  onShare: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ paddingBottom: 22 }}>
      <View style={s.gridHead}>
        <Text style={s.gridTitle}>{title}</Text>
        <Pressable
          onPress={() => {
            tapSelection();
            onShare();
          }}
          hitSlop={10}>
          <Ionicons name="share-outline" size={20} color={colors.dim} />
        </Pressable>
      </View>
      {!!note && <Text style={s.noteText}>{note}</Text>}
      {children}
    </View>
  );
}

/**
 * Capture one card and hand it to the share sheet.
 *
 * The same two lazy requires the profile card uses: both native modules exist
 * only in a real build, and a screen that imported them at the top would not
 * load at all in a JS-only environment.
 */
async function shareCard(ref: React.RefObject<View | null>): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
    const uri = await captureRef(ref, { format: 'jpg', quality: 0.92 });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'image/jpeg',
        UTI: 'public.jpeg',
        dialogTitle: t('ratings.shareTitle'),
      });
      return;
    }
    // Sharing unavailable: iOS still accepts a file url through Share.
    await Share.share({ url: uri });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Alert.alert(t('ratings.shareFailedTitle'), msg);
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function EpisodeCard({
  kind,
  tvdbId,
  season,
  episode,
  value,
  decimal,
}: {
  kind: 'best' | 'worst';
  tvdbId: number;
  season: number;
  episode: number;
  value: number;
  /** A community average is 3.4, not three stars and a bit — show the number
   *  rather than rounding it into a row of glyphs that claims more precision
   *  in one direction and less in the other. */
  decimal?: boolean;
}) {
  const em = episodeMeta(tvdbId, season, episode);
  return (
    <Pressable
      style={s.card}
      onPress={() => {
        tapSelection();
        router.push(`/episode/${tvdbId}-s${season}e${episode}`);
      }}>
      {/* A show whose stills never downloaded gets the badge rather than a grey
          rectangle pretending to be a picture. */}
      {em?.still ? (
        <Image source={{ uri: em.still }} style={s.still} contentFit="cover" transition={120} />
      ) : (
        <View style={[s.still, s.stillEmpty]}>
          <Ionicons name={kind === 'best' ? 'trophy' : 'thumbs-down'} size={18} color={colors.faint} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.code}>{`S${String(season).padStart(2, '0')} / E${String(episode).padStart(2, '0')}`}</Text>
        <Text style={s.title} numberOfLines={2}>
          {em?.title ?? ''}
        </Text>
        <View style={s.foot}>
          <Text style={s.stars}>{decimal ? value.toFixed(1) : '★'.repeat(value)}</Text>
          {!!em?.air && <Text style={s.dim}>{shortDate(em.air)}</Text>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

function SeasonCard({
  kind,
  season,
  avg,
  rated,
}: {
  kind: 'best' | 'worst';
  season: number;
  avg: number;
  rated: number;
}) {
  return (
    <View style={s.card}>
      <View style={[s.still, s.stillEmpty]}>
        <Text style={s.seasonNum}>{season === 0 ? '★' : season}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.code}>{t('show.season', { n: season })}</Text>
        <View style={s.foot}>
          <Text style={[s.stars, { color: kind === 'best' ? colors.green : colors.danger }]}>
            {avg.toFixed(1)}
          </Text>
          <Text style={s.dim}>{t('show.extremes.episodes', { count: rated })}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  sectionTitle: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 12,
  },
  still: { width: 84, height: 52, borderRadius: 6, backgroundColor: colors.panel },
  stillEmpty: { alignItems: 'center', justifyContent: 'center' },
  seasonNum: { color: colors.dim, fontSize: 22, fontWeight: '900' },
  code: { color: colors.dim, fontSize: 12, fontWeight: '700' },
  title: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 2 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  stars: { color: colors.yellow, fontSize: 13, letterSpacing: 1 },
  dim: { color: colors.faint, fontSize: 12 },
  /** Off the left edge: mounted and laid out, never seen, always capturable. */
  /**
   * Off the left edge: mounted and laid out, never seen, always capturable.
   *
   * NO FIXED WIDTH. The card sizes to its own content — a seven-season grid is
   * wider than a phone, and forcing it to 360 would clip the seasons off the
   * right of the picture.
   */
  offscreen: { position: 'absolute', left: -4000, top: 0 },
  gridHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 },
  gridTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  card2: { backgroundColor: colors.bg, borderRadius: radius.card, paddingTop: 2 },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 12,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  brandShow: { color: colors.dim, fontSize: 12, flex: 1 },
  brandMark: { color: colors.yellow, fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  noteText: { color: colors.dim, fontSize: 13, flex: 1 },
});
