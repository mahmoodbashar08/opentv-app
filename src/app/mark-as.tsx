import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addMovieRewatch, markRewatched, setMovieWatched, unmarkWatched } from '@/db';
import { tapLight } from '@/haptics';
import { colors, space } from '@/theme';

/** "Mark as…" sheet for an already-watched episode or movie: un-watch or +1 rewatch. */
export default function MarkAsSheet() {
  const { show, s, e, movie } = useLocalSearchParams<{ show?: string; s?: string; e?: string; movie?: string }>();
  const showId = Number(show);
  const season = Number(s);
  const episode = Number(e);
  const unwatch = () => (movie ? setMovieWatched(movie, false) : unmarkWatched(showId, season, episode));
  const rewatch = () => (movie ? addMovieRewatch(movie) : markRewatched(showId, season, episode));

  const act = (fn: () => void) => {
    tapLight();
    fn();
    router.back();
  };

  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <View style={styles.sheet}>
        <Text style={styles.title}>Mark as…</Text>
        <Pressable style={styles.row} onPress={() => act(unwatch)}>
          <Ionicons name="eye-off-outline" size={22} color={colors.text} />
          <Text style={styles.label}>Not watched</Text>
        </Pressable>
        <Pressable
          style={[styles.row, { borderBottomWidth: 0 }]}
          onPress={() => act(rewatch)}>
          <View style={styles.plusOne}>
            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '800' }}>+1</Text>
          </View>
          <Text style={styles.label}>Rewatched</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#232326',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 14,
    paddingBottom: 30,
  },
  title: { color: colors.dim, fontSize: 14, fontWeight: '600', paddingHorizontal: space.xl, paddingBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.xl,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333338',
  },
  plusOne: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { color: colors.text, fontSize: 17, fontWeight: '600' },
});
