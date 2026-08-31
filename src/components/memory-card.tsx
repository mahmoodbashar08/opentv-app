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
 * IT IS A NOTIFICATION, and drawn as one — the row from the notifications
 * screen, not the Wrapped banner beneath it.
 *
 * The difference is what each shape is FOR. Wrapped and Reconnect are offers:
 * a filled card, a bold heading, something being sold. This is not an offer. It
 * is a thing that happened, on the same date, years ago — the same register as
 * "somebody replied to you", which the app already draws as a flat row with a
 * round mark, a sentence at reading size, and a quiet line underneath. Putting
 * a memory in a promo card made it read like an advertisement for itself.
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
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getMeta, setMeta } from '@/db';
import { t } from '@/i18n';
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
      setMemory(memoryDismissed(getMeta(DISMISSED_KEY), today) ? null : memoryFor(today));
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
   * WHERE IT GOES. A memory about a show opens that show; a memory about
   * something written opens the archive it was written in, because the comment
   * carries no show id — `comments.entity` is a display string and matching it
   * to a show by name is the bug that made search offer ADD SHOW for shows
   * already tracked.
   */
  const open = () => {
    if (memory.kind === 'comment') router.push('/comments');
    else router.push(`/show/${memory.showId}`);
    // Read and acted on. It has done its job for today.
    dismiss();
  };

  return (
    <Pressable style={styles.card} onPress={open}>
      <View style={styles.mark}>
        <Ionicons name="time-outline" size={21} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        {/* The sentence leads. "On this day" is the label under it, the way the
            notifications list puts the date under what happened — the event is
            what somebody reads, not the heading over it. */}
        <Text style={styles.body} numberOfLines={2}>
          {memorySentence(memory, now)}
        </Text>
        {/* Their own words, in their own voice, which is the whole reason a
            comment outranks a count. One line: this is a reminder, not the
            archive, and the archive is one tap away. */}
        {memory.kind === 'comment' && (
          <Text style={styles.quote} numberOfLines={1}>
            “{memory.text}”
          </Text>
        )}
        <Text style={styles.label}>{t('onThisDay.title')}</Text>
      </View>
      {/* Its own hit area, like Wrapped's and Reconnect's: dismissing must not
          open the thing being dismissed, which is what a single tappable row
          would do. */}
      <Pressable onPress={dismiss} hitSlop={12} accessibilityLabel={t('ui.dismiss')}>
        <Ionicons name="close" size={17} color={colors.faint} />
      </Pressable>
    </Pressable>
  );
}

/* Deliberately the same numbers as `row` on the notifications screen — the gap,
 * the 44pt round mark, 14.5/20 for what happened and a faint 12.5 under it, and
 * a hairline instead of a fill. Two rows in the same app that agree about
 * everything except four pixels of padding look like a mistake, and one of them
 * always is. */
const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  mark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  quote: { color: colors.dim, fontSize: 13, lineHeight: 18, marginTop: 1, fontStyle: 'italic' },
  label: { color: colors.faint, fontSize: 12.5, marginTop: 1 },
});
