/**
 * Connecting Trakt, and the only screen that can.
 *
 * THE DEVICE FLOW IS THE WHOLE DESIGN. Trakt shows a short code, the user types
 * it on trakt.tv/activate on whatever device is convenient, and this polls until
 * it is approved. Nothing is typed into this app — see the header of `@/trakt`
 * for why a phone has no callback URL worth defending.
 *
 * IT ONLY EVER READS. There is no write scope, no "sync back to Trakt", and no
 * attempt to keep the two in step. Trakt is treated as another export that
 * happens to be live, which is the same standing the GDPR ZIP has: the phone
 * stays the source of truth. The screen says so out loud, because a person
 * connecting an account to a tracker is owed the shape of the deal before they
 * approve it and not after.
 *
 * THE POLL IS CANCELLED ON BLUR, not left running. A device code expires in
 * minutes and the loop below asks Trakt every few seconds; a screen dismissed
 * mid-flow that keeps polling is a request per interval for as long as the app
 * lives, against somebody else's rate limit, for a code nobody will approve.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { pollForToken, requestDeviceCode, type DeviceCode, type PollResult } from '@/trakt';
import { disconnectTrakt, getTraktToken, setTraktToken, syncTrakt, traktConnectedAt } from '@/trakt-sync';
import { colors, radius, space } from '@/theme';

/** Trakt's own advice is `interval` seconds; it answers 429 if pushed. */
const FALLBACK_INTERVAL = 5;

/**
 * Ask Trakt, every few seconds, whether the code has been approved yet.
 *
 * OUTSIDE THE COMPONENT ON PURPOSE. It reads the clock and loops for minutes,
 * which is neither of the things a render may do, and defining it in the body
 * meant its one `code` check closed over a value from whichever render created
 * it. Everything it needs is an argument.
 *
 * `alive` is a ref rather than a flag because the loop outlives the render that
 * started it: a boolean would be captured at the value it had when the loop
 * began, and the screen could be long gone.
 */
async function pollUntilApproved(
  dc: DeviceCode,
  alive: { current: boolean },
  done: (res: PollResult) => void | Promise<void>,
): Promise<void> {
  let wait = (dc.interval || FALLBACK_INTERVAL) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;
  while (alive.current && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    if (!alive.current) return;
    const res = await pollForToken(dc.device_code);
    // 429 means exactly this and nothing else — back off rather than stop.
    if (res.state === 'slow_down') {
      wait += 1000;
      continue;
    }
    if (res.state === 'pending') continue;
    await done(res);
    return;
  }
  // Ran out of time without an answer. Same outcome as Trakt saying so.
  if (alive.current) await done({ state: 'expired' });
}

export default function TraktScreen() {
  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  /* Read by the poll loop, which outlives a render — a state flag would be
     captured at the value it had when the loop started. */
  const alive = useRef(true);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void (async () => {
        setConnected((await getTraktToken()) != null);
        setLastSync(traktConnectedAt());
      })();
      return () => {
        // Leaving the screen ends the flow. See the header.
        alive.current = false;
        setCode(null);
      };
    }, []),
  );

  const connect = async () => {
    tapLight();
    setBusy(true);
    const dc = await requestDeviceCode();
    setBusy(false);
    if (!dc) {
      Alert.alert(t('trakt.failedTitle'), t('trakt.failedBody'));
      return;
    }
    setCode(dc);
    void pollUntilApproved(dc, alive, async (res) => {
      setCode(null);
      if (res.state === 'token') {
        await setTraktToken(res.access_token);
        setConnected(true);
        // Straight into a first sync: connecting and then being told to press
        // another button is the flow asking twice for one decision.
        void run();
        return;
      }
      if (res.state === 'denied') Alert.alert(t('trakt.title'), t('trakt.denied'));
      if (res.state === 'expired') Alert.alert(t('trakt.title'), t('trakt.expired'));
    });
  };

  const run = async () => {
    setBusy(true);
    const out = await syncTrakt();
    setBusy(false);
    setLastSync(traktConnectedAt());
    if (!out.ran) {
      Alert.alert(t('trakt.failedTitle'), t('trakt.failedBody'));
      return;
    }
    Alert.alert(
      t('trakt.title'),
      out.applied > 0 ? t('trakt.applied', { count: out.applied }) : t('trakt.nothingNew'),
    );
  };

  const cut = () => {
    Alert.alert(t('trakt.disconnectTitle'), t('trakt.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('trakt.disconnect'),
        style: 'destructive',
        onPress: () => {
          void disconnectTrakt().then(() => {
            setConnected(false);
            setLastSync(null);
          });
        },
      },
    ]);
  };

  const syncedLabel = lastSync ? new Date(lastSync).toLocaleString() : t('trakt.never');

  return (
    <Screen>
      <NavHeader title={t('trakt.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.intro}>{t('trakt.intro')}</Text>
        {/* THE DEAL, BEFORE THE BUTTON. Read-only, tracked shows only, phone
            stays the source of truth — said here rather than in a help page
            nobody opens, because this is the moment somebody decides. */}
        <View style={styles.promiseRow}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.dim} />
          <Text style={styles.promise}>{t('trakt.rules')}</Text>
        </View>

        {code != null ? (
          <View style={styles.codeBox}>
            <Text style={styles.step}>{t('trakt.step')}</Text>
            <Text style={styles.code} selectable>
              {code.user_code}
            </Text>
            <PillButton
              label={t('trakt.open')}
              trackId="trakt.open"
              onPress={() => void Linking.openURL(code.verification_url).catch(() => {})}
            />
            <Text style={styles.waiting}>{t('trakt.waiting')}</Text>
          </View>
        ) : connected ? (
          <>
            <Text style={styles.sectionTitle}>{t('trakt.connected')}</Text>
            <MenuRow trackId="trakt.lastSync" title={t('trakt.lastSync')} value={syncedLabel} />
            <MenuRow
              trackId="trakt.syncNow"
              title={busy ? t('trakt.syncing') : t('trakt.syncNow')}
              onPress={busy ? undefined : () => void run()}
            />
            <MenuRow trackId="trakt.disconnect" title={t('trakt.disconnect')} danger onPress={cut} />
          </>
        ) : (
          <View style={styles.connectWrap}>
            <PillButton
              label={t('trakt.connect')}
              trackId="trakt.connect"
              onPress={busy ? undefined : () => void connect()}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.text, fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg, paddingTop: 14 },
  promiseRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    paddingTop: 14,
    paddingBottom: 6,
  },
  promise: { color: colors.dim, fontSize: 13, lineHeight: 18, flex: 1 },
  connectWrap: { paddingHorizontal: space.lg, paddingTop: 24 },
  sectionTitle: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: space.lg,
    paddingTop: 22,
    paddingBottom: 6,
  },
  codeBox: {
    margin: space.lg,
    padding: 20,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    gap: 14,
  },
  step: { color: colors.dim, fontSize: 13.5, textAlign: 'center' },
  /* Monospaced and wide: this is read off one screen and typed into another,
     and 0/O and 1/I are the whole reason that goes wrong. */
  code: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 6,
    fontVariant: ['tabular-nums'],
  },
  waiting: { color: colors.faint, fontSize: 12.5 },
});
