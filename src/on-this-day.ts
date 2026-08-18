/**
 * The sentence a memory becomes, and the one rule about when it may interrupt.
 *
 * SEPARATE FROM THE CARD because two very different things need it: a view, and
 * the notification scheduler. `notifications.ts` cannot import a component, and
 * duplicating the wording is how a notification and the screen it opens end up
 * describing the same memory differently.
 */

import { t } from '@/i18n';
import { memoryDeservesNotification, pickMemory, type MemoryEvent } from '@/pure';
import { memoryEventsOn } from '@/db';

/** The sentence, in the reader's language, with the years already counted. */
export function memorySentence(m: MemoryEvent, now: Date): string {
  const count = now.getFullYear() - m.year;
  switch (m.kind) {
    case 'finale':
      return t('onThisDay.finale', { count, show: m.show });
    case 'binge':
      return t('onThisDay.binge', { count, show: m.show, n: m.count });
    case 'comment':
      return t('onThisDay.comment', { count, show: m.show });
    case 'episode':
      return t('onThisDay.episode', { count, show: m.show });
  }
}

/** Today's memory, or null — which is the answer on most days. */
export function memoryFor(now: Date): MemoryEvent | null {
  return pickMemory(memoryEventsOn(now));
}

export { MEMORY_HOUR, memoryNotificationAt } from '@/pure';
