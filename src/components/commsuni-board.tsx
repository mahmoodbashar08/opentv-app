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
import { offerTranslate, translateShared } from '@/community-translate';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { boardPage, recordDecision, rememberShared, reportOnBoard, sources as loadSources, type BoardFilter, type BoardSort, type BoardTarget, type LanguageCount, type ReportReason, type SharedComment, type Source } from '@/commsuni';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { useJoined } from '@/community-session';
import { CommentCard, formatCommentDate } from '@/components/comment-card';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
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
/**
 * A page's pictures, fetched as the page arrives rather than when each row
 * scrolls in (facc's checklist, 💠). Only the public ones: archive pictures go
 * through our server with a token and load on their own.
 */
function prefetchPictures(page: SharedComment[] | undefined): void {
  const urls = (page ?? []).map((c) => c.image).filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));
  if (urls.length) void Image.prefetch(urls, 'disk').catch(() => {});
}

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
  const [filter, setFilter] = useState<BoardFilter>({ source: null, language: null });
  const [languageCounts, setLanguageCounts] = useState<LanguageCount[]>([]);
  // Per app, like the languages (facc, 6 Oct). Null until the server says, so
  // an older cached page still shows every app rather than none.
  const [sourceCounts, setSourceCounts] = useState<Map<string, number> | null>(null);
  // The tab's number: the unfiltered first page's language counts, summed.
  const [total, setTotal] = useState<number | null>(null);
  // Reported here and hidden for this reader (§10 allows it after a 202).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const key = target ? JSON.stringify(target) : '';
  const filterKey = `${filter.source ?? ''}|${filter.language ?? ''}`;

  useEffect(() => {
    if (!target || !joined) return;
    let live = true;
    // Replaced only when the new first page lands, so switching sort does not
    // blank the list while it loads.
    void boardPage(target, sort, null, filter).then((page) => {
      if (!live) return;
      setComments(page?.comments ?? []);
      setCursor(page?.nextCursor ?? null);
      prefetchPictures(page?.comments);
      if (page?.comments.length) setShown(true);
      if (page?.languageCounts) {
        // Language chips keep the counts for every language, so picking one
        // does not make the others vanish.
        if (!filter.language) setLanguageCounts(byLanguage(page.languageCounts));
        if (!filter.source && !filter.language) setTotal(page.languageCounts.reduce((n, l) => n + l.count, 0));
      }
      // Kept while an app is picked, so the other apps' chips do not vanish.
      if (page?.sourceCounts && !filter.source) setSourceCounts(new Map(page.sourceCounts.map((x) => [x.source, x.count])));
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
  }, [key, sort, joined, filterKey]);

  const more = async () => {
    if (!target || !cursor || loading) return;
    setLoading(true);
    const page = await boardPage(target, sort, cursor, filter);
    setLoading(false);
    if (!page) return;
    setComments((prev) => [...prev, ...page.comments.filter((c) => !prev.some((p) => p.id === c.id))]);
    prefetchPictures(page.comments);
    setCursor(page.nextCursor);
  };

  return {
    enabled: !!target && joined,
    pending: !!target && joined && !settled,
    active: !!target && joined && shown,
    comments: comments.filter((c) => !hidden.has(c.id)),
    sort,
    setSort,
    cursor,
    loading,
    more,
    catalog,
    filter,
    setFilter,
    languageCounts,
    sourceCounts,
    total,
    hide: (id: string) => setHidden((h) => new Set(h).add(id)),
  };
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
  // With counts: each app's icon and number, biggest first, and an app with
  // nothing here left out (unless it is the one picked) — of 19 apps, most
  // threads have one. A row of one app beside "All" says nothing, so it goes.
  const appChips = board.catalog
    .map((c) => ({ c, n: board.sourceCounts?.get(c.slug) ?? null }))
    .filter(({ c, n }) => n == null || n > 0 || board.filter.source === c.slug)
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
    .map(({ c, n }) => ({
      key: c.slug,
      label: n == null ? c.displayName : `${c.displayName} ${formatCount(n, currentLocale())}`,
      icon: c.icon,
      accent: c.accent,
    }));

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
        <>
          <View style={styles.sorts}>
            {(['most_liked', 'most_recent', 'most_relevant'] as const).map((s) => (
              <Pressable key={s} style={[styles.sort, board.sort === s && styles.sortOn]} onPress={() => board.setSort(s)}>
                <Text style={[styles.sortText, board.sort === s && styles.sortTextOn]}>
                  {t(s === 'most_liked' ? 'commsuni.sortLiked' : s === 'most_recent' ? 'commsuni.sortRecent' : 'commsuni.sortTop')}
                </Text>
              </Pressable>
            ))}
          </View>
          {/* FILTERS, ASKED OF THEIR SERVER (§9): every source by default. */}
          {(appChips.length > 1 || board.filter.source != null) && (
            <Chips
              items={[{ key: null, label: t('commsuni.filterAll') }, ...appChips]}
              value={board.filter.source}
              onPick={(k) => board.setFilter({ source: k, language: board.filter.language })}
            />
          )}
          {board.languageCounts.length > 1 && (
            <Chips
              items={[
                { key: null, label: t('commsuni.allLanguages') },
                // The reader's own language first, then the biggest.
                ...[...board.languageCounts]
                  .sort((a, b) => {
                    const mine = currentLocale().slice(0, 2);
                    const am = a.language.slice(0, 2) === mine ? 1 : 0;
                    const bm = b.language.slice(0, 2) === mine ? 1 : 0;
                    return bm - am || b.count - a.count;
                  })
                  .slice(0, 12)
                  .map((l) => ({ key: l.language, label: `${languageName(l.language)} ${formatCount(l.count, currentLocale())}` })),
              ]}
              value={board.filter.language}
              onPick={(k) => board.setFilter({ source: board.filter.source, language: k })}
            />
          )}
        </>
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
/**
 * A language by ITS OWN name — "Français", "العربية" — the way language
 * pickers everywhere do it: everybody finds their own, and nothing needs
 * translating six times. (Intl.DisplayNames is not in Hermes, so a table.)
 */
const ENDONYMS: Record<string, string> = {
  en: 'English', ar: 'العربية', fr: 'Français', it: 'Italiano', es: 'Español', pt: 'Português',
  de: 'Deutsch', nl: 'Nederlands', tr: 'Türkçe', ru: 'Русский', pl: 'Polski', sv: 'Svenska',
  da: 'Dansk', no: 'Norsk', nb: 'Norsk', fi: 'Suomi', cs: 'Čeština', el: 'Ελληνικά', he: 'עברית',
  fa: 'فارسی', hi: 'हिन्दी', id: 'Indonesia', ms: 'Melayu', th: 'ไทย', vi: 'Tiếng Việt',
  ja: '日本語', ko: '한국어', zh: '中文', uk: 'Українська', ro: 'Română', hu: 'Magyar',
  ca: 'Català', hr: 'Hrvatski', sr: 'Српски', bg: 'Български', sk: 'Slovenčina', tl: 'Tagalog',
  gl: 'Galego', eu: 'Euskara', sl: 'Slovenščina', lt: 'Lietuvių', lv: 'Latviešu', et: 'Eesti',
  is: 'Íslenska', ga: 'Gaeilge', cy: 'Cymraeg', af: 'Afrikaans', sw: 'Kiswahili', ur: 'اردو',
  bn: 'বাংলা', ta: 'தமிழ்', ku: 'Kurdî', az: 'Azərbaycan', ka: 'ქართული', hy: 'Հայերեն',
};
function languageName(tag: string): string {
  return ENDONYMS[tag.toLowerCase().split('-')[0]!] ?? tag.toUpperCase();
}

/**
 * ONE CHIP PER LANGUAGE. CommsUni counts `en`, `en-US`, `en-GB` apart, which
 * drew "English" four times (5 Oct). Filtering on `en` already matches every
 * English locale (§3), so the chips are by primary tag, counts added up.
 */
function byLanguage(counts: LanguageCount[]): LanguageCount[] {
  const sum = new Map<string, number>();
  for (const l of counts) {
    const base = l.language.toLowerCase().split('-')[0]!;
    // `und` / `zxx` / `mul` are "unknown", "no text", "several" — not languages.
    if (base && !['unknown', 'und', 'zxx', 'mul', 'mis'].includes(base)) sum.set(base, (sum.get(base) ?? 0) + l.count);
  }
  return [...sum].map(([language, count]) => ({ language, count }));
}

/** One row of filter chips, scrolling sideways. `null` is "all". */
function Chips({
  items,
  value,
  onPick,
}: {
  items: { key: string | null; label: string; icon?: string | null; accent?: string | null }[];
  value: string | null;
  onPick: (k: string | null) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {items.map((it) => (
        <Pressable
          key={it.key ?? '*'}
          style={[styles.sort, value === it.key && styles.sortOn]}
          onPress={() => {
            tapLight();
            onPick(it.key);
          }}>
          {/* The app's own icon, else a dot in its colour — which app is which at a glance. */}
          {it.icon ? (
            <Image source={{ uri: it.icon }} style={styles.chipIcon} />
          ) : it.accent ? (
            <View style={[styles.chipDot, { backgroundColor: it.accent }]} />
          ) : null}
          <Text style={[styles.sortText, value === it.key && styles.sortTextOn]}>{it.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/**
 * REPORTING ON THE SHARED BOARD (§10). Every comment from another app can be
 * reported; an archived TV Time comment can also be flagged "this is mine"
 * (hide it / claim it later) — never offered on anything else, as the guide
 * forbids it on native comments. Hidden for this reader once accepted.
 */
export function useReport(onHidden: (id: string) => void) {
  const [target, setTarget] = useState<SharedComment | null>(null);
  const send = async (c: SharedComment, reason: ReportReason) => {
    setTarget(null);
    const ok = await reportOnBoard(c.id, reason, c.origin.kind === 'tvtime');
    if (!ok) {
      Alert.alert(t('community.report.failedTitle'));
      return;
    }
    onHidden(c.id);
    Alert.alert(
      t('community.report.sentTitle'),
      reason.startsWith('mine_') ? t('commsuni.mineSentBody') : t('community.report.sentBody'),
    );
  };
  const actions: SheetAction[] = target
    ? [
        ...(target.origin.kind === 'tvtime'
          ? ([
              { text: t('commsuni.mineHide'), icon: 'eye-off-outline', onPress: () => void send(target, 'mine_hide') },
              { text: t('commsuni.mineClaim'), icon: 'person-outline', onPress: () => void send(target, 'mine_claim') },
            ] as SheetAction[])
          : []),
        { text: t('community.report.spam'), icon: 'flag-outline', onPress: () => void send(target, 'spam') },
        { text: t('community.report.harassment'), icon: 'flag-outline', onPress: () => void send(target, 'abuse') },
        { text: t('community.report.spoiler'), icon: 'flag-outline', onPress: () => void send(target, 'spoiler') },
        { text: t('community.report.sexual'), icon: 'flag-outline', onPress: () => void send(target, 'sexual') },
        { text: t('commsuni.reportIllegal'), icon: 'flag-outline', onPress: () => void send(target, 'illegal') },
        { text: t('community.report.other'), icon: 'flag-outline', onPress: () => void send(target, 'other') },
      ]
    : [];
  const sheet = (
    <ActionSheet visible={target != null} title={t('community.report.title')} actions={actions} onClose={() => setTarget(null)} />
  );
  return { open: (c: SharedComment) => setTarget(c), sheet };
}

export function SharedRow({ c, onMenu }: { c: SharedComment; onMenu?: () => void }) {
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
      translate={offerTranslate(c.language) ? { cacheKey: `cu:${c.id}`, run: () => translateShared(c.id, c.text, c.language) } : undefined}
      image={pictureOf(c)}
      likes={c.likes}
      replies={c.replyCount}
      spoiler={c.isSpoiler}
      spoilerReason="flagged"
      revealed={revealed}
      onReveal={() => setRevealed(true)}
      onPress={open}
      onReply={open}
      onMenu={onMenu}
    />
  );
}

/**
 * THE ATTRIBUTION ALONE, for pages that show the board without being the
 * thread — a comment's own page. The guide wants it on every one (§9).
 */
export function CommsuniAttribution() {
  const [catalog, setCatalog] = useState<Source[]>([]);
  useEffect(() => {
    let live = true;
    void loadSources().then((s) => {
      if (live) setCatalog(s);
    });
    return () => {
      live = false;
    };
  }, []);
  // The byline reads only the catalogue; nothing else of a board is needed.
  return <BoardBanner board={{ catalog } as Board} part="byline" />;
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
  chips: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, marginBottom: space.md },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.card },
  chipIcon: { width: 16, height: 16, borderRadius: 4 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
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
