/**
 * Simkl — connect with a code, bring in what was watched there (and whatever
 * Nuvio scrobbled there), and confirm the shows Simkl knows only by name.
 *
 * THE PLEX SCREEN, ON PURPOSE: a code shown here, approved at simkl.com/pin on
 * any device, polled until it is; then Last checked / Check now / Disconnect.
 * The poll is cancelled on blur for the reason Plex's is — a screen left
 * mid-flow must not keep asking somebody else's server for a code nobody will
 * approve.
 *
 * THE ONE THING PLEX DOES NOT HAVE is "Check these matches". A show with no id
 * this app can place is matched by title against the shows the user tracks,
 * and a title is a guess — so it is shown here, with both names, and nothing
 * is ticked until the user says it is the same show (`answerSimklMatch`).
 *
 * "Data from Simkl" links back to simkl.com because Simkl's API rules require
 * a link (api.simkl.org/api-rules).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { simklConfigured, simklDeviceCode, simklPollToken, type SimklDeviceCode, type SimklPoll } from '@/simkl';
import { answerSimklMatch, disconnectSimkl, getSimklTokens, setSimklTokens, simklPending, simklSyncedAt, syncSimkl, type SimklPendingMatch } from '@/simkl-sync';
import { colors, radius, space, ls } from '@/theme';

/**
 * Poll at Simkl's interval until the code is approved or runs out. Outside the
 * component for the reasons `plex.tsx` gives: it loops for minutes and must
 * read `alive` as it is now, not as it was when the loop began.
 */
async function pollUntilApproved(code: SimklDeviceCode, alive: { current: boolean }, done: (res: SimklPoll) => void | Promise<void>): Promise<void> {
  let wait = Math.max(code.interval, 5) * 1000;
  // Simkl's codes last 15 minutes; this stops a little before.
  const deadline = Date.now() + Math.min(code.expires_in, 900) * 1000 - 30_000;
  while (alive.current && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    if (!alive.current) return;
    const res = await simklPollToken(code.device_code);
    if (res.state === 'pending') continue;
    // "add 5 seconds to the interval" (oauth2-device, poll errors).
    if (res.state === 'slow_down') {
      wait += 5000;
      continue;
    }
    await done(res);
    return;
  }
  // There is no deny signal, so running out of time is how a "no" ends too.
  if (alive.current) await done({ state: 'expired' });
}

export default function SimklScreen() {
  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState<SimklDeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pending, setPending] = useState<SimklPendingMatch[]>([]);
  const alive = useRef(true);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void (async () => {
        setConnected((await getSimklTokens()) != null);
        setLastSync(simklSyncedAt());
        setPending(simklPending());
      })();
      return () => {
        alive.current = false;
        setCode(null);
      };
    }, []),
  );

  const run = async () => {
    setBusy(true);
    const out = await syncSimkl(true);
    setBusy(false);
    setLastSync(simklSyncedAt());
    setPending(simklPending());
    if (!out.ran) {
      Alert.alert(t('simkl.failedTitle'), t('simkl.failedBody'));
      return;
    }
    const lines = [out.applied > 0 ? t('plex.applied', { count: out.applied }) : t('plex.nothingNew')];
    if (out.pending > 0) lines.push(t('simkl.pendingNote', { count: out.pending }));
    Alert.alert(t('simkl.title'), lines.join('\n\n'));
  };

  const connect = async () => {
    if (!simklConfigured()) {
      Alert.alert(t('simkl.title'), t('simkl.unavailable'));
      return;
    }
    tapLight();
    setBusy(true);
    const got = await simklDeviceCode();
    setBusy(false);
    if (!got) {
      Alert.alert(t('simkl.failedTitle'), t('simkl.failedBody'));
      return;
    }
    setCode(got);
    void pollUntilApproved(got, alive, async (res) => {
      setCode(null);
      if (res.state === 'token') {
        await setSimklTokens(res.tokens);
        setConnected(true);
        // Straight into a first sync: connecting and then being told to press
        // another button is the flow asking twice for one decision.
        void run();
        return;
      }
      Alert.alert(t('simkl.title'), t('plex.expired'));
    });
  };

  const answer = (p: SimklPendingMatch, same: boolean) => {
    tapLight();
    const applied = answerSimklMatch(p.simklId, same);
    setPending(simklPending());
    if (same) Alert.alert(t('simkl.title'), applied > 0 ? t('plex.applied', { count: applied }) : t('plex.nothingNew'));
  };

  const cut = () => {
    Alert.alert(t('simkl.disconnectTitle'), t('plex.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('plex.disconnect'),
        style: 'destructive',
        onPress: () => {
          void disconnectSimkl().then(() => {
            setConnected(false);
            setLastSync(null);
            setPending([]);
          });
        },
      },
    ]);
  };

  const syncedLabel = lastSync ? new Date(lastSync).toLocaleString() : t('plex.never');

  return (
    <Screen>
      <NavHeader title={t('simkl.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.intro}>{t('simkl.intro')}</Text>
        <View style={styles.promiseRow}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.dim} />
          <Text style={styles.promise}>{t('simkl.rules')}</Text>
        </View>

        {code != null ? (
          <View style={styles.codeBox}>
            <Text style={styles.step}>{t('plex.step')}</Text>
            <Pressable
              onPress={() => {
                void Clipboard.setStringAsync(code.user_code);
                tapLight();
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('plex.copy')}
              // The code is the whole point of this box and a label replaces
              // the text inside it, so it is handed over as the value, spaced
              // out so VoiceOver and TalkBack spell it rather than guess a word.
              accessibilityValue={{ text: code.user_code.split('').join(' ') }}
              hitSlop={10}
              style={styles.codeRow}>
              <Text style={styles.code} selectable>
                {code.user_code}
              </Text>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={colors.dim} />
            </Pressable>
            <Text style={styles.copyHint}>{copied ? t('plex.copied') : t('plex.copy')}</Text>
            <PillButton label={t('simkl.open')} trackId="simkl.open" onPress={() => void Linking.openURL(code.verification_uri).catch(() => {})} />
            <Text style={styles.waiting}>{t('plex.waiting')}</Text>
          </View>
        ) : connected ? (
          <>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t('plex.connected')}</Text>
            <MenuRow trackId="simkl.lastSync" title={t('plex.lastSync')} value={syncedLabel} />
            <MenuRow trackId="simkl.syncNow" title={busy ? t('plex.syncing') : t('plex.syncNow')} onPress={busy ? undefined : () => void run()} />
            <MenuRow trackId="simkl.disconnect" title={t('plex.disconnect')} danger onPress={cut} />
          </>
        ) : (
          <View style={styles.connectWrap}>
            <PillButton label={t('simkl.connect')} trackId="simkl.connect" onPress={busy ? undefined : () => void connect()} />
          </View>
        )}

        {connected && pending.length > 0 && (
          <>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t('simkl.matchesTitle')}</Text>
            <Text style={styles.hint}>{t('simkl.matchesHint')}</Text>
            {/* A handful at most — only shows with no id at all land here —
                so a plain map inside the scroll view, not a nested list. */}
            {pending.map((p) => (
              <View key={p.simklId} style={styles.match}>
                <Text style={styles.matchFrom}>
                  {p.title}
                  {p.year ? ` (${p.year})` : ''}
                </Text>
                <Text style={styles.matchTo}>{t('simkl.matchLine', { name: p.name, count: p.rows.length })}</Text>
                <View style={styles.matchButtons}>
                  <Pressable style={[styles.matchBtn, styles.matchYes]} onPress={() => answer(p, true)}
                    accessibilityRole="button"
                    // Out of the card, "Same show" alone does not say which one —
                    // a screen reader swiping button to button hears the title too.
                    accessibilityLabel={t('a11y.matchSame', { title: p.title })}>
                    <Text style={styles.matchYesText}>{t('simkl.matchSame')}</Text>
                  </Pressable>
                  <Pressable style={styles.matchBtn} onPress={() => answer(p, false)}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.matchNot', { title: p.title })}>
                    <Text style={styles.matchNoText}>{t('simkl.matchNot')}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        <Pressable onPress={() => void Linking.openURL('https://simkl.com/').catch(() => {})} hitSlop={8} accessibilityRole="link">
          <Text style={styles.credit}>{t('simkl.credit')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.text, fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg, paddingTop: 14 },
  promiseRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: space.lg, paddingTop: 14, paddingBottom: 6 },
  promise: { color: colors.dim, fontSize: 13, lineHeight: 18, flex: 1 },
  connectWrap: { paddingHorizontal: space.lg, paddingTop: 24 },
  sectionTitle: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: ls(1.2),
    textTransform: 'uppercase',
    paddingHorizontal: space.lg,
    paddingTop: 22,
    paddingBottom: 6,
  },
  hint: { color: colors.dim, fontSize: 13, lineHeight: 18, paddingHorizontal: space.lg, paddingBottom: 8 },
  codeBox: { margin: space.lg, padding: 20, borderRadius: radius.card, backgroundColor: colors.card, alignItems: 'center', gap: 14 },
  step: { color: colors.dim, fontSize: 13.5, textAlign: 'center' },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copyHint: { color: colors.faint, fontSize: 12, marginTop: -6 },
  code: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: ls(4), fontVariant: ['tabular-nums'] },
  waiting: { color: colors.faint, fontSize: 12.5 },
  match: { marginHorizontal: space.lg, marginBottom: 10, padding: 14, borderRadius: radius.card, backgroundColor: colors.card, gap: 4 },
  matchFrom: { color: colors.text, fontSize: 15, fontWeight: '700' },
  matchTo: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  matchButtons: { flexDirection: 'row', gap: 10, paddingTop: 8 },
  matchBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, backgroundColor: colors.panel },
  /* Yellow acts: confirming is the action; "Not this" is the quiet way out. */
  matchYes: { backgroundColor: colors.yellow },
  matchYesText: { color: colors.onYellow, fontWeight: '800', fontSize: 14 },
  matchNoText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  credit: { color: colors.faint, fontSize: 12, textAlign: 'center', paddingTop: 28 },
});
