import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import db, { getMeta, hasLibrary, libraryOwner, setMeta } from '@/db';
import { tapLight } from '@/haptics';
import { PopcornGame } from '@/components/popcorn-game';
import type { ImportResult, Progress } from '@/importer';
import { postOnboardingRoute, setOnboarded } from '@/session-store';
import { colors, radius, space } from '@/theme';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';

const STEPS = ['import.steps.step1', 'import.steps.step2', 'import.steps.step3'] as const;

/** Total / In-app / New / Issues grid for one category. "In app" = everything
 * from the file that's now in the library (new + already there); it splits
 * into full and name-only ("149 +5" = 149 with details, 5 by name). */
function StatRow({ label, total, added, existing, nameOnly, missed }: { label: string; total: number; added: number; existing: number; nameOnly: number; missed: number }) {
  const inApp = added + existing;
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statCell}>{formatCount(total, currentLocale())}</Text>
      <Text style={[styles.statCell, { color: colors.green }]}>
        {nameOnly > 0 ? `${formatCount(inApp - nameOnly, currentLocale())} +${nameOnly}` : formatCount(inApp, currentLocale())}
      </Text>
      <Text style={styles.statCell}>{formatCount(added, currentLocale())}</Text>
      <Text style={[styles.statCell, missed > 0 && { color: colors.danger }]}>{formatCount(missed, currentLocale())}</Text>
    </View>
  );
}

function Summary({ result, onDone }: { result: ImportResult; onDone: () => void }) {
  const [copied, setCopied] = useState<number | string | null>(null);
  // which "needs attention" items got matched since import (via Fix match) —
  // re-checked from the database every time this screen regains focus
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      const s = new Set<string>();
      for (const n of result.notImported) {
        if (n.matchIssue !== true) continue; // not a match problem — "fixed" is meaningless
        if (n.kind === 'movie') {
          const r = db.getFirstSync<{ tmdbId: number | null }>('SELECT tmdbId FROM movies WHERE name = ?', [n.name]);
          if (r?.tmdbId != null) s.add(`${n.kind}:${n.name}`);
        } else if (n.id != null) {
          // Any id-bearing match failure, not just kind 'show' — an 'episodes'
          // row whose bulk fill failed for want of a database match is fixed by
          // matching that show, so it has to be able to report FIXED too.
          //
          // Cached metadata is the real proof a match was made — a poster is
          // optional and some entries resolve without one, which used to leave
          // them showing FIND forever even though the fix had worked.
          const r = db.getFirstSync<{ posterUrl: string | null }>('SELECT posterUrl FROM shows WHERE tvdbId = ?', [n.id]);
          const matched = db.getFirstSync<{ n: number }>(
            "SELECT 1 AS n FROM meta WHERE key = ? OR key = ?",
            [`showMeta:${n.id}`, `showRemap:${n.id}`],
          );
          if (r?.posterUrl || matched) s.add(`${n.kind}:${n.name}`);
        }
      }
      setFixed(s);
    }, [result]),
  );
  const missed = (kinds: string[]) => result.notImported.filter((n) => kinds.includes(n.kind)).length;
  // an entry with no title can't be searched for, and renders as a blank row
  // with a FIND button that looks for nothing — drop those rather than show them
  const named = result.notImported.filter((n) => (n.name ?? '').trim() !== '');
  // Two different things were being shown under one heading. A row whose match
  // failed is a TASK: match it and the row goes green. A row saying the export
  // listed no episodes for a show is an EXPLANATION: the show is matched
  // correctly, the data simply isn't there, and no amount of matching changes
  // that. Mixing them made the second kind look broken and unfinished.
  const actionable = named.filter((n) => n.matchIssue === true);
  const explained = named.filter((n) => n.matchIssue !== true);
  const [showAllMissed, setShowAllMissed] = useState(false);
  // the list was capped at 60 with the remainder as inert text, which left
  // hundreds of entries unreachable on a big import
  const shown = showAllMissed ? actionable : actionable.slice(0, 60);
  const nameOnlyTotal =
    result.stats.shows.nameOnly + result.stats.moviesWatched.nameOnly + result.stats.watchlist.nameOnly;

  const copy = async (text: string, key: number | string) => {
    await Clipboard.setStringAsync(text);
    tapLight();
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 14 }} showsVerticalScrollIndicator={false}>
      <Text style={styles.completed}>
        {result.merged ? t('import.summary.completedMerged') : t('import.summary.completed')}
      </Text>
      <Text style={styles.summaryTitle}>{t('import.summary.title')}</Text>
      {result.merged &&
        result.stats.shows.added + result.stats.episodes.added + result.stats.moviesWatched.added + result.stats.watchlist.added === 0 && (
          <View style={styles.allSetBox}>
            <Ionicons name="checkmark-circle" size={18} color={colors.green} />
            <Text style={styles.allSetText}>{t('import.summary.allSet')}</Text>
          </View>
        )}

      <View style={styles.card}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel} />
          <Text style={[styles.statCell, styles.statHead, { color: colors.yellow }]}>{t('import.summary.colTotal')}</Text>
          <Text style={[styles.statCell, styles.statHead, { color: colors.green }]}>{t('import.summary.colInApp')}</Text>
          <Text style={[styles.statCell, styles.statHead]}>{t('import.summary.colNew')}</Text>
          <Text style={[styles.statCell, styles.statHead, { color: colors.danger }]}>{t('import.summary.colIssues')}</Text>
        </View>
        <StatRow label={t('import.summary.rowShows')} total={result.stats.shows.total} added={result.stats.shows.added} existing={result.stats.shows.existing} nameOnly={result.stats.shows.nameOnly} missed={missed(['show'])} />
        <StatRow label={t('import.summary.rowEpisodes')} total={result.stats.episodes.total} added={result.stats.episodes.added} existing={result.stats.episodes.existing} nameOnly={0} missed={missed(['episodes'])} />
        <StatRow label={t('import.summary.rowMovies')} total={result.stats.moviesWatched.total} added={result.stats.moviesWatched.added} existing={result.stats.moviesWatched.existing} nameOnly={result.stats.moviesWatched.nameOnly} missed={missed(['movie'])} />
        <StatRow label={t('import.summary.rowWatchlist')} total={result.stats.watchlist.total} added={result.stats.watchlist.added} existing={result.stats.watchlist.existing} nameOnly={result.stats.watchlist.nameOnly} missed={0} />
      </View>
      {(() => {
        // Only shown when the export genuinely held more watched films than
        // reached the library. The counts above are derived from what we
        // parsed, so they can never surface a shortfall on their own — this is
        // the line that tells a real import gap apart from a hazy recollection.
        const a = result.movieAudit;
        if (!a) return null;
        const lostToDuplicateTitles = Math.max(a.titlesInExport - a.imported, 0);
        const gap = Math.max(a.rowsInExport - a.imported, 0);
        if (gap === 0) return null;
        const parts = [
          a.titlesInExport !== a.rowsInExport
            ? t('import.summary.movieAuditWithTitles', {
                count: a.rowsInExport,
                titles: formatCount(a.titlesInExport, currentLocale()),
                imported: formatCount(a.imported, currentLocale()),
              })
            : t('import.summary.movieAudit', { count: a.rowsInExport, imported: formatCount(a.imported, currentLocale()) }),
        ];
        if (lostToDuplicateTitles > 0) {
          parts.push(t('import.summary.movieAuditDuplicatesMerged', { count: lostToDuplicateTitles }));
        }
        if (a.nameless > 0) {
          parts.push(t('import.summary.movieAuditNameless', { count: a.nameless }));
        }
        return <Text style={styles.auditNote}>{parts.join(' ')}</Text>;
      })()}
      <View style={styles.libraryLine}>
        <Ionicons name="library-outline" size={16} color={colors.yellow} />
        <Text style={styles.libraryText}>
          {t('import.summary.libraryNow', {
            shows: formatCount(result.library.shows, currentLocale()),
            episodes: formatCount(result.library.episodes, currentLocale()),
            movies: formatCount(result.library.movies, currentLocale()),
            watchlist: formatCount(result.library.watchlist, currentLocale()),
          })}
        </Text>
      </View>
      {nameOnlyTotal > 0 && (
        <Text style={styles.mergeNote}>{t('import.summary.nameOnlyNote', { count: nameOnlyTotal })}</Text>
      )}
      {(result.foldedShows ?? 0) > 0 && (
        <Text style={styles.mergeNote}>
          {t('import.summary.duplicatesFoldedNote', { count: result.foldedShows ?? 0 })}
        </Text>
      )}
      {result.merged && <Text style={styles.mergeNote}>{t('import.summary.mergedNote')}</Text>}

      {actionable.length > 0 && (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.cardTitle}>{t('import.summary.needsAttentionTitle', { count: actionable.length })}</Text>
            <Pressable onPress={() => void copy(actionable.map((n) => n.name).join('\n'), 'all')} hitSlop={8}>
              <Text style={styles.copyAll}>{copied === 'all' ? t('import.summary.copiedCheck') : t('import.summary.copyAll')}</Text>
            </Pressable>
          </View>
          {shown.map((n, i) => (
            <Pressable key={i} style={[styles.missItem, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => void copy(n.name, i)}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.missName}>
                  {n.kind === 'movie'
                    ? t('import.summary.missNameMovie', { name: n.name })
                    : n.kind === 'show'
                      ? t('import.summary.missNameShow', { name: n.name })
                      : n.name}
                </Text>
                <Text style={[styles.missReason, copied === i && { color: colors.green }]}>
                  {copied === i ? t('import.summary.copiedToClipboard') : t('import.summary.reasonPrefix', { reason: n.reason })}
                </Text>
              </View>
              {n.fixable === true && (n.kind === 'movie' || n.id != null) &&
                (fixed.has(`${n.kind}:${n.name}`) ? (
                  <View style={styles.fixedBtn}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.green} />
                    <Text style={styles.fixedText}>{t('import.summary.fixed')}</Text>
                  </View>
                ) : (
                  <Pressable
                    style={styles.findBtn}
                    hitSlop={6}
                    onPress={() =>
                      router.push(
                        n.kind === 'movie'
                          ? `/fix-match?name=${encodeURIComponent(n.name)}`
                          : `/fix-match?type=show&id=${n.id}&name=${encodeURIComponent(n.name)}`,
                      )
                    }>
                    <Ionicons name="search" size={13} color={colors.onYellow} />
                    <Text style={styles.findText}>{t('import.summary.find')}</Text>
                  </Pressable>
                ))}
            </Pressable>
          ))}
          {actionable.length > shown.length && (
            <Pressable style={styles.showAllBtn} onPress={() => setShowAllMissed(true)} hitSlop={6}>
              <Text style={styles.showAllText}>{t('import.summary.showAll', { count: actionable.length })}</Text>
            </Pressable>
          )}
          <Text style={styles.missReason}>{t('import.summary.tapToCopyHint')}</Text>
        </View>
      )}

      {explained.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('import.summary.whyEmptyTitle', { count: explained.length })}</Text>
          <Text style={[styles.missReason, { marginTop: 2 }]}>{t('import.summary.whyEmptyExplanation')}</Text>
          {explained.map((n, i) => (
            <Pressable key={i} style={styles.missItem} onPress={() => void copy(n.name, `x${i}`)}>
              <Text style={styles.missName}>{n.name}</Text>
              <Text style={[styles.missReason, copied === `x${i}` && { color: colors.green }]}>
                {copied === `x${i}` ? t('import.summary.copiedToClipboard') : n.reason}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable style={styles.cta} onPress={onDone}>
        <Text style={styles.ctaText}>{t('import.summary.letsGo')}</Text>
      </Pressable>
    </ScrollView>
  );
}

// a number that counts up to its value when it lands — the "ticking up" feel
function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setN(Math.round(v)));
    Animated.timing(anim, { toValue: value, duration: 1000, useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [value, anim]);
  return <Text style={styles.countNum}>{formatCount(n, currentLocale())}</Text>;
}

/** The summary of an import that finished with no screen in front of it — one
 *  resumed on launch after being cut short. Stored by resumeInterruptedImport
 *  because otherwise the user is never shown what needs attention. */
function savedSummary(): ImportResult | null {
  const raw = getMeta('resumedImportSummary');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ImportResult;
  } catch {
    return null;
  }
}

export default function ImportScreen() {
  const { source, summary } = useLocalSearchParams<{ source?: string; summary?: string }>();
  const fromCloud = source === 'icloud';
  // opened from Settings to read a resumed import's summary, not to run one
  const [saved] = useState(() => (summary === '1' ? savedSummary() : null));
  const [progress, setProgress] = useState<Progress | null>(null);
  const [counts, setCounts] = useState<{ shows: number; episodes: number; movies: number } | null>(null);
  // measured, not fixed: the arena fills whatever space the progress UI leaves
  const [gameH, setGameH] = useState(0);
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<ImportResult | null>(null);
  const startedCloud = useRef(false);
  // pass-through to the importer that also captures the running tallies
  const onProgress = (p: Progress) => {
    setProgress(p);
    if (p.counts) setCounts(p.counts);
  };

  const finish = (r: ImportResult) => {
    setProgress(null);
    setResult(r);
    // onboarding flips on LET'S GO, not here — flipping now would unmount the
    // welcome screen underneath and strand the back button on the summary
    // the fresh library round-trips to iCloud right away (restore already
    // recorded its own hash, making this a cheap no-op)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { backupNow } = require('@/backup') as typeof import('@/backup');
    void backupNow().catch(() => {});
  };

  const fail = (err: unknown) => {
    setProgress(null);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('DocumentPicker') || msg.includes('Cannot find native module')) {
      Alert.alert(t('import.buildNeededTitle'), t('import.buildNeededBody'));
    } else {
      Alert.alert(
        fromCloud ? t('import.restoreFailedTitle') : t('import.importFailedTitle'),
        t('import.failedBody', { message: msg }),
      );
    }
  };

  const doPick = async (mode: 'merge' | 'replace') => {
    try {
      // lazy-load: a binary built without the native picker still renders this
      // screen and gets a friendly alert instead of a crash
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pickAndImport } = require('@/importer') as typeof import('@/importer');
      const r = await pickAndImport(onProgress, mode);
      if (!r) {
        setProgress(null);
        return; // user cancelled the picker
      }
      // Episode structure comes from TheTVDB at runtime — the bundled metadata
      // carries enrichment only since 1.2.0. Until a show has it there are no
      // season or episode totals, so the grid draws part-watched bars over
      // finished shows. Fetch it now, while the user is still looking at a
      // progress screen, rather than trickling 200-a-launch afterwards.
      // Best-effort: anything that fails here is retried by the background
      // pre-cache on the next launch, so an offline import still completes.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { cacheMissingShowMetadata } = require('@/show-meta-fetch') as typeof import('@/show-meta-fetch');
        await cacheMissingShowMetadata((done, total) =>
          setProgress({ phase: t('import.gettingEpisodeData'), done, total }),
        );
      } catch {
        // offline or TheTVDB unreachable — the library is imported either way
      }
      finish(r);
    } catch (err) {
      fail(err);
    }
  };

  const pick = () => {
    // importing over an existing library is ambiguous — ask instead of
    // silently merging (a test library would leak into the real import)
    if (hasLibrary() && libraryOwner() !== 'seed') {
      Alert.alert(
        t('import.existingLibraryTitle'),
        t('import.existingLibraryBody'),
        [
          { text: t('import.mergeIntoLibrary'), onPress: () => void doPick('merge') },
          { text: t('import.eraseAndImportClean'), style: 'destructive', onPress: () => void doPick('replace') },
          { text: t('common.cancel'), style: 'cancel' },
        ],
      );
      return;
    }
    void doPick('merge');
  };

  // arriving via "Continue as <name>" — start pulling the backup right away
  useEffect(() => {
    if (!fromCloud || startedCloud.current) return;
    startedCloud.current = true;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { restoreFromCloud } = require('@/backup') as typeof import('@/backup');
        finish(await restoreFromCloud(onProgress));
      } catch (err) {
        fail(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromCloud]);

  const alreadyImported = () => {
    setOnboarded(true);
    router.replace(postOnboardingRoute());
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Screen>
      <NavHeader />
      <ContentColumn style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: space.xl, gap: 18, marginTop: 12, flex: 1 }}>
        <Text style={styles.title}>{fromCloud ? t('import.titleRestore') : t('import.titleImport')}</Text>
        {!result && (
          <Text style={styles.sub}>{fromCloud ? t('import.subRestore') : t('import.subImport')}</Text>
        )}

        {saved ? (
          // a summary the user is catching up on — dismissing it is what marks
          // it read, so it stops being offered in Settings
          <Summary
            result={saved}
            onDone={() => {
              setMeta('resumedImportSummary', '');
              router.back();
            }}
          />
        ) : result ? (
          <Summary
            result={result}
            onDone={() => {
              setOnboarded(true);
              router.replace(postOnboardingRoute());
            }}
          />
        ) : progress ? (
          <View style={{ gap: 14, marginTop: 20, flex: 1 }}>
            {/* the popcorn bucket drags horizontally — don't let swipe-back steal it */}
            <Stack.Screen options={{ gestureEnabled: false }} />
            <Text style={styles.phase}>{progress.phase}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.pct}>
              {progress.total > 1 ? `${progress.done} / ${progress.total}` : ' '}
            </Text>
            {counts && (
              <View style={styles.countsRow}>
                <View style={styles.countBox}>
                  <CountUp value={counts.shows} />
                  <Text style={styles.countLabel}>{t('import.countShows')}</Text>
                </View>
                <View style={styles.countBox}>
                  <CountUp value={counts.episodes} />
                  <Text style={styles.countLabel}>{t('import.countEpisodes')}</Text>
                </View>
                <View style={styles.countBox}>
                  <CountUp value={counts.movies} />
                  <Text style={styles.countLabel}>{t('import.countMovies')}</Text>
                </View>
              </View>
            )}
            <View style={styles.keepOpenBox}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.yellow} />
              <Text style={styles.keepOpenText}>{t('import.keepOpenBody')}</Text>
            </View>
            {/* The wait, made fun — score carries over to Settings → Popcorn.
                The arena takes whatever height is left rather than a fixed one:
                anything added above it (the live counts row) used to push the
                bucket off the bottom of the screen, and Screen only insets the
                top, so the home indicator has to be subtracted here. */}
            <View
              style={{ flex: 1, minHeight: 150, marginBottom: insets.bottom + 8 }}
              onLayout={(e) => setGameH(Math.round(e.nativeEvent.layout.height))}>
              {gameH > 0 && <PopcornGame height={gameH} />}
            </View>
          </View>
        ) : fromCloud ? null : (
          <>
            {STEPS.map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={{ color: colors.onYellow, fontWeight: '800', fontSize: 13 }}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{t(s)}</Text>
              </View>
            ))}

            <Pressable style={styles.cta} onPress={pick}>
              <Ionicons name="folder-open-outline" size={18} color={colors.onYellow} />
              <Text style={styles.ctaText}>{t('import.chooseFileButton')}</Text>
            </Pressable>

            <Pressable onPress={alreadyImported} hitSlop={8}>
              <Text style={styles.link}>{t('import.alreadyOnDevice')}</Text>
            </Pressable>
          </>
        )}
      </View>
      </ContentColumn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  sub: { color: colors.dim, fontSize: 14.5, marginTop: -8 },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepText: { color: '#E3E3E8', fontSize: 15, lineHeight: 21, flex: 1 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    marginTop: 8,
  },
  ctaText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 0.8 },
  link: { color: colors.blue, fontSize: 14.5, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  phase: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#2A2A2E', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.yellow },
  pct: { color: colors.dim, fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  countsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 },
  countBox: { alignItems: 'center', gap: 2 },
  countNum: { color: colors.yellow, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  countLabel: { color: colors.dim, fontSize: 12, fontWeight: '600' },
  completed: { color: colors.dim, fontSize: 14 },
  summaryTitle: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: -6 },
  card: {
    backgroundColor: '#1B1B1E',
    borderWidth: 1,
    borderColor: '#2A2A2E',
    borderRadius: radius.card,
    padding: 14,
    gap: 10,
  },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 2 },
  statRow: { flexDirection: 'row', alignItems: 'center' },
  statLabel: { color: colors.text, fontSize: 14.5, fontWeight: '600', flex: 1.2 },
  statHead: { fontWeight: '800', fontSize: 12.5 },
  statCell: { color: '#D5D5DA', fontSize: 14, flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  auditNote: {
    color: colors.dim,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 10,
    marginHorizontal: space.md,
  },
  mergeNote: { color: colors.dim, fontSize: 12.5, lineHeight: 18 },
  missItem: { gap: 2, paddingVertical: 4 },
  copyAll: { color: colors.blue, fontSize: 13.5, fontWeight: '700' },
  findBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  findText: { color: colors.onYellow, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  fixedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: colors.green,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  fixedText: { color: colors.green, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  libraryLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -4 },
  allSetBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#15251A',
    borderWidth: 1,
    borderColor: '#2C4A33',
    borderRadius: radius.card,
    padding: 12,
  },
  allSetText: { color: '#CDE8CF', fontSize: 13.5, lineHeight: 19, flex: 1 },
  keepOpenBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#2A2308',
    borderWidth: 1,
    borderColor: '#4A3F14',
    borderRadius: radius.card,
    padding: 12,
    marginTop: 6,
  },
  keepOpenText: { color: '#EFE3B0', fontSize: 13.5, lineHeight: 19, flex: 1 },
  libraryText: { color: '#E3E3E8', fontSize: 13.5, lineHeight: 19, flex: 1 },
  missName: { color: '#E3E3E8', fontSize: 14, fontWeight: '600' },
  showAllBtn: { paddingVertical: 10, alignItems: 'center' },
  showAllText: { color: colors.yellow, fontWeight: '800', fontSize: 13.5 },
  missReason: { color: colors.dim, fontSize: 13, lineHeight: 18 },
});
