/**
 * The other end of the reset link — `opentv://reset-password?token=…`.
 *
 * THIS SCREEN DID NOT EXIST. The server issued reset tokens, the email carried
 * a button, and tapping it landed on expo-router's "Unmatched Route": password
 * reset was reachable, advertised on the sign-in screen, and impossible to
 * finish. Nothing in the app or the tests noticed, because both halves were
 * correct on their own — only the route between them was missing.
 *
 * NOT `set-password.tsx`, which is the neighbouring screen for somebody already
 * signed in with Apple or Google. That one authenticates with a session; this
 * one authenticates with the token in the URL, which is the whole point — the
 * person using it cannot sign in, or they would not be here.
 *
 * NO ADDRESS FIELD for the same reason as its neighbour: the token names the
 * account, and typing an address could only contradict it.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api';
import { PASSWORD_MIN, resetPassword } from '@/community-email-auth';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorKey } from '@/pure';
import { colors, radius, space } from '@/theme';

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const ready = password.length >= PASSWORD_MIN && !!token;

  const submit = async () => {
    if (busy || !ready || !token) return;
    setBusy(true);
    tapLight();
    try {
      await resetPassword(token, password);
      /**
       * SIGNED OUT EVERYWHERE, INCLUDING HERE. The server kills every session
       * on the account — that is most of the point of a reset — so this device
       * cannot carry on with whatever token it was holding. Sending them to
       * sign in with the password they have just chosen is the honest end.
       */
      Alert.alert(t('community.resetPassword.doneTitle'), t('community.resetPassword.doneBody'), [
        { text: t('common.done'), onPress: () => router.replace('/email-sign-in') },
      ]);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      Alert.alert(
        t('community.resetPassword.failedTitle'),
        // The server answers one 400 for an expired link, a used one and a
        // password it will not take. Only the last is worth separating, and it
        // arrives with a usable message of its own.
        code === 'invalid_body' ? (e as ApiError).message : t(communityErrorKey(code)),
      );
    } finally {
      setBusy(false);
    }
  };

  // A link with no token is a mangled one — a mail client that ate the query,
  // or a paste that lost half of it. Say so rather than showing a form whose
  // button can never work.
  if (!token) {
    return (
      <Screen>
        <NavHeader title={t('community.resetPassword.title')} />
        <ContentColumn>
          <View style={styles.body}>
            <Text style={styles.blurb}>{t('community.resetPassword.noToken')}</Text>
          </View>
        </ContentColumn>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title={t('community.resetPassword.title')} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ContentColumn>
          <View style={styles.body}>
            <Text style={styles.blurb}>{t('community.resetPassword.blurb')}</Text>

            <View style={styles.field}>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t('community.setPassword.placeholder')}
                placeholderTextColor={colors.faint}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                editable={!busy}
                autoFocus
                onSubmitEditing={() => void submit()}
              />
              <Pressable hitSlop={10} onPress={() => setShow((v) => !v)}>
                <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.dim} />
              </Pressable>
            </View>

            <Text style={styles.hint}>{t('community.setPassword.rule', { count: PASSWORD_MIN })}</Text>

            <Pressable style={[styles.cta, !ready && styles.dim]} disabled={!ready || busy} onPress={() => void submit()}>
              {busy ? (
                <ActivityIndicator color={colors.onYellow} />
              ) : (
                <Text style={styles.ctaText}>{t('community.resetPassword.action')}</Text>
              )}
            </Pressable>
          </View>
        </ContentColumn>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingTop: space.lg },
  blurb: { color: colors.dim, fontSize: 15, lineHeight: 21 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 14 },
  hint: { color: colors.faint, fontSize: 12.5 },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  ctaText: { color: colors.onYellow, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  dim: { opacity: 0.45 },
});
