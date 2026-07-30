import { Alert } from 'react-native';

import { getMeta, getWatchedSet, markWatched, setMeta, unmarkWatched } from '@/db';
import { t } from '@/i18n';
import { showMeta } from '@/metadata';

/**
 * Mark an episode watched, then — like the real app — offer to mark every
 * previous unwatched episode across all seasons. "Never for this show"
 * persists per show.
 */
export function markWatchedWithPrompt(showId: number, season: number, episode: number, onDone: () => void): void {
  markWatched(showId, season, episode);

  if (getMeta(`noPrevPrompt:${showId}`) === '1') {
    onDone();
    return;
  }

  const meta = showMeta(showId);
  const watched = getWatchedSet(showId);
  const prev: { s: number; e: number }[] = [];
  if (meta) {
    const seasons = Object.keys(meta.seasons)
      .map(Number)
      .filter((n) => n > 0 && n <= season)
      .sort((a, b) => a - b);
    for (const s of seasons) {
      const total = meta.seasons[String(s)]?.count ?? 0;
      const maxE = s === season ? episode - 1 : total;
      for (let e = 1; e <= maxE; e++) {
        if (!watched.has(`${s}-${e}`)) prev.push({ s, e });
      }
    }
  }
  if (prev.length === 0) {
    onDone();
    return;
  }

  Alert.alert(t('markPrevPrompt.title'), t('markPrevPrompt.body'), [
    {
      text: t('markPrevPrompt.yes'),
      onPress: () => {
        for (const p of prev) markWatched(showId, p.s, p.e);
        onDone();
      },
    },
    { text: t('markPrevPrompt.no'), onPress: onDone },
    {
      text: t('markPrevPrompt.neverForThisShow'),
      onPress: () => {
        setMeta(`noPrevPrompt:${showId}`, '1');
        onDone();
      },
    },
    {
      // tapped by mistake: undo the episode that was just marked, mark nothing
      text: t('common.cancel'),
      style: 'cancel',
      onPress: () => {
        unmarkWatched(showId, season, episode);
        onDone();
      },
    },
    // Android dismisses alerts on an outside tap — no button fires, so without
    // this the episode is marked but the list never refreshes ("still appears
    // like i havent marked it"). Dismiss = keep the mark, just refresh.
  ], { cancelable: true, onDismiss: onDone });
}
