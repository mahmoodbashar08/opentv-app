/**
 * Email and password — creating an account, or coming back to one.
 *
 * ONE SCREEN, TWO MODES, because they are the same two fields and a person
 * arriving here often does not yet know which they need: the address they are
 * about to type may or may not already have an account. Splitting them into two
 * screens makes the wrong guess a navigation error rather than a toggle.
 *
 * WHEN THE ADDRESS IS ALREADY TAKEN it says so, and says what to do about it.
 * That is a change: it used to answer "check your inbox" exactly as a new
 * account does, so that registration could not be used to discover who has an
 * account. The privacy that bought was thin — the inbox owner was told a minute
 * later anyway — and the cost was real, because somebody whose account signs in
 * with Google was sent to wait for a password email that could never help them.
 * See `showExisting`, and the register route on the server.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
  type ExistingAccount,
  loginWithEmail,
  PASSWORD_MIN,
  registerWithEmail,
  requestPasswordReset,
} from '@/community-email-auth';
import { claimImportedHandle } from '@/community-prompt';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorKey } from '@/pure';
import { colors, space } from '@/theme';

type Mode = 'signIn' | 'create';

export default function EmailSignInScreen() {
  const insets = useSafeAreaInsets();
  // Filled in when the join screen knows which account this phone belongs to.
  // Sign-in mode is already the default, which is the right one to arrive in:
  // an address we remember is one that has an account.
  const { email: known, forgot: askForgot } = useLocalSearchParams<{ email?: string; forgot?: string }>();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState(known ?? '');
  // Arrived from the card that names this phone's account. The address is not
  // a field to be edited then — it is the account, and the only thing missing
  // is the password.
  const locked = !!known;
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
      // The address rides along so the next screen can offer the CODE as well
      // as the link — a code is only accepted with the address it was sent to,
      // and asking somebody to retype what they typed one screen ago is rude.
      router.replace(`/verify-email?email=${encodeURIComponent(email.trim())}`);
      return;
    }
    router.dismissAll();
    // The TV Time name first — see `claimImportedHandle`. Only a name that
    // cannot be taken puts a screen in front of somebody.
    if (res.needsHandle) {
      void claimImportedHandle().then((claimed: boolean) => {
        if (!claimed) router.push('/handle');
      });
    }
  };

  /**
   * "THAT ADDRESS ALREADY HAS AN ACCOUNT" — and how to get into it.
   *
   * This used to send people to "check your inbox", identically to a successful
   * registration, so as not to reveal that the address was taken. It revealed
   * it anyway, by email, a minute later — and in the meantime the person was
   * waiting for a message that could not do what they wanted. Somebody whose
   * account is a Google one has no password to reset and never will.
   *
   * So the server now names the providers and this says them out loud. The two
   * cases need opposite advice, which is the whole reason it is worth asking:
   * an account WITH a password should be signed into, and one without needs a
   * password created before there is anything to type.
   */
  const showExisting = ({ providers, hasPassword }: ExistingAccount) => {
    const named = providers
      .filter((p) => p !== 'email')
      .map((p) => (p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : p));

    const message = named.length
      ? t('community.email.existsProvider', { provider: named.join(' & ') }) +
        (hasPassword ? '' : `\n\n${t('community.email.existsNoPassword')}`)
      : t('community.email.existsPassword');

    Alert.alert(t('community.email.existsTitle'), message, [
      hasPassword
        ? {
            text: t('community.email.existsSignIn'),
            onPress: () => {
              setMode('signIn');
              setPassword('');
            },
          }
        : {
            // The reset link is how a provider-only account gets its first
            // password — same token, and "set" is the honest verb for it.
            text: t('community.email.existsSetPassword'),
            onPress: () => void forgot(),
          },
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    tapLight();
    try {
      if (mode === 'create') {
        const res = await registerWithEmail(email.trim(), password);
        if (res.taken) {
          showExisting(res);
          return;
        }
        leave(res);
        return;
      }

      leave(await loginWithEmail(email.trim(), password));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';

      // THE ADDRESS SIGNS IN ANOTHER WAY. Not a failure to explain away — the
      // account is there and the person is one tap from it, in the wrong place.
      if (code === 'use_provider') {
        showExisting({
          taken: true,
          providers: e instanceof ApiError ? [...e.providers] : [],
          hasPassword: false,
        });
        return;
      }

      const message =
        code === 'invalid_body'
          ? t('community.email.rejected')
          : // NO ACCOUNT AT ALL, which the server now says outright. This screen
            // opens in sign-in mode, so the commonest thing anybody does here is
            // try to sign in to something that does not exist yet — and being
            // told the password is wrong sends them to guess at a door that was
            // never built.
            code === 'no_account'
            ? t('community.email.signInFailed')
            : // AND NOW A 401 MEANS EXACTLY ONE THING. It used to cover both
              // cases, so it could only say the vague "that sign-in wasn't
              // accepted" — true of a wrong password, a missing account and a
              // provider account alike. Those are separate codes now, so this
              // is free to name the actual problem and point at the way out.
              code === 'unauthenticated' && mode === 'signIn'
              ? t('community.email.wrongPassword')
              : t(communityErrorKey(code));

      Alert.alert(t('community.email.failedTitle'), message, [
        // Straight to the fix rather than an OK that leaves them where they
        // were, on a form that cannot succeed.
        ...(code === 'no_account'
          ? [
              {
                text: t('community.email.createAction'),
                onPress: () => {
                  setMode('create');
                  setPassword('');
                },
              },
            ]
          : []),
        // A wrong password has a way out too, and it is the link they have
        // just failed to notice above the alert.
        ...(code === 'unauthenticated' && mode === 'signIn'
          ? [{ text: t('community.email.forgotAction'), onPress: () => void forgot() }]
          : []),
        { text: t('common.ok'), style: 'cancel' as const },
      ]);
    } finally {
      setBusy(false);
    }
  };

  /**
   * ARRIVED ON "FORGOT YOUR PASSWORD?" from the join screen, where the address
   * was already known. Sending it on mount is not a surprise: it is the button
   * that was pressed, one screen ago, and making somebody press a second one
   * that says the same thing is asking them to confirm their own tap.
   *
   * Guarded by a ref, not by the effect's dependencies: `forgot` is recreated
   * every render, so listing it would send one per keystroke.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (askForgot !== '1' || !known || asked.current) return;
    asked.current = true;
    void forgot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askForgot, known]);

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
                style={[styles.input, locked && styles.locked]}
                value={email}
                onChangeText={setEmail}
                editable={!locked}
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

              {/* NO "create an account instead" when we arrived knowing which
                  account this phone belongs to. The library republishes onto
                  whoever signs in, so a second account here would take a copy
                  of these comments and leave the first one's followers behind.
                  Changing account means deleting the current one. */}
              {locked ? null : (
                <Pressable
                  style={styles.switchRow}
                  hitSlop={8}
                  onPress={() => setMode((m) => (m === 'create' ? 'signIn' : 'create'))}>
                  <Text style={styles.switchText}>
                    {t(mode === 'create' ? 'community.email.haveAccount' : 'community.email.noAccount')}
                  </Text>
                </Pressable>
              )}
            </View>
          </ContentColumn>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingTop: space.lg },
  // Visibly settled rather than merely unresponsive: a field that ignores taps
  // and looks editable reads as a bug.
  locked: { color: colors.dim },
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
