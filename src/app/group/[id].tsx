import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NavHeader, PillButton, Screen } from '@/components/ui';
import { colors, radius, space } from '@/theme';

const TOPICS = [
  { text: 'Topics from members appear here when the social layer arrives.', replies: 0 },
  { text: 'Until then this page shows the full group layout.', replies: 0 },
];

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const name = id ? id[0].toUpperCase() + id.slice(1) : 'Group';

  return (
    <Screen>
      <NavHeader title={name} right={<Ionicons name="share-outline" size={20} color={colors.text} />} />
      <ScrollView>
        <View style={styles.banner}>
          <Text style={{ color: 'rgba(255,255,255,.65)', fontSize: 26, fontWeight: '800' }}>{name}</Text>
        </View>
        <Text style={styles.desc}>Discuss {name} with other fans — topics, polls and hot takes.</Text>
        <View style={styles.joinRow}>
          <PillButton label="○ Join" variant="white" small />
          <Text style={styles.meta}>54.9K 👥 &nbsp; 2.7K 💬</Text>
        </View>
        <Text style={styles.sort}>
          SORT BY <Text style={{ color: colors.blue }}>Newest</Text>
        </Text>
        {TOPICS.map((t, i) => (
          <View key={i} style={styles.topicRow}>
            <View style={styles.avatar} />
            <Text style={styles.topicText}>{t.text}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.faint} />
          </View>
        ))}
      </ScrollView>
      <Pressable style={styles.fab} onPress={() => router.push('/create-topic')}>
        <Ionicons name="pencil" size={22} color={colors.onYellow} />
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    aspectRatio: 16 / 7,
    marginHorizontal: space.lg,
    borderRadius: radius.card,
    backgroundColor: '#2A3550',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desc: { color: '#E3E3E8', fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg, marginTop: 14 },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginTop: 14,
  },
  meta: { color: colors.text, fontSize: 14.5 },
  sort: {
    color: colors.dim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#1B1B1E',
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.raise },
  topicText: { color: colors.text, fontSize: 14.5, flex: 1, lineHeight: 20 },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 28,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
