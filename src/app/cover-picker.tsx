import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { Screen } from '@/components/ui';
import db, { getMovies, setMeta, getMeta } from '@/db';
import { tmdb } from '@/tmdb';
import { colors, space } from '@/theme';


// TV Time's cover flow: pick one of your shows/movies, then one of its
// fanart backdrops becomes your profile cover
type Item = { key: string; name: string; poster: string | null; kind: 'show' | 'movie'; tvdbId?: number; tmdbId?: number | null };
type Backdrop = { path: string };

export default function CoverPickerScreen() {
  const { width: W } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [backdrops, setBackdrops] = useState<Backdrop[] | null>(null);
  const [saving, setSaving] = useState(false);

  const items = useMemo<Item[]>(() => {
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
  }, []);

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
      if (old) {
        try {
          const f = new File(Paths.document, old);
          if (f.exists) f.delete();
        } catch {}
      }
      router.back();
    } catch (err) {
      Alert.alert('Could not set cover', err instanceof Error ? err.message : String(err));
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
            <Ionicons name="chevron-back" size={24} color={colors.text} />
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
            <Text style={{ color: colors.dim, fontSize: 15 }}>No artwork available for this title.</Text>
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
                  style={{ width: W - 2 * space.lg, aspectRatio: 16 / 9, borderRadius: 4, backgroundColor: colors.raise }}
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
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headTitle}>Choose cover photo</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={20} color={colors.dim} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search shows and movies"
          placeholderTextColor={colors.dim}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
        />
      </View>
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
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
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
