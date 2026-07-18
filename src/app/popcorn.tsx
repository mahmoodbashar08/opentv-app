/** 🍿 The popcorn game, playable anytime from Settings — beat your best. */
import { Stack } from 'expo-router';
import { Dimensions, Text, StyleSheet } from 'react-native';

import { PopcornGame } from '@/components/popcorn-game';
import { NavHeader, Screen } from '@/components/ui';
import { colors, space } from '@/theme';

export default function PopcornScreen() {
  const h = Math.max(Dimensions.get('window').height - 260, 320);
  return (
    <Screen>
      {/* sliding the bucket is a horizontal drag — the swipe-back gesture would
          steal it mid-game; the header back button still exits */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      <NavHeader title="Popcorn" />
      <Text style={styles.hint}>Slide the bucket. Catch the popcorn. That's it.</Text>
      <PopcornGame height={h} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.dim, fontSize: 13, marginTop: 4, marginBottom: 2, paddingHorizontal: space.lg },
});
