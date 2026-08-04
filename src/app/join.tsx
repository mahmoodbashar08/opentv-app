/**
 * The join prompt — the one place the app asks for an account.
 *
 * Everything about this screen is shaped by one promise: joining changes what
 * the app can SHOW you, never what it does with your library. That sentence is
 * on the screen, at the decision point, in `promise` below, because a privacy
 * claim made anywhere except where the decision is taken is marketing.
 *
 * Apple's guideline 4.8 requires Sign in with Apple wherever another
 * third-party login is offered — on Apple platforms. Both, or neither, and
 * `appleAvailable()` decides at runtime rather than at build time so an old
 * dev client without the native module hides the button instead of crashing.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '@/api';
import { AuthCancelled, AuthFailed, appleAvailable, signInWithApple, signInWithGoogle, type AuthProvider } from '@/community-auth';
import { afterJoin, markCommunityDeclined } from '@/community-prompt';
import { signIn } from '@/community-session';
import { ContentColumn, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorKey } from '@/pure';
import { colors, radius, space } from '@/theme';

/** `POST /v1/auth/session`. Mirrors `ownProfile()` in the Worker. */
type SessionResponse = {
  token: string;
  expires_at: string;
  profile: { id: string; handle: string };
  needs_handle: boolean;
};

const PERKS = [
  { icon: 'star-outline', textKey: 'community.join.perkRatings' as const },
  { icon: 'chatbubble-outline', textKey: 'community.join.perkComments' as const },
  { icon: 'people-outline', textKey: 'community.join.perkFriends' as const },
] as const;

export default function JoinScreen() {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  // null while the check is in flight: rendering the button and then removing
  // it is worse than a beat of nothing, because the user may already be
  // reaching for it.
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

  const fail = (message: string) => Alert.alert(t('community.join.failedTitle'), message);

  const go = async (provider: AuthProvider) => {
    if (busy) return;
    setBusy(provider);
    tapLight();
    try {
      const idToken = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();
      const res = await api<SessionResponse>('/v1/auth/session', {
        method: 'POST',
        body: { provider, id_token: idToken },
      });
      await signIn(res.token, res.profile.id, res.profile.handle);
      // A brand-new profile carries a `user_…` placeholder handle and cannot
      // be shown to anyone until it is replaced. `replace`, not `push`: this
      // screen has done its job and must not sit under the handle flow where
      // a back gesture would return to a Join button for an account that
      // already exists.
      if (res.needs_handle) router.replace('/handle');
      else afterJoin();
    } catch (e) {
      // The user closed the sheet. They know; saying so would be noise.
      if (e instanceof AuthCancelled) return;
      if (e instanceof ApiError) fail(t(communityErrorKey(e.code)));
      else if (e instanceof AuthFailed) fail(e.developerFault ? e.message : t('community.error.generic'));
      else fail(t('community.error.generic'));
    } finally {
      setBusy(null);
    }
  };

  const notNow = () => {
    tapLight();
    markCommunityDeclined();
    router.back();
  };

  return (
    <Screen>
      <ContentColumn style={{ flex: 1, paddingHorizontal: space.xl }}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.emoji}>🍿</Text>
          <Text style={styles.title}>{t('community.join.title')}</Text>
          <Text style={styles.sub}>{t('community.join.sub')}</Text>

          <View style={styles.perks}>
            {PERKS.map((p) => (
              <View key={p.textKey} style={styles.perk}>
                <Ionicons name={p.icon} size={20} color={colors.yellow} style={styles.perkIcon} />
                <Text style={styles.perkText}>{t(p.textKey)}</Text>
              </View>
            ))}
          </View>

          {/* The brand promise, at the moment of the decision. Not a footnote:
              it is the reason someone chooses this app over the alternatives,
              and it is literally true — the server has no watch-history table
              (backend/docs/PLAN.md §2). */}
          <Text style={styles.promise}>{t('community.join.promise')}</Text>
        </ScrollView>

        <View style={[styles.actions, { paddingBottom: space.sm + insets.bottom }]}>
          {apple === true && (
            <Pressable
              style={[styles.appleBtn, busy != null && styles.dim]}
              disabled={busy != null}
              onPress={() => void go('apple')}>
              {busy === 'apple' ? (
                <ActivityIndicator color={colors.onYellow} />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={19} color={colors.onYellow} />
                  <Text style={styles.appleText}>{t('community.join.continueApple')}</Text>
                </>
              )}
            </Pressable>
          )}

          <Pressable
            style={[styles.googleBtn, busy != null && styles.dim]}
            disabled={busy != null}
            onPress={() => void go('google')}>
            {busy === 'google' ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={colors.text} />
                <Text style={styles.googleText}>{t('community.join.continueGoogle')}</Text>
              </>
            )}
          </Pressable>

          {/* THE THIRD WAY IN, for people who have neither account or want
              neither involved. Styled as the quietest of the three on purpose:
              Apple and Google are one tap and carry no password to forget, so
              they stay the recommended path — this is the one that always
              works. */}
          <Pressable
            style={[styles.googleBtn, busy != null && styles.dim]}
            disabled={busy != null}
            onPress={() => {
              tapLight();
              router.push('/email-sign-in');
            }}>
            <Ionicons name="mail-outline" size={18} color={colors.text} />
            <Text style={styles.googleText}>{t('community.join.continueEmail')}</Text>
          </Pressable>

          <Pressable style={styles.later} onPress={notNow} disabled={busy != null} hitSlop={12}>
            <Text style={styles.laterText}>{t('community.join.notNow')}</Text>
          </Pressable>
        </View>
      </ContentColumn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, justifyContent: 'center', gap: 14, paddingVertical: space.xl },
  emoji: { fontSize: 46, textAlign: 'center' },
  title: { color: colors.text, fontSize: 27, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  perks: { gap: 14, marginTop: 10, marginBottom: 4 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // width + centring keeps the icons in a column whatever glyph is used, and
  // flips with the row under RTL because `flexDirection: 'row'` is mirrored.
  perkIcon: { width: 30, textAlign: 'center' },
  perkText: { color: colors.text, fontSize: 15.5, flex: 1, lineHeight: 21 },
  promise: { color: colors.faint, fontSize: 12.5, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  actions: { gap: 10 },
  dim: { opacity: 0.5 },
  appleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
  },
  appleText: { color: colors.onYellow, fontWeight: '800', fontSize: 14.5, letterSpacing: 0.5 },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.text,
    borderRadius: radius.pill,
    paddingVertical: 14,
  },
  googleText: { color: colors.text, fontWeight: '800', fontSize: 14.5, letterSpacing: 0.5 },
  later: { paddingVertical: 14, alignItems: 'center' },
  laterText: { color: colors.dim, fontSize: 15, fontWeight: '600' },
});
