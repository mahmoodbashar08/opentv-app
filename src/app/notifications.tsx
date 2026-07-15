import { Image } from 'expo-image';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { getMeta } from '@/db';
import { documentFileUri } from '@/library';
import { colors, space } from '@/theme';

// real history from the TV Time export — stored by the importer
type Item = { text: string; date: string; image: string | null };
function loadFeed(): Item[] {
  try {
    return JSON.parse(getMeta('tvtimeNotifications') ?? '[]') as Item[];
  } catch {
    return [];
  }
}

function prettyDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function NotificationsScreen() {
  const items = loadFeed();

  return (
    <Screen>
      <NavHeader title="Notifications" />
      <ScrollView>
        {items.length === 0 && (
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>🔔</Text>
            <Text style={styles.emptyText}>
              Nothing here yet. Your TV Time notification history arrives with an import; new activity joins it
              when the social features go live.
            </Text>
          </View>
        )}
        {items.map((n, i) => {
          const uri = documentFileUri(n.image) ?? (n.image?.startsWith('http') ? n.image : null);
          return (
            <View key={i} style={styles.row}>
              {uri ? (
                <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 18 }}>🔔</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>{n.text}</Text>
                {n.date !== '' && <Text style={styles.date}>{prettyDate(n.date)}</Text>}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  thumb: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.raise },
  text: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  date: { color: colors.faint, fontSize: 12.5, marginTop: 1 },
  empty: { alignItems: 'center', gap: 12, paddingHorizontal: 40, paddingTop: 90 },
  emptyText: { color: colors.dim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
