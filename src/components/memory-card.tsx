/**
 * "On this day" — one line about the same date in the user's own past.
 *
 * WHY IT SITS ON THE PROFILE AND NOT ON A SCREEN OF ITS OWN. A new idea either
 * replaces something or it lives inside a surface that already exists; three
 * ideas arriving as three tabs is how a tracker becomes a menu. It began on
 * Watch Next, on the argument that this is the same question that screen
 * answers — what now. IT ISN'T. Watch Next is opened to start an episode, and a
 * memory there is a paragraph standing in front of the thing somebody came for.
 * A memory is about their own library, which is what the profile already is,
 * and it rides with the other messages at the top of it.
 *
 * IT IS ONE OF THE STRIPS, and drawn as one — the full-bleed bar the profile
 * already uses for iCloud, backup, reminders and Discord.
 *
 * Those are the app speaking to the person whose page this is, in one line,
 * edge to edge, with a way out on the right. A memory is the same kind of
 * sentence, so it takes the same bar. It went through a padded card and a
 * notification row first; both were shapes this screen does not otherwise use,
 * and a page with four ways of saying one line has no way of saying it.
 *
 * THE BRAND, NOT THE ACCENT, for the reason `cloudBanner` gives: `colors.yellow`
 * becomes ink on paper so that filled CONTROLS turn black-on-white, and a
 * full-width black stripe reads as an error rather than a notice.
 *
 * MOST DAYS IT IS NOT HERE. `memoryEventsOn` returns nothing for the majority
 * of dates, and that is the design rather than a shortfall — a card that is
 * always present is furniture, and furniture is not read. The whole component
 * renders null far more often than it renders.
 *
 * READ ON FOCUS, NOT DURING RENDER. The React Compiler memoises render-time
 * calls against their arguments, so a `memoryEventsOn(new Date())` in the body
 * would be computed once and then quietly kept — including across midnight,
 * which is the one moment this must be wrong about. State React sets is the
 * only invalidation that survives the compiler.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { getMeta, setMeta } from '@/db';
import { t } from '@/i18n';
import { notifyKindEnabled } from '@/notifications';
import { memoryFor, memorySentence } from '@/on-this-day';
import { localDayStamp, memoryDismissed, type MemoryEvent } from '@/pure';
import { colors, space } from '@/theme';

/** The day today's memory was last put away. A date, not a flag — see
 *  `memoryDismissed`. */
const DISMISSED_KEY = 'memoryDismissedOn';

export function MemoryCard() {
  const [memory, setMemory] = useState<MemoryEvent | null>(null);
  const [now, setNow] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      const today = new Date();
      setNow(today);
      /* One switch governs the strip and the evening notification alike —
         Settings → App → On this day. Read here rather than passed in, so no
         caller can render this having forgotten to ask. */
      const off = !notifyKindEnabled('memory');
      setMemory(off || memoryDismissed(getMeta(DISMISSED_KEY), today) ? null : memoryFor(today));
    }, []),
  );

  if (memory == null) return null;

  /* Put it away for the rest of the day — the same thing whether it was read
     and opened, or waved off with the ×. */
  const dismiss = () => {
    setMeta(DISMISSED_KEY, localDayStamp(new Date()));
    setMemory(null);
  };

  /*
   * WHERE IT GOES — as precisely as the memory allows.
   *
   * AN EPISODE MEMORY OPENS THAT EPISODE. "A year ago today you watched Dark
   * S1E5" and then landing on the show is the tap not being answered: the
   * sentence names an episode, so the episode is what was asked for. The kind
   * carries `season` and `episode` for exactly this.
   *
   * A finale opens the SHOW, even though a finale is also an episode: the kind
   * records that a show ended, not which episode ended it, and guessing the
   * last episode from the show's structure is a guess.
   *
   * A comment opens the archive it was written in, because it carries no show
   * id — `comments.entity` is a display string, and matching it to a show by
   * name is precisely the bug that made search offer ADD SHOW for shows already
   * tracked. The archive is keyed by that same string.
   */
  const open = () => {
    if (memory.kind === 'comment') router.push('/comments');
    else if (memory.kind === 'episode')
      router.push(`/episode/${memory.showId}-s${memory.season}e${memory.episode}`);
    else router.push(`/show/${memory.showId}`);
    // Read and acted on. It has done its job for today.
    dismiss();
  };

  return (
    <Pressable style={styles.bar} onPress={open}>
      <Ionicons name="time-outline" size={18} color={colors.onBrand} />
      {/* The sentence, never the quoted comment. A bar holds one line, and
          "2 years ago today you wrote about Dark" is the part that places the
          memory in time — the words themselves are one tap away in the
          archive this opens. */}
      <Text style={styles.text} numberOfLines={2}>
        {memorySentence(memory, now)}
      </Text>
      {/* Its own hit area, like Discord's: dismissing must not open the thing
          being dismissed, which is what a single tappable row would do. */}
      <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel={t('ui.dismiss')}>
        <Ionicons name="close" size={17} color={colors.onBrand} />
      </Pressable>
    </Pressable>
  );
}

/* Deliberately the same numbers as `cloudBanner` on the profile screen — full
 * bleed, `gap: 8`, 13/700 on the brand. Two bars in the same column that agree
 * about everything except four pixels of padding look like a mistake, and one
 * of them always is. */
const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  text: { color: colors.onBrand, fontSize: 13, fontWeight: '700', flex: 1 },
});
