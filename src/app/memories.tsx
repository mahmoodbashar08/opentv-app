/**
 * Everything worth remembering, in one list.
 *
 * WHAT IT IS FOR. The "On this day" strip shows exactly one memory, on the one
 * day it belongs to, and then it is gone — which is right for a strip and
 * wrong as the only way to reach any of them. This is the page behind it: the
 * same three questions asked of the whole library instead of one date.
 *
 * IT IS NOT THE WATCH TIMELINE. The timeline is every episode ever watched, in
 * order, and it is a log. This is the handful of moments that were actually
 * something: a show ended, a day disappeared into one series, somebody wrote
 * their own words down. `memoryArchive` deliberately returns no plain-episode
 * rows for exactly this reason — a memories list made mostly of "you watched an
 * episode" buries the three kinds worth reading.
 *
 * FREE, AND NEVER PLUS, like the strip and for the same reason. It shows a
 * person their own past, computed on their own phone from marks they made years
 * ago. Charging for that breaks the rule the whole app stands on.
 *
 * READ ON FOCUS, NOT DURING RENDER. The React Compiler memoises render-time
 * calls against their arguments, so a `memoryArchive()` in the body would be
 * computed once and then quietly kept — including after a comment is deleted in
 * the screen this pushes to. State React sets is the only invalidation that
 * survives the compiler.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';

import { EmptyState, NavHeader, Screen } from '@/components/ui';
import { memoryArchive, type DatedMemory } from '@/db';
import { currentLocale, t } from '@/i18n';
import { colors, radius, space } from '@/theme';

/** The mark on the left when there is no artwork — per kind, because the strip
 *  only ever shows one memory and a list of forty wants them told apart. */
const ICON = {
  finale: 'flag-outline',
  binge: 'flame-outline',
  comment: 'chatbubble-outline',
  episode: 'tv-outline',
} as const;

/** One line, without the "years ago today" framing the strip needs — every row
 *  here carries its own date, so the sentence says what happened and the date
 *  says when. */
function line(m: DatedMemory['event']): string {
  switch (m.kind) {
    case 'finale':
      return t('memories.finale', { show: m.show });
    case 'binge':
      return t('memories.binge', { show: m.show, n: m.count });
    case 'comment':
      return t('memories.comment', { show: m.show });
    case 'episode':
      return t('memories.episode', { show: m.show, code: `S${m.season}E${m.episode}` });
  }
}

/** `2019-04-14` and `2019-04-14 21:30:00` both arrive here; only the date part
 *  is ever shown, so the time is cut before parsing rather than formatted. */
function prettyDate(at: string): string {
  const d = new Date(`${at.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return at.slice(0, 10);
  return d.toLocaleDateString(currentLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function MemoriesScreen() {
  const [rows, setRows] = useState<DatedMemory[]>([]);

  useFocusEffect(
    useCallback(() => {
      setRows(memoryArchive());
    }, []),
  );

  /*
   * WHERE EACH ROW GOES — the same rule the strip follows, and the same reasons.
   * A finale opens the SHOW because the kind records that a show ended, not
   * which episode ended it. A comment opens the archive it was written in,
   * because it carries no show id: `comments.entity` is a display string, and
   * matching it to a show by name is precisely the bug that made search offer
   * ADD SHOW for shows already tracked.
   */
  const open = (m: DatedMemory['event']) => {
    if (m.kind === 'comment') router.push('/comments');
    else if (m.kind === 'episode') router.push(`/episode/${m.showId}-s${m.season}e${m.episode}`);
    else router.push(`/show/${m.showId}`);
  };

  return (
    <Screen>
      <NavHeader title={t('memories.title')} close />
      <FlatList
        data={rows}
        keyExtractor={(r, i) => `${r.at}-${r.event.kind}-${i}`}
        contentContainerStyle={rows.length === 0 ? styles.emptyWrap : { paddingBottom: 40 }}
        ListEmptyComponent={<EmptyState title={t('memories.title')} caption={t('memories.empty')} />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => open(item.event)}>
            {/* THE ARTWORK IS THE MEMORY. A page of grey circles beside three
                sentences is a report; the poster is what makes somebody
                recognise the day they are reading about. Comments carry no show
                id and so no poster — those keep the mark, which is why it still
                exists. */}
            {item.poster ? (
              <Image source={{ uri: item.poster }} style={styles.poster} contentFit="cover" cachePolicy="disk" />
            ) : (
              <View style={styles.mark}>
                <Ionicons name={ICON[item.event.kind]} size={19} color={colors.brand} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.text} numberOfLines={2}>
                {line(item.event)}
              </Text>
              {/* Their own words, in their own voice, which is the whole reason
                  a comment outranks a count in the strip's ranking too. */}
              {item.event.kind === 'comment' && (
                <Text style={styles.quote} numberOfLines={2}>
                  “{item.event.text}”
                </Text>
              )}
              <Text style={styles.date}>{prettyDate(item.at)}</Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

/* The notifications row, deliberately: a 44pt round mark, what happened at
 * reading size, a faint line under it, a hairline instead of a fill. A memory
 * and "somebody replied to you" are the same register, and two lists in one app
 * that agree about everything except four pixels of padding look like a
 * mistake — one of them always is. */
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  poster: { width: 46, height: 69, borderRadius: 6, backgroundColor: colors.raise },
  mark: {
    width: 46,
    height: 69,
    borderRadius: 6,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  quote: { color: colors.dim, fontSize: 13, lineHeight: 18, marginTop: 2, fontStyle: 'italic' },
  date: { color: colors.faint, fontSize: 12.5, marginTop: 1 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.card },
});
