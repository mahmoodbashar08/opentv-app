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
      /*
       * THE CODE IS PART OF THE SENTENCE, because the tap goes to the episode.
       * "A year ago today you watched Dark" names a show and then opens an
       * episode, which reads as the wrong screen; "…watched Dark S1E5" names
       * what it opens. It sits where the title already sat in every locale, so
       * word order stays right including in Arabic.
       */
      return t('onThisDay.episode', { count, show: m.show, code: `S${m.season}E${m.episode}` });
  }
}

/** Today's memory, or null — which is the answer on most days. */
export function memoryFor(now: Date): MemoryEvent | null {
  return pickMemory(memoryEventsOn(now));
}

export { MEMORY_HOUR, memoryNotificationAt } from '@/pure';
