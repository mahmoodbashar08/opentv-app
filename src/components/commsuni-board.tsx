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

import { boardPage, recordDecision, rememberShared, sources as loadSources, type BoardSort, type BoardTarget, type SharedComment, type Source } from '@/commsuni';
import { useJoined } from '@/community-session';
import { CommentCard, formatCommentDate } from '@/components/comment-card';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';
import { sharedAuthorName } from '@/pure';
import { sharedPicture as pictureOf } from '@/components/shared-picture';

const COMMSUNI_URL = 'https://commsuni.tv';
const ARCHIVE_URL = 'https://tvtime-archive.com';

/**
 * The board's data, for the thread to merge with its own comments: ONE list,
 * as agreed with CommsUni (§9) — not a second section under ours. `active` is
 * false until a first page arrives with something in it, so a quiet thread or
 * an outage looks exactly like a thread with no shared comments.
 */
export function useBoard(target: BoardTarget | null) {
  const joined = useJoined();
  const [sort, setSort] = useState<BoardSort>('most_liked');
  const [comments, setComments] = useState<SharedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<Source[]>([]);
  const [shown, setShown] = useState(false);
  // Whether the first page has answered at all, so a thread can wait for it
  // instead of saying "nothing here" a second before the board arrives.
  const [settled, setSettled] = useState(false);
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
      setSettled(true);
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

  const more = async () => {
    if (!target || !cursor || loading) return;
    setLoading(true);
    const page = await boardPage(target, sort, cursor);
    setLoading(false);
    if (!page) return;
    setComments((prev) => [...prev, ...page.comments.filter((c) => !prev.some((p) => p.id === c.id))]);
    setCursor(page.nextCursor);
  };

  return { pending: !!target && joined && !settled, active: !!target && joined && shown, comments, sort, setSort, cursor, loading, more, catalog };
}

export type Board = ReturnType<typeof useBoard>;

/** Banner, the info card, and the sort tabs — the head of the merged list. */
/**
 * `part`: the merged thread draws the two halves apart — the sort buttons at
 * the top (they order OpenTV's comments AND CommsUni's), and the "Comments by
 * CommsUni.tv" bar as the divider just above the first CommsUni comment, so it
 * labels what is under it rather than the whole page (3 Oct).
 */
export function BoardBanner({ board, part = 'both' }: { board: Board; part?: 'both' | 'sorts' | 'byline' }) {
  const [info, setInfo] = useState(false);
  // The catalogue is ordered by source id: 1 is the TV Community Archive, and
  // CommsUni itself is matched by slug — the guide's two stable entries.
  const archiveIcon = board.catalog[0]?.icon ?? null;
  const commsuniIcon = board.catalog.find((s) => s.slug === 'commsunitv')?.icon ?? null;
  return (
    <View style={part === 'byline' ? styles.divider : styles.head}>
      {part !== 'sorts' && (
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
      )}

      {part !== 'byline' && (
      <View style={styles.sorts}>
        {(['most_liked', 'most_recent'] as const).map((s) => (
          <Pressable key={s} style={[styles.sort, board.sort === s && styles.sortOn]} onPress={() => board.setSort(s)}>
            <Text style={[styles.sortText, board.sort === s && styles.sortTextOn]}>
              {t(s === 'most_liked' ? 'commsuni.sortLiked' : 'commsuni.sortRecent')}
            </Text>
          </Pressable>
        ))}
      </View>
      )}

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

/** One shared comment in the merged list. A tap opens it on its own page. */
export function SharedRow({ c }: { c: SharedComment }) {
  const [revealed, setRevealed] = useState(false);
  const open = () => {
    tapLight();
    rememberShared(c);
    router.push(`/shared-comment/${encodeURIComponent(c.id)}`);
  };
  return (
    <CommentCard
      author={sharedAuthorName(c.author.name)}
      avatar={c.author.avatar ? { uri: c.author.avatar } : null}
      date={c.createdAt ? formatCommentDate(c.createdAt) : ''}
      entity={c.origin.displayName || null}
      body={c.text}
      image={pictureOf(c)}
      likes={c.likes}
      replies={c.replyCount}
      spoiler={c.isSpoiler}
      spoilerReason="flagged"
      revealed={revealed}
      onReveal={() => setRevealed(true)}
      onPress={open}
      onReply={open}
    />
  );
}

/** "More" at the foot of the list, while the board has another page. */
export function BoardMore({ board }: { board: Board }) {
  if (!board.active || !board.cursor) return null;
  return (
    <Pressable style={styles.more} onPress={() => void board.more()} disabled={board.loading}>
      {board.loading ? <ActivityIndicator color={colors.dim} /> : <Text style={styles.moreText}>{t('commsuni.more')}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { paddingTop: space.md },
  divider: { paddingTop: space.lg, paddingBottom: space.xs },
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

/**
 * THE ONE-TIME QUESTION (guide §9), asked the first time somebody writes on a
 * title that has a shared board: share with CommsUni, or keep it on OpenTV.
 * Two unselected choices; closing the sheet records neither and asks again
 * next time. Only after "share" does it ask the separate identity question.
 * New comments only — the copy says nothing about existing ones, so
 * `coversExisting` stays false and nothing old is ever sent.
 */
export function ConsentSheet({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const [step, setStep] = useState<'share' | 'identity'>('share');
  const finish = (d: 'share' | 'keep_private', id?: 'profile' | 'persona') => {
    tapLight();
    void recordDecision(d, id, false);
    setStep('share');
    onDone();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <Pressable style={styles.scrim} onPress={onDone}>
        <Pressable style={styles.card} onPress={() => {}}>
          {step === 'share' ? (
            <>
              <Text style={styles.cardTitle}>{t('commsuni.consent.title')}</Text>
              <Text style={styles.cardText}>{t('commsuni.consent.body')}</Text>
              <Pressable style={styles.support} onPress={() => setStep('identity')}>
                <Text style={styles.supportText}>{t('commsuni.consent.share')}</Text>
              </Pressable>
              <Pressable style={styles.archive} onPress={() => finish('keep_private')}>
                <Text style={styles.archiveText}>{t('commsuni.consent.keep')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>{t('commsuni.consent.identityTitle')}</Text>
              <Text style={styles.cardText}>{t('commsuni.consent.identityBody')}</Text>
              <Pressable style={styles.support} onPress={() => finish('share', 'profile')}>
                <Text style={styles.supportText}>{t('commsuni.consent.asProfile')}</Text>
              </Pressable>
              <Pressable style={styles.archive} onPress={() => finish('share', 'persona')}>
                <Text style={styles.archiveText}>{t('commsuni.consent.asPersona')}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
