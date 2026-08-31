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
 * ONE LINE, NOT A CARD. It was two lines of large type in a padded block, which
 * on a phone is a screenful of nothing you can act on. It reads as a row now:
 * a mark, a sentence, an arrow — the shape of everything else it sits beside.
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
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { getMeta, setMeta } from '@/db';
import { t } from '@/i18n';
import { memoryFor, memorySentence } from '@/on-this-day';
import { localDayStamp, memoryDismissed, type MemoryEvent } from '@/pure';
import { colors, radius, space } from '@/theme';

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
      <Ionicons name="time-outline" size={17} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>{t('onThisDay.title')}</Text>
        <Text style={styles.line} numberOfLines={2}>
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
      </View>
      {/* A way past it without opening anything. The hit area is padded well
          beyond the glyph — a 15pt × on a row this short is otherwise a target
          nobody can hit on the first try. */}
      <Pressable onPress={dismiss} hitSlop={12} style={styles.dismiss} accessibilityLabel={t('ui.dismiss')}>
        <Ionicons name="close" size={16} color={colors.faint} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* The container owns the spacing between blocks, so no vertical margin here. */
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginHorizontal: space.lg,
    paddingVertical: 11,
    paddingHorizontal: 13,
    backgroundColor: colors.card,
    borderRadius: radius.card,
  },
  eyebrow: { color: colors.brand, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  line: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 19, marginTop: 2 },
  quote: { color: colors.dim, fontSize: 13, lineHeight: 17, marginTop: 2, fontStyle: 'italic' },
  dismiss: { padding: 4 },
});
