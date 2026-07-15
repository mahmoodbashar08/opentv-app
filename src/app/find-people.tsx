import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { MenuRow, NavHeader, Screen } from '@/components/ui';
import { colors, radius, space } from '@/theme';

export default function FindPeopleScreen() {
  return (
    <Screen>
      <NavHeader title="Find people to follow" />
      {/* social isn't live yet — say it up front, like the following screen */}
      <View style={styles.soonCard}>
        <Text style={styles.soonBadge}>COMING SOON</Text>
        <Text style={styles.soonText}>
          Finding friends goes live when accounts arrive. Your old TV Time follows reconnect automatically —
          their ids are already saved from your import.
        </Text>
      </View>
      <MenuRow
        title="Find X friends"
        value="soon"
        icon={
          <View style={[styles.icon, { backgroundColor: '#FFF' }]}>
            <Text style={{ fontWeight: '800', color: '#000' }}>X</Text>
          </View>
        }
      />
      <MenuRow
        title="Find contacts"
        value="soon"
        icon={
          <View style={[styles.icon, { backgroundColor: colors.yellow }]}>
            <Ionicons name="person" size={16} color={colors.onYellow} />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  soonCard: {
    marginHorizontal: space.lg,
    marginTop: 6,
    marginBottom: 10,
    backgroundColor: '#26220E',
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  soonBadge: { color: colors.yellow, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  soonText: { color: '#E3E3E8', fontSize: 13.5, lineHeight: 19 },
});
