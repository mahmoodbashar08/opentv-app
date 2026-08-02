/**
 * The bell — the TV Time archive, and now the community's activity beside it.
 *
 * WHAT IT IS: the notification history mined out of a TV Time GDPR export. A
 * genuine archive of a service that is gone, and one of the reasons people
 * install this app.
 *
 * ONE LIST, NOT TWO TABS. The archive and the community's activity are both
 * "things that happened, most recent first", and splitting them made the reader
 * check two places to answer one question. They interleave by date.
 *
 * THE COMMUNITY HALF WAS REMOVED ONCE, AND IS BACK ON PURPOSE. The objection then
 * was that an inbox asks for attention, and this app is a tracker somebody opens
 * when they have watched something. What changed is that the events became real:
 * follows, likes and replies were being recorded by the server and were
 * invisible on every phone, so a person who replied to you was answered by
 * silence. The archive keeps the first tab and is untouched.
 *
 * STILL NO BADGE. That was the part the original objection was actually about —
 * a number on a bell is what turns a place you can visit into a thing that wants
 * you. Read state is tracked (the server keeps `read_at` and this screen marks a
 * watermark on open) so a badge is a decision away, but it is a decision, not an
 * oversight.
 *
 * NOT PUSH. Nothing here leaves the app. There is no push token, no APNs
 * registration and nothing on the Worker that sends — opening this screen is the
 * only way these arrive, which is the quiet version on purpose.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { avatarUri } from '@/community-comments';
import {
  fetchNotifications,
  markNotificationsRead,
  type Notification,
} from '@/community-notifications';
import { useJoined } from '@/community-session';
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

/** One TV Time row — unchanged behaviour, now drawn inside the merged list. */
function ArchiveRow({ item }: { item: ArchiveItem }) {
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
}

// ── one list, both sources ───────────────────────────────────────────────────

/**
 * A row, from either source, carrying only what a row needs.
 *
 * They are merged rather than tabbed because they answer the same question. The
 * archive is on this device and always available; the activity arrives over the
 * network, so the list renders the archive immediately and folds the rest in
 * when it lands rather than holding an empty screen until it does.
 */
type Row =
  | { kind: 'archive'; at: string; item: ArchiveItem }
  | { kind: 'activity'; at: string; item: Notification };

function mergeRows(archive: ArchiveItem[], activity: Notification[]): Row[] {
  const rows: Row[] = [
    ...archive.map((item): Row => ({ kind: 'archive', at: item.date, item })),
    ...activity.map((item): Row => ({ kind: 'activity', at: item.created_at, item })),
  ];
  // Newest first. A dateless archive row (some exports carry none) sorts last
  // rather than to the top on an empty string.
  return rows.sort((a, b) => {
    if (a.at === '' && b.at === '') return 0;
    if (a.at === '') return 1;
    if (b.at === '') return -1;
    return b.at.localeCompare(a.at);
  });
}

// ── the community's activity ─────────────────────────────────────────────────

/**
 * One line per event, in the reader's language.
 *
 * `actor` is null when the person deleted their account — the server sets
 * `actor_id` to NULL and keeps the row, because a like that really happened is
 * better shown as "someone" than hidden.
 */
function activityText(n: Notification): string {
  const who = n.actor?.display_name || n.actor?.handle || t('activity.someone');
  switch (n.kind) {
    case 'follow':
      return t('activity.follow', { who });
    case 'like':
      return t('activity.like', { who });
    case 'reply':
      return t('activity.reply', { who });
    case 'comment':
      return t('activity.comment', { who });
    case 'friend_found':
      return t('activity.friendFound', { who });
    case 'profile':
      return t('activity.profile', { who });
    default:
      // A kind this build does not know about is still an event that happened.
      return who;
  }
}

/** Where a row goes when tapped. A comment lands on the permalink, which shows
 *  it with its replies and a box to answer in; a follow lands on the person. */
function openActivity(n: Notification): void {
  if ((n.kind === 'reply' || n.kind === 'like' || n.kind === 'comment') && n.subject_id != null) {
    router.push(`/comment/${encodeURIComponent(n.subject_id)}`);
    return;
  }
  if (n.actor?.handle != null) router.push(`/profile/${encodeURIComponent(n.actor.handle)}`);
}

/** One community event: who did it, what it was, and where it goes. */
function ActivityRow({ item }: { item: Notification }) {
  const uri = avatarUri(item.actor?.avatar_key);
  return (
    <Pressable style={styles.row} onPress={() => openActivity(item)}>
      {uri != null ? (
        <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Text style={styles.thumbLetter}>{(item.actor?.handle ?? '?').slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.text}>{activityText(item)}</Text>
        <Text style={styles.date}>{prettyDate(item.created_at)}</Text>
      </View>
    </Pressable>
  );
}

// ── the screen ───────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const joined = useJoined();
  const [archive] = useState<ArchiveItem[]>(loadArchive);
  const [activity, setActivity] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    // Nothing to ask for when there is no account, and asking would only cost a
    // round trip to be told so.
    if (!joined) return;
    let cancelled = false;
    void fetchNotifications().then((page) => {
      if (cancelled) return;
      setActivity(page.items);
      setCursor(page.next_cursor);
      // A WATERMARK on the newest row — one request clears everything behind it.
      // Sent even though nothing draws a badge yet, so read state is already
      // true if one is ever added.
      const newest = page.items[0]?.created_at;
      if (newest != null) void markNotificationsRead(newest);
    });
    return () => {
      cancelled = true;
    };
  }, [joined]);

  const rows = mergeRows(archive, activity);

  return (
    <Screen>
      <NavHeader title={t('notifications.title')} />
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === 'activity' ? r.item.id : `a${i}`)}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (cursor == null) return;
          const at = cursor;
          setCursor(null);
          void fetchNotifications(at).then((page) => {
            setActivity((prev) => [...prev, ...page.items]);
            setCursor(page.next_cursor);
          });
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>🔔</Text>
            <Text style={styles.emptyText}>{t('notifications.emptyText')}</Text>
          </View>
        }
        renderItem={({ item: row }) =>
          row.kind === 'archive' ? <ArchiveRow item={row.item} /> : <ActivityRow item={row.item} />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  thumbLetter: { color: colors.yellow, fontWeight: '800', fontSize: 16 },
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
