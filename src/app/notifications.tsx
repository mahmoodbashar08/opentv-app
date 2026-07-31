/**
 * The bell. Two inboxes behind one icon.
 *
 * WHY TWO TABS RATHER THAN TWO SCREENS. This route already existed, and it
 * already meant something: the notification history mined out of a TV Time GDPR
 * export — a genuine archive of a service that is gone, and one of the reasons
 * people install this app. The community inbox is a second, live feed of the
 * same kind of thing. Replacing the archive with it would have deleted a
 * feature to ship one; hanging the new feed off a second bell would have left
 * two bells. So: one bell, one route, a tab bar, and the archive is untouched.
 *
 * The Community tab only appears for somebody who has joined. Everyone else
 * sees exactly the screen they saw before this phase, with no tab bar at all.
 *
 * READ-MARKING IS A WATERMARK, sent ONCE when the first page lands: the newest
 * row's `created_at`, and the server marks everything at or before it. Not one
 * request per row, not a list of ids — a user coming back from a week away has
 * hundreds, and the badge must clear in a single call.
 *
 * WHAT TAPPING A ROW CAN AND CANNOT DO. `follow` and `friend_found` carry a
 * profile id, and a profile is reachable by handle, so those open the person.
 * `reply` and `like` carry a COMMENT id — and the server publishes no route
 * that turns a comment id back into the show, season and episode its thread
 * hangs on. There is no `GET /v1/comments/:id`, and `GET /v1/comments` filters
 * by target or by parent, never by id. So the plan's "tapping a reply opens the
 * relevant thread" is not implementable against the contract as it stands.
 * Rather than guess a target or leave the row dead, a reply or like opens the
 * actor's profile — the one thing the row genuinely knows how to reach. Fixing
 * it properly is a server change, not a client one.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useJoined } from '@/community-session';
import {
  fetchNotifications,
  markRead,
  type Notification,
} from '@/community-notifications';
import { CommunityAvatar } from '@/components/person-row';
import { NavHeader, Screen, TopTabs } from '@/components/ui';
import { getMeta } from '@/db';
import { currentLocale, t } from '@/i18n';
import { documentFileUri } from '@/library';
import { notificationText, relativeTime } from '@/pure';
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

// ── the community inbox ──────────────────────────────────────────────────────

function CommunityRow({ item, now }: { item: Notification; now: number }) {
  const line = notificationText(item.kind, item.actor?.handle ?? null);
  const age = relativeTime(item.created_at, now);
  const actor = item.actor;

  return (
    <Pressable
      style={[styles.row, item.read_at === null && styles.unread]}
      disabled={actor === null}
      onPress={() => {
        if (actor) router.push(`/profile/${encodeURIComponent(actor.handle)}`);
      }}>
      {actor ? (
        <CommunityAvatar person={actor} size={44} />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Text style={{ fontSize: 18 }}>🔔</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.text}>{t(line.key, line.params)}</Text>
        {age && <Text style={styles.date}>{t(age.key, { count: age.count })}</Text>}
      </View>
      {item.read_at === null && <View style={styles.dot} />}
    </Pressable>
  );
}

function CommunityInbox() {
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // The clock every "3 hours ago" is measured against, stamped when a page
  // lands rather than read during render — `Date.now()` in a render body is
  // impure, and re-stamping on refresh is exactly when ages should move.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void fetchNotifications().then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setCursor(page.next_cursor);
      setNow(Date.now());
      setLoading(false);
      // ONE request, on open, for the whole backlog. The newest row is first —
      // the server orders by (created_at, id) descending — so its timestamp is
      // the high-water mark for everything behind it.
      const newest = page.items[0];
      if (newest) void markRead(newest.created_at);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    const page = await fetchNotifications();
    setItems(page.items);
    setCursor(page.next_cursor);
    setNow(Date.now());
    setRefreshing(false);
    const newest = page.items[0];
    if (newest) void markRead(newest.created_at);
  };

  const loadMore = async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    const page = await fetchNotifications(cursor);
    // Filtered against what is already shown: a notification arriving between
    // two page fetches shifts the window, and the cursor is (created_at, id),
    // so a duplicate is possible even though it is rare.
    setItems((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      return [...prev, ...page.items.filter((n) => !seen.has(n.id))];
    });
    setCursor(page.next_cursor);
    setLoadingMore(false);
  };

  return (
    <FlatList
      data={items}
      keyExtractor={(n) => n.id}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      onEndReachedThreshold={0.4}
      onEndReached={() => void loadMore()}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={styles.spinner} color={colors.dim} />
        ) : (
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>🔔</Text>
            <Text style={styles.emptyText}>{t('community.notifications.empty')}</Text>
          </View>
        )
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.spinner} color={colors.dim} /> : null}
      renderItem={({ item }) => <CommunityRow item={item} now={now} />}
    />
  );
}

// ── the screen ───────────────────────────────────────────────────────────────

const TABS = ['Community', 'TV Time'] as const;

export default function NotificationsScreen() {
  const joined = useJoined();
  const archive = loadArchive();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Community');

  return (
    <Screen>
      <NavHeader title={t('notifications.title')} />
      {joined && (
        <TopTabs
          tabs={TABS}
          labels={{
            Community: t('community.notifications.tabCommunity'),
            'TV Time': t('community.notifications.tabArchive'),
          }}
          active={tab}
          onChange={setTab}
        />
      )}
      {joined && tab === 'Community' ? <CommunityInbox /> : <ArchiveList items={archive} />}
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
