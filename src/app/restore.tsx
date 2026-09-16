/**
 * Getting a library back onto a new phone.
 *
 * THE HOLE THIS FILLS. Cloud backup shipped without the one journey it exists
 * for. A person who loses their phone, installs OpenTV on a new one and opens
 * it is offered iCloud, a TV Time import, or starting fresh — and nothing at
 * all about the copy sitting on a server they are paying for. To reach it they
 * would have to finish onboarding with an empty library, find the community,
 * sign in, and then find Settings → Data → Cloud backup. Nobody does that.
 * They conclude it is gone.
 *
 * SIGNING IN IS THE WHOLE OF IT, because the backup is keyed to the profile
 * and nothing else. All three ways are offered.
 *
 * EMAIL IS HERE, AND WAS WRONGLY LEFT OUT AT FIRST. The reasoning was that an
 * address cannot be confirmed until `RESEND_API_KEY` is set, so the account is
 * a dead end. It is not: `/v1/backup` is behind `requireAuth`, never
 * `requireVerified`, so an unconfirmed account backs up and restores perfectly
 * well. And it matters most exactly where it was missing — a SELF-HOSTED
 * instance has no mail either, and on Android there is no Apple button, so
 * email was the only way in and this screen did not offer it.
 *
 * WHAT IS FOUND IS DESCRIBED BEFORE IT IS RESTORED. "Restore" with nothing
 * behind it is a button somebody presses in hope; a name, a date and three
 * counts are a copy they recognise as theirs.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { chooseOpenTvCloud, findServerBackup, restoreFromServerBackup, type BackupSummary } from '@/cloud-backup';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { AuthCancelled, signInWithApple, signInWithGoogle } from '@/community-auth';
import { api } from '@/api';
import { isJoined, rememberAccount, signIn as sessionSignIn } from '@/community-session';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { postOnboardingRoute, setOnboarded } from '@/session-store';
import { colors, radius } from '@/theme';

type Stage = 'signIn' | 'looking' | 'found' | 'none';

export default function RestoreScreen() {
  const [stage, setStage] = useState<Stage>('signIn');
  const [backup, setBackup] = useState<BackupSummary | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Ask the server what it is holding for whoever just signed in.
   *
   * `chooseOpenTvCloud()` first, because `findServerBackup` answers for the
   * destination this device is pointed at and a fresh install is pointed at
   * nothing. Choosing it writes no data and uploads nothing — it only says
   * where to look.
   */
  const look = useCallback(async () => {
    setStage('looking');
    try {
      chooseOpenTvCloud();
      const found = await findServerBackup();
      setBackup(found);
      setStage(found ? 'found' : 'none');
    } catch {
      setStage('none');
    }
  }, []);

  /**
   * The same exchange the join screen makes, because it is the same account.
   *
   * A provider gives an id token; the server turns it into a session. Anything
   * about handles and profiles is deliberately NOT done here — this person is
   * recovering a library, not setting up a profile, and `needs_handle` is
   * answered by the app proper once they are back inside it.
   */
  /*
   * ALREADY SIGNED IN IS A NORMAL WAY TO ARRIVE, and it was not handled: the
   * screen sat on its sign-in buttons for somebody who had just signed in on
   * the email screen and come back. On focus, if there is a session, start
   * looking.
   */
  useFocusEffect(
    useCallback(() => {
      if (stage === 'signIn' && isJoined()) void look();
    }, [stage, look]),
  );

  const signIn = async (provider: 'google' | 'apple') => {
    if (busy) return;
    setBusy(true);
    try {
      tapLight();
      const idToken = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();
      const res = await api<{ token: string; profile: { id: string; handle: string; email?: string | null } }>(
        '/v1/auth/session',
        { method: 'POST', body: { provider, id_token: idToken } },
      );
      await sessionSignIn(res.token, res.profile.id, res.profile.handle);
      rememberAccount(res.profile.email ?? null, provider);
      await look();
    } catch (e) {
      // Closing the sheet is an answer, not a failure.
      if (e instanceof AuthCancelled) return;
      Alert.alert(t('restore.failedTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await restoreFromServerBackup(() => {});
      /*
       * STRAIGHT INTO THE APP. Somebody who has just watched their decade come
       * back does not want to be returned to a welcome screen offering to
       * import it.
       */
      setOnboarded(true);
      Alert.alert(
        t('restore.doneTitle'),
        t('restore.doneBody', { shows: res.shows, episodes: res.episodes, movies: res.movies }),
        [{ text: t('common.ok'), onPress: () => router.replace(postOnboardingRoute()) }],
      );
    } catch {
      Alert.alert(t('restore.failedTitle'), t('restore.failedBody'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <NavHeader title={t('restore.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <ContentColumn>
          <Text style={s.intro}>{t('restore.intro')}</Text>

          {stage === 'signIn' && (
            <>
              <Pressable style={s.primary} onPress={() => void signIn('google')} disabled={busy}>
                <Ionicons name="logo-google" size={18} color={colors.onYellow} />
                <Text style={s.primaryText}>{t('restore.withGoogle')}</Text>
              </Pressable>
              {Platform.OS === 'ios' && (
                <Pressable style={s.secondary} onPress={() => void signIn('apple')} disabled={busy}>
                  <Ionicons name="logo-apple" size={18} color={colors.text} />
                  <Text style={s.secondaryText}>{t('restore.withApple')}</Text>
                </Pressable>
              )}
              {/* Straight to the existing screen; coming back here with a
                  session is enough, because `look()` runs on focus. */}
              <Pressable style={s.secondary} onPress={() => router.push('/email-sign-in')} disabled={busy}>
                <Ionicons name="mail-outline" size={18} color={colors.text} />
                <Text style={s.secondaryText}>{t('restore.withEmail')}</Text>
              </Pressable>
              {/* The other half of the feature, and free — it needs no account
                  of ours at all, so it is reachable from here rather than only
                  from a settings screen this person has not seen yet. */}
              <Pressable style={s.secondary} onPress={() => router.replace('/cloud-backup?dest=own')} disabled={busy}>
                <Ionicons name="server-outline" size={18} color={colors.text} />
                <Text style={s.secondaryText}>{t('restore.ownServer')}</Text>
              </Pressable>
              <Text style={s.fine}>{t('restore.signInWhy')}</Text>
            </>
          )}

          {stage === 'looking' && (
            <View style={s.waiting}>
              <ActivityIndicator color={colors.brand} />
              <Text style={s.fine}>{t('restore.looking')}</Text>
            </View>
          )}

          {stage === 'found' && backup && (
            <>
              <View style={s.card}>
                <Text style={s.cardName}>{backup.username ?? t('restore.yourLibrary')}</Text>
                {!!backup.updatedAt && (
                  <Text style={s.cardDate}>
                    {new Date(backup.updatedAt).toLocaleString(currentLocale(), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Text>
                )}
                {/* THE COUNTS, so this is recognisably yours rather than a
                    button pressed in hope. A backup made by an older build
                    carries none, and then the date alone has to do. */}
                {(backup.shows != null || backup.episodes != null || backup.movies != null) && (
                  <View style={s.figures}>
                    <Figure n={backup.shows} label={t('restore.shows')} />
                    <Figure n={backup.episodes} label={t('restore.episodes')} />
                    <Figure n={backup.movies} label={t('restore.movies')} />
                  </View>
                )}
              </View>
              <Pressable style={s.primary} onPress={() => void restore()} disabled={busy}>
                <Ionicons name="cloud-download-outline" size={18} color={colors.onYellow} />
                <Text style={s.primaryText}>{busy ? t('restore.restoring') : t('restore.restore')}</Text>
              </Pressable>
              <Text style={s.fine}>{t('restore.mergeNote')}</Text>
            </>
          )}

          {stage === 'none' && (
            <>
              <View style={s.card}>
                <Text style={s.cardDate}>{t('restore.nothingThere')}</Text>
              </View>
              <Pressable style={s.secondary} onPress={() => router.replace('/import')}>
                <Ionicons name="download-outline" size={18} color={colors.text} />
                <Text style={s.secondaryText}>{t('restore.importInstead')}</Text>
              </Pressable>
            </>
          )}
        </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

function Figure({ n, label }: { n: number | null; label: string }) {
  if (n == null) return null;
  return (
    <View>
      <Text style={s.figure}>{n}</Text>
      <Text style={s.figureLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  intro: { color: colors.text, fontSize: 15, lineHeight: 21, paddingTop: 14, paddingBottom: 18 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 15,
    marginBottom: 10,
  },
  primaryText: { color: colors.onBrand, fontSize: 15, fontWeight: '800' },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 15,
    marginBottom: 10,
  },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  fine: { color: colors.faint, fontSize: 12.5, lineHeight: 17, paddingTop: 4 },
  waiting: { alignItems: 'center', gap: 12, paddingTop: 24 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 14 },
  cardName: { color: colors.text, fontSize: 18, fontWeight: '900' },
  cardDate: { color: colors.dim, fontSize: 13, marginTop: 4 },
  figures: { flexDirection: 'row', gap: 22, marginTop: 14 },
  figure: { color: colors.text, fontSize: 20, fontWeight: '900' },
  figureLabel: { color: colors.faint, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
});
