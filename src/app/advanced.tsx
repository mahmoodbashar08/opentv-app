/**
 * The five rows almost nobody needs, behind one row everybody can skip.
 *
 * They were a section called "Metadata" in the App tab: a TheTVDB key, an undo
 * for the 1.2.0 numbering migration, a resumed-import summary, a review queue
 * for guessed film matches, and a full metadata refresh. Every one of them is
 * real and two of them have rescued libraries — and all five are things a
 * reader either already knows they want or will never want at all.
 *
 * A heading called "Metadata" does not tell the second group to move along. It
 * reads like something they ought to understand, in a tab they opened to change
 * the theme. So the section became a row, and the row says what it is for.
 *
 * MOST OF THESE ARE CONDITIONAL, which is the other half of the argument. The
 * undo only exists while a snapshot does; the summary only until it is read;
 * the review queue only while something is unreviewed. On a healthy install
 * this screen is two rows. As a section in a tab, those two rows sat under a
 * heading all year regardless.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView } from 'react-native';

import { MenuRow, NavHeader, Screen } from '@/components/ui';
import { getGuessedMovies, getMeta } from '@/db';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
import { discardSnapshot, restoreSnapshot, snapshotCounts, snapshotTakenAt } from '@/pre-tvdb-snapshot';
import { refreshAllShowMetadata } from '@/show-meta-fetch';
import { space } from '@/theme';
import { tvdbKeyFailed, userTvdbKey } from '@/tvdb';

export default function AdvancedScreen() {
  // Refresh all metadata — one pass over the whole library, so it needs a
  // live counter rather than a spinner
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDone, setRefreshDone] = useState(0);
  const [refreshTotal, setRefreshTotal] = useState(0);
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshDone(0);
    setRefreshTotal(0);
    try {
      const { total, ok } = await refreshAllShowMetadata((done, tot) => {
        setRefreshDone(done);
        setRefreshTotal(tot);
      });
      // the refresh never throws — a failed fetch keeps serving the cached copy
      // — so without checking the result this reported success while reaching
      // nothing at all
      if (total > 0 && ok === 0) {
        Alert.alert(t('settings.app.refreshFailedTitle'), t('settings.app.refreshFailedBody'));
      } else if (ok < total) {
        Alert.alert(
          t('settings.app.refreshPartialTitle'),
          t('settings.app.refreshPartialBody', { ok, total }),
        );
      }
    } catch {
      Alert.alert(t('settings.app.refreshFailedTitle'), t('settings.app.refreshFailedBody'));
    } finally {
      setRefreshing(false);
    }
  };

  // the 1.2.0 numbering migration keeps a verbatim copy of every watch row it
  // touched. It is never deleted automatically — this is the way back.
  const [snapAt, setSnapAt] = useState(() => snapshotTakenAt());
  const [guessedMovies] = useState(() => getGuessedMovies().length);
  // an import cut short finishes itself on the next launch, with no screen in
  // front of it — this is the only way its summary and "Needs attention" list
  // ever reach the user. Re-read on focus so it clears once they've seen it.
  const [resumedSummary, setResumedSummary] = useState(() => !!getMeta('resumedImportSummary'));
  useFocusEffect(useCallback(() => setResumedSummary(!!getMeta('resumedImportSummary')), []));

  const undoMigration = () => {
    const counts = snapshotCounts();
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    Alert.alert(
      t('settings.app.undoMigrationConfirmTitle'),
      t('settings.app.undoMigrationConfirmBody', {
        count: formatCount(total, currentLocale()),
        date: new Date(snapAt ?? '').toLocaleDateString(currentLocale()),
      }),
      [
        {
          text: t('settings.app.undoMigrationRestore'),
          style: 'destructive',
          onPress: () => {
            const ok = restoreSnapshot();
            Alert.alert(
              ok ? t('settings.app.undoMigrationRestoredTitle') : t('settings.app.undoMigrationRestoreFailedTitle'),
              ok ? t('settings.app.undoMigrationRestoredBody') : t('settings.app.undoMigrationRestoreFailedBody'),
            );
          },
        },
        {
          text: t('settings.app.undoMigrationDelete'),
          style: 'destructive',
          onPress: () => {
            discardSnapshot();
            setSnapAt(null);
          },
        },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  };

  return (
    <Screen>
      <NavHeader title={t('settings.app.advanced')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <MenuRow
          trackId="settings.app.tvdbKey"
          title={t('settings.app.tvdbKey')}
          sub={
            userTvdbKey()
              ? t('settings.app.tvdbKeyOwnSub')
              : tvdbKeyFailed()
                ? t('settings.app.tvdbKeyFailedSub')
                : t('settings.app.tvdbKeyDefaultSub')
          }
          value={tvdbKeyFailed() && !userTvdbKey() ? '!' : undefined}
          onPress={() => router.push('/tvdb-key')}
        />
        {!!snapAt && (
          <MenuRow
            trackId="settings.app.undoMigration"
            title={t('settings.app.undoMigration')}
            sub={t('settings.app.undoMigrationSub', { date: new Date(snapAt).toLocaleDateString(currentLocale()) })}
            onPress={undoMigration}
          />
        )}
        {resumedSummary && (
          <MenuRow
            trackId="settings.app.resumedImportSummary"
            title={t('settings.app.resumedImportSummary')}
            sub={t('settings.app.resumedImportSummarySub')}
            onPress={() => router.push('/import?summary=1')}
          />
        )}
        {guessedMovies > 0 && (
          <MenuRow
            trackId="settings.app.reviewMatchedMovies"
            title={t('settings.app.reviewMatchedMovies')}
            sub={t('settings.app.reviewMatchedMoviesSub', { count: guessedMovies })}
            value={String(guessedMovies)}
            onPress={() => router.push('/review-movies')}
          />
        )}
        <MenuRow
          trackId="settings.app.refreshMetadata"
          title={t('settings.app.refreshMetadata')}
          sub={
            refreshing
              ? t('settings.app.refreshingProgress', { done: refreshDone, total: refreshTotal || '…' })
              : t('settings.app.refreshMetadataSub')
          }
          onPress={() => void refreshAll()}
        />
      </ScrollView>
    </Screen>
  );
}
