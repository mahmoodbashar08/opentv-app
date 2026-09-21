/**
 * EVERY WAY TO KEEP A COPY, ON ONE SCREEN.
 *
 * Backup used to be FIVE THINGS IN THREE PLACES on the Data tab: a Google
 * Drive section, an iCloud section, a "Cloud backup" row, "Export my data" and
 * "Backup as JSON" — ten rows in all, three of them top-level sections. A
 * person whose whole question is "what happens if I lose my phone" had to
 * understand the difference between five features before they could answer it.
 *
 * They are not five features. They are one question with three answers, and
 * the answers differ in exactly one way — WHERE THE COPY GOES:
 *
 *   automatic   the platform's own drive, silently, while you sleep
 *   ours        a server, which is the only copy that crosses iPhone↔Android
 *   yourself    a file you hold, which nothing can revoke
 *
 * So the screen is organised by that, and nothing else. The ordering is
 * deliberate: the silent one first because it is the one that protects people
 * who never open this screen again.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text } from 'react-native';

import { backupNow, icloudAvailable, icloudSupported, lastBackupAt, lastBackupError } from '@/backup';
import { backupDestination } from '@/cloud-backup';
import { exportAll } from '@/db';
import {
  connectDrive,
  disconnectDrive,
  driveBackupNow,
  driveConnected,
  driveSupported,
  lastDriveBackupAt,
  lastDriveError,
} from '@/gdrive-backup';
import { shareLibraryExport } from '@/manual-backup';
import { MenuRow, NavHeader, Screen } from '@/components/ui';
import { currentLocale, t } from '@/i18n';
import { colors, space } from '@/theme';

/** Export as a TV Time-format ZIP (images bundled) — our importer reads it
 *  back losslessly. Shares via the Android-safe helper. */
async function exportData() {
  try {
    await shareLibraryExport();
  } catch (err) {
    Alert.alert(t('settings.data.exportFailedTitle'), err instanceof Error ? err.message : String(err));
  }
}

/** Full raw backup as JSON — belt and braces alongside the ZIP. */
async function exportJson() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    const name = `opentv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.write(JSON.stringify(exportAll()));
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: name });
    }
  } catch (err) {
    Alert.alert(t('settings.data.exportFailedTitle'), err instanceof Error ? err.message : String(err));
  }
}

function when(at: number | string | null): string {
  if (at == null) return t('settings.data.never');
  return new Date(at).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export default function BackupScreen() {
  const [backedUp, setBackedUp] = useState(lastBackupAt());
  const [backupErr, setBackupErr] = useState(lastBackupError());
  const [driveOn, setDriveOn] = useState(() => driveConnected());
  const [driveAt, setDriveAt] = useState<number | null>(() => lastDriveBackupAt());
  const [driveBusy, setDriveBusy] = useState(false);
  const [cloud, setCloud] = useState(() => backupDestination());

  /* Re-read on focus: the cloud screen is a push away and can change the
     destination, and a stale "Not set" here would be the screen disagreeing
     with the screen the person just came back from. */
  useFocusEffect(
    useCallback(() => {
      setBackedUp(lastBackupAt());
      setBackupErr(lastBackupError());
      setDriveOn(driveConnected());
      setDriveAt(lastDriveBackupAt());
      setCloud(backupDestination());
    }, []),
  );

  const driveBackUp = async () => {
    try {
      const r = await driveBackupNow(true);
      if (r === 'unavailable') {
        Alert.alert(t('settings.data.driveFailedTitle'), t('settings.data.driveFailedBody'));
        return;
      }
      setDriveAt(lastDriveBackupAt());
      Alert.alert(t('settings.data.backedUpTitle'), t('settings.data.driveBackedUpBody'));
    } catch (err) {
      Alert.alert(t('settings.data.backupFailedTitle'), err instanceof Error ? err.message : String(err));
    }
  };

  const toggleDrive = async (on: boolean) => {
    if (driveBusy) return;
    if (!on) {
      disconnectDrive();
      setDriveOn(false);
      return;
    }
    setDriveBusy(true);
    try {
      const r = await connectDrive();
      setDriveOn(r === 'ok');
      // Cancelling is an answer, not an error — somebody who backs out of the
      // account sheet does not need a dialog telling them so.
      if (r === 'ok') void driveBackUp();
      else if (r !== 'cancelled') {
        Alert.alert(
          t('settings.data.driveFailedTitle'),
          r === 'unauthorised'
            ? t('settings.data.driveUnauthorised')
            : r === 'no-play-services'
              ? t('settings.data.driveNoPlay')
              : `${t('settings.data.driveFailedBody')}${lastDriveError() ? `\n\n${lastDriveError()}` : ''}`,
        );
      }
    } finally {
      setDriveBusy(false);
    }
  };

  const backUp = async () => {
    try {
      const r = await backupNow(true);
      if (r === 'unavailable') {
        Alert.alert(t('settings.data.icloudOffTitle'), t('settings.data.icloudOffBody'));
        return;
      }
      setBackedUp(lastBackupAt());
      setBackupErr(null);
      Alert.alert(t('settings.data.backedUpTitle'), t('settings.data.backedUpBody'));
    } catch (err) {
      setBackupErr(lastBackupError());
      Alert.alert(t('settings.data.backupFailedTitle'), err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen>
      <NavHeader title={t('settings.backup.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <Text style={s.intro}>{t('settings.backup.intro')}</Text>

        {/* ── the silent one ───────────────────────────────────────────── */}
        <Text style={s.section}>{t('settings.backup.automaticSection')}</Text>

        {icloudSupported() && (
          <>
            <MenuRow
              trackId="settings.data.icloudDrive"
              title={t('settings.data.icloudDrive')}
              sub={t('settings.data.icloudDriveSub')}
              value={icloudAvailable() ? t('common.on') : t('common.off')}
            />
            <MenuRow trackId="settings.data.lastBackedUp" title={t('settings.data.lastBackedUp')} value={when(backedUp)} />
            {/* SAID STANDING STILL. The automatic backup swallows its own
                error, so a full iCloud used to show only as a date that
                stopped moving — months of believing you had a copy. */}
            {backupErr && (
              <MenuRow
                trackId="settings.data.backupFailed"
                title={t('settings.data.backupFailedTitle')}
                sub={`${t('settings.data.backupFailedSub')}\n\n${backupErr}`}
                danger
              />
            )}
            <MenuRow
              trackId="settings.data.backupNow"
              title={t('settings.data.backupNow')}
              sub={t('settings.data.backupNowSub')}
              onPress={() => void backUp()}
            />
          </>
        )}

        {driveSupported() && (
          <>
            <MenuRow
              trackId="settings.data.driveBackup"
              title={t('settings.data.driveBackup')}
              sub={t('settings.data.driveBackupSub')}
              right={
                <Switch
                  value={driveOn}
                  disabled={driveBusy}
                  onValueChange={(v) => void toggleDrive(v)}
                  trackColor={{ true: colors.green }}
                />
              }
            />
            {driveOn && (
              <>
                <MenuRow trackId="settings.data.driveLastBackedUp" title={t('settings.data.lastBackedUp')} value={when(driveAt)} />
                <MenuRow
                  trackId="settings.data.driveBackupNow"
                  title={t('settings.data.backupNow')}
                  sub={t('settings.data.driveBackupNowSub')}
                  onPress={() => void driveBackUp()}
                />
              </>
            )}
          </>
        )}

        {/* ── the one that crosses ─────────────────────────────────────── */}
        <Text style={s.section}>{t('settings.backup.cloudSection')}</Text>
        <MenuRow
          trackId="cloudBackup.title"
          title={t('cloudBackup.title')}
          sub={t('cloudBackup.entrySub')}
          value={cloud == null ? t('common.off') : t('common.on')}
          onPress={() => router.push('/cloud-backup')}
        />

        {/* ── the one nobody can revoke ────────────────────────────────── */}
        <Text style={s.section}>{t('settings.backup.yourselfSection')}</Text>
        <MenuRow
          trackId="settings.data.export"
          title={t('settings.data.export')}
          sub={t('settings.data.exportSub')}
          onPress={() => void exportData()}
        />
        <MenuRow
          trackId="settings.data.backupJson"
          title={t('settings.data.backupJson')}
          sub={t('settings.data.backupJsonSub')}
          onPress={() => void exportJson()}
        />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  intro: {
    color: colors.dim,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  section: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
});
