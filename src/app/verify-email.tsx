/**
 * "Check your inbox" — and the other end of the link in it.
 *
 * TWO JOBS, ONE SCREEN. It is what you land on after creating an account, and
 * it is what the confirmation link opens (`opentv://verify-email?token=…`).
 * The second is why it takes a `token` param: expo-router matches the deep link
 * to this route, and if a token is present the screen confirms immediately
 * rather than asking somebody to press a button about a thing they already
 * pressed a button about.
 *
 * WHY IT BLOCKS. Until the address is confirmed the session is restricted
 * server-side — no comments, no follows, no looking at anybody. So this screen
 * is not a suggestion; it is the whole of the app's community half until it is
 * done. It says so plainly, and it offers the only three ways forward: resend,
 * open Mail, or leave.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api';
import { confirmEmail, confirmEmailWithCode, resendConfirmation, resendWaitMs } from '@/community-email-auth';
import { leaveCommunity } from '@/community-account';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorKey } from '@/pure';
import { colors, space } from '@/theme';

export default function VerifyEmailScreen() {
  const { token, email } = useLocalSearchParams<{ token?: string; email?: string }>();
  const [confirming, setConfirming] = useState(token != null);
  const [resending, setResending] = useState(false);
  const [done, setDone] = useState(false);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  /**
   * Seconds until another email may be asked for.
   *
   * Starts at a full minute on arrival because one has JUST been sent — the
   * registration that led here sent it. Offering a live "Send it again" the
   * instant somebody lands would be offering a button whose only reply is 429.
   *
   * Read from storage rather than started at 60 unconditionally: reopening the
   * app hours later must not re-impose a wait that has long since passed.
   */
  const [wait, setWait] = useState(() => Math.ceil(resendWaitMs() / 1000));
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(Math.ceil(resendWaitMs() / 1000)), 1000);
    return () => clearInterval(t);
  }, [wait]);

  // THE LINK'S OTHER END. Runs once, on the token it arrived with.
  useEffect(() => {
    if (token == null) return;
    let cancelled = false;
    void confirmEmail(token)
      .then(() => {
        if (cancelled) return;
        setDone(true);
        tapLight();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const code = e instanceof ApiError ? e.code : 'unknown';
        Alert.alert(
          t('community.verify.failedTitle'),
          // The server answers the same 400 for an expired link and one that
          // never existed, deliberately. "Ask for a new one" is the only useful
          // thing to say about either.
          code === 'invalid_body' ? t('community.verify.expired') : t(communityErrorKey(code)),
        );
      })
      .finally(() => {
        if (!cancelled) setConfirming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * THE CODE, for when the link cannot work.
   *
   * A confirmation link is a deep link, so it only opens on the device holding
   * the email. Reading it on a phone while signing in on a tablet, a second
   * handset or a simulator leaves nothing to tap — and a button that does
   * nothing is indistinguishable from a broken account. Six digits cross the
   * room.
   */
  const submitCode = async () => {
    const digits = code.replace(/\D/g, '');
    if (checking || digits.length !== 6 || !email) return;
    setChecking(true);
    tapLight();
    try {
      await confirmEmailWithCode(email, digits);
      setDone(true);
    } catch (e) {
      const c = e instanceof ApiError ? e.code : 'unknown';
      Alert.alert(
        t('community.verify.failedTitle'),
        c === 'invalid_body' ? t('community.verify.badCode') : t(communityErrorKey(c)),
      );
      setCode('');
    } finally {
      setChecking(false);
    }
  };

  const resend = async () => {
    if (resending) return;
    setResending(true);
    tapLight();
    try {
      await resendConfirmation();
      setWait(Math.ceil(resendWaitMs() / 1000));
      Alert.alert(t('community.verify.sentTitle'), t('community.verify.sentBody'));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      Alert.alert(
        t('community.verify.failedTitle'),
        // The cooldown is not a failure — it is the app saying "you just did
        // that". Worth its own words rather than a generic error.
        code === 'rate_limited' ? t('community.verify.tooSoon') : t(communityErrorKey(code)),
      );
    } finally {
      setResending(false);
    }
  };

  if (confirming) {
    return (
      <Screen>
        <NavHeader title={t('community.verify.title')} />
        <View style={styles.centre}>
          <ActivityIndicator color={colors.dim} />
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <NavHeader title={t('community.verify.title')} />
        <ContentColumn>
          <View style={styles.body}>
            <Ionicons name="checkmark-circle" size={56} color={colors.green} />
            <Text style={styles.heading}>{t('community.verify.doneTitle')}</Text>
            <Text style={styles.text}>{t('community.verify.doneBody')}</Text>
            {/* `dismissAll`, not a replace to a tab: this screen sits on top
                of the join modal (and the sign-in one before it), and replacing
                only itself would leave the user looking at "Continue with
                Apple" after finishing. Closing the modals lands them on the
                tab they came from. */}
            <Pressable style={styles.cta} onPress={() => router.dismissAll()}>
              <Text style={styles.ctaText}>{t('community.verify.doneAction')}</Text>
            </Pressable>
          </View>
        </ContentColumn>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title={t('community.verify.title')} />
      <ContentColumn>
        <View style={styles.body}>
          <Ionicons name="mail-outline" size={56} color={colors.yellow} />
          <Text style={styles.heading}>{t('community.verify.sentTitle')}</Text>
          <Text style={styles.text}>
            {t('community.verify.waitingBody')}
          </Text>

          {/* THE ADDRESS IT WENT TO, spelled out.
              "Check your inbox" is useless advice if the inbox is not the one
              you think: one missing letter in a Gmail address is a different
              account entirely, the mail leaves successfully, and the screen
              waits for a confirmation that can never arrive. Showing what was
              typed turns a silent dead end into an obvious typo.
              Only here — a reset says nothing about where it went, on purpose,
              since that screen can be reached by somebody who is not the owner. */}
          {email ? <Text style={styles.address}>{email}</Text> : null}
          {/* Said plainly, because a locked account with no explanation reads
              as a broken app rather than a step that has not been finished. */}
          <Text style={styles.lock}>{t('community.verify.lockedNote')}</Text>

          {/* Only where the address is known. Arriving here from a deep link
              there is no address to pair a code with, and a field that cannot
              work is worse than no field. */}
          {email ? (
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>{t('community.verify.codeLabel')}</Text>
              <TextInput
                style={styles.codeInput}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                // eslint-disable-next-line no-restricted-syntax -- six zeros, not a word
                placeholder="000000"
                placeholderTextColor={colors.faint}
                editable={!checking}
                onSubmitEditing={() => void submitCode()}
              />
              <Pressable
                style={[styles.cta, (code.replace(/\D/g, '').length !== 6 || checking) && styles.dim]}
                disabled={code.replace(/\D/g, '').length !== 6 || checking}
                onPress={() => void submitCode()}>
                {checking ? (
                  <ActivityIndicator color={colors.onYellow} />
                ) : (
                  <Text style={styles.ctaText}>{t('community.verify.codeAction')}</Text>
                )}
              </Pressable>
            </View>
          ) : null}

          <Pressable style={styles.secondary} onPress={() => void Linking.openURL('message://')}>
            <Text style={styles.secondaryText}>{t('community.verify.openMail')}</Text>
          </Pressable>

          <Pressable
            style={styles.secondary}
            disabled={resending || wait > 0}
            onPress={() => void resend()}>
            {resending ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={[styles.secondaryText, wait > 0 && styles.waiting]}>
                {wait > 0
                  ? t('community.verify.resendIn', { seconds: wait })
                  : t('community.verify.resend')}
              </Text>
            )}
          </Pressable>

          {/* Never trapped. Leaving destroys nothing — the account and its
              address stay exactly as they are, and signing in again returns
              here. */}
          <Pressable
            hitSlop={8}
            onPress={() => {
              void leaveCommunity();
              router.dismissAll();
            }}>
            <Text style={styles.link}>{t('community.verify.notNow')}</Text>
          </Pressable>
        </View>
      </ContentColumn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { alignItems: 'center', gap: 14, paddingTop: space.xl },
  heading: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  text: { color: colors.dim, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  lock: { color: colors.faint, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 2 },
  // Brighter than the sentence above it and never truncated: this line exists
  // to be read letter by letter, because one wrong letter is the bug it is
  // here to expose.
  address: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: -4,
  },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 34,
    marginTop: 8,
  },
  ctaText: { color: colors.onYellow, fontSize: 16, fontWeight: '800' },
  secondary: { paddingVertical: 12, paddingHorizontal: 24 },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  link: { color: colors.blue, fontSize: 14, paddingVertical: 8 },
  codeBox: { width: '100%', alignItems: 'center', gap: 10, marginTop: 6 },
  codeLabel: { color: colors.faint, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  codeInput: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 10,
    textAlign: 'center',
    // The trailing letter-spacing pushes the text left of centre; the padding
    // puts it back so six digits sit under the label rather than beside it.
    paddingLeft: 10,
    paddingVertical: 12,
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 14,
  },
  dim: { opacity: 0.45 },
  // Dimmed, not hidden: the wait is information, and a control that vanishes
  // and returns reads as a glitch.
  waiting: { color: colors.faint, fontWeight: '600' },
});
