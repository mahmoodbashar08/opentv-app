import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import badgesJson from '@/data/badges.json';

type AppBadge = { id: string; name: string; image?: string; unlocked?: boolean; date?: string };
type WatchBadge = { id: string; show: string; tier?: string; detail?: string; image?: string; date?: string };
const badges = badgesJson as { app: AppBadge[]; watch: WatchBadge[] };
import { colors, radius } from '@/theme';

// ring-text descriptions for the app badges, like the real detail page
const APP_DESC: Record<string, string> = {
  'voted-character': "You've voted for an actor",
  'got-comment-like': 'Someone liked your comment',
  'commented-episode': "You've commented an episode",
  'created-meme': "You've created a meme",
  'gave-comment-like': "You've liked a comment",
  'chose-emotion': "You've chosen an emotion",
  'used-mobile-version': "You've used the mobile app",
  'checked-user-profile': "You've checked a user profile",
  'displayed-comments': "You've displayed comments",
  'cleared-watchlist': "You've cleared the watchlist",
  'reported-spoiler': "You've reported a spoiler",
  'used-web-version': "You've used the web version",
  'commented-show': "You've commented on a show",
  'archived-show': "You've archived a TV show",
};

function describe(id: string, show?: string): { title: string; desc: string } {
  const marathon = /marathoner-(\d+)-within-(\d+)/.exec(id);
  if (marathon) {
    return {
      title: 'Marathoner',
      desc: `You've watched ${marathon[1]} episodes of ${show} within ${marathon[2]} hours`,
    };
  }
  const quick = /quick-watcher-(\d+)/.exec(id);
  if (quick) {
    return { title: 'Quick Watcher', desc: `You've watched ${quick[1]} episodes of ${show} right after they aired` };
  }
  const serial = /serial-watcher-(\d+)/.exec(id);
  if (serial) {
    return { title: 'Serial Watcher', desc: `You've watched episodes of ${serial[1]} different shows` };
  }
  return { title: show ?? 'Badge', desc: APP_DESC[id] ?? '' };
}

function longDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
}

export default function BadgeScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cardRef = useRef<View>(null);

  const app = badges.app.find((b) => b.id === id);
  const watch = badges.watch.find((b) => b.id === id);
  const image = app?.image ?? watch?.image ?? null;
  const meta = app
    ? { title: app.name, desc: APP_DESC[app.id] ?? '', date: app.date }
    : watch
      ? { ...describe(watch.id, watch.show), date: watch.date }
      : null;

  if (!meta) return null;

  const share = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      await Share.share({ url: uri });
    } catch {
      Share.share({ message: `${meta.title} — ${meta.desc} (OpenTV)` }).catch(() => {});
      void Alert;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Pressable style={[styles.close, { top: insets.top + 10 }]} onPress={() => router.back()} hitSlop={12}>
        <Ionicons name="close" size={28} color={colors.text} />
      </Pressable>

      <View ref={cardRef} collapsable={false} style={styles.card}>
        <Text style={{ fontSize: 96 }}>🏅</Text>
        <Text style={styles.title}>{meta.title}</Text>
        {meta.desc !== '' && <Text style={styles.desc}>{meta.desc}</Text>}
        {longDate(meta.date) && <Text style={styles.date}>{longDate(meta.date)}</Text>}
      </View>

      <View style={{ position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center' }}>
        <Pressable style={styles.shareBtn} onPress={share}>
          <Text style={styles.shareText}>SHARE</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  close: { position: 'absolute', left: 18, zIndex: 2 },
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    backgroundColor: colors.bg,
    gap: 6,
  },
  art: { width: 190, height: 190, marginBottom: 40 },
  title: { color: colors.text, fontSize: 27, fontWeight: '800' },
  desc: { color: '#E3E3E8', fontSize: 17.5, textAlign: 'center', lineHeight: 25, marginTop: 10 },
  date: { color: colors.dim, fontSize: 12.5, fontWeight: '700', letterSpacing: 1, marginTop: 8 },
  shareBtn: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    paddingHorizontal: 52,
  },
  shareText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 1.2 },
});
