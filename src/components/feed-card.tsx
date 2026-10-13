/**
 * One card of the friends feed — TV Time's activity row: who, what they did to
 * what, the reaction itself, and the poster.
 *
 * LOCKED, IT KEEPS THE VERB AND HIDES THE CONTENT. "sara rated The Bear S2E5"
 * tells you nothing about The Bear; four stars and "shocked" might. So a locked
 * card draws the first line in full and replaces the second with a lock and
 * "Watch it to see" — no stars, no feeling, no words, no character name.
 *
 * ONE ELEMENT TO A SCREEN READER. The card is a single button whose label is
 * the sentence a sighted reader takes in at a glance; long-press (Report /
 * Block / Unfollow) is offered as its accessibility action.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { avatarUri } from '@/community-comments';
import type { FeedCardModel } from '@/community-feed';
import { Poster } from '@/components/poster';
import { feedStars, feedVerbKey } from '@/feed-pure';
import { currentLocale, t } from '@/i18n';
import type { LocaleKey } from '@/locales/keys';
import { relativeTime, spoilerHidden } from '@/pure';
import { filledStarText } from '@/star-rating';
import { colors, radius, space, ls } from '@/theme';

/** The episode screen's faces, by the contract names the server stores. */
const FACE: Record<string, string> = {
  shocked: '😯',
  frustrated: '😤',
  sad: '😭',
  reflective: '🤔',
  touched: '🥹',
  amused: '😆',
  scared: '😱',
  bored: '😑',
  understood: '😌',
  thrilled: '🤩',
  confused: '🙃',
  tense: '😬',
};

function emotionLabel(name: string): string {
  return FACE[name] ? t(`media.emotions.${name}` as LocaleKey) : name;
}

/** What the second line says, in words — for the screen reader, and for nothing else. */
function contentText(card: FeedCardModel, hidden: boolean): string {
  const { item } = card;
  if (card.locked) return t('feed.lockedA11y');
  switch (item.kind) {
    case 'rating': {
      const stars = feedStars(item.score);
      // "3.5 out of 5 stars", the number in the reader's own digits
      const said = stars != null ? t('halfStars.value', { value: stars.toLocaleString(currentLocale()) }) : null;
      return [said, ...item.emotions.map(emotionLabel)]
        .filter(Boolean)
        .join(', ');
    }
    case 'comment':
      return hidden ? t('community.comments.spoilerHidden') : item.body;
    case 'character':
      return item.character;
  }
}

export function FeedCard({
  card,
  now,
  revealed,
  onPress,
  onMore,
  onReveal,
}: {
  card: FeedCardModel;
  /** Passed in so a list of fifty cards agrees on what "2h" means. */
  now: number;
  /** Spoiler-flagged comments the reader has tapped open. */
  revealed: ReadonlySet<string>;
  onPress: (card: FeedCardModel) => void;
  onMore: (card: FeedCardModel) => void;
  onReveal: (commentId: string) => void;
}) {
  const { item, locked } = card;
  const uri = avatarUri(item.actor.avatar_key);
  // Never a bare id (`targetLabel`'s rule): "S2E5" while the name is on its
  // way, and for a show-level event on a show nobody here has heard of, nothing
  // for the moment it takes `resolveUnknownTargets` to fetch it.
  const title = card.label;
  const verb = t(feedVerbKey(item), { title });
  const age = relativeTime(item.created_at, now);
  const ageText = age ? t(age.key as LocaleKey, { count: age.count }) : '';
  const curtained =
    !locked && item.kind === 'comment' && spoilerHidden({ id: item.comment_id, is_spoiler: item.is_spoiler }, revealed);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      onPress={() => {
        // A flagged comment's first tap lifts the curtain; the second opens it.
        if (curtained && item.kind === 'comment') onReveal(item.comment_id);
        else onPress(card);
      }}
      onLongPress={() => onMore(card)}
      accessibilityRole="button"
      accessibilityLabel={[`@${item.actor.handle}`, verb, contentText(card, curtained), ageText].filter(Boolean).join('. ')}
      accessibilityActions={[{ name: 'longpress', label: t('comments.more') }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'longpress') onMore(card);
      }}>
      {uri != null ? (
        <Image source={{ uri }} style={[styles.avatar, locked && styles.dimmed]} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, locked && styles.dimmed]}>
          <Text style={styles.avatarLetter}>{item.actor.handle.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={styles.handle} numberOfLines={1}>
            @{item.actor.handle}
          </Text>
          <Text style={styles.age}>{ageText}</Text>
        </View>
        <Text style={styles.verb} numberOfLines={2}>
          {verb}
        </Text>

        {locked ? (
          <View style={styles.row}>
            <Ionicons name="lock-closed" size={13} color={colors.faint} />
            <Text style={styles.lockedText}>{t('feed.locked')}</Text>
          </View>
        ) : item.kind === 'rating' ? (
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {feedStars(item.score) != null && (
              <Text style={styles.stars}>
                {/* a half is "½", as on the share card: no half-star glyph is
                    in every system font */}
                {filledStarText(feedStars(item.score)! * 2)}
                <Text style={{ color: colors.faint }}>{'★'.repeat(5 - Math.ceil(feedStars(item.score)!))}</Text>
              </Text>
            )}
            {item.emotions.map((e) => (
              <Text key={e} style={styles.chip}>
                {FACE[e] ?? ''} {emotionLabel(e)}
              </Text>
            ))}
          </View>
        ) : item.kind === 'comment' ? (
          curtained ? (
            <Text style={styles.curtain}>{t('community.comments.spoilerHidden')}</Text>
          ) : (
            <View style={styles.row}>
              {item.has_image && <Ionicons name="image-outline" size={14} color={colors.dim} />}
              <Text style={styles.comment} numberOfLines={3}>
                {item.body}
              </Text>
            </View>
          )
        ) : (
          <Text style={styles.comment} numberOfLines={1}>
            {item.character}
          </Text>
        )}
      </View>

      <View style={styles.poster}>
        <Poster name={title || '·'} uri={card.poster} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.md,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: colors.text, fontWeight: '800', fontSize: 15 },
  dimmed: { opacity: 0.45 },
  body: { flex: 1, gap: 3 },
  topLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  handle: { flex: 1, color: colors.text, fontWeight: '800', fontSize: 14 },
  age: { color: colors.faint, fontSize: 12 },
  verb: { color: colors.text, fontSize: 14, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  stars: { color: colors.yellow, fontSize: 14, letterSpacing: ls(1) },
  chip: {
    color: colors.text,
    fontSize: 12,
    backgroundColor: colors.raise,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  comment: { flex: 1, color: colors.dim, fontSize: 14, lineHeight: 19 },
  curtain: { color: colors.faint, fontSize: 13, fontStyle: 'italic', marginTop: 2 },
  lockedText: { color: colors.faint, fontSize: 13 },
  poster: { width: 44, height: 66 },
});
