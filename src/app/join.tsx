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
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

  /**
   * Sign in as a test account, with no Apple or Google account behind it.
   *
   * DEVELOPMENT ONLY, twice over: this function is inside a `__DEV__` branch in
   * the tree below, and the endpoint it calls answers 404 unless the server has
   * a `DEV_AUTH_SECRET` set — which production never does. Both halves have to
   * be switched on deliberately for it to work at all.
   *
   * WHY IT IS WORTH HAVING. The community renders what OTHER people thought, so
   * one account can only ever see "nobody" or "one person at 100%". Follows,
   * replies, split percentages, friend matching and notifications were all
   * unreachable without a second account, and provider accounts on a simulator
   * mean two-factor prompts on a device with no phone.
   *
   * The name goes in the same handle flow a real sign-in does — nothing here
   * skips a step the app would otherwise take.
   */
  const goDev = async (name: string) => {
    if (busy) return;
    setBusy('apple');
    tapLight();
    try {
      const secret = process.env.EXPO_PUBLIC_DEV_AUTH_SECRET ?? '';
      const res = await api<SessionResponse>('/v1/auth/dev', {
        method: 'POST',
        body: { name: name.trim().toLowerCase() },
        headers: { 'X-Dev-Secret': secret },
      });
      await signIn(res.token, res.profile.id, res.profile.handle);
      if (res.needs_handle) router.replace('/handle');
      else afterJoin();
    } catch (e) {
      // Deliberately blunt: the two ways this fails are "the server has no
      // secret set" (404) and "this build has the wrong one" (401), and both
      // are for whoever is running the test, not for a user.
      fail(e instanceof ApiError ? `dev sign-in: ${e.code}` : 'dev sign-in failed');
    } finally {
      setBusy(null);
    }
  };

  /**
   * ASKED, not configured. Every simulator on a machine talks to the same Metro
   * server and therefore bundles the same environment, so a name baked in at
   * build time would sign every device into ONE account — which is the exact
   * opposite of what a second account is for. A prompt costs one tap and lets
   * two simulators be two people.
   */
  const askDevName = () => {
    Alert.prompt(
      'Dev sign-in',
      'Name for this test account (a–z, 0–9, _ or -)',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: (v?: string) => void goDev((v ?? '').trim() || 'tester') },
      ],
      'plain-text',
      process.env.EXPO_PUBLIC_DEV_USER ?? 'tester',
    );
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

          {/* DEVELOPMENT BUILDS ONLY — see `goDev`. `__DEV__` is folded away by
              the bundler, so this button, its handler and its strings are all
              absent from a release build, which is also why they are not
              translated. */}
          {__DEV__ && (
            /* eslint-disable no-restricted-syntax -- a debug control nobody ships */
            <Pressable
              style={[styles.googleBtn, styles.devBtn, busy != null && styles.dim]}
              onPress={askDevName}
              disabled={busy != null}>
              <Text style={styles.devText}>DEV: SIGN IN AS A TEST USER</Text>
            </Pressable>
            /* eslint-enable no-restricted-syntax */
          )}

          {/*
            ACCEPTANCE AT THE POINT OF POSTING, which is what App Review looks
            for on an app carrying other people's writing (guideline 1.2). This
            screen is the only door into the community, so it is the one place
            where agreeing to the terms and gaining the ability to post are the
            same act — a link buried in About would not be agreement to anything.

            The zero-tolerance sentence is stated here rather than left to the
            document, because the requirement is that the user SEES it, and
            nobody opens a EULA. `Terms of Use` is tappable for the full text.
          */}
          <Text style={styles.agree}>
            {t('community.join.agree')}{' '}
            <Text
              style={styles.agreeLink}
              onPress={() => void Linking.openURL('https://theopentv.com/terms')}>
              {t('community.join.terms')}
            </Text>
          </Text>

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
  // Deliberately drab: a debug control should not look like something to tap.
  devBtn: { borderColor: '#3A3A3E', borderWidth: 1, marginTop: 4 },
  devText: { color: colors.dim, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.6 },
  later: { paddingVertical: 14, alignItems: 'center' },
  laterText: { color: colors.dim, fontSize: 15, fontWeight: '600' },
  // Legible, not fine print: this is a disclosure, and a 10pt grey line that
  // nobody can read is the thing App Review objects to.
  agree: {
    color: colors.dim,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: space.lg,
    marginTop: 18,
  },
  agreeLink: { color: colors.blue, fontWeight: '700' },
});
