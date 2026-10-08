/**
 * "Add your shows" — the first minute of a fresh start (1.6.7).
 *
 * A fresh start went welcome → your name → an EMPTY library, and nothing
 * helped fill it: 41 of 141 accounts had no library at all (5 Oct). TV Time's
 * first minute was a grid of posters you tap, and that is this: this week's
 * trending series, a search box above them, one tap to pick (yellow check),
 * and Continue as soon as there is one.
 *
 * STEP 2, "Where are you?" — TV Time's other half of that minute. Each pick
 * gets Not started / Up to date / Partway (an S·E stepper), never ticking
 * episode by episode. Episodes come straight from TheTVDB, since a show added
 * a second ago has no metadata yet.
 *
 * STEP 3, films you have seen — fresh start only. A pick is a watched film.
 *
 * Reached two ways: from setup-profile (`from=onboarding`, which finishes
 * onboarding on Continue or Skip) and from the Shows tab while it is empty.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addMovieToWatchlist, addShow, markWatched, setMovieWatched } from '@/db';
import { tapLight, tapSelection } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { TVDB_LANG, artworkUrl } from '@/pure';
import { leaveOnboarding } from '@/session-store';
import { colors, space } from '@/theme';
import { pool } from '@/tmdb';
import { tvdbEpisodes, tvdbMovieTranslation, tvdbSeries, tvdbSearch, tvdbSearchMovies, tvdbTranslation, tvdbTrending, type TvdbEpisode } from '@/tvdb';

type Pick = { tvdbId: number; name: string; poster: string | null; year: string | null };

/** Aired, numbered episodes — specials (season 0) and the unaired are never ticked. */
function airedOnly(eps: TvdbEpisode[]): TvdbEpisode[] {
  const today = new Date().toISOString().slice(0, 10);
  return eps.filter((x) => x.seasonNumber > 0 && x.aired != null && x.aired <= today);
}

type Where = { mode: 'none' | 'all' | 'partway'; at: number };

const COLS = 3;
const EP_W = 52;
const GAP = 10;

export default function PickShowsScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const onboarding = from === 'onboarding';
  const [stage, setStage] = useState<'shows' | 'where' | 'films'>('shows');
  // Frozen at Continue: step 2 fetches per pick, and a fresh array each render would refetch for ever.
  const [chosen, setChosen] = useState<Pick[]>([]);

  const done = () => {
    if (onboarding) leaveOnboarding();
    else router.back();
  };
  // Films are step 3 of a fresh start only; from the empty Shows tab it ends at shows.
  const afterShows = () => (onboarding ? setStage('films') : done());

  if (stage === 'where') return <WhereStep picks={chosen} onDone={afterShows} />;
  if (stage === 'films') {
    return (
      <PickGrid
        kind="movie"
        onSkip={done}
        onContinue={(ps) => {
          for (const p of ps) {
            addMovieToWatchlist(p.name, p.poster, p.year, null, p.tvdbId);
            setMovieWatched(p.name, true);
          }
          done();
        }}
      />
    );
  }
  return (
    <PickGrid
      kind="tv"
      onSkip={afterShows}
      onContinue={(ps) => {
        for (const p of ps) addShow(p.tvdbId, p.name, p.poster);
        setChosen(ps);
        setStage('where');
      }}
    />
  );
}

/** The poster grid both steps share: this week's trending, a search box, tap to pick. */
function PickGrid({ kind, onSkip, onContinue }: { kind: 'tv' | 'movie'; onSkip: () => void; onContinue: (picks: Pick[]) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const film = kind === 'movie';

  const [trending, setTrending] = useState<Pick[] | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Pick[] | null>(null);
  const [picked, setPicked] = useState<Map<number, Pick>>(new Map());

  useEffect(() => {
    let live = true;
    void tvdbTrending().then(async (d) => {
      if (!live) return;
      const list = ((film ? d?.movies : d?.series) ?? [])
        .filter((x) => x.name)
        .map((x) => ({ tvdbId: x.id, name: x.name!, poster: artworkUrl(x.image ?? null), year: x.year ?? null }));
      setTrending(list);
      // Trending carries ORIGINAL titles (兰香如故, らんま½): the reader's
      // language, else English, else that. Shown first, renamed as they land.
      const lang = TVDB_LANG[currentLocale().slice(0, 2)] ?? 'eng';
      const tr = film ? tvdbMovieTranslation : tvdbTranslation;
      const named = await pool(
        list,
        async (p) => {
          const name = (await tr(p.tvdbId, lang))?.name ?? (lang === 'eng' ? null : (await tr(p.tvdbId, 'eng'))?.name);
          return name ? { ...p, name } : p;
        },
        6,
      );
      if (live) setTrending(named.map((n, i) => n ?? list[i]));
    });
    return () => {
      live = false;
    };
  }, [film]);

  // Search after a pause in typing, not on every key.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      const lang = TVDB_LANG[currentLocale().slice(0, 2)] ?? 'eng';
      void (film ? tvdbSearchMovies(q, lang) : tvdbSearch(q, lang)).then((hits) => {
        if (live) setFound(hits.map((h) => ({ tvdbId: h.tvdbId, name: h.name, poster: h.image, year: h.year })));
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, film]);

  const toggle = (p: Pick) => {
    tapSelection();
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(p.tvdbId)) next.delete(p.tvdbId);
      else next.set(p.tvdbId, p);
      return next;
    });
  };

  const tile = (width - space.lg * 2 - GAP * (COLS - 1)) / COLS;
  // Under two letters it is the trending grid, whatever the last search found.
  const list = query.trim().length >= 2 ? (found ?? null) : trending;

  return (
    <View style={[s.screen, { paddingTop: insets.top + space.md }]}>
      <View style={s.head}>
        <Text style={s.title}>{t(film ? 'pickShows.filmsTitle' : 'pickShows.title')}</Text>
        <Pressable hitSlop={12} onPress={onSkip}>
          <Text style={s.skip}>{t('pickShows.skip')}</Text>
        </Pressable>
      </View>
      <Text style={s.sub}>{t(film ? 'pickShows.filmsSub' : 'pickShows.sub')}</Text>
      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={colors.dim} />
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t(film ? 'pickShows.filmsSearch' : 'pickShows.search')}
          placeholderTextColor={colors.faint}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {list == null ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.dim} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => String(p.tvdbId)}
          numColumns={COLS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingHorizontal: space.lg, paddingBottom: 120 }}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={<Text style={s.none}>{t('pickShows.none')}</Text>}
          renderItem={({ item }) => {
            const on = picked.has(item.tvdbId);
            return (
              <Pressable
                style={{ width: tile }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={item.name}
                onPress={() => toggle(item)}>
                <View style={[s.poster, { height: tile * 1.5 }, on && s.posterOn]}>
                  {item.poster ? (
                    <Image source={{ uri: item.poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                  ) : (
                    <Text style={s.noPoster} numberOfLines={3}>
                      {item.name}
                    </Text>
                  )}
                  {on && (
                    <View style={s.check}>
                      <Ionicons name="checkmark" size={18} color={colors.onYellow} />
                    </View>
                  )}
                </View>
                <Text style={s.name} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <Pressable style={[s.cta, picked.size === 0 && s.ctaOff]} disabled={picked.size === 0} onPress={() => {
            tapLight();
            onContinue([...picked.values()]);
          }}>
          <Text style={s.ctaText}>
            {picked.size === 0 ? t('pickShows.pickOne') : t('pickShows.continue', { count: picked.size })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * STEP 2, AS THE CARD PEOPLE ALREADY KNOW (8 Oct). It was three chips and two
 * S/E steppers — a form. Now each show is the "Continue tracking" card: the
 * episode you are on, with its still and title, a row of seasons and a row of
 * that season's episodes to tap (scrolled to where you are), and one tap for "watched it
 * all". Everything before the card's episode is marked watched; nothing else.
 */
function WhereStep({ picks, onDone }: { picks: Pick[]; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [eps, setEps] = useState<Map<number, TvdbEpisode[] | null>>(new Map());
  // Per show: which answer, and for "partway" the index of the NEXT episode.
  const [where, setWhere] = useState<Map<number, Where>>(new Map());
  // An ended show is "Finished", a running one "Up to date" — the same answer,
  // said the way each one is true.
  const [ended, setEnded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let live = true;
    void pool(
      picks,
      async (p) => {
        const [list, meta] = await Promise.all([tvdbEpisodes(p.tvdbId), tvdbSeries(p.tvdbId)]);
        if (!live) return;
        setEps((m) => new Map(m).set(p.tvdbId, list ? airedOnly(list) : null));
        if (meta?.status?.name === 'Ended') setEnded((e) => new Set(e).add(p.tvdbId));
      },
      4,
    );
    return () => {
      live = false;
    };
  }, [picks]);

  const set = (id: number, w: Where) => {
    tapSelection();
    setWhere((m) => new Map(m).set(id, w));
  };

  const apply = () => {
    tapLight();
    for (const p of picks) {
      const w = where.get(p.tvdbId);
      const list = eps.get(p.tvdbId);
      if (!w || w.mode === 'none' || !list) continue;
      const n = w.mode === 'all' ? list.length : w.at;
      // ponytail: watched "now", like the show screen's Mark all — real dates are unknown.
      for (const x of list.slice(0, n)) markWatched(p.tvdbId, x.seasonNumber, x.number);
    }
    onDone();
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + space.md }]}>
      <View style={s.head}>
        <Text style={s.title}>{t('pickShows.whereTitle')}</Text>
        <Pressable hitSlop={12} onPress={onDone}>
          <Text style={s.skip}>{t('pickShows.skip')}</Text>
        </Pressable>
      </View>
      <Text style={s.sub}>{t('pickShows.whereSub')}</Text>
      <FlatList
        data={picks}
        keyExtractor={(p) => String(p.tvdbId)}
        contentContainerStyle={{ gap: space.xl, padding: space.lg, paddingBottom: 120 }}
        renderItem={({ item }) => (
          <WhereCard
            pick={item}
            list={eps.get(item.tvdbId)}
            ended={ended.has(item.tvdbId)}
            where={where.get(item.tvdbId) ?? { mode: 'none', at: 1 }}
            onSet={(w) => set(item.tvdbId, w)}
          />
        )}
      />
      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <Pressable style={s.cta} onPress={apply}>
          <Text style={s.ctaText}>{t('pickShows.done')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function WhereCard({
  pick,
  list,
  ended,
  where,
  onSet,
}: {
  pick: Pick;
  list: TvdbEpisode[] | null | undefined;
  ended: boolean;
  where: Where;
  onSet: (w: Where) => void;
}) {
  const head = (
    <View style={s.rowHead}>
      <View style={s.thumb}>{pick.poster && <Image source={{ uri: pick.poster }} style={StyleSheet.absoluteFill} contentFit="cover" />}</View>
      <Text style={s.rowName} numberOfLines={2}>
        {pick.name}
      </Text>
    </View>
  );
  if (list === undefined) return <View style={s.row}>{head}<ActivityIndicator color={colors.dim} style={{ alignSelf: 'flex-start' }} /></View>;
  if (!list || list.length === 0) return <View style={s.row}>{head}</View>;

  // Partway always points at a real episode after the first.
  const at = Math.min(Math.max(where.at, 1), list.length - 1);
  const ep = list[at]!;
  const seasons = [...new Set(list.map((x) => x.seasonNumber))].sort((a, b) => a - b);
  const inSeason = list.map((e, i) => ({ ep: e, i })).filter((x) => x.ep.seasonNumber === ep.seasonNumber);
  const modes = (['none', 'all', 'partway'] as const).filter((m) => m !== 'partway' || list.length > 1);

  return (
    <View style={s.row}>
      {head}
      <View style={s.chips}>
        {modes.map((m) => (
          <Pressable
            key={m}
            style={[s.chip, where.mode === m && s.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: where.mode === m }}
            onPress={() => onSet({ mode: m, at })}>
            <Text style={[s.chipText, where.mode === m && s.chipTextOn]}>
              {t(m === 'none' ? 'pickShows.notStarted' : m === 'all' ? (ended ? 'pickShows.finished' : 'pickShows.upToDate') : 'pickShows.partway')}
            </Text>
          </Pressable>
        ))}
      </View>
      {where.mode === 'partway' && (
        <>
          <View style={s.card}>
            <View style={s.still}>
              {ep.image ? (
                <Image source={{ uri: ep.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : pick.poster ? (
                <Image source={{ uri: pick.poster }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
            </View>
            <View style={s.cardText}>
              <Text style={s.cardKicker}>{t('pickShows.nextUp')}</Text>
              <Text style={s.cardEp}>
                S{String(ep.seasonNumber).padStart(2, '0')} | E{String(ep.number).padStart(2, '0')}
              </Text>
              {ep.name ? (
                <Text style={s.cardName} numberOfLines={1}>
                  {ep.name}
                </Text>
              ) : null}
            </View>
          </View>
          {/* Seasons, then that season's episodes — tap the next one to watch. */}
          <FlatList
            horizontal
            data={seasons}
            keyExtractor={(n) => String(n)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
            renderItem={({ item: n }) => (
              <Pressable
                style={[s.seasonPill, n === ep.seasonNumber && s.seasonOn]}
                onPress={() => onSet({ mode: 'partway', at: Math.max(1, list.findIndex((x) => x.seasonNumber === n)) })}>
                <Text style={[s.seasonText, n === ep.seasonNumber && s.seasonTextOn]}>S{n}</Text>
              </Pressable>
            )}
          />
          <FlatList
            key={ep.seasonNumber}
            horizontal
            data={inSeason}
            keyExtractor={(x) => String(x.i)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
            getItemLayout={(_, i) => ({ length: EP_W + 8, offset: (EP_W + 8) * i, index: i })}
            initialScrollIndex={Math.max(0, inSeason.findIndex((x) => x.i === at) - 2)}
            renderItem={({ item: x }) => (
              <Pressable
                style={[s.epPill, x.i === at && s.seasonOn, x.i === 0 && { opacity: 0.35 }]}
                disabled={x.i === 0}
                onPress={() => onSet({ mode: 'partway', at: x.i })}>
                <Text style={[s.seasonText, x.i === at && s.seasonTextOn]}>E{x.ep.number}</Text>
              </Pressable>
            )}
          />
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  skip: { color: colors.dim, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.dim, fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg, marginTop: 6 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: space.lg,
    marginVertical: space.md,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  search: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 11 },
  poster: { borderRadius: 10, overflow: 'hidden', backgroundColor: colors.card, justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  posterOn: { borderColor: colors.yellow },
  noPoster: { color: colors.dim, fontSize: 13, fontWeight: '700', textAlign: 'center', padding: 8 },
  check: {
    position: 'absolute',
    top: 6,
    end: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.text, fontSize: 12, fontWeight: '600', marginTop: 4 },
  none: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 40 },
  bar: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.bg },
  cta: { backgroundColor: colors.yellow, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: colors.onYellow, fontSize: 16, fontWeight: '800' },
  row: { gap: space.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 44, height: 66, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.card },
  rowName: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#000', borderRadius: 16, overflow: 'hidden', height: 96 },
  still: { width: '40%', height: '100%', backgroundColor: colors.card },
  cardText: { flex: 1, paddingHorizontal: 14, gap: 2 },
  cardKicker: { color: colors.dim, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  cardEp: { color: colors.text, fontSize: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cardName: { color: colors.dim, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.yellow },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: colors.onYellow },
  epPill: { width: EP_W, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: colors.card },
  seasonPill: { paddingHorizontal: 14, height: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: colors.card },
  seasonOn: { backgroundColor: colors.yellow },
  seasonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  seasonTextOn: { color: colors.onYellow },
});
