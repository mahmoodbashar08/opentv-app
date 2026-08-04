/**
 * "Check your inbox" — and the other end of the link in it.
 *
 * TWO JOBS, ONE SCREEN. It is what you land on after creating an account, and
 * it is what the confirmation link opens (`ourtvtime://verify-email?token=…`).
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
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { confirmEmail, resendConfirmation } from '@/community-email-auth';
import { leaveCommunity } from '@/community-account';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorKey } from '@/pure';
import { colors, space } from '@/theme';

export default function VerifyEmailScreen() {
  const { token, pending } = useLocalSearchParams<{ token?: string; pending?: string }>();
  const [confirming, setConfirming] = useState(token != null);
  const [resending, setResending] = useState(false);
  const [done, setDone] = useState(false);

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

  const resend = async () => {
    if (resending) return;
    setResending(true);
    tapLight();
    try {
      await resendConfirmation();
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
            {t(pending === '1' ? 'community.verify.pendingBody' : 'community.verify.waitingBody')}
          </Text>
          {/* Said plainly, because a locked account with no explanation reads
              as a broken app rather than a step that has not been finished. */}
          <Text style={styles.lock}>{t('community.verify.lockedNote')}</Text>

          <Pressable style={styles.cta} onPress={() => void Linking.openURL('message://')}>
            <Text style={styles.ctaText}>{t('community.verify.openMail')}</Text>
          </Pressable>

          <Pressable style={styles.secondary} disabled={resending} onPress={() => void resend()}>
            {resending ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.secondaryText}>{t('community.verify.resend')}</Text>
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
});
