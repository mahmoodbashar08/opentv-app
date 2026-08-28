import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  I18nManager,
  type ImageSourcePropType,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { formatCommentDate } from '@/components/comment-card';
import { CommentsList } from '@/components/comments-list';
import { CONTENT_MAX_WIDTH, NavHeader, Screen } from '@/components/ui';
import seed from '@/seed';
import db, { addOwnComment, dedupeOwnComments, getComments, getMeta, getMovie, setMeta } from '@/db';
import { API_BASE_URL } from '@/api-config';
import { documentFileUri, isSeedLibrary } from '@/library';
import { episodeMeta } from '@/metadata';
import { syncOwnComments } from '@/own-comment-sync';
import { archivedCommentKey as commentKey, localCommentToSeed } from '@/pure';
import { buildTargetResolver } from '@/community-seed';
// ALIASED, because this screen has its own `deleteComment` -- the one the ⋯
// menu calls, which writes the tombstone. The import was shadowed by it, so
// every server delete on this screen was in fact calling the local function
// with a server id as its key: a nonsense tombstone, no request, and a comment
// that stayed live for everybody else. The lint said "defined but never used"
// and it was right.
import {
  commentImageUri,
  deleteComment as deleteCommentOnServer,
  deleteImportedComment,
} from '@/community-comments';
import { isJoined } from '@/community-session';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { tapLight } from '@/haptics';
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
  /** The server's own id, for a comment this app posted. Null for imports,
   *  which are addressed by a hash of their content instead. */
  serverId?: string | null;
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

/** How long the first paint will wait for the server before showing what this
 *  phone already has. A ceiling, not a delay. */
const SETTLE_MS = 2500;

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
  /*
   * Scoped to ONE title, and not a member. Both halves matter: the unscoped
   * archive cannot know which show a new comment is about, and a member has
   * the title's own thread, which does replies and pictures this cannot.
   */
  const canWriteLocally = title != null && !isJoined();
  const [draft, setDraft] = useState('');
  /**
   * A PICTURE ON A NOTE NOBODY ELSE WILL SEE — YET.
   *
   * The archive is already full of comments with photographs: TV Time allowed
   * it, and OpenTV rescued those files onto the phone before that CDN died. So
   * a picture on your own comment is not a new idea here, it is the thing the
   * screen was built to display. What was missing was the ability to add one.
   *
   * COPIED INTO DOCUMENTS, exactly as every rescued TV Time photograph is, and
   * stored as a FILENAME rather than a URL. The picker's own uri lives in a
   * cache the system may empty, so keeping it would make the picture disappear
   * days later with nothing to explain it.
   */
  const [localImage, setLocalImage] = useState<{ uri: string; name: string } | null>(null);
  /* Words OR a picture. A captionless photograph is a comment TV Time allowed
     and the archive carries plenty; refusing one here would be this app being
     stricter about somebody's own notes than the service it replaces. */
  const canSendLocal = draft.trim().length > 0 || localImage != null;

  const pickLocalImage = async (): Promise<void> => {
    // The same guard `comment-attachment` uses: in a build without the native
    // module the picker is absent rather than broken, and saying so beats a
    // crash.
    if (!requireOptionalNativeModule('ExponentImagePicker')) {
      Alert.alert(t('import.buildNeededTitle'), t('editProfile.photoBuildNeededBody'));
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        // HEIC IS WHAT AN IPHONE STORES AND WHAT THE SERVER REFUSES. It matters
        // even here, where nothing uploads today: this file is meant to travel
        // the day its author joins and subscribes, and a picture that cannot be
        // sent then is a picture that was never really kept.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const type = a.mimeType ?? (a.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      const ext = type === 'image/gif' ? 'gif' : type === 'image/png' ? 'png' : 'jpg';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
      // The rowid does not exist yet, so the name is timestamped instead. It
      // only has to be unique and stable, not meaningful.
      const name = `local-comment-${Date.now()}.${ext}`;
      new File(a.uri).copy(new File(Paths.document, name));
      setLocalImage({ uri: new File(Paths.document, name).uri, name });
    } catch {
      Alert.alert(t('community.comments.uploadFailed'));
    }
  };

  const sendLocal = async (): Promise<void> => {
    const text = draft.trim();
    if (!canSendLocal || title == null) return;
    tapLight();
    // No serverId, deliberately and importantly: this comment is on no server,
    // and `addOwnComment` reads that as "still to be seeded". Passing one would
    // mark it published and it would never travel. See the note there.
    addOwnComment({ entity: title, text, date: new Date().toISOString(), image: localImage?.name ?? null, local: true });
    setDraft('');
    setLocalImage(null);
    // Same re-read the pull-to-refresh does — the list is read once on open, so
    // a new row is invisible until something asks again.
    setAll(getComments());
  };

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
  /*
   * ONE LIST, ONCE -- not the local rows and then a jump.
   *
   * This drew the archive immediately and merged the server's extra comments
   * when they arrived, so the newest of them landed at the TOP a second later
   * and shoved everything down under the reader's thumb. "It loads the normal
   * ones then appends the GIF" is exactly that, and it is worse than waiting.
   *
   * So the first paint waits -- but never for long, and never at all when
   * there is nothing to wait for. `SETTLE_MS` is a ceiling rather than a
   * delay: a phone with no signal shows its own archive after a moment
   * instead of a spinner that outlasts anybody's patience.
   */
  const [settling, setSettling] = useState(() => !seedLib && isJoined());
  useEffect(() => {
    if (seedLib) return;
    let cancelled = false;
    const done = (reread: boolean) => {
      if (cancelled) return;
      if (reread) setAll(getComments());
      setSettling(false);
    };
    const timer = setTimeout(() => done(false), SETTLE_MS);
    void syncOwnComments()
      .then((n) => {
        clearTimeout(timer);
        done(n > 0);
      })
      .catch(() => {
        clearTimeout(timer);
        done(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [seedLib]);
  const [deleted, setDeleted] = useState<Set<string>>(loadDeleted);
  const [refreshing, setRefreshing] = useState(false);
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
    /*
     * TWO KINDS OF COMMENT, TWO WAYS TO NAME ONE. A comment this app posted
     * has the server's own `c_…`, which no hash can reproduce, so it is deleted
     * by id. An imported one has no id anywhere; the server derives one from
     * what the comment IS. Getting this wrong is not a harmless silent failure
     * -- it removes the row from this phone and leaves the copy every other
     * person can read.
     *
     * IF WE DO NOT KNOW ITS ID, GO AND FIND OUT.
     *
     * A row written before the id was recorded falls back to naming the
     * comment by its content -- and `localCommentToSeed` returns nothing for a
     * comment with no words and no local picture, which is exactly what a
     * captionless photograph is. So the delete removed the row from this phone
     * and left the copy everybody else can read, silently.
     *
     * The sync knows every id: one pass backfills them, and the row is read
     * again before deciding. Slower, and only on the rows that need it.
     */
    if (!row.serverId && isJoined()) {
      void (async () => {
        try {
          await syncOwnComments();
        } catch {
          /* offline: fall through to the content path below */
        }
        const fresh = getComments().find((x) => commentKey(x) === key);
        if (fresh?.serverId) {
          try {
            await deleteCommentOnServer(fresh.serverId);
          } catch {
            /* already gone */
          }
          return;
        }
        const late = fresh ? localCommentToSeed(fresh, buildTargetResolver()) : null;
        if (late) void deleteImportedComment(late);
      })();
      return;
    }
    if (row.serverId) {
      // Already gone, or offline: the local row is tombstoned either way, and
      // an error here would confront somebody whose comment has, as far as
      // they can see, been deleted.
      void (async () => {
        try {
          await deleteCommentOnServer(row.serverId!);
        } catch {
          /* nothing to say */
        }
      })();
      return;
    }
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
          /*
           * OUR OWN ADDRESS IS USABLE; THE EXPORT'S IS NOT.
           *
           * `imageUrl` holds two unrelated things. From the TV Time export it
           * is a CloudFront link whose hostname no longer resolves -- using it
           * reserved a picture-shaped hole under every comment whose photo
           * never reached this phone. From the own-comment sync it is this
           * server's own address for a picture somebody has already approved,
           * which answers.
           *
           * Told apart by where it points, rather than by hoping.
           */
          const stored = c.imageUrl?.startsWith(API_BASE_URL) === true ? c.imageUrl : null;
          /*
           * A ROW THAT KNOWS ITS SERVER ID CAN BUILD THE ADDRESS ITSELF, and
           * that is one fewer column that has to be filled at the right moment
           * by the right code path. `imageUrl` is still honoured when it is
           * ours, for rows written before the id was recorded.
           *
           * The route serves ONLY an approved picture on a live comment and
           * 404s otherwise, so a comment with no picture asks once, gets
           * nothing, and draws nothing -- which is the same outcome as not
           * asking.
           */
          const ours = stored ?? (c.serverId ? commentImageUri(c.serverId) : null);
          const uri = seeded == null ? (documentFileUri(c.image) ?? ours) : null;
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
      {settling && <ActivityIndicator style={styles.settling} color={colors.dim} />}
      <CommentsList
        headerNote={title != null ? t('comments.archiveNote') : null}
        // "Write the first one" is only true where a composer exists. Every
        // other use of this list is read-only, so the default states the fact
        // and this screen adds the invitation when it can honour it.
        emptyText={canWriteLocally ? t('comments.emptyWritable') : undefined}
        items={items}
        refreshing={refreshing}
        onRefresh={() => {
          /*
           * The archive is read ONCE on open -- `getComments()` walks the whole
           * table, and doing that per render is its own problem at five
           * thousand rows. That made it silently stale: post a comment, come
           * back, and it is not there, with no way to ask again.
           *
           * Pull re-reads the table and asks the server for anything this phone
           * never stored, which is the same pair of steps the screen does when
           * it opens.
           */
          setRefreshing(true);
          void syncOwnComments()
            .catch(() => 0)
            .finally(() => {
              setAll(getComments());
              setDeleted(loadDeleted());
              setRefreshing(false);
            });
        }}
      />
      {/*
        * WRITING, FOR SOMEBODY WHO DECLINED THE COMMUNITY.
        *
        * The pencil that used to sit here did nothing — it predates the
        * community and was never given an onPress. It was removed with the
        * reasoning that this screen shows EVERY title at once, so a compose
        * button cannot know which show you mean. True, and it has a hole: the
        * screen ALSO opens scoped to one title (`?title=`), and there it knows
        * exactly.
        *
        * That hole was the whole of the bug. A member writes in the title's
        * thread — richer, with replies and pictures — so nothing is offered
        * here for them. A NON-member has no thread they may write in at all,
        * and this screen told them "write the first one" with nowhere to do
        * it. Comments predate the community and are private notes on a phone;
        * declining should not have taken the pen away.
        *
        * Local only. `addOwnComment` writes to SQLite and nothing else, which
        * is the whole point — this composer must not be the one thing on a
        * declined device that talks to a server.
        */}
      {canWriteLocally && (
        <View style={styles.localComposerWrap}>
          {/*
            * THE PICTURE, AND WHAT WILL HAPPEN TO IT.
            *
            * Same shape as the community composer's "waiting to be reviewed"
            * note, and for the same reason: a picture whose fate is unstated
            * gets reported as a bug. Here the fate is different — it is not
            * waiting for a moderator, it is on this phone and going nowhere,
            * and the day its author joins it needs Plus to travel. Saying so
            * at the moment of attaching beats saying it weeks later when the
            * upload silently does not happen.
            */}
          {localImage != null && (
            <View style={styles.attachRow}>
              <Image source={{ uri: localImage.uri }} style={styles.attachThumb} contentFit="cover" />
              <Text style={styles.attachNote} numberOfLines={3}>
                {t('comments.localImageNote')}
              </Text>
              <Pressable hitSlop={10} onPress={() => setLocalImage(null)}>
                <Ionicons name="close-circle" size={22} color={colors.dim} />
              </Pressable>
            </View>
          )}
        <View style={styles.localComposer}>
          <Pressable hitSlop={8} style={styles.localAttach} onPress={() => void pickLocalImage()}>
            <Ionicons
              name={localImage ? 'image' : 'image-outline'}
              size={19}
              color={localImage ? colors.yellow : colors.dim}
            />
          </Pressable>
          <TextInput
            style={styles.localInput}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('comments.writePlaceholder')}
            placeholderTextColor={colors.faint}
            multiline
          />
          <Pressable
            style={[styles.localSend, !canSendLocal && styles.localSendOff]}
            disabled={!canSendLocal}
            onPress={() => void sendLocal()}>
            <Ionicons
              name={I18nManager.isRTL ? 'arrow-back' : 'arrow-forward'}
              size={18}
              color={colors.onYellow}
            />
          </Pressable>
        </View>
        </View>
      )}

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
  settling: { paddingTop: 24 },
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
  localComposerWrap: { backgroundColor: colors.bg },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingTop: 10,
  },
  attachThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.card },
  attachNote: { flex: 1, color: colors.faint, fontSize: 12, lineHeight: 16 },
  localAttach: { paddingHorizontal: 2, paddingVertical: 8, justifyContent: 'center' },
  localComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
    backgroundColor: colors.bg,
  },
  localInput: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  localSend: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localSendOff: { opacity: 0.35 },
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
