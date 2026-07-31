/**
 * The bell — the TV Time notification archive, and only that.
 *
 * WHAT IT IS: the notification history mined out of a TV Time GDPR export. A
 * genuine archive of a service that is gone, and one of the reasons people
 * install this app.
 *
 * THERE WAS A SECOND TAB HERE — a live community inbox of follows, replies and
 * likes — and it was removed on purpose rather than left switched off. An inbox
 * is a thing that asks for attention, and this app is a tracker somebody opens
 * when they have watched something; a feed of other people's activity is a
 * different product wearing the same bell. The server still records the events
 * (`notifications` in the D1 schema) so nothing is lost if that changes, and
 * nothing on the phone asks for them.
 *
 * The badge went with it. A bell that never counts anything does not need one,
 * and the count it drew was community-only — the archive is history and has
 * nothing unread by definition.
 */
import { Image } from 'expo-image';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { getMeta } from '@/db';
import { currentLocale, t } from '@/i18n';
import { documentFileUri } from '@/library';
import { colors, space } from '@/theme';

// ── the TV Time archive (unchanged behaviour, now virtualised) ───────────────

/** Real history from the TV Time export — stored by the importer. */
type ArchiveItem = { text: string; date: string; image: string | null };

function loadArchive(): ArchiveItem[] {
  try {
    return JSON.parse(getMeta('tvtimeNotifications') ?? '[]') as ArchiveItem[];
  } catch {
    return [];
  }
}

function prettyDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale(), { month: 'long', day: 'numeric', year: 'numeric' });
}

function ArchiveList({ items }: { items: ArchiveItem[] }) {
  return (
    <FlatList
      data={items}
      keyExtractor={(_, i) => String(i)}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={{ fontSize: 40 }}>🔔</Text>
          <Text style={styles.emptyText}>{t('notifications.emptyText')}</Text>
        </View>
      }
      renderItem={({ item }) => {
        const uri = documentFileUri(item.image) ?? (item.image?.startsWith('http') ? item.image : null);
        return (
          <View style={styles.row}>
            {uri ? (
              <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback]}>
                <Text style={{ fontSize: 18 }}>🔔</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.text}>{item.text}</Text>
              {item.date !== '' && <Text style={styles.date}>{prettyDate(item.date)}</Text>}
            </View>
          </View>
        );
      }}
    />
  );
}

// ── the screen ───────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  return (
    <Screen>
      <NavHeader title={t('notifications.title')} />
      <ArchiveList items={loadArchive()} />
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
  unread: { backgroundColor: colors.panel },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.yellow },
  thumb: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.raise },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  date: { color: colors.faint, fontSize: 12.5, marginTop: 1 },
  spinner: { marginVertical: 24 },
  empty: { alignItems: 'center', gap: 12, paddingHorizontal: 40, paddingTop: 90 },
  emptyText: { color: colors.dim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
