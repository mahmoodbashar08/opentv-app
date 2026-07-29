/**
 * Review the movies we had to guess at.
 *
 * TV Time's export carries a film's NAME and nothing else, so a generic title
 * ("Superman", "Frozen", "Scream") matches several real films. The importer
 * breaks the tie with the date you watched it — right far more often than not,
 * but not always. Rather than present a guess as fact, those are flagged and
 * listed here.
 *
 * The point is speed: a library with 200 unmatched films used to mean 200
 * manual searches. This turns it into a short list of yes/no confirmations,
 * with Fix match one tap away for the ones that are wrong.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CONTENT_MAX_WIDTH, ContentColumn, EmptyState, NavHeader, Screen } from '@/components/ui';
import { clearMovieGuess, getGuessedMovies } from '@/db';
import { tapLight } from '@/haptics';
import { colors, radius, space } from '@/theme';

export default function ReviewMoviesScreen() {
  const [items, setItems] = useState(() => getGuessedMovies());
  useFocusEffect(
    useCallback(() => {
      setItems(getGuessedMovies());
    }, []),
  );

  const confirm = (name: string) => {
    tapLight();
    clearMovieGuess(name);
    setItems((prev) => prev.filter((m) => m.name !== name));
  };

  const confirmAll = () => {
    tapLight();
    for (const m of items) clearMovieGuess(m.name);
    setItems([]);
  };

  return (
    <Screen>
      <NavHeader title="Review movies" />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          caption="Every movie in your library matched a film we could identify with confidence."
        />
      ) : (
        <>
          <ContentColumn>
            <Text style={styles.intro}>
              Your export gave us these films by name only, and more than one real film shares each name. We picked
              the most likely one — check the poster looks right.
            </Text>
          </ContentColumn>
          <FlatList
            data={items}
            keyExtractor={(m) => m.name}
            contentContainerStyle={{ paddingBottom: 96 }}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable onPress={() => router.push(`/movie/${encodeURIComponent(item.name)}`)}>
                  <View style={styles.poster}>
                    {item.poster ? (
                      <Image source={{ uri: item.poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                    ) : (
                      <Ionicons name="film-outline" size={22} color={colors.faint} />
                    )}
                  </View>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {!!item.year && <Text style={styles.year}>Matched to the {item.year} film</Text>}
                </View>
                <Pressable style={styles.wrongBtn} onPress={() => router.push(`/fix-match?name=${encodeURIComponent(item.name)}&kind=movie`)}>
                  <Text style={styles.wrongText}>Wrong</Text>
                </Pressable>
                <Pressable style={styles.okBtn} onPress={() => confirm(item.name)} hitSlop={6}>
                  <Ionicons name="checkmark" size={20} color={colors.onYellow} />
                </Pressable>
              </View>
            )}
          />
          <View style={styles.allBtnWrap} pointerEvents="box-none">
            <Pressable style={styles.allBtn} onPress={confirmAll}>
              <Text style={styles.allText}>These all look right ({items.length})</Text>
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.dim, fontSize: 13.5, lineHeight: 19, marginHorizontal: space.md, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: space.md, marginBottom: 10 },
  poster: {
    width: 46,
    height: 69,
    borderRadius: radius.poster,
    backgroundColor: colors.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  year: { color: colors.faint, fontSize: 12.5, marginTop: 2 },
  wrongBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.card },
  wrongText: { color: colors.dim, fontSize: 13, fontWeight: '700' },
  okBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allBtnWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    paddingHorizontal: space.md,
    alignItems: 'center',
  },
  allBtn: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    paddingVertical: 15,
    borderRadius: radius.pill,
    backgroundColor: colors.yellow,
    alignItems: 'center',
  },
  allText: { color: colors.onYellow, fontWeight: '800', fontSize: 15 },
});
