/**
 * Add a password to an account that joined with Apple or Google.
 *
 * WHY ANYONE WANTS THIS. A provider sign-in is one door, and a door somebody
 * else owns. It fails on a device where Google Play services are missing or
 * broken, on a simulator with no Apple ID, and permanently if they ever stop
 * using that Google account. A password is a second way in that OpenTV can
 * honour by itself.
 *
 * NO ADDRESS FIELD, deliberately. The server uses the address on the identity
 * the provider issued; letting this screen name one would let anybody claim
 * any address by typing it. There is nothing here to get wrong.
 *
 * NO CONFIRMATION EMAIL EITHER, for the same reason — the provider has already
 * verified that address, which is the exact standard the account-linking rule
 * holds out for. Sending "please confirm" for an address Google just vouched
 * for would be theatre.
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
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api';
import { PASSWORD_MIN, setAccountPassword } from '@/community-email-auth';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorKey } from '@/pure';
import { colors, radius, space } from '@/theme';

export default function SetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const ready = password.length >= PASSWORD_MIN;

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    tapLight();
    try {
      const email = await setAccountPassword(password);
      // The address is worth showing: this screen never asked for one, so
      // "which email?" is the obvious question, and answering it is how
      // somebody knows what to type next time.
      Alert.alert(t('community.setPassword.doneTitle'), t('community.setPassword.doneBody', { email }), [
        { text: t('common.done'), onPress: () => router.back() },
      ]);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      Alert.alert(
        t('community.setPassword.failedTitle'),
        code === 'handle_taken'
          ? t('community.setPassword.addressTaken')
          : code === 'forbidden'
            ? t('community.setPassword.alreadySet')
            : t(communityErrorKey(code)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <NavHeader title={t('community.settings.setPasswordRow')} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ContentColumn>
          <View style={styles.body}>
            <Text style={styles.blurb}>{t('community.setPassword.blurb')}</Text>

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
                onSubmitEditing={() => void submit()}
              />
              <Pressable hitSlop={10} onPress={() => setShow((v) => !v)}>
                <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.dim} />
              </Pressable>
            </View>

            {/* The rule, before it is broken rather than after. */}
            <Text style={styles.hint}>{t('community.setPassword.rule', { count: PASSWORD_MIN })}</Text>

            <Pressable style={[styles.cta, !ready && styles.dim]} disabled={!ready || busy} onPress={() => void submit()}>
              {busy ? (
                <ActivityIndicator color={colors.onYellow} />
              ) : (
                <Text style={styles.ctaText}>{t('community.setPassword.action')}</Text>
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
