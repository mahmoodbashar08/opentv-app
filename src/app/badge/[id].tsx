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
import { currentLocale, t } from '@/i18n';
import type { LocaleKey } from '@/locales/keys';

// ring-text descriptions for the app badges, like the real detail page
const APP_DESC_KEY: Record<string, LocaleKey> = {
  'voted-character': 'badge.desc.votedCharacter',
  'got-comment-like': 'badge.desc.gotCommentLike',
  'commented-episode': 'badge.desc.commentedEpisode',
  'created-meme': 'badge.desc.createdMeme',
  'gave-comment-like': 'badge.desc.gaveCommentLike',
  'chose-emotion': 'badge.desc.choseEmotion',
  'used-mobile-version': 'badge.desc.usedMobileVersion',
  'checked-user-profile': 'badge.desc.checkedUserProfile',
  'displayed-comments': 'badge.desc.displayedComments',
  'cleared-watchlist': 'badge.desc.clearedWatchlist',
  'reported-spoiler': 'badge.desc.reportedSpoiler',
  'used-web-version': 'badge.desc.usedWebVersion',
  'commented-show': 'badge.desc.commentedShow',
  'archived-show': 'badge.desc.archivedShow',
};

function describe(id: string, show?: string): { title: string; desc: string } {
  const marathon = /marathoner-(\d+)-within-(\d+)/.exec(id);
  if (marathon) {
    return {
      title: t('badge.marathonerTitle'),
      desc: t('badge.marathonerDesc', { episodes: marathon[1], show: show ?? '', hours: marathon[2] }),
    };
  }
  const quick = /quick-watcher-(\d+)/.exec(id);
  if (quick) {
    return { title: t('badge.quickWatcherTitle'), desc: t('badge.quickWatcherDesc', { count: quick[1], show: show ?? '' }) };
  }
  const serial = /serial-watcher-(\d+)/.exec(id);
  if (serial) {
    return { title: t('badge.serialWatcherTitle'), desc: t('badge.serialWatcherDesc', { count: serial[1] }) };
  }
  const descKey = APP_DESC_KEY[id];
  return { title: show ?? t('badge.defaultTitle'), desc: descKey ? t(descKey) : '' };
}

function longDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(currentLocale(), { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
}

export default function BadgeScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cardRef = useRef<View>(null);

  const app = badges.app.find((b) => b.id === id);
  const watch = badges.watch.find((b) => b.id === id);
  const image = app?.image ?? watch?.image ?? null;
  const meta = app
    ? { title: app.name, desc: APP_DESC_KEY[app.id] ? t(APP_DESC_KEY[app.id]) : '', date: app.date }
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
      Share.share({ message: t('badge.shareMessage', { title: meta.title, desc: meta.desc }) }).catch(() => {});
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
          <Text style={styles.shareText}>{t('badge.share')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  close: { position: 'absolute', start: 18, zIndex: 2 },
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
