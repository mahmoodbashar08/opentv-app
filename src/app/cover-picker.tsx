import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, I18nManager, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { track } from '@/analytics';
import { appearanceChanged } from '@/community-appearance';
import { listsChanged } from '@/community-publish';
import { Screen } from '@/components/ui';
import db, { getCustomLists, getMovies, setListCover, setMeta, getMeta } from '@/db';
import { tmdb } from '@/tmdb';
import { colors, space } from '@/theme';
import { t } from '@/i18n';


/**
 * TV Time's cover flow: pick one of your shows/movies, then one of its fanart
 * backdrops becomes your profile cover.
 *
 * OR A LIST'S COVER — `?list=<name>` — which is the same two pages, the same
 * artwork sources and the same fallbacks, differing only in where the URL is
 * written at the end. A second picker would have been a second copy of the
 * TheTVDB-then-TMDB ladder, drifting from this one on the first change to
 * either. In list mode the choice is narrowed to that list's own titles: a
 * cover for "Comfort watches" comes from the comfort watches.
 *
 * NOTHING IS DOWNLOADED for a list. The profile cover is written to disk
 * because it is shown before the network is up; a list cover is a URL from the
 * same catalogue every poster on the screen already comes from.
 */
type Item = { key: string; name: string; poster: string | null; kind: 'show' | 'movie'; tvdbId?: number; tmdbId?: number | null };
type Backdrop = { path: string };

export default function CoverPickerScreen() {
  const { list: listParam } = useLocalSearchParams<{ list?: string }>();
  const listName = listParam != null ? decodeURIComponent(listParam) : null;
  const { width: W } = useWindowDimensions();
  // this screen's lists run full width (image grid + rows, not prose) — the
  // full-bleed backdrop image sizes off the same raw window width as its
  // full-width row, or it would leave dead space beside it on a tablet
  const CONTENT_W = W;
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [backdrops, setBackdrops] = useState<Backdrop[] | null>(null);
  const [saving, setSaving] = useState(false);

  const items = useMemo<Item[]>(() => {
    if (listName != null) {
      // The list's OWN titles. A show carries the id it is keyed by, so the
      // TheTVDB path below works unchanged; a film has only a name, and
      // `tmdbId` is looked up from the movies table where there is one.
      const list = getCustomLists().find((l) => l.name === listName);
      const byName = new Map(getMovies().map((m) => [m.name, m.tmdbId]));
      return (list?.items ?? []).map((it, i) => ({
        key: `${it.kind}${it.tvdbId ?? it.name}${i}`,
        name: it.name,
        poster: it.poster,
        kind: it.kind,
        ...(it.tvdbId != null ? { tvdbId: it.tvdbId } : {}),
        tmdbId: byName.get(it.name) ?? null,
      }));
    }
    const shows = db
      .getAllSync<{ tvdbId: number; name: string; posterUrl: string | null }>('SELECT tvdbId, name, posterUrl FROM shows')
      .map((s) => ({ key: `s${s.tvdbId}`, name: s.name, poster: s.posterUrl, kind: 'show' as const, tvdbId: s.tvdbId }));
    const movies = getMovies().map((m) => ({
      key: `m${m.name}`,
      name: m.name,
      poster: m.poster,
      kind: 'movie' as const,
      tmdbId: m.tmdbId,
    }));
    return [...shows, ...movies].sort((a, b) => a.name.localeCompare(b.name));
  }, [listName]);

  const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())) : items;

  const openItem = async (item: Item) => {
    setSelected(item);
    setBackdrops(null);
    // TheTVDB first — a tracked show already carries the id it is keyed by,
    // so there is no lookup, and it returns full URLs rather than paths
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const t = require('@/tvdb') as typeof import('@/tvdb');
      if (item.kind === 'show' && item.tvdbId != null) {
        const art = await t.tvdbArtworks(item.tvdbId, 'series', t.TVDB_ART_BACKGROUND, 40);
        if (art.length) {
          setBackdrops(art.map((url) => ({ path: url })));
          return;
        }
      }
    } catch {
      // fall through to TMDB
    }
    try {
      let tmdbId = item.tmdbId ?? null;
      const kind: 'tv' | 'movie' = item.kind === 'show' ? 'tv' : 'movie';
      if (item.kind === 'show' && item.tvdbId != null) {
        const found = await tmdb<{ tv_results: { id: number }[] }>(`/find/${item.tvdbId}?external_source=tvdb_id`);
        tmdbId = found.tv_results?.[0]?.id ?? null;
      }
      if (tmdbId == null) {
        setBackdrops([]);
        return;
      }
      const res = await tmdb<{ backdrops: { file_path: string; vote_count?: number }[] }>(`/${kind}/${tmdbId}/images`);
      const sorted = [...(res.backdrops ?? [])]
        .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
        .slice(0, 40)
        .map((b) => ({ path: `https://image.tmdb.org/t/p/w1280${b.file_path}` }));
      setBackdrops(sorted);
    } catch {
      setBackdrops([]);
    }
  };

  const pick = async (path: string) => {
    if (saving) return;
    // A LIST COVER IS JUST THE URL. Nothing to fetch, nothing to write to disk,
    // nothing to clean up after — so it is saved and the screen is gone before
    // the profile path's first `await`.
    if (listName != null) {
      setListCover(listName, path);
      track('list_cover_set');
      listsChanged();
      router.back();
      return;
    }
    setSaving(true);
    try {
      // `path` is a full URL now — TheTVDB's own, or the TMDB one built above
      const res = await fetch(path);
      if (!res.ok) throw new Error('download failed');
      const bytes = new Uint8Array(await res.arrayBuffer());
      // unique filename per change — expo-image caches by uri
      const name = `profile-cover-${Date.now()}.jpg`;
      const old = getMeta('coverFile');
      const dest = new File(Paths.document, name);
      if (dest.exists) dest.delete();
      dest.write(bytes);
      setMeta('coverFile', name);
      setMeta('coverUrl', path);
      // STRAIGHT TO THE SERVER, not on the next launch. Writing meta and
      // waiting for a foreground cycle is how the lists behaved before
      // `listsChanged()` existed, and it looks identical from the outside: you
      // pick a banner, everybody else keeps seeing the old header, and nothing
      // anywhere says why. Fire and forget — it is fingerprinted, so a second
      // call costs one `getMeta`.
      appearanceChanged();
      if (old) {
        try {
          const f = new File(Paths.document, old);
          if (f.exists) f.delete();
        } catch {}
      }
      router.back();
    } catch (err) {
      Alert.alert(t('coverPicker.couldNotSetCoverTitle'), err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // ---- page 2: the chosen title's fanart ---------------------------------------
  if (selected) {
    return (
      <Screen>
        <View style={styles.head}>
          <Pressable onPress={() => setSelected(null)} hitSlop={8}>
            <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headTitle} numberOfLines={1}>
            {selected.name}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        {backdrops == null ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.yellow} />
          </View>
        ) : backdrops.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: colors.dim, fontSize: 15 }}>{t('coverPicker.noArtwork')}</Text>
          </View>
        ) : (
          <FlatList
            data={backdrops}
            keyExtractor={(b) => b.path}
            contentContainerStyle={{ paddingHorizontal: space.lg, gap: 14, paddingBottom: 40, paddingTop: 8 }}
            renderItem={({ item }) => (
              <Pressable onPress={() => pick(item.path)} disabled={saving}>
                <Image
                  source={{ uri: item.path }}
                  style={{ width: CONTENT_W - 2 * space.lg, aspectRatio: 16 / 9, borderRadius: 4, backgroundColor: colors.raise }}
                  contentFit="cover"
                />
              </Pressable>
            )}
          />
        )}
        {saving && (
          <View style={[StyleSheet.absoluteFill as object, styles.center, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <ActivityIndicator color={colors.yellow} size="large" />
          </View>
        )}
      </Screen>
    );
  }

  // ---- page 1: your shows and movies, searchable --------------------------------
  return (
    <Screen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headTitle}>
          {listName != null ? t('plus.lists.chooseCover') : t('editProfile.chooseCover')}
        </Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={20} color={colors.dim} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('coverPicker.searchPlaceholder')}
          placeholderTextColor={colors.dim}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
        />
      </View>
      {listName != null && items.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: colors.dim, fontSize: 15, textAlign: 'center', paddingHorizontal: 40 }}>
            {t('plus.lists.coverNeedsItems')}
          </Text>
        </View>
      ) : null}
      <FlatList
        data={shown}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => openItem(item)}>
            {item.poster ? (
              <Image source={{ uri: item.poster }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue }]}>
                <Ionicons name="tv-outline" size={22} color="#FFF" />
              </View>
            )}
            <Text style={styles.rowName} numberOfLines={1}>
              {item.name}
            </Text>
            <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.text} />
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    gap: 12,
  },
  headTitle: { color: colors.text, fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2E',
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 17, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  thumb: { width: 46, height: 68, borderRadius: 3, backgroundColor: colors.raise },
  rowName: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
