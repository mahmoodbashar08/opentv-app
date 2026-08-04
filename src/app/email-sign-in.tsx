/**
 * Email and password — creating an account, or coming back to one.
 *
 * ONE SCREEN, TWO MODES, because they are the same two fields and a person
 * arriving here often does not yet know which they need: the address they are
 * about to type may or may not already have an account. Splitting them into two
 * screens makes the wrong guess a navigation error rather than a toggle.
 *
 * WHAT IT WILL NOT TELL YOU. "Create account" with an address that already
 * exists answers exactly as a new one does — "check your inbox" — because the
 * server refuses to say which, and it is right to: an endpoint that reports
 * "already registered" is a way to test whether somebody uses OpenTV, and for a
 * TV tracker that is a list of what they watch. The copy is written so that
 * answer is honest rather than evasive: an email really is on its way, and only
 * the person holding the inbox learns which kind it was.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api';
import {
  emailLooksValid,
  loginWithEmail,
  PASSWORD_MIN,
  registerWithEmail,
  requestPasswordReset,
} from '@/community-email-auth';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorKey } from '@/pure';
import { colors, space } from '@/theme';

type Mode = 'signIn' | 'create';

export default function EmailSignInScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  // Checked here only so nobody waits for a round trip to be told their
  // password is four characters long. The server decides.
  const ready = emailLooksValid(email) && password.length >= PASSWORD_MIN;

  /**
   * WHERE TO GO ONCE THE ACCOUNT EXISTS — and why it is not a `replace`.
   *
   * Apple and Google sign in FROM the join screen, so `replace('/handle')`
   * swaps join for handle and the stack is [tabs, handle]; when `afterJoin()`
   * calls `router.back()` at the end, the user lands on the tabs.
   *
   * Email is one screen deeper — join pushed this one — so the same `replace`
   * left [tabs, join, handle], and that closing `back()` landed on the JOIN
   * SCREEN. Somebody who had just created an account, picked a handle and
   * finished was shown "The OpenTV community is here. Continue with Apple",
   * as if none of it had happened.
   *
   * `dismissAll()` closes both modals first, so whatever comes next sits
   * directly on the tabs and every path unwinds to the same place.
   */
  const leave = (res: { needsHandle: boolean; verified: boolean }) => {
    if (!res.verified) {
      router.replace('/verify-email');
      return;
    }
    router.dismissAll();
    if (res.needsHandle) router.push('/handle');
  };

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    tapLight();
    try {
      if (mode === 'create') {
        const res = await registerWithEmail(email.trim(), password);
        // `pending` is the taken-address case, and it looks identical on
        // purpose — see this file's header.
        if (res.pending) {
          router.replace('/verify-email?pending=1');
          return;
        }
        leave(res);
        return;
      }

      leave(await loginWithEmail(email.trim(), password));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      const message =
        code === 'invalid_body'
          ? t('community.email.rejected')
          : // A REFUSED SIGN-IN IS USUALLY A MISSING ACCOUNT, not a typo — this
            // screen opens in sign-in mode, so the first thing a new user does
            // is try to sign in to something that does not exist yet. "That
            // sign-in wasn't accepted" is true and useless; it has to name the
            // way forward.
            //
            // It says the same thing whether or not the address is registered,
            // so it stays clear of the oracle the server is built to avoid.
            code === 'unauthenticated' && mode === 'signIn'
            ? t('community.email.signInFailed')
            : t(communityErrorKey(code));

      Alert.alert(t('community.email.failedTitle'), message, [
        // Straight to the fix rather than an OK that leaves them where they
        // were, on a form that cannot succeed.
        ...(code === 'unauthenticated' && mode === 'signIn'
          ? [{ text: t('community.email.createAction'), onPress: () => setMode('create') }]
          : []),
        { text: t('common.ok'), style: 'cancel' as const },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!emailLooksValid(email)) {
      Alert.alert(t('community.email.forgotTitle'), t('community.email.forgotNeedsEmail'));
      return;
    }
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // `requestPasswordReset` only rethrows a network failure, and even then
      // the honest message is the same one: if that address is here, an email
      // is coming. Saying anything sharper would answer a question the server
      // spent its design refusing to answer.
    }
    Alert.alert(t('community.email.forgotTitle'), t('community.email.forgotSent'));
  };

  return (
    <Screen>
      <NavHeader title={t(mode === "create" ? "community.email.createTitle" : "community.email.signInTitle")} close />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: space.lg + insets.bottom }} keyboardShouldPersistTaps="handled">
          <ContentColumn>
            <View style={styles.body}>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t('community.email.emailPlaceholder')}
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                returnKeyType="next"
                // An address is `[a-z0-9@._-]`, so the field stays
                // left-to-right even in Arabic — the same reason the handle
                // field does.
                textAlign="left"
              />

              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('community.email.passwordPlaceholder')}
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  // `new-password` on create tells the keychain to OFFER one,
                  // which is the single best thing this screen can do for the
                  // strength of what ends up stored.
                  autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                  secureTextEntry={!show}
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                  textAlign="left"
                />
                <Pressable style={styles.eye} hitSlop={10} onPress={() => setShow((v) => !v)}>
                  <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.dim} />
                </Pressable>
              </View>

              <Text style={styles.hint}>
                {mode === 'create' ? t('community.email.passwordRule', { n: PASSWORD_MIN }) : ' '}
              </Text>

              <Pressable style={[styles.cta, !ready && styles.dim]} disabled={!ready || busy} onPress={() => void submit()}>
                {busy ? (
                  <ActivityIndicator color={colors.onYellow} />
                ) : (
                  <Text style={styles.ctaText}>
                    {t(mode === 'create' ? 'community.email.createAction' : 'community.email.signInAction')}
                  </Text>
                )}
              </Pressable>

              {mode === 'signIn' && (
                <Pressable onPress={() => void forgot()} hitSlop={8}>
                  <Text style={styles.link}>{t('community.email.forgotLink')}</Text>
                </Pressable>
              )}

              <Pressable
                style={styles.switchRow}
                hitSlop={8}
                onPress={() => setMode((m) => (m === 'create' ? 'signIn' : 'create'))}>
                <Text style={styles.switchText}>
                  {t(mode === 'create' ? 'community.email.haveAccount' : 'community.email.noAccount')}
                </Text>
              </Pressable>
            </View>
          </ContentColumn>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingTop: space.lg },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    writingDirection: 'ltr',
  },
  passwordRow: { justifyContent: 'center' },
  passwordInput: { paddingRight: 46 },
  eye: { position: 'absolute', right: 12 },
  hint: { color: colors.faint, fontSize: 12.5, minHeight: 17 },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  dim: { opacity: 0.45 },
  ctaText: { color: colors.onYellow, fontSize: 16, fontWeight: '800' },
  link: { color: colors.blue, fontSize: 14, textAlign: 'center', paddingVertical: 10 },
  switchRow: { alignItems: 'center', paddingVertical: 6 },
  switchText: { color: colors.dim, fontSize: 14 },
});
