/**
 * "Which month, which year?" — the one door into Wrapped.
 *
 * Three screens open it (Profile, Deep Stats, and Wrapped's own quiet state),
 * so it is one component: three copies of a list of periods is three chances
 * for them to disagree about which months exist.
 *
 * The current month is never offered — see `periodOptions`. A recap of a month
 * still running is a recap of nothing.
 */
import { useState } from 'react';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { currentLocale, t } from '@/i18n';
import { formatPeriod } from '@/locale-resolve';
import { periodOptions } from '@/pure';
import { watchYears } from '@/stats-calc';

/** 'July 2026' for a month, '2025' for a year, in the app's language. */
export function periodLabel(key: string): string {
  return formatPeriod(key, currentLocale());
}

export function PeriodSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (key: string) => void;
}) {
  // In an initialiser, not in render: `watchYears()` is a database read, and
  // the React Compiler would memoise a render-time one against its (empty)
  // arguments. Which years have watches in them changes about once a year.
  const [options] = useState(() => periodOptions(new Date().toISOString().slice(0, 10), watchYears()));

  const actions: SheetAction[] = options.map((key) => ({
    text: periodLabel(key),
    icon: key.length === 4 ? 'calendar-outline' : 'calendar-clear-outline',
    onPress: () => onPick(key),
  }));

  return <ActionSheet visible={visible} title={t('plus.wrapped.pickTitle')} actions={actions} onClose={onClose} />;
}
