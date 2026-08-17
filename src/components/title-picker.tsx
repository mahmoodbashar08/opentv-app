/**
 * Choose something out of your own library: a searchable list of what you track.
 *
 * ONE COMPONENT, BECAUSE IT IS ONE STEP. "Which title's artwork" and "which
 * title's GIFs" are the same question with the same answer space, and they had
 * been written twice — a row list in the cover picker, a poster grid in the GIF
 * one — so switching tabs changed the furniture as well as the subject. That
 * reads as two features rather than one choice made two ways.
 *
 * THE ROWS, NOT THE GRID. A grid of posters is prettier and worse here: this
 * list is alphabetical over a whole library, and finding "1917" in it means
 * reading names, which a grid makes you do from artwork you may not recognise
 * at thumbnail size. The row carries both.
 *
 * The caller supplies the items, because callers know different things: the
 * cover picker needs a tvdbId to fetch fanart afterwards, the GIF flow needs
 * only a name. Nothing here contacts anything — the search filters what is
 * already on the phone.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { FlatList, I18nManager, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { artworkChoices } from '@/db';
import { t } from '@/i18n';
import { colors, space } from '@/theme';

/** The least a row needs. Callers may pass richer objects; the extra fields
 *  ride along untouched and come back on `onPick`. */
export type TitleItem = { key: string; name: string; poster?: string | null };

export function TitlePicker<T extends TitleItem>({
  items,
  note,
  empty,
  onPick,
}: {
  /** Defaults to everything in the library with artwork. */
  items?: readonly T[];
  note?: string;
  empty?: string;
  onPick: (item: T) => void;
}) {
  const fallback = useMemo(
    () =>
      items != null
        ? []
        : artworkChoices().map((a) => ({ key: a.ref, name: a.name, poster: a.uri }) as unknown as T),
    [items],
  );
  const all = items ?? fallback;
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((a) => a.name.toLowerCase().includes(needle)) : all;
  }, [all, q]);

  return (
    <>
      {note != null && <Text style={s.note}>{note}</Text>}
      <View style={s.searchRow}>
        <Ionicons name="search" size={20} color={colors.dim} />
        <TextInput
          style={s.searchInput}
          placeholder={t('coverPicker.searchPlaceholder')}
          placeholderTextColor={colors.dim}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
        />
      </View>
      {empty != null && all.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyText}>{empty}</Text>
        </View>
      ) : null}
      <FlatList
        data={shown as T[]}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingBottom: 40 }}
        initialNumToRender={14}
        windowSize={7}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => onPick(item)}>
            {item.poster ? (
              <Image source={{ uri: item.poster }} style={s.thumb} contentFit="cover" />
            ) : (
              <View style={[s.thumb, s.thumbBlank]}>
                <Ionicons name="tv-outline" size={22} color="#FFF" />
              </View>
            )}
            <Text style={s.rowName} numberOfLines={1}>
              {item.name}
            </Text>
            <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.text} />
          </Pressable>
        )}
      />
    </>
  );
}

const s = StyleSheet.create({
  note: { color: colors.faint, fontSize: 12, paddingHorizontal: space.lg, paddingBottom: 8 },
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
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1E',
  },
  thumb: { width: 44, height: 66, borderRadius: 4, backgroundColor: colors.card },
  thumbBlank: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blue },
  rowName: { color: colors.text, fontSize: 17, fontWeight: '600', flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { color: colors.dim, fontSize: 15, textAlign: 'center', paddingHorizontal: 40 },
});
