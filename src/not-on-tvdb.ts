import { Alert } from 'react-native';

import { t } from '@/i18n';

/**
 * A show TMDB knows about but TheTVDB does not — usually one that has only
 * just aired.
 *
 * OpenTV keys every show on a TheTVDB id, so there is nothing to hang a
 * library row on and the show genuinely cannot be added yet. The failure
 * itself is upstream and unavoidable; saying nothing about it is not.
 *
 * Reported by a user who tried to add a series that had aired days earlier:
 * neither the + nor the row did anything, with no message, so the app simply
 * looked broken. Every place that resolves a TheTVDB id for a show must call
 * this when the resolution comes back empty.
 */
export function alertNotOnTvdb(name: string): void {
  Alert.alert(t('notOnTvdb.title'), t('notOnTvdb.body', { name }), [{ text: t('common.ok') }]);
}
