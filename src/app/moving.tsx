/**
 * "Moving from another phone?" — the paths all existed, nobody found them.
 *
 * WHAT THIS SCREEN KNOWS THAT THE WELCOME SHEET DOES NOT: which phone the
 * library is on. The sheet offers iCloud, Drive, a server backup and an import
 * as equal pills, and a person holding a new Android and an old iPhone has to
 * work out alone that iCloud will never answer here, that Drive holds nothing
 * of theirs yet, and that the free way across is a file they make on the old
 * phone (CHANGELOG 2.0.0, item 6). Asked which phone they had, the screen can
 * say exactly that and nothing else. Which paths, and in what order, is
 * `movingPaths` in `src/moving.ts`.
 *
 * WORDS AND BUTTONS, NO SCREENSHOTS. Every answer ends in the screen that
 * already does the thing — `/import`, `/restore`, `/setup-profile` — and the
 * old phone's rows are named with the SAME strings those rows render, so a
 * retranslation can never leave this page pointing at a row that is no longer
 * called that.
 *
 * `replace`, NOT `push`, INTO EVERY DESTINATION. This is a signpost; once a
 * road is taken it should be behind the reader, not under them. Pushed, it
 * would survive onboarding's own `replace` and sit beneath the tabs, where the
 * Android back button would find it — the welcome screen itself is removed by
 * its route guard, but this one is reachable before and after onboarding and
 * so has no guard to remove it.
 *
 * PLUS IS NAMED WHERE IT APPLIES AND NOWHERE ELSE. A fresh phone cannot know
 * whether this person subscribed, so the server copy is "if you had OpenTV
 * Plus", said after the free file path, never instead of it.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { findCloudBackup, icloudSupported, type CloudBackup } from '@/backup';
import { ContentColumn, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { movingPaths, type MovingPath, type Phone } from '@/moving';
import { useOnboarded } from '@/session-store';
import { colors, radius, space, type } from '@/theme';

const HERE: Phone = Platform.OS === 'ios' ? 'iphone' : 'android';

export default function MovingScreen() {
  const [old, setOld] = useState<Phone | null>(null);
  const onboarded = useOnboarded();
  // undefined = still looking. iPhone only; the lookup is the same one the
  // welcome screen makes, and it is what lets the iCloud step say "it's here"
  // or "it isn't" instead of offering a button that may lead nowhere.
  const [cloud, setCloud] = useState<CloudBackup | null | undefined>(undefined);
  const [driveBusy, setDriveBusy] = useState(false);

  useEffect(() => {
    if (!icloudSupported()) return;
    findCloudBackup()
      .then(setCloud)
      .catch(() => setCloud(null));
  }, []);

  /* The same exchange as the welcome screen's `restoreDrive`, and kept apart
     from it on purpose while the accessibility sweep is editing that screen
     (WAVE2); fold the two into one helper once both have merged. Signing in to
     Google here is not joining the community — see `gdrive-backup.ts`. */
  const restoreDrive = async () => {
    setDriveBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const drive = require('@/gdrive-backup') as typeof import('@/gdrive-backup');
      const r = await drive.connectDrive();
      if (r === 'cancelled') return;
      if (r !== 'ok') {
        Alert.alert(
          t('settings.data.driveFailedTitle'),
          r === 'unauthorised' ? t('settings.data.driveUnauthorised') : r === 'no-play-services' ? t('settings.data.driveNoPlay') : t('settings.data.driveFailedBody'),
        );
        return;
      }
      if (!(await drive.findDriveBackup())) {
        Alert.alert(t('welcome.noDriveBackupTitle'), t('welcome.noDriveBackupBody'));
        return;
      }
      router.replace('/import?source=drive');
    } finally {
      setDriveBusy(false);
    }
  };

  // The old phone's rows, by the strings those rows actually render.
  const rows = {
    settings: t('settings.title'),
    tab: t('settings.tabs.data'),
    backup: t('settings.backup.title'),
    export: t('settings.data.export'),
  };

  const paths = old ? movingPaths(HERE, old, { onboarded, icloud: icloudSupported() }) : [];

  return (
    <Screen>
      <NavHeader title={t('moving.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <ContentColumn style={{ paddingHorizontal: space.lg }}>
          <Text style={s.question} accessibilityRole="header">
            {t('moving.which')}
          </Text>
          <View style={s.choices}>
            {(['iphone', 'android'] as const).map((p) => (
              <Pressable
                key={p}
                style={[s.choice, old === p && s.choiceOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: old === p }}
                onPress={() => {
                  tapLight();
                  setOld(p);
                }}>
                <Ionicons name={p === 'iphone' ? 'logo-apple' : 'logo-android'} size={26} color={old === p ? colors.onYellow : colors.text} />
                <Text style={[s.choiceText, old === p && { color: colors.onYellow }]}>{t(`moving.${p}`)}</Text>
              </Pressable>
            ))}
          </View>

          {/* Why the automatic copy is not on this list: the question the
              person actually arrived with. */}
          {old && old !== HERE && (
            <Text style={s.cross}>{t(old === 'iphone' ? 'moving.crossFromIphone' : 'moving.crossFromAndroid')}</Text>
          )}

          {paths.map((p) => (
            <Path key={p} path={p} cloud={cloud} driveBusy={driveBusy} onDrive={() => void restoreDrive()} rows={rows} />
          ))}
        </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

/**
 * One answer: a title with its price, a few lines, and the button into the
 * screen that does it. The free ones act in yellow; the Plus one and "no
 * backup" are outlined, so the eye lands on what costs nothing first.
 *
 * The title is a header and the button its own element rather than the card
 * being one grouped label: a grouped card would swallow its button, and a
 * header is what lets VoiceOver and TalkBack jump from answer to answer.
 */
function Path({
  path,
  cloud,
  driveBusy,
  onDrive,
  rows,
}: {
  path: MovingPath;
  cloud: CloudBackup | null | undefined;
  driveBusy: boolean;
  onDrive: () => void;
  rows: { settings: string; tab: string; backup: string; export: string };
}) {
  const head = (title: string, plus?: boolean) => (
    <View style={s.cardHead}>
      <Text style={s.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={s.tag}>{t(plus ? 'moving.plus' : 'moving.free')}</Text>
    </View>
  );

  switch (path) {
    case 'icloud':
      return (
        <View style={s.card}>
          {head(t('moving.icloud.title'))}
          {cloud === undefined ? (
            <View style={s.waiting}>
              <ActivityIndicator color={colors.brand} />
              <Text style={s.body}>{t('moving.icloud.looking')}</Text>
            </View>
          ) : cloud ? (
            <>
              <Text style={s.body}>{t('moving.icloud.found')}</Text>
              <PillButton label={t('moving.icloud.button')} trackId="moving.icloud" onPress={() => router.replace('/import?source=icloud')} />
            </>
          ) : (
            <Text style={s.body}>{t('moving.icloud.none', { steps: t('welcome.icloudSteps') })}</Text>
          )}
        </View>
      );
    case 'drive':
      return (
        <View style={s.card}>
          {head(t('moving.drive.title'))}
          <Text style={s.body}>{t('moving.drive.body', { row: t('settings.data.driveBackup') })}</Text>
          <PillButton label={t('moving.drive.button')} trackId="moving.drive" onPress={driveBusy ? undefined : onDrive} />
        </View>
      );
    case 'file':
      return (
        <View style={s.card}>
          {head(t('moving.file.title'))}
          {[t('moving.file.step1', rows), t('moving.file.step2'), t('moving.file.step3')].map((text, i) => (
            <View key={i} style={s.step}>
              <View style={s.stepNum}>
                <Text style={s.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={s.stepText}>{text}</Text>
            </View>
          ))}
          <PillButton label={t('moving.file.button')} trackId="moving.file" onPress={() => router.replace('/import?from=opentv')} />
        </View>
      );
    case 'server':
      return (
        <View style={s.card}>
          {head(t('moving.server.title'), true)}
          <Text style={s.body}>{t('moving.server.body')}</Text>
          <PillButton label={t('moving.server.button')} variant="outline" trackId="moving.server" onPress={() => router.replace('/restore')} />
        </View>
      );
    case 'fresh':
      return (
        <View style={s.card}>
          {head(t('moving.fresh.title'))}
          <Text style={s.body}>{t('moving.fresh.body', rows)}</Text>
          <PillButton label={t('moving.fresh.button')} variant="outline" trackId="moving.fresh" onPress={() => router.replace('/setup-profile')} />
        </View>
      );
  }
}

const s = StyleSheet.create({
  question: { ...type.section, paddingTop: 14, paddingBottom: 12 },
  choices: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  choice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.text,
    borderRadius: radius.pill,
    paddingVertical: 14,
  },
  choiceOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  choiceText: { color: colors.text, fontSize: 15, fontWeight: '800' },
  cross: { color: colors.dim, fontSize: 14.5, lineHeight: 20, paddingBottom: 14 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  tag: { ...type.plus, textTransform: 'uppercase', letterSpacing: 0.8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: colors.onYellow, fontWeight: '800', fontSize: 12.5 },
  stepText: { color: colors.text, fontSize: 15, lineHeight: 21, flex: 1 },
});
