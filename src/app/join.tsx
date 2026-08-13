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
import { afterJoin, claimImportedHandle, markCommunityDeclined } from '@/community-prompt';
import { rememberAccount, signIn, useLastAccount } from '@/community-session';
import { ContentColumn, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorText } from '@/community-error-text';
import { colors, radius, space } from '@/theme';

/** `POST /v1/auth/session`. Mirrors `ownProfile()` in the Worker. */
type SessionResponse = {
  token: string;
  expires_at: string;
  // `email` is optional and often absent: Apple's private relay hides it,
  // and a Google account may not release it. `rememberAccount` treats null as
  // 'nothing new to say' rather than 'forget what you knew'.
  profile: { id: string; handle: string; email?: string | null };
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
  const last = useLastAccount();
  // A card that names the account REPLACES the three buttons. Not a default
  // that can be stepped around: this phone has an account, and offering to make
  // another is offering to split one person's history across two profiles.
  const focused = !!last.email || !!last.provider;

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
      // Which account this phone belongs to, kept past the session. The email
      // may be absent — Apple's private relay, or a Google account that hides
      // it — and `rememberAccount` refuses to blank what it does not know, so
      // the provider is recorded either way and that alone is the useful hint.
      rememberAccount(res.profile.email ?? null, provider);
      // A brand-new profile carries a `user_…` placeholder handle and cannot
      // be shown to anyone until it is replaced. `replace`, not `push`: this
      // screen has done its job and must not sit under the handle flow where
      // a back gesture would return to a Join button for an account that
      // already exists.
      // The TV Time name first, and the screen only if it cannot be taken —
      // see `claimImportedHandle`.
      if (res.needs_handle) {
        if (await claimImportedHandle()) afterJoin();
        else router.replace('/handle');
      } else afterJoin();
    } catch (e) {
      // The user closed the sheet. They know; saying so would be noise.
      if (e instanceof AuthCancelled) return;
      if (e instanceof ApiError) fail(communityErrorText(e));
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

          {/* WHO THIS PHONE WAS LAST SIGNED IN AS.
              Leaving clears the session and rightly keeps nothing that proves
              identity — but it used to keep nothing that IDENTIFIES the account
              either, so coming back meant remembering which of three doors was
              used, and which address. Guessing wrong makes a second account
              holding half the person's comments. It survives a reinstall too,
              because it lives in the same SQLite file the library does and
              rides the same iCloud backup.
              Deleting the account clears it — see `forgetAccount`. */}
          {last.email || last.provider ? (
            <View style={styles.lastBox}>
              <Text style={styles.lastLabel}>{t('community.join.lastSignedIn')}</Text>
              <Text style={styles.lastValue}>
                {last.email ?? (last.provider === 'apple' ? 'Apple' : last.provider === 'google' ? 'Google' : '')}
              </Text>
              <Text style={styles.lastHint}>
                {t(
                  last.provider === 'apple'
                    ? 'community.join.lastApple'
                    : last.provider === 'google'
                      ? 'community.join.lastGoogle'
                      : 'community.join.lastEmail',
                )}
              </Text>

              {/* THE ONE DOOR, not three. Offering Apple, Google and email to
                  somebody whose account we can name is how a second account
                  gets made: the quickest button is not always the right one,
                  and only one of them leads back to their comments. */}
              {last.provider === 'apple' || last.provider === 'google' ? (
                <Pressable
                  style={[styles.lastCta, busy != null && styles.dim]}
                  disabled={busy != null}
                  onPress={() => void go(last.provider === 'apple' ? 'apple' : 'google')}>
                  {busy != null ? (
                    <ActivityIndicator color={colors.onYellow} />
                  ) : (
                    <>
                      <Ionicons
                        name={last.provider === 'apple' ? 'logo-apple' : 'logo-google'}
                        size={18}
                        color={colors.onYellow}
                      />
                      <Text style={styles.lastCtaText}>
                        {t(
                          last.provider === 'apple'
                            ? 'community.join.continueApple'
                            : 'community.join.continueGoogle',
                        )}
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <>
                  <Pressable
                    style={styles.lastCta}
                    onPress={() => {
                      tapLight();
                      router.push(`/email-sign-in?email=${encodeURIComponent(last.email ?? '')}`);
                    }}>
                    <Text style={styles.lastCtaText}>{t('community.join.lastSignIn')}</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      tapLight();
                      router.push(`/email-sign-in?email=${encodeURIComponent(last.email ?? '')}&forgot=1`);
                    }}>
                    <Text style={styles.lastForget}>{t('community.email.forgotLink')}</Text>
                  </Pressable>
                </>
              )}

              {/* NO "use a different account". This device belongs to the
                  account it joined with: the library republishes onto whoever
                  signs in, so a second account would take a copy of these
                  comments and leave the first one's followers behind. The way
                  to change account is to delete the current one, which clears
                  this card along with it. */}
            </View>
          ) : null}

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
          {/* Hidden while a known account is being offered above — see the
              card. `showAll` brings them back for anyone who asks. */}
          {focused ? null : (
            <>
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
              // The address rides along so the sign-in screen opens filled in
              // and in the right mode — the whole point of remembering it.
              router.push(last.email ? `/email-sign-in?email=${encodeURIComponent(last.email)}` : '/email-sign-in');
            }}>
            <Ionicons name="mail-outline" size={18} color={colors.text} />
            <Text style={styles.googleText}>{t('community.join.continueEmail')}</Text>
          </Pressable>
            </>
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
  // The remembered account, quiet but legible — it is a fact about this phone,
  // not a call to action, and the three buttons below it must stay louder.
  lastBox: {
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 3,
    alignItems: 'center',
  },
  lastLabel: { color: colors.faint, fontSize: 12, letterSpacing: 0.3, textTransform: 'uppercase', fontWeight: '700' },
  lastValue: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  lastHint: { color: colors.dim, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  lastForget: { color: colors.blue, fontSize: 13, paddingTop: 6 },
  lastCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 13,
    marginTop: 10,
  },
  lastCtaText: { color: colors.onYellow, fontSize: 15, fontWeight: '800' },
  agreeLink: { color: colors.blue, fontWeight: '700' },
});
