/**
 * An account, and NOTHING ELSE.
 *
 * This screen exists because `/join` was the only door, and it is a door to a
 * community: a public handle, published shelves, uploaded comments and
 * ratings, a push token and analytics. Somebody whose entire wish is "do not
 * lose my decade if I lose my phone" had to accept all of it to get a backup,
 * which is the sharpest contradiction in an app whose first promise is that
 * your library stays on your phone.
 *
 * Neither backup nor sync ever needed membership — both ask `getToken()`, and
 * the server's `requireAuth` validates a token and asks nothing else. So this
 * screen takes the token and stops.
 *
 * SAYING WHAT IT DOES NOT DO IS THE POINT. A privacy claim made anywhere but
 * the screen where the decision is taken is marketing, and the mirror of that
 * rule is that a screen taking a decision must say what it is NOT taking. The
 * three lines under the buttons are the whole reason this is a separate screen
 * rather than a checkbox on the other one — and a checkbox is exactly how
 * somebody joins a community by accident.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api } from '@/api';
import { appleAvailable, AuthCancelled, signInWithApple, signInWithGoogle } from '@/community-auth';
import { rememberAccount, signIn } from '@/community-session';
import { NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';

type SessionResponse = { token: string; profile: { id: string; handle: string; email?: string | null } };

export default function SignInScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  /* Runtime, not build time — an old dev client without the native module
     hides the button instead of crashing. Same check `/join` makes. */
  const [apple, setApple] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void appleAvailable()
      .then((ok) => {
        if (live) setApple(ok);
      })
      .catch(() => {
        if (live) setApple(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const done = () => {
    // Back to whatever asked for the account, so the thing they were trying to
    // do finishes itself rather than leaving them on a screen they did not
    // come here for.
    if (next) router.replace(next as never);
    else router.back();
  };

  const withProvider = async (provider: 'apple' | 'google') => {
    if (busy) return;
    tapLight();
    setBusy(provider);
    try {
      const idToken = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();
      const res = await api<SessionResponse>('/v1/auth/session', {
        method: 'POST',
        body: { provider, id_token: idToken },
      });
      // `signIn` and NOT `joinCommunity` — the difference this screen exists
      // to make. No handle prompt, no publish, no analytics consent.
      await signIn(res.token, res.profile.id, res.profile.handle);
      rememberAccount(res.profile.email ?? null, provider);
      done();
    } catch (err) {
      if (err instanceof AuthCancelled) return; // backing out is an answer
      Alert.alert(t('signIn.failedTitle'), err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <NavHeader title={t('signIn.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        <Text style={s.lede}>{t('signIn.lede')}</Text>

        {apple === true && (
          <Pressable style={s.button} onPress={() => void withProvider('apple')} disabled={busy != null}>
            {busy === 'apple' ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <Ionicons name="logo-apple" size={19} color={colors.text} />
                <Text style={s.buttonText}>{t('signIn.apple')}</Text>
              </>
            )}
          </Pressable>
        )}

        <Pressable style={s.button} onPress={() => void withProvider('google')} disabled={busy != null}>
          {busy === 'google' ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color={colors.text} />
              <Text style={s.buttonText}>{t('signIn.google')}</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={s.quiet}
          onPress={() => router.push(next ? `/email-sign-in?next=${encodeURIComponent(next)}` : '/email-sign-in')}
          disabled={busy != null}>
          <Text style={s.quietText}>{t('signIn.email')}</Text>
        </Pressable>

        {/* THE THREE LINES THIS SCREEN IS FOR. */}
        <View style={s.promise}>
          <Text style={s.promiseTitle}>{t('signIn.notTitle')}</Text>
          {(['notProfile', 'notFindable', 'notCommunity'] as const).map((k) => (
            <View key={k} style={s.promiseRow}>
              <Ionicons name="close" size={15} color={colors.dim} style={s.promiseIcon} />
              <Text style={s.promiseText}>{t(`signIn.${k}`)}</Text>
            </View>
          ))}
          <Text style={s.later}>{t('signIn.later')}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  lede: {
    color: colors.dim,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xl,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  quiet: { alignItems: 'center', paddingVertical: space.md, marginBottom: space.lg },
  quietText: { color: colors.blue, fontSize: 15, fontWeight: '600' },
  promise: {
    marginHorizontal: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.lift,
    borderWidth: 1,
    borderColor: colors.line,
    gap: space.sm,
  },
  promiseTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: space.xs },
  promiseRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  promiseIcon: { marginTop: 2 },
  promiseText: { flex: 1, color: colors.dim, fontSize: 13.5, lineHeight: 19 },
  later: { color: colors.faint, fontSize: 12.5, lineHeight: 18, marginTop: space.xs },
});
