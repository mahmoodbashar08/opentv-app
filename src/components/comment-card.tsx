/**
 * ONE COMMENT, drawn the same wherever it appears.
 *
 * This is the card the owner's own comments screen has always used, lifted out
 * so a public profile draws its comments identically. Before this, `comments.tsx`
 * had the card inline and `user-comments.tsx` borrowed the thread's `CommentRow`,
 * and the two drifted: one printed `Mon, Jul 6, 2026` above a `RIVERDALE ›` pill,
 * the other `3 weeks ago · From TV Time` under a yellow heading.
 *
 * IT KNOWS NOTHING ABOUT WHERE ITS DATA CAME FROM. The owner's comments are rows
 * of the local archive; a profile's are pages fetched from the server, with
 * authors, likes and spoiler flags the local ones do not have. Both map to
 * `CommentCardProps` at the call site, so this file has no branch on which
 * screen is asking.
 *
 * SPOILERS ARE THE ONE THING THAT DOES NOT COME FOR FREE. The owner's card never
 * needed them — your own comment cannot spoil anything for you — so hiding a
 * flagged body had to be carried over from `CommentRow` rather than inherited.
 * A card that forgot it would quietly reveal every spoiler on a public profile,
 * which is the failure nobody sees until it is too late.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image as ExpoImage } from 'expo-image';
import { useState } from 'react';
import { type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space } from '@/theme';
import { currentLocale, t } from '@/i18n';
import { cachedTranslation, type Translation } from '@/community-translate';

/**
 * The one date format a comment card uses, wherever it is drawn.
 *
 * Absolute, not "3 weeks ago". A comment archive spans years, and a relative
 * time answers "how long ago" for the newest rows and nothing at all for the
 * rest — "5 years ago" on four hundred of them is not a date. Locale-aware,
 * because the app ships in six languages and Arabic does not write Jul 6.
 */
export function formatCommentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale(), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export type CommentCardProps = {
  /** Display name, drawn as written — no `@` is added. */
  author: string;
  /** Remote avatar, else the first letter of `author` on a plain circle. */
  avatar?: ImageSourcePropType | { uri: string } | null;
  /** Already formatted. The card never parses a date. */
  date: string;
  /** The pill's text. Hidden entirely when absent, for a thread that has one subject. */
  entity?: string | null;
  body: string;
  image?: { source: ImageSourcePropType | { uri: string }; width: number; height: number } | null;
  /** A reply shows a line saying so; the parent lives on the thread screen. */
  isReply?: boolean;
  likes: number;
  replies: number;
  liked?: boolean;
  /** Marks the card as written by this phone's owner — a small yellow dot, as
   *  the thread draws it. Meaningless on the owner's own archive, where every
   *  card is theirs; it earns its place on a public profile that is your own. */
  mine?: boolean;
  /** Hides the body behind a tap. Ignored when `revealed`. */
  spoiler?: boolean;
  /** Why it is hidden, so the curtain can say which. `'flagged'` is the
   *  author's own warning; `'unseen'` is "you have not watched this yet". */
  spoilerReason?: 'flagged' | 'unseen';
  revealed?: boolean;
  onReveal?: () => void;
  /** The whole card. A comment that does nothing when tapped reads as broken
   *  even when the data behind it is fine — the thread is what a reader wants,
   *  and the reply count alone is too small a target to be the only way in. */
  onPress?: () => void;
  /** The name and avatar. Opens whoever wrote it. */
  onPressAuthor?: () => void;
  onPressEntity?: () => void;
  onMenu?: () => void;
  onLike?: () => void;
  onReply?: () => void;
  onShare?: () => void;
  /** A Translate link under the body. `cacheKey` is what `cachedTranslation`
   *  knows it by, so a row scrolled away and back keeps its translation. */
  translate?: { cacheKey: string; run: () => Promise<Translation> };
};

export function CommentCard({
  author,
  avatar,
  date,
  entity,
  body,
  image,
  isReply,
  onPress,
  onPressAuthor,
  likes,
  replies,
  liked,
  mine,
  spoiler,
  spoilerReason,
  revealed,
  onReveal,
  onPressEntity,
  onMenu,
  onLike,
  onReply,
  onShare,
  translate,
}: CommentCardProps) {
  const hidden = spoiler === true && revealed !== true;
  const [broken, setBroken] = useState(false);
  // The picture's own shape, once it has loaded. Every picture used to be a
  // fixed 4:3 box filled edge to edge, which cut the top and bottom off
  // anything taller — a meme of stacked panels lost two of its three (7 Oct).
  const [ratio, setRatio] = useState<number | null>(null);
  const [translation, setTranslation] = useState(() => (translate ? cachedTranslation(translate.cacheKey) : null));
  const [showTranslated, setShowTranslated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const Card = onPress != null ? Pressable : View;

  return (
    <Card style={styles.card} onPress={onPress}>
      <View style={styles.head}>
        <Pressable
          style={styles.head}
          onPress={onPressAuthor}
          disabled={onPressAuthor == null}
          hitSlop={6}>
          {avatar != null ? (
            // expo-image, not RN Image: CommsUni's archive avatars are SVG data
            // URIs, which RN's Image cannot draw (an empty circle, 2 Oct).
            <ExpoImage source={avatar} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarLetter]}>
              <Text style={styles.avatarLetterText}>{author.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View>
            <Text style={styles.author}>{author}</Text>
            <Text style={styles.date}>{date}</Text>
          </View>
        </Pressable>
        <View style={{ flex: 1 }} />
        {mine === true && <View style={styles.mineDot} />}
        {onMenu != null && (
          <Pressable hitSlop={10} onPress={onMenu}>
            <Ionicons name="ellipsis-horizontal" size={17} color={colors.dim} />
          </Pressable>
        )}
      </View>

      {entity != null && entity !== '' && (
        <Pressable style={styles.entityPill} onPress={onPressEntity} disabled={onPressEntity == null}>
          <Text style={styles.entityText}>{entity.toUpperCase()} ›</Text>
        </Pressable>
      )}

      {isReply === true && (
        <View style={styles.replyNote}>
          <Ionicons name="arrow-undo-outline" size={13} color={colors.dim} />
          <Text style={styles.replyNoteText}>{t('comments.replyNote')}</Text>
        </View>
      )}

      {hidden ? (
        // The tap target is the hidden body itself: a reader who wants it says
        // so deliberately, and one who does not never has it on screen.
        <Pressable style={styles.spoiler} onPress={onReveal}>
          <Ionicons name="eye-off-outline" size={15} color={colors.dim} />
          <Text style={styles.spoilerText}>
            {t(spoilerReason === 'unseen' ? 'community.comments.unseenHidden' : 'community.comments.spoilerHidden')}
          </Text>
        </Pressable>
      ) : (
        <>
          {body !== '' && <Text style={styles.body}>{showTranslated && translation ? translation.text : body}</Text>}
          {/* The same link, words and behaviour as on OpenTV's own comments. */}
          {translate != null && body !== '' && !translation?.same && (
            <Pressable
              hitSlop={6}
              onPress={() => {
                if (busy) return;
                if (translation) {
                  setShowTranslated((v) => !v);
                  return;
                }
                setBusy(true);
                setFailed(false);
                void translate
                  .run()
                  .then((r) => {
                    setTranslation(r);
                    setShowTranslated(!r.same);
                  })
                  .catch(() => setFailed(true))
                  .finally(() => setBusy(false));
              }}>
              <Text style={[styles.translate, failed && styles.translateFailed]}>
                {busy
                  ? t('community.comments.translating')
                  : failed
                    ? t('community.comments.translateFailed')
                    : translation && showTranslated
                      ? t('community.comments.showOriginal')
                      : t('community.comments.translate')}
              </Text>
            </Pressable>
          )}
          {/* A picture that does not load takes its space with it: the
              Comments screen asks for one on every row it might have, and a
              comment without one used to keep an empty box the size of it. */}
          {image != null && !broken && (
            // expo-image, SAVED TO DISK: the picture is downloaded once and
            // then opens instantly. RN's Image kept it in memory only, so every
            // visit re-downloaded every picture from our server. The cache key is
            // the URL alone — the token in the headers changes, the picture not.
            <ExpoImage
              source={image.source as never}
              // Its real shape, kept between flat (2:1) and tall (1:1.8) so one
              // picture can never take the whole screen; `contain` inside that,
              // so nothing is ever cut off.
              style={[styles.image, { width: image.width, height: ratio == null ? image.height : Math.round(image.width * Math.min(1.8, Math.max(0.5, ratio))) }]}
              contentFit="contain"
              cachePolicy="disk"
              transition={150}
              onError={() => setBroken(true)}
              onLoad={(e) => {
                const { width, height } = e.source;
                if (width > 0 && height > 0) setRatio(height / width);
              }}
            />
          )}
        </>
      )}

      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={onLike} disabled={onLike == null} hitSlop={8}>
          <Ionicons
            name={liked === true ? 'heart' : 'heart-outline'}
            size={22}
            color={liked === true ? colors.danger : colors.dim}
          />
          <Text style={styles.actionCount}>{likes}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={onReply} disabled={onReply == null} hitSlop={8}>
          <Ionicons name="chatbubble-outline" size={20} color="#C9C9CF" />
          <Text style={styles.actionCount}>{replies}</Text>
        </Pressable>
        {onShare != null && (
          <Pressable hitSlop={10} style={{ marginStart: 'auto' }} onPress={onShare}>
            <Ionicons name="share-outline" size={20} color="#C9C9CF" />
          </Pressable>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  translate: { color: colors.blue, fontSize: 13, fontWeight: '700', marginTop: 8 },
  translateFailed: { color: colors.dim, fontWeight: '600' },
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.card,
    marginHorizontal: space.md,
    marginBottom: 10,
    padding: 15,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.raise },
  avatarLetter: { alignItems: 'center', justifyContent: 'center' },
  avatarLetterText: { color: colors.yellow, fontWeight: '800' },
  author: { color: colors.text, fontWeight: '700', fontSize: 15 },
  date: { color: colors.faint, fontSize: 12.5 },
  entityPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.pillGrey,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 11,
    marginTop: 10,
  },
  entityText: { color: colors.text, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.7 },
  replyNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  replyNoteText: { color: colors.dim, fontSize: 12, fontStyle: 'italic', flex: 1 },
  body: { color: colors.text, fontSize: 15, marginTop: 10, lineHeight: 21 },
  spoiler: {
    marginTop: 10,
    borderRadius: 8,
    backgroundColor: colors.raise,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  spoilerText: { color: colors.dim, fontSize: 13.5, fontWeight: '600' },
  image: {
    alignSelf: 'center',
    borderRadius: 8,
    marginTop: 12,
    backgroundColor: colors.panel,
    overflow: 'hidden',
  },
  actions: { flexDirection: 'row', gap: 24, marginTop: 14, alignItems: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  actionCount: { color: colors.dim, fontSize: 14 },
  mineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.yellow },
});
