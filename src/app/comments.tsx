import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  type ImageSourcePropType,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { formatCommentDate } from '@/components/comment-card';
import { CommentsList } from '@/components/comments-list';
import { CONTENT_MAX_WIDTH, NavHeader, Screen } from '@/components/ui';
import seed from '@/seed';
import db, { dedupeOwnComments, getComments, getMeta, getMovie, setMeta } from '@/db';
import { documentFileUri, isSeedLibrary } from '@/library';
import { episodeMeta } from '@/metadata';
import { syncOwnComments } from '@/own-comment-sync';
import { archivedCommentKey as commentKey, localCommentToSeed } from '@/pure';
import { buildTargetResolver } from '@/community-seed';
import { deleteImportedComment } from '@/community-comments';
import { isJoined } from '@/community-session';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

// one shape for both sources: bundled seed comments and imported db rows
type Comment = {
  /** rowid — unique, unlike `commentKey`, which is content and can collide */
  id?: number;
  type: string;
  entity: string;
  text: string;
  date: string;
  likes: number;
  replies: number;
  image?: string | null;
  imageUrl?: string | null;
  ratio?: number | null;
};

const AVATAR = require('../../assets/profile/avatar.jpg');

// static require map — Metro needs literal paths; display ratios baked in
// (the Toy Story photo is EXIF-rotated portrait: 3024x4032 on screen)
const IMAGES: Record<string, { src: ImageSourcePropType; ratio: number }> = {
  'spiderman-nwh.jpeg': { src: require('@/assets/comments/spiderman-nwh.jpeg'), ratio: 1024 / 941 },
  'toy-story-5.jpeg': { src: require('@/assets/comments/toy-story-5.jpeg'), ratio: 3024 / 4032 },
  'aot-meme.gif': { src: require('@/assets/comments/aot-meme.gif'), ratio: 354 / 498 },
};

// explicit pixel box per image — centered like the real app, never overflows.
// `cardInner` is passed in rather than captured at module load: on iPad the
// window width changes on rotation, and a baked-in value leaves every image
// sized for the previous orientation. The list itself is capped to
// CONTENT_MAX_WIDTH on a tablet (see the FlatList `cappedList` style below),
// so images must size off that same effective width, not the raw window —
// otherwise a card built for a 1366pt window is laid out inside a 700pt card.
const cardInnerWidth = (w: number) => Math.min(w, CONTENT_MAX_WIDTH) - 2 * 12 - 2 * 15;
function imageBox(ratio: number, cardInner: number): { width: number; height: number } {
  const width = Math.round(cardInner * (ratio < 1 ? 0.55 : 0.7));
  const height = Math.round(Math.min(width / ratio, 360));
  return { width, height };
}

/**
 * "Toy Story 5" → the film; "Attack on Titan S4E28" → THAT EPISODE.
 *
 * The episode, not the show. A comment was written about one episode, and
 * landing on the series page left the reader to find it themselves — through a
 * season picker, in a show with sixty of them. The suffix the entity already
 * carries is the answer; it was being stripped and thrown away.
 *
 * A season-only entity ("Attack on Titan S4") has no episode to open, so it
 * falls back to the show, as does a bare series name.
 */
function openEntity(entity: string): void {
  const m = /\s+S(\d+)(?:E(\d+))?\s*$/i.exec(entity);
  const bare = (m ? entity.slice(0, m.index) : entity).trim();
  const show = db.getFirstSync<{ tvdbId: number }>('SELECT tvdbId FROM shows WHERE LOWER(name) = ?', [bare.toLowerCase()]);
  if (show) {
    const season = m?.[1];
    const episode = m?.[2];
    // AN EPISODE THE CATALOGUE CANNOT IDENTIFY OPENS THE SHOW. Its own page has
    // no title, no still and no synopsis, so landing there answers "which
    // episode was this?" with "we don't know" — the show is the useful
    // destination. Every episode the catalogue does carry still opens itself.
    const known = episode !== undefined && episodeMeta(show.tvdbId, Number(season), Number(episode))?.title;
    const unknown = episode !== undefined && !known && Number(episode) === 0;
    router.push(
      episode !== undefined && !unknown
        ? `/episode/${show.tvdbId}-s${Number(season)}e${Number(episode)}`
        : `/show/${show.tvdbId}`,
    );
    return;
  }
  if (getMovie(bare)) router.push(`/movie/${encodeURIComponent(bare)}`);
}

/**
 * What the pill says — the SAME name the episode page uses.
 *
 * The archive stores the entity as TV Time wrote it, "Attack on Titan S4E0",
 * and an episode no catalogue carries has no title on its own page, where it
 * reads "Unknown episode". Printing the raw code here left the two screens
 * disagreeing about one episode: a pill naming a code, opening a page that
 * says it cannot identify it.
 *
 * Everything else is untouched — the string is only rewritten for an episode
 * the catalogue genuinely has nothing for.
 */
function entityLabel(entity: string): string {
  const m = /\s+S(\d+)E(\d+)\s*$/i.exec(entity);
  if (!m) return entity;
  const bare = entity.slice(0, m.index).trim();
  const show = db.getFirstSync<{ tvdbId: number }>('SELECT tvdbId FROM shows WHERE LOWER(name) = ?', [
    bare.toLowerCase(),
  ]);
  if (!show) return entity;
  const season = Number(m[1]);
  const episode = Number(m[2]);
  if (episodeMeta(show.tvdbId, season, episode)?.title) return entity;
  return episode === 0 ? `${bare} · ${t('show.episodeUnknownTitle')}` : entity;
}

function loadDeleted(): Set<string> {
  try {
    return new Set(JSON.parse(getMeta('deletedComments') ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

type Sheet = { kind: 'own' | 'share'; key: string; text: string; entity: string } | null;

export default function CommentsScreen() {
  const { width: W } = useWindowDimensions();
  const CARD_INNER = cardInnerWidth(W);
  // the FlatList is capped to CONTENT_MAX_WIDTH on a tablet (styles.cappedList)
  // — the compose FAB floats over it and is a sibling of the Screen's
  // full-width container, so it must track the capped list's trailing edge,
  // not the raw screen's, or it drifts away from the content it edits on iPad.
  // On a phone (W <= CONTENT_MAX_WIDTH) this reduces to exactly 18, as today.
  const { title } = useLocalSearchParams<{ title?: string }>();
  const username = getMeta('username') ?? seed.profile.username;
  const seedLib = isSeedLibrary();
  // read once. getComments() reads the whole table, and at 5,000 comments
  // doing that on every render is its own performance problem.
  const [all, setAll] = useState<Comment[]>(() => {
    // Cleaned BEFORE the first read, not in an effect: an earlier own-comment
    // sync wrote a bare duplicate of every comment, and clearing them after the
    // first paint would show the wrong list and then correct itself.
    if (!seedLib) dedupeOwnComments();
    return seedLib ? seed.comments : getComments();
  });
  /** Everything, replies included — what the "All" toggle shows. */
  const [showAll, setShowAll] = useState(false);

  /**
   * Fill in anything written in the community that this phone never stored.
   *
   * Comments posted before the write-back existed live only on the server, so
   * the archive is short by however many of those there are — which is exactly
   * the count the profile shows above it. Runs once on open rather than at
   * launch: this is the only screen where the difference is visible, and it
   * needs the network anyway.
   */
  useEffect(() => {
    if (seedLib) return;
    let cancelled = false;
    void syncOwnComments().then((n) => {
      if (!cancelled && n > 0) setAll(getComments());
    });
    return () => {
      cancelled = true;
    };
  }, [seedLib]);
  const [deleted, setDeleted] = useState<Set<string>>(loadDeleted);
  const [sheet, setSheet] = useState<Sheet>(null);

  // with a title we show ONLY that show/movie's comments — no fallback to all
  //
  // MEMOISED, AND AT THIS SIZE THAT IS NOT AN OPTIMISATION. The heaviest real
  // account holds 8,534 comments and the next 805. Unmemoised, three chained
  // filters over that array ran on EVERY render — opening the sheet, deleting
  // one, toggling All — roughly 25,000 iterations for a state change that
  // cannot alter the result. That is the freeze people reported, and the
  // FlatList below could never help: virtualisation decides what to DRAW, and
  // this happens before it is handed anything.
  const shown = useMemo(
    () =>
      (title ? all.filter((c) => c.entity.toLowerCase().includes(String(title).toLowerCase())) : all)
    // Replies are hidden unless the owner asks for them: a reply on its own is
    // half a conversation, since what it answers lives on the server and the
    // archive has no parent column. `getVisibleOwnComments` applies the same
    // rule for the count, so the two cannot disagree.
        .filter((c) => showAll || c.type !== 'reply')
        .filter((c) => !deleted.has(commentKey(c))),
    [all, title, showAll, deleted],
  );

  const deleteComment = (key: string) => {
    const next = new Set(deleted);
    next.add(key);
    setDeleted(next);
    try {
      setMeta('deletedComments', JSON.stringify([...next]));
    } catch {}
    setSheet(null);

    /*
     * AND FROM THE SERVER, when there is one to reach.
     *
     * This wrote the tombstone above and stopped. The row vanished from this
     * phone and stayed on the public profile and in the thread, for everybody
     * else -- a button saying "Delete comment" that meant "hide on this
     * device". Somebody removing something they wrote nine years ago is usually
     * removing it from OTHER PEOPLE.
     *
     * The comment is named by WHAT IT IS rather than by an id, because the
     * archive keeps none: `localCommentToSeed` builds the same fields the
     * seeder sends, and the server derives the same id from them that it
     * derived when the comment was uploaded.
     *
     * Fire-and-forget: the row is already gone from this screen, and a failure
     * here must not put an error in front of somebody whose comment is, as far
     * as they can see, deleted. It is retried by nothing -- a comment that
     * fails to delete server-side stays visible to others, which is worth
     * knowing about, but not worth a spinner on a screen that has moved on.
     */
    const row = all.find((c) => commentKey(c) === key);
    if (row == null || !isJoined()) return;
    const item = localCommentToSeed(row, buildTargetResolver());
    if (item == null) return; // never seeded — nothing on the server to remove
    void deleteImportedComment(item);
  };

  const shareComment = (text: string, entity: string) => {
    setSheet(null);
    Share.share({ message: t('comments.shareMessage', { entity, text: text || '📷' }) }).catch(() => {});
  };

  /**
   * The row objects, built once per change of input rather than once per render.
   *
   * This ran inline in the JSX, so every render allocated one object PER
   * COMMENT and called `documentFileUri` for each — 8,534 times on the heaviest
   * account, for a re-render that could not change any of it.
   *
   * It also quietly defeated the FlatList below. Virtualisation governs what
   * gets DRAWN; the whole array still had to be built before the list was
   * handed anything, so the expensive part happened however few rows showed.
   */
  const items = useMemo(
    () =>
      shown.map((c) => {

          // The TOMBSTONE key stays content-based so a delete survives a
          // re-import. The LIST key is the rowid, because content is not unique
          // and a collision silently drops a row.
          const key = commentKey(c);
          const rowKey = c.id != null ? String(c.id) : key;
          /*
           * The bundled seed ships its images as static requires with their
           * ratios baked in; an imported one is a downloaded file.
           *
           * `imageUrl` IS NOT A FALLBACK, though it reads like one. It is the
           * link the TV Time export carried, on a CloudFront distribution whose
           * hostname no longer exists in DNS -- see the note at the top of
           * `backend/src/routes/images.ts`. It can never load, so using it as a
           * source only ever reserved a picture-shaped hole in the card: a tall
           * black gap under somebody's words, on every comment whose photograph
           * did not reach this phone before the CDN went dark.
           *
           * So: a file on disk or nothing. A row that remembers a photograph it
           * no longer has says so with the caption placeholder below rather
           * than with silence and a hole.
           */
          const seeded = c.image != null ? IMAGES[c.image] : undefined;
          const uri = seeded == null ? documentFileUri(c.image) : null;
          const ratio = seeded?.ratio ?? c.ratio ?? 4 / 3;
          const source = seeded?.src ?? (uri != null ? { uri } : null);
          return {
            key: rowKey,
            author: username,
            avatar: seedLib ? AVATAR : null,
            date: formatCommentDate(c.date),
            entity: entityLabel(c.entity),
            body: c.text,
            image: source != null ? { source, ...imageBox(ratio, CARD_INNER) } : null,
            isReply: c.type === 'reply',
            likes: c.likes,
            replies: c.replies,
            // There is no thread to open: the TV Time export carries no parent
            // id, so an archived reply can be labelled but never linked. The
            // useful destination is the episode or film it was written about.
            onPress: () => openEntity(c.entity),
            onPressEntity: () => openEntity(c.entity),
            onMenu: () => setSheet({ kind: 'own', key, text: c.text, entity: c.entity }),
            onShare: () => setSheet({ kind: 'share', key, text: c.text, entity: c.entity }),
          };
      }),
    // `openEntity` and `setSheet` are stable; the rest is what actually changes
    // what a row says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, username, seedLib],
  );

  return (
    <Screen>
      {/* OWNER ONLY. This screen is only ever the phone owner's own archive —
          somebody else's comments are `user-comments.tsx`, which has no replies
          to reveal and so needs no switch. */}
      <NavHeader
        title={title ?? t('comments.title')}
        right={
          // An ICON, not a word: the header's right slot is a fixed 40pt box
          // (see `ui.tsx`), and "Comments" was clipped to "Comm". Filled and
          // yellow while replies are included, so the state is visible at a
          // glance rather than needing a label to explain it.
          <Pressable
            hitSlop={12}
            onPress={() => setShowAll((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showAll ? t('comments.onlyMine') : t('comments.showAll')}>
            <Ionicons
              name={showAll ? 'chatbubbles' : 'chatbubbles-outline'}
              size={20}
              color={showAll ? colors.yellow : colors.text}
            />
          </Pressable>
        }
      />
      <CommentsList
        headerNote={title != null ? t('comments.archiveNote') : null}
        items={items}
      />
      {/* The pencil that used to sit here did nothing — it predates the
          community, when there was no thread to write into, and it was never
          given an onPress. It is not restored here because this screen shows
          EVERY title's comments at once, so a compose button has no way to know
          which show you mean. Writing happens in a title's own thread, reached
          from the pill on each card or from the show/episode screen. */}

      {/* own-comment / share sheets, like the real app */}
      {sheet && (
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)}>
          <View style={styles.sheet}>
            {sheet.kind === 'own' ? (
              <Pressable style={[styles.sheetRow, { borderBottomWidth: 0 }]} onPress={() => deleteComment(sheet.key)}>
                <Ionicons name="trash-outline" size={20} color={colors.text} />
                <Text style={styles.sheetLabel}>{t('comments.deleteComment')}</Text>
              </Pressable>
            ) : (
              <>
                <Text style={styles.sheetTitle}>{t('media.actions.share')}</Text>
                <Pressable style={styles.sheetRow} onPress={() => shareComment(sheet.text, sheet.entity)}>
                  <Ionicons name="link-outline" size={20} color={colors.text} />
                  <Text style={styles.sheetLabel}>{t('comments.copyLink')}</Text>
                </Pressable>
                <Pressable
                  style={styles.sheetRow}
                  onPress={() => {
                    setSheet(null);
                    Alert.alert(t('comments.saveImageTitle'), t('comments.saveImageBody'));
                  }}>
                  <Ionicons name="download-outline" size={20} color={colors.text} />
                  <Text style={styles.sheetLabel}>{t('comments.saveImageTitle')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.sheetRow, { borderBottomWidth: 0 }]}
                  onPress={() => shareComment(sheet.text, sheet.entity)}>
                  <Text style={styles.sheetLabel}>{t('comments.more')}</Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cappedList: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  soonCard: {
    marginHorizontal: space.md,
    marginBottom: 10,
    backgroundColor: '#26220E',
    borderRadius: radius.card,
    padding: 13,
    gap: 5,
  },
  soonBadge: { color: colors.yellow, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  soonText: { color: '#E3E3E8', fontSize: 13.5, lineHeight: 19 },
  sortRow: { paddingHorizontal: space.lg, paddingBottom: 10 },
  sortLabel: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.card,
    marginHorizontal: space.md,
    marginBottom: 10,
    padding: 15,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.raise,
  },
  entityPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#55555C',
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 11,
    marginTop: 10,
  },
  entityText: { color: colors.text, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.7 },
  replyNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  replyNoteText: { color: colors.dim, fontSize: 12, fontStyle: 'italic', flex: 1 },
  body: { color: colors.text, fontSize: 15, marginTop: 10, lineHeight: 21 },
  image: {
    alignSelf: 'center',
    borderRadius: 8,
    marginTop: 12,
    backgroundColor: '#0A0A0B',
    overflow: 'hidden',
  },
  actions: { flexDirection: 'row', gap: 24, marginTop: 14, alignItems: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  actionCount: { color: '#C9C9CF', fontSize: 14 },
  empty: { alignItems: 'center', gap: 12, marginTop: 60, paddingHorizontal: 40 },
  emptyText: { color: colors.dim, fontSize: 15, textAlign: 'center' },
  fab: {
    position: 'absolute',
    end: 18,
    bottom: 28,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#232326',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 10,
    paddingBottom: 30,
  },
  sheetTitle: { color: colors.dim, fontSize: 14, fontWeight: '600', paddingHorizontal: space.xl, paddingVertical: 8 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.xl,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333338',
  },
  sheetLabel: { color: colors.text, fontSize: 16.5 },
});
