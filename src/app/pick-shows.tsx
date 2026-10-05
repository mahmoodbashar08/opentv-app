/**
 * "Add your shows" — the first minute of a fresh start (1.6.7).
 *
 * A fresh start went welcome → your name → an EMPTY library, and nothing
 * helped fill it: 41 of 141 accounts had no library at all (5 Oct). TV Time's
 * first minute was a grid of posters you tap, and that is this: this week's
 * trending series, a search box above them, one tap to pick (yellow check),
 * and Continue as soon as there is one.
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

import { addShow } from '@/db';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { artworkUrl } from '@/pure';
import { leaveOnboarding } from '@/session-store';
import { colors, space } from '@/theme';
import { tvdbSearch, tvdbTrending } from '@/tvdb';

type Pick = { tvdbId: number; name: string; poster: string | null };

const COLS = 3;
const GAP = 10;

export default function PickShowsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const onboarding = from === 'onboarding';

  const [trending, setTrending] = useState<Pick[] | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Pick[] | null>(null);
  const [picked, setPicked] = useState<Map<number, Pick>>(new Map());

  useEffect(() => {
    let live = true;
    void tvdbTrending().then((d) => {
      if (!live) return;
      setTrending(
        (d?.series ?? []).filter((s) => s.name).map((s) => ({ tvdbId: s.id, name: s.name!, poster: artworkUrl(s.image ?? null) })),
      );
    });
    return () => {
      live = false;
    };
  }, []);

  // Search after a pause in typing, not on every key.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      void tvdbSearch(q).then((hits) => {
        if (live) setFound(hits.map((h) => ({ tvdbId: h.tvdbId, name: h.name, poster: h.image })));
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const toggle = (p: Pick) => {
    tapSelection();
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(p.tvdbId)) next.delete(p.tvdbId);
      else next.set(p.tvdbId, p);
      return next;
    });
  };

  const finish = (add: boolean) => {
    if (add) {
      tapLight();
      for (const p of picked.values()) addShow(p.tvdbId, p.name, p.poster);
    }
    if (onboarding) leaveOnboarding();
    else router.back();
  };

  const tile = (width - space.lg * 2 - GAP * (COLS - 1)) / COLS;
  // Under two letters it is the trending grid, whatever the last search found.
  const list = query.trim().length >= 2 ? (found ?? null) : trending;

  return (
    <View style={[s.screen, { paddingTop: insets.top + space.md }]}>
      <View style={s.head}>
        <Text style={s.title}>{t('pickShows.title')}</Text>
        <Pressable hitSlop={12} onPress={() => finish(false)}>
          <Text style={s.skip}>{t('pickShows.skip')}</Text>
        </Pressable>
      </View>
      <Text style={s.sub}>{t('pickShows.sub')}</Text>
      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={colors.dim} />
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t('pickShows.search')}
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
        <Pressable style={[s.cta, picked.size === 0 && s.ctaOff]} disabled={picked.size === 0} onPress={() => finish(true)}>
          <Text style={s.ctaText}>
            {picked.size === 0 ? t('pickShows.pickOne') : t('pickShows.continue', { count: picked.size })}
          </Text>
        </Pressable>
      </View>
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
});
