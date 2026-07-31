/**
 * The community thread for one episode, show or film.
 *
 * WHY THIS IS ITS OWN SCREEN rather than a section spliced into the episode
 * and show pages, which is how the plan phrases it (§7, "thread on the episode
 * and show screens"):
 *
 *  1. Both of those screens are one long `ScrollView`. A `FlatList` inside a
 *     `ScrollView` is the nested-virtualisation bug INSTRUCTIONS.md names as a
 *     P2 — the list stops recycling, mounts every row, and the screen locks up
 *     on exactly the shows with the most comments.
 *  2. The composer needs the keyboard, and the episode screen is a horizontal
 *     pager. A text field inside a swipeable page fights the gesture.
 *
 * So both screens get a row that opens this, which is the same two-tap reach
 * and keeps one virtualised list per screen. The thread itself lives in
 * `components/comment-thread.tsx` and is used by both.
 */
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import type { ThreadTarget } from '@/community-comments';
import { CommentThread } from '@/components/comment-thread';
import { NavHeader, Screen } from '@/components/ui';
import { t } from '@/i18n';

/** A route param that must be a non-negative integer, or nothing at all. */
function numberParam(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export default function ThreadScreen() {
  const { source, key, season, episode, title } = useLocalSearchParams<{
    source?: string;
    key?: string;
    season?: string;
    episode?: string;
    title?: string;
  }>();

  const target: ThreadTarget = {
    // Anything unrecognised falls back to `tvdb`, the only source a show or
    // episode is ever addressed by. An unknown source would earn a 400 and an
    // empty thread, which reads as "nobody has commented" — a lie.
    source: source === 'tmdb' || source === 'title' ? source : 'tvdb',
    key: key ?? '',
    season: numberParam(season),
    episode: numberParam(episode),
  };

  return (
    <Screen>
      <NavHeader title={title || t('community.comments.title')} close />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // The header is already laid out above this, so the inset the keyboard
        // has to clear is only what sits below it.
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <CommentThread target={target} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
