/**
 * The shared board under a thread: TV Time's archived comments and other
 * CommsUni apps', read-only (1.6.5, phase one).
 *
 * INVISIBLE UNTIL IT HAS SOMETHING. The contract in `commsuni.ts` is that an
 * outage, a revoked key or a quiet thread all look the same — nothing — so this
 * renders nothing until a first page arrives with at least one comment. A
 * stranger on a day CommsUni is down cannot tell the feature exists.
 *
 * THE BANNER IS THE GUIDE'S, NOT A DECORATION (§9, "Mandatory"): both platform
 * icons from the sources catalogue, "Comments by CommsUni.tv", and an info
 * button opening a card that introduces both names with two outbound links.
 *
 * NOT A SECOND LIST INSIDE A LIST. This sits in the thread's FlatList footer,
 * so it pages by a button rather than by scroll — twenty at a time, which is
 * few enough to render plainly and keeps the one virtualised list the thread
 * screen is built around.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { boardPage, rememberShared, sources as loadSources, type BoardSort, type BoardTarget, type SharedComment, type Source } from '@/commsuni';
import { useJoined } from '@/community-session';
import { CommentCard, formatCommentDate } from '@/components/comment-card';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';

const COMMSUNI_URL = 'https://commsuni.tv';
const ARCHIVE_URL = 'https://tvtime-archive.com';

export function CommsUniBoard({ target }: { target: BoardTarget | null }) {
  const joined = useJoined();
  const [sort, setSort] = useState<BoardSort>('most_liked');
  const [comments, setComments] = useState<SharedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<Source[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [info, setInfo] = useState(false);
  // Whether the first page for this sort has come back with anything at all.
  const [shown, setShown] = useState(false);

  const key = target ? JSON.stringify(target) : '';

  useEffect(() => {
    if (!target || !joined) return;
    let live = true;
    // Replaced only when the new first page lands, so switching sort does not
    // blank the list while it loads.
    void boardPage(target, sort, null).then((page) => {
      if (!live) return;
      setComments(page?.comments ?? []);
      setCursor(page?.nextCursor ?? null);
      if (page?.comments.length) setShown(true);
    });
    void loadSources().then((s) => {
      if (live) setCatalog(s);
    });
    return () => {
      live = false;
    };
    // `key` stands in for the target's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sort, joined]);

  if (!target || !joined || !shown) return null;

  /** A shared comment opens on its own page, like one of ours. */
  const openComment = (c: SharedComment) => {
    tapLight();
    rememberShared(c);
    router.push(`/shared-comment/${encodeURIComponent(c.id)}`);
  };

  const more = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    const page = await boardPage(target, sort, cursor);
    setLoading(false);
    if (!page) return;
    setComments((prev) => [...prev, ...page.comments.filter((c) => !prev.some((p) => p.id === c.id))]);
    setCursor(page.nextCursor);
  };

  // The catalogue is ordered by source id: 1 is the TV Community Archive, and
  // CommsUni itself is matched by slug — the guide's two stable entries.
  const archiveIcon = catalog[0]?.icon ?? null;
  const commsuniIcon = catalog.find((s) => s.slug === 'commsunitv')?.icon ?? null;

  return (
    <View style={styles.wrap}>
      <View style={styles.banner}>
        <View style={styles.icons}>
          {archiveIcon ? <Image source={{ uri: archiveIcon }} style={styles.icon} /> : null}
          {commsuniIcon ? <Image source={{ uri: commsuniIcon }} style={styles.icon} /> : null}
        </View>
        <Text style={styles.byline}>{t('commsuni.byline')}</Text>
        <Pressable
          hitSlop={10}
          accessibilityLabel={t('commsuni.infoTitle')}
          onPress={() => {
            tapLight();
            setInfo(true);
          }}>
          <Ionicons name="information-circle-outline" size={20} color={colors.dim} />
        </Pressable>
      </View>

      <View style={styles.sorts}>
        {(['most_liked', 'most_recent'] as const).map((s) => (
          <Pressable key={s} style={[styles.sort, sort === s && styles.sortOn]} onPress={() => setSort(s)}>
            <Text style={[styles.sortText, sort === s && styles.sortTextOn]}>
              {t(s === 'most_liked' ? 'commsuni.sortLiked' : 'commsuni.sortRecent')}
            </Text>
          </Pressable>
        ))}
      </View>

      {comments.map((c) => (
        <View key={c.id} style={styles.row}>
          <CommentCard
            author={c.author.name ?? '—'}
            avatar={c.author.avatar ? { uri: c.author.avatar } : null}
            date={c.createdAt ? formatCommentDate(c.createdAt) : ''}
            entity={c.origin.displayName || null}
            body={c.text}
            image={c.image ? { source: { uri: c.image }, width: 1, height: 1 } : null}
            likes={c.likes}
            replies={c.replyCount}
            spoiler={c.isSpoiler}
            spoilerReason="flagged"
            revealed={revealed.has(c.id)}
            onReveal={() => setRevealed((prev) => new Set(prev).add(c.id))}
            onPress={() => openComment(c)}
            onReply={() => openComment(c)}
          />
        </View>
      ))}

      {cursor ? (
        <Pressable style={styles.more} onPress={() => void more()} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.dim} /> : <Text style={styles.moreText}>{t('commsuni.more')}</Text>}
        </Pressable>
      ) : null}

      <Modal visible={info} transparent animationType="fade" onRequestClose={() => setInfo(false)}>
        <Pressable style={styles.scrim} onPress={() => setInfo(false)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>{t('commsuni.infoTitle')}</Text>
            <View style={styles.cardRow}>
              {commsuniIcon ? <Image source={{ uri: commsuniIcon }} style={styles.bigIcon} /> : null}
              <Text style={styles.cardText}>
                <Text style={styles.cardStrong}>{t('commsuni.nameCommsuni')}</Text> {t('commsuni.infoCommsuni')}
              </Text>
            </View>
            <View style={styles.cardRow}>
              {archiveIcon ? <Image source={{ uri: archiveIcon }} style={styles.bigIcon} /> : null}
              <Text style={styles.cardText}>
                <Text style={styles.cardStrong}>{t('commsuni.nameArchive')}</Text> {t('commsuni.infoArchive')}
              </Text>
            </View>
            <Text style={styles.cardNote}>{t('commsuni.infoSolo')}</Text>
            <Pressable style={styles.support} onPress={() => void Linking.openURL(COMMSUNI_URL)}>
              <Text style={styles.supportText}>{t('commsuni.support')}</Text>
            </Pressable>
            <Pressable style={styles.archive} onPress={() => void Linking.openURL(ARCHIVE_URL)}>
              <Text style={styles.archiveText}>{t('commsuni.archiveLink')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.xl, paddingBottom: space.xl },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.card,
  },
  icons: { flexDirection: 'row', gap: 4 },
  icon: { width: 20, height: 20, borderRadius: 5 },
  byline: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  sorts: { flexDirection: 'row', gap: space.sm, marginHorizontal: space.lg, marginBottom: space.md },
  sort: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.card },
  sortOn: { backgroundColor: colors.text },
  sortText: { color: colors.dim, fontSize: 13, fontWeight: '600' },
  sortTextOn: { color: colors.bg },
  row: { position: 'relative' },
  more: { alignItems: 'center', paddingVertical: space.md, marginHorizontal: space.lg },
  moreText: { color: colors.blue, fontSize: 15, fontWeight: '600' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: space.lg },
  card: { backgroundColor: colors.panel, borderRadius: radius.card, padding: space.lg, gap: space.md },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  cardRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  bigIcon: { width: 40, height: 40, borderRadius: 10 },
  cardText: { flex: 1, color: colors.dim, fontSize: 14, lineHeight: 20 },
  cardStrong: { color: colors.text, fontWeight: '700' },
  cardNote: { color: colors.faint, fontSize: 13, lineHeight: 18 },
  // The guide's colour for the CommsUni button, #ffd31a.
  support: { backgroundColor: '#ffd31a', borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center' },
  supportText: { color: '#141414', fontSize: 15, fontWeight: '800' },
  archive: { alignItems: 'center', paddingVertical: 6 },
  archiveText: { color: colors.blue, fontSize: 15, fontWeight: '600' },
});
