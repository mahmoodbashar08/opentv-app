import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import db, { hasLibrary, libraryOwner } from '@/db';
import { tapLight } from '@/haptics';
import { PopcornGame } from '@/components/popcorn-game';
import type { ImportResult, Progress } from '@/importer';
import { setOnboarded } from '@/session-store';
import { colors, radius, space } from '@/theme';

const STEPS = [
  'Request your data export in TV Time: Settings → Privacy → Request my data.',
  'TV Time emails you a ZIP file with your full history.',
  'Pick that file here — everything imports onto this phone.',
] as const;

/** Total / In-app / New / Issues grid for one category. "In app" = everything
 * from the file that's now in the library (new + already there); it splits
 * into full and name-only ("149 +5" = 149 with details, 5 by name). */
function StatRow({ label, total, added, existing, nameOnly, missed }: { label: string; total: number; added: number; existing: number; nameOnly: number; missed: number }) {
  const inApp = added + existing;
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statCell}>{total.toLocaleString()}</Text>
      <Text style={[styles.statCell, { color: colors.green }]}>
        {nameOnly > 0 ? `${(inApp - nameOnly).toLocaleString()} +${nameOnly}` : inApp.toLocaleString()}
      </Text>
      <Text style={styles.statCell}>{added.toLocaleString()}</Text>
      <Text style={[styles.statCell, missed > 0 && { color: colors.danger }]}>{missed.toLocaleString()}</Text>
    </View>
  );
}

function Summary({ result, onDone }: { result: ImportResult; onDone: () => void }) {
  const [copied, setCopied] = useState<number | 'all' | null>(null);
  // which "needs attention" items got matched since import (via Fix match) —
  // re-checked from the database every time this screen regains focus
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      const s = new Set<string>();
      for (const n of result.notImported) {
        if (n.kind === 'movie') {
          const r = db.getFirstSync<{ tmdbId: number | null }>('SELECT tmdbId FROM movies WHERE name = ?', [n.name]);
          if (r?.tmdbId != null) s.add(`${n.kind}:${n.name}`);
        } else if (n.kind === 'show' && n.id != null) {
          const r = db.getFirstSync<{ posterUrl: string | null }>('SELECT posterUrl FROM shows WHERE tvdbId = ?', [n.id]);
          if (r?.posterUrl) s.add(`${n.kind}:${n.name}`);
        }
      }
      setFixed(s);
    }, [result]),
  );
  const missed = (kinds: string[]) => result.notImported.filter((n) => kinds.includes(n.kind)).length;
  const shown = result.notImported.slice(0, 60);
  const nameOnlyTotal =
    result.stats.shows.nameOnly + result.stats.moviesWatched.nameOnly + result.stats.watchlist.nameOnly;

  const copy = async (text: string, key: number | 'all') => {
    await Clipboard.setStringAsync(text);
    tapLight();
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 14 }} showsVerticalScrollIndicator={false}>
      <Text style={styles.completed}>Import completed{result.merged ? ' — merged into your library' : ''}</Text>
      <Text style={styles.summaryTitle}>Import Summary</Text>
      {result.merged &&
        result.stats.shows.added + result.stats.episodes.added + result.stats.moviesWatched.added + result.stats.watchlist.added === 0 && (
          <View style={styles.allSetBox}>
            <Ionicons name="checkmark-circle" size={18} color={colors.green} />
            <Text style={styles.allSetText}>
              Everything in this file is already in the app — see the "In app" column. "New" is 0 because importing
              twice never creates duplicates.
            </Text>
          </View>
        )}

      <View style={styles.card}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel} />
          <Text style={[styles.statCell, styles.statHead, { color: colors.yellow }]}>Total</Text>
          <Text style={[styles.statCell, styles.statHead, { color: colors.green }]}>In app</Text>
          <Text style={[styles.statCell, styles.statHead]}>New</Text>
          <Text style={[styles.statCell, styles.statHead, { color: colors.danger }]}>Issues</Text>
        </View>
        <StatRow label="Shows" total={result.stats.shows.total} added={result.stats.shows.added} existing={result.stats.shows.existing} nameOnly={result.stats.shows.nameOnly} missed={missed(['show'])} />
        <StatRow label="Episodes" total={result.stats.episodes.total} added={result.stats.episodes.added} existing={result.stats.episodes.existing} nameOnly={0} missed={missed(['episodes'])} />
        <StatRow label="Movies" total={result.stats.moviesWatched.total} added={result.stats.moviesWatched.added} existing={result.stats.moviesWatched.existing} nameOnly={result.stats.moviesWatched.nameOnly} missed={missed(['movie'])} />
        <StatRow label="Watchlist" total={result.stats.watchlist.total} added={result.stats.watchlist.added} existing={result.stats.watchlist.existing} nameOnly={result.stats.watchlist.nameOnly} missed={0} />
      </View>
      <View style={styles.libraryLine}>
        <Ionicons name="library-outline" size={16} color={colors.yellow} />
        <Text style={styles.libraryText}>
          Your library now: {result.library.shows.toLocaleString()} shows · {result.library.episodes.toLocaleString()}{' '}
          episodes · {result.library.movies.toLocaleString()} movies · {result.library.watchlist.toLocaleString()}{' '}
          watchlist
        </Text>
      </View>
      {nameOnlyTotal > 0 && (
        <Text style={styles.mergeNote}>
          +{nameOnlyTotal} in "In app" = saved with their name and your history, but no database match yet — see
          Needs attention below.
        </Text>
      )}
      {result.merged && (
        <Text style={styles.mergeNote}>
          "In app" counts everything from this file that's in your library — items you already had were kept exactly
          as they are, never duplicated or overwritten.
        </Text>
      )}

      {result.notImported.length > 0 && (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.cardTitle}>Needs attention ({result.notImported.length})</Text>
            <Pressable onPress={() => void copy(result.notImported.map((n) => n.name).join('\n'), 'all')} hitSlop={8}>
              <Text style={styles.copyAll}>{copied === 'all' ? 'Copied ✓' : 'Copy all'}</Text>
            </Pressable>
          </View>
          {shown.map((n, i) => (
            <Pressable key={i} style={[styles.missItem, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => void copy(n.name, i)}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.missName}>
                  {n.kind === 'movie' ? 'Movie: ' : n.kind === 'show' ? 'Show: ' : ''}
                  {n.name}
                </Text>
                <Text style={[styles.missReason, copied === i && { color: colors.green }]}>
                  {copied === i ? 'Copied to clipboard ✓' : `Reason: ${n.reason}`}
                </Text>
              </View>
              {(n.kind === 'movie' || (n.kind === 'show' && n.id != null)) &&
                (fixed.has(`${n.kind}:${n.name}`) ? (
                  <View style={styles.fixedBtn}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.green} />
                    <Text style={styles.fixedText}>FIXED</Text>
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
                    <Text style={styles.findText}>FIND</Text>
                  </Pressable>
                ))}
            </Pressable>
          ))}
          {result.notImported.length > shown.length && (
            <Text style={styles.missReason}>…and {result.notImported.length - shown.length} more</Text>
          )}
          <Text style={styles.missReason}>Tap any item to copy its name.</Text>
        </View>
      )}

      <Pressable style={styles.cta} onPress={onDone}>
        <Text style={styles.ctaText}>LET&apos;S GO</Text>
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
  return <Text style={styles.countNum}>{n.toLocaleString()}</Text>;
}

export default function ImportScreen() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  const fromCloud = source === 'icloud';
  const [progress, setProgress] = useState<Progress | null>(null);
  const [counts, setCounts] = useState<{ shows: number; episodes: number; movies: number } | null>(null);
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
      Alert.alert('One more build needed', 'The file picker is a native module — rebuild the app once (npx expo run:ios --device) and this will work.');
    } else {
      Alert.alert(fromCloud ? 'Restore failed' : 'Import failed', `Something went wrong: ${msg}`);
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
        'You already have a library on this phone',
        'Add the import on top of it (nothing gets deleted), or erase this library first and import clean?',
        [
          { text: 'Merge into my library', onPress: () => void doPick('merge') },
          { text: 'Erase it and import clean', style: 'destructive', onPress: () => void doPick('replace') },
          { text: 'Cancel', style: 'cancel' },
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
    router.replace('/movies');
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Screen>
      <NavHeader />
      <View style={{ paddingHorizontal: space.xl, gap: 18, marginTop: 12, flex: 1 }}>
        <Text style={styles.title}>{fromCloud ? 'Restore from iCloud' : 'Import from TV Time'}</Text>
        {!result && (
          <Text style={styles.sub}>
            {fromCloud
              ? 'Your backup is downloading from your iCloud Drive.'
              : 'Bring your whole history — shows, episodes, movies, ratings, emotions and lists.'}
          </Text>
        )}

        {result ? (
          <Summary
            result={result}
            onDone={() => {
              setOnboarded(true);
              router.replace('/movies');
            }}
          />
        ) : progress ? (
          <View style={{ gap: 14, marginTop: 20 }}>
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
                  <Text style={styles.countLabel}>shows</Text>
                </View>
                <View style={styles.countBox}>
                  <CountUp value={counts.episodes} />
                  <Text style={styles.countLabel}>episodes</Text>
                </View>
                <View style={styles.countBox}>
                  <CountUp value={counts.movies} />
                  <Text style={styles.countLabel}>movies</Text>
                </View>
              </View>
            )}
            <View style={styles.keepOpenBox}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.yellow} />
              <Text style={styles.keepOpenText}>
                Keep OpenTV open while it imports — it only takes a moment. If your phone locks or you switch apps,
                nothing is lost or half-saved; just come back and start the import again.
              </Text>
            </View>
            {/* the wait, made fun — score carries over to Settings → Popcorn */}
            <PopcornGame height={360} />
          </View>
        ) : fromCloud ? null : (
          <>
            {STEPS.map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={{ color: colors.onYellow, fontWeight: '800', fontSize: 13 }}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{s}</Text>
              </View>
            ))}

            <Pressable style={styles.cta} onPress={pick}>
              <Ionicons name="folder-open-outline" size={18} color={colors.onYellow} />
              <Text style={styles.ctaText}>CHOOSE EXPORT FILE</Text>
            </Pressable>

            <Pressable onPress={alreadyImported} hitSlop={8}>
              <Text style={styles.link}>My data is already on this device →</Text>
            </Pressable>
          </>
        )}
      </View>
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
  missReason: { color: colors.dim, fontSize: 13, lineHeight: 18 },
});
