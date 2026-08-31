/**
 * Connecting Plex, and the only screen that can.
 *
 * THE PIN FLOW IS THE WHOLE DESIGN. Plex issues a short code, the user approves
 * it in a browser on whatever device is convenient, and this polls until a token
 * appears. Nothing is typed into this app — see the header of `@/plex` for why
 * a phone has no callback URL worth defending, and for why this is Plex rather
 * than Trakt.
 *
 * IT ONLY EVER READS. There is no write, no "sync back to Plex", and no attempt
 * to keep the two in step. Plex is treated as another export that happens to be
 * live, which is the same standing the GDPR ZIP has: the phone stays the source
 * of truth. The screen says so out loud, because a person connecting an account
 * to a tracker is owed the shape of the deal before they approve it, not after.
 *
 * THE POLL IS CANCELLED ON BLUR, not left running. A PIN expires in minutes and
 * the loop below asks Plex every few seconds; a screen dismissed mid-flow that
 * keeps polling is a request per interval for as long as the app lives, against
 * somebody else's server, for a code nobody will approve.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { pinAuthUrl, pollForPin, requestPin, type PinResult, type PlexPin } from '@/plex';
import { disconnectPlex, getPlexToken, plexClientId, plexSyncedAt, setPlexToken, syncPlex } from '@/plex-sync';
import { mixHex } from '@/pure';
import { colors, radius, space } from '@/theme';

/** Plex publishes no interval, so this is chosen: often enough that approving
 *  in a browser feels immediate, rarely enough not to hammer plex.tv. */
const POLL_MS = 2000;

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
  clientId: string,
  pin: PlexPin,
  alive: { current: boolean },
  done: (res: PinResult) => void | Promise<void>,
): Promise<void> {
  // Plex expires a PIN in about fifteen minutes; this stops well before that
  // so a forgotten screen is not still asking when it does.
  const deadline = Date.now() + 10 * 60 * 1000;
  while (alive.current && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (!alive.current) return;
    const res = await pollForPin(clientId, pin);
    if (res.state === 'pending') continue;
    await done(res);
    return;
  }
  // Ran out of time without an answer. Same outcome as Plex saying so.
  if (alive.current) await done({ state: 'expired' });
}

export default function PlexScreen() {
  const [connected, setConnected] = useState(false);
  const [pin, setPin] = useState<PlexPin | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  /* Read by the poll loop, which outlives a render — a state flag would be
     captured at the value it had when the loop started. */
  const alive = useRef(true);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void (async () => {
        setConnected((await getPlexToken()) != null);
        setLastSync(plexSyncedAt());
      })();
      return () => {
        // Leaving the screen ends the flow. See the header.
        alive.current = false;
        setPin(null);
      };
    }, []),
  );

  const connect = async () => {
    tapLight();
    setBusy(true);
    const clientId = plexClientId();
    const got = await requestPin(clientId);
    setBusy(false);
    if (!got) {
      Alert.alert(t('plex.failedTitle'), t('plex.failedBody'));
      return;
    }
    setPin(got);
    void pollUntilApproved(clientId, got, alive, async (res) => {
      setPin(null);
      if (res.state === 'token') {
        await setPlexToken(res.token);
        setConnected(true);
        // Straight into a first sync: connecting and then being told to press
        // another button is the flow asking twice for one decision.
        void run();
        return;
      }
      if (res.state === 'expired') Alert.alert(t('plex.title'), t('plex.expired'));
    });
  };

  const run = async () => {
    setBusy(true);
    const out = await syncPlex();
    setBusy(false);
    setLastSync(plexSyncedAt());
    if (!out.ran) {
      /*
       * THREE DIFFERENT NOTHINGS, and they need three different sentences.
       * "Check your connection" to somebody on a train away from their own LAN
       * sends them to fix something that is not wrong; "try again on the same
       * network" to somebody who owns no server at all is worse, because it
       * blames them for not standing near a machine they do not have.
       */
      Alert.alert(
        t('plex.title'),
        out.seen === 0 ? t('plex.noServerAtAll') : out.servers === 0 ? t('plex.noServer') : t('plex.failedBody'),
      );
      return;
    }
    Alert.alert(t('plex.title'), out.applied > 0 ? t('plex.applied', { count: out.applied }) : t('plex.nothingNew'));
  };

  const cut = () => {
    Alert.alert(t('plex.disconnectTitle'), t('plex.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('plex.disconnect'),
        style: 'destructive',
        onPress: () => {
          void disconnectPlex().then(() => {
            setConnected(false);
            setLastSync(null);
          });
        },
      },
    ]);
  };

  const syncedLabel = lastSync ? new Date(lastSync).toLocaleString() : t('plex.never');

  return (
    <Screen>
      <NavHeader title={t('plex.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.intro}>{t('plex.intro')}</Text>
        {/* THE DEAL, BEFORE THE BUTTON. Read-only, tracked shows only, phone
            stays the source of truth — said here rather than in a help page
            nobody opens, because this is the moment somebody decides. */}
        <View style={styles.promiseRow}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.dim} />
          <Text style={styles.promise}>{t('plex.rules')}</Text>
        </View>
        {/*
         * SAID BECAUSE IT IS TRUE, not as a disclaimer. The PIN flow was proven
         * against the live API before this shipped; the part that reads a
         * library and ticks episodes has never run against a real server,
         * because there was none to run it against. A scrobbler's mistakes are
         * silent and cumulative — a duplicate tick looks like nothing while
         * every total and streak built on it drifts — so the person switching
         * this on is owed the fact that they are first, and told what the worst
         * case actually is: it only ever ADDS, and only for shows they already
         * track. Remove this line once a real sync has been confirmed.
         */}
        <View style={styles.newRow}>
          <Ionicons name="information-circle-outline" size={16} color={colors.brand} />
          <Text style={styles.newNote}>{t('plex.newWarning')}</Text>
        </View>

        {pin != null ? (
          <View style={styles.codeBox}>
            <Text style={styles.step}>{t('plex.step')}</Text>
            {/* THE CODE IS READ OFF ONE SCREEN AND TYPED INTO ANOTHER, which
                is where four characters go wrong — so it can also just be
                copied. `selectable` stays: a long-press is what some people
                reach for first, and taking it away to add a button would be a
                trade rather than an addition. */}
            <Pressable
              onPress={() => {
                void Clipboard.setStringAsync(pin.code);
                tapLight();
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              accessibilityLabel={t('plex.copy')}
              hitSlop={10}
              style={styles.codeRow}>
              <Text style={styles.code} selectable>
                {pin.code}
              </Text>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={colors.dim} />
            </Pressable>
            <Text style={styles.copyHint}>{copied ? t('plex.copied') : t('plex.copy')}</Text>
            <PillButton
              label={t('plex.open')}
              trackId="plex.open"
              onPress={() => void Linking.openURL(pinAuthUrl()).catch(() => {})}
            />
            <Text style={styles.waiting}>{t('plex.waiting')}</Text>
          </View>
        ) : connected ? (
          <>
            <Text style={styles.sectionTitle}>{t('plex.connected')}</Text>
            <MenuRow trackId="plex.lastSync" title={t('plex.lastSync')} value={syncedLabel} />
            <MenuRow
              trackId="plex.syncNow"
              title={busy ? t('plex.syncing') : t('plex.syncNow')}
              onPress={busy ? undefined : () => void run()}
            />
            <MenuRow trackId="plex.disconnect" title={t('plex.disconnect')} danger onPress={cut} />
          </>
        ) : (
          <View style={styles.connectWrap}>
            <PillButton
              label={t('plex.connect')}
              trackId="plex.connect"
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
  newRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginHorizontal: space.lg,
    marginTop: 12,
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: mixHex(colors.bg, colors.brand, 0.14),
  },
  newNote: { color: colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
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
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copyHint: { color: colors.faint, fontSize: 12, marginTop: -6 },
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
