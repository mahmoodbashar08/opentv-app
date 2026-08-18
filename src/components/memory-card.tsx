/**
 * "On this day" — one line about the same date in the user's own past.
 *
 * WHY IT SITS ON WATCH NEXT AND NOT ON A SCREEN OF ITS OWN. A new idea either
 * replaces something or it lives inside a surface that already exists; three
 * ideas arriving as three tabs is how a tracker becomes a menu. Watch Next is
 * the first thing anybody opens, and this belongs to the same question that
 * screen already answers: what now.
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

import { memoryEventsOn } from '@/db';
import { t } from '@/i18n';
import { pickMemory, type MemoryEvent } from '@/pure';
import { colors, radius, space } from '@/theme';

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

export function MemoryCard() {
  const [memory, setMemory] = useState<MemoryEvent | null>(null);
  const [now, setNow] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      const today = new Date();
      setNow(today);
      setMemory(pickMemory(memoryEventsOn(today)));
    }, []),
  );

  if (memory == null) return null;

  /*
   * WHERE IT GOES. A memory about a show opens that show; a memory about
   * something written opens the archive it was written in, because the comment
   * carries no show id — `comments.entity` is a display string and matching it
   * to a show by name is the bug that made search offer ADD SHOW for shows
   * already tracked.
   */
  const open = () =>
    memory.kind === 'comment' ? router.push('/comments') : router.push(`/show/${memory.showId}`);

  return (
    <Pressable style={styles.card} onPress={open}>
      <View style={styles.head}>
        <Ionicons name="time-outline" size={14} color={colors.yellow} />
        <Text style={styles.eyebrow}>{t('onThisDay.title')}</Text>
      </View>
      <Text style={styles.line}>{memorySentence(memory, now)}</Text>
      {/* Their own words, in their own voice, which is the whole reason a
          comment outranks a count. Two lines: this is a reminder, not the
          archive, and the archive is one tap away. */}
      {memory.kind === 'comment' && (
        <Text style={styles.quote} numberOfLines={2}>
          “{memory.text}”
        </Text>
      )}
      <Ionicons
        name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'}
        size={16}
        color={colors.faint}
        style={styles.chevron}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.lg,
    marginBottom: 10,
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: radius.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6 },
  eyebrow: { color: colors.yellow, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  line: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21, paddingRight: 18 },
  quote: { color: colors.dim, fontSize: 14, lineHeight: 19, paddingTop: 6, fontStyle: 'italic' },
  chevron: { position: 'absolute', top: 16, right: 12 },
});
