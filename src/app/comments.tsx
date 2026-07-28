import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Image,
  type ImageSourcePropType,
  Pressable,
  FlatList,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import seed from '@/seed';
import db, { getComments, getMeta, getMovie, setMeta } from '@/db';
import { documentFileUri, isSeedLibrary } from '@/library';
import { colors, radius, space } from '@/theme';

// one shape for both sources: bundled seed comments and imported db rows
type Comment = {
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
// sized for the previous orientation.
const cardInnerWidth = (w: number) => w - 2 * 12 - 2 * 15;
function imageBox(ratio: number, cardInner: number): { width: number; height: number } {
  const width = Math.round(cardInner * (ratio < 1 ? 0.55 : 0.7));
  const height = Math.round(Math.min(width / ratio, 360));
  return { width, height };
}

/** "Toy Story 5" → the movie page; "Attack on Titan S4E28" → the show page. */
function openEntity(entity: string): void {
  const bare = entity.replace(/\s+S\d+(E\d+)?$/i, '').trim();
  const show = db.getFirstSync<{ tvdbId: number }>('SELECT tvdbId FROM shows WHERE LOWER(name) = ?', [bare.toLowerCase()]);
  if (show) {
    router.push(`/show/${show.tvdbId}`);
    return;
  }
  if (getMovie(bare)) router.push(`/movie/${encodeURIComponent(bare)}`);
}

function commentKey(c: { entity: string; date: string; text: string }): string {
  return `${c.entity}|${c.date}|${c.text.slice(0, 40)}`;
}

function loadDeleted(): Set<string> {
  try {
    return new Set(JSON.parse(getMeta('deletedComments') ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

type Sheet = { kind: 'own' | 'share'; key: string; text: string; entity: string } | null;

export default function CommentsScreen() {
  const CARD_INNER = cardInnerWidth(useWindowDimensions().width);
  const { title } = useLocalSearchParams<{ title?: string }>();
  const username = getMeta('username') ?? seed.profile.username;
  const seedLib = isSeedLibrary();
  // read once. getComments() reads the whole table, and at 5,000 comments
  // doing that on every render is its own performance problem.
  const [all] = useState<Comment[]>(() => (seedLib ? seed.comments : getComments()));
  const [deleted, setDeleted] = useState<Set<string>>(loadDeleted);
  const [sheet, setSheet] = useState<Sheet>(null);

  // with a title we show ONLY that show/movie's comments — no fallback to all
  const shown = (
    title ? all.filter((c) => c.entity.toLowerCase().includes(String(title).toLowerCase())) : all
  ).filter((c) => !deleted.has(commentKey(c)));

  const deleteComment = (key: string) => {
    const next = new Set(deleted);
    next.add(key);
    setDeleted(next);
    try {
      setMeta('deletedComments', JSON.stringify([...next]));
    } catch {}
    setSheet(null);
  };

  const shareComment = (text: string, entity: string) => {
    setSheet(null);
    Share.share({ message: `${entity}: ${text || '📷'} — via OpenTV` }).catch(() => {});
  };

  return (
    <Screen>
      <NavHeader title={title ?? 'Comments'} />
      <View style={styles.sortRow}>
        <Text style={styles.sortLabel}>
          SORT BY <Text style={{ color: colors.blue }}>Most recent</Text>
        </Text>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(c) => commentKey(c)}
        contentContainerStyle={{ paddingBottom: 100 }}
        // a library can hold thousands of comments, many with GIFs — mounting
        // them all is what used to lock the screen up. These keep the mounted
        // window small without the list feeling like it is loading.
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          title != null ? (
            <View style={styles.soonCard}>
              <Text style={styles.soonBadge}>COMING SOON</Text>
              <Text style={styles.soonText}>
                Community comments arrive with accounts — for now these are your own comments only.
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>💬</Text>
            <Text style={styles.emptyText}>No comments here yet — write the first one.</Text>
          </View>
        }
        renderItem={({ item: c }) => {
          const key = commentKey(c);
          return (

            <View key={key} style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {seedLib ? (
                  <Image source={AVATAR} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: colors.yellow, fontWeight: '800' }}>{username[0]?.toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{username}</Text>
                  <Text style={{ color: colors.faint, fontSize: 12.5 }}>{formatDate(c.date)}</Text>
                </View>
                <Pressable hitSlop={10} onPress={() => setSheet({ kind: 'own', key, text: c.text, entity: c.entity })}>
                  <Ionicons name="ellipsis-horizontal" size={17} color={colors.dim} />
                </Pressable>
              </View>

              <Pressable style={styles.entityPill} onPress={() => openEntity(c.entity)}>
                <Text style={styles.entityText}>{c.entity.toUpperCase()} ›</Text>
              </Pressable>

              {c.type === 'reply' && (
                <View style={styles.replyNote}>
                  <Ionicons name="arrow-undo-outline" size={13} color={colors.dim} />
                  <Text style={styles.replyNoteText}>
                    Your reply — the original comment wasn&apos;t in your TV Time export
                  </Text>
                </View>
              )}

              {c.text !== '' && <Text style={styles.body}>{c.text}</Text>}

              {c.image != null && IMAGES[c.image] != null ? (
                <Image
                  source={IMAGES[c.image].src}
                  style={[styles.image, imageBox(IMAGES[c.image].ratio, CARD_INNER)]}
                  resizeMode="cover"
                />
              ) : (
                (() => {
                  // imported photo: the downloaded copy, else the original link
                  const uri = documentFileUri(c.image) ?? c.imageUrl ?? null;
                  return uri ? (
                    <Image source={{ uri }} style={[styles.image, imageBox(c.ratio || 4 / 3, CARD_INNER)]} resizeMode="cover" />
                  ) : null;
                })()
              )}

              <View style={styles.actions}>
                <View style={styles.action}>
                  <Ionicons name="heart-outline" size={22} color="#C9C9CF" />
                  <Text style={styles.actionCount}>{c.likes}</Text>
                </View>
                <View style={styles.action}>
                  <Ionicons name="chatbubble-outline" size={20} color="#C9C9CF" />
                  <Text style={styles.actionCount}>{c.replies}</Text>
                </View>
                <Pressable
                  hitSlop={10}
                  style={{ marginLeft: 'auto' }}
                  onPress={() => setSheet({ kind: 'share', key, text: c.text, entity: c.entity })}>
                  <Ionicons name="share-outline" size={20} color="#C9C9CF" />
                </Pressable>
              </View>
            </View>
          );
        }}
      />
      <Pressable style={styles.fab}>
        <Ionicons name="pencil" size={22} color={colors.onYellow} />
      </Pressable>

      {/* own-comment / share sheets, like the real app */}
      {sheet && (
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)}>
          <View style={styles.sheet}>
            {sheet.kind === 'own' ? (
              <Pressable style={[styles.sheetRow, { borderBottomWidth: 0 }]} onPress={() => deleteComment(sheet.key)}>
                <Ionicons name="trash-outline" size={20} color={colors.text} />
                <Text style={styles.sheetLabel}>Delete comment</Text>
              </Pressable>
            ) : (
              <>
                <Text style={styles.sheetTitle}>Share</Text>
                <Pressable style={styles.sheetRow} onPress={() => shareComment(sheet.text, sheet.entity)}>
                  <Ionicons name="link-outline" size={20} color={colors.text} />
                  <Text style={styles.sheetLabel}>Copy link</Text>
                </Pressable>
                <Pressable
                  style={styles.sheetRow}
                  onPress={() => {
                    setSheet(null);
                    Alert.alert('Save image', 'Saving to your photo library arrives in a future build.');
                  }}>
                  <Ionicons name="download-outline" size={20} color={colors.text} />
                  <Text style={styles.sheetLabel}>Save image</Text>
                </Pressable>
                <Pressable
                  style={[styles.sheetRow, { borderBottomWidth: 0 }]}
                  onPress={() => shareComment(sheet.text, sheet.entity)}>
                  <Text style={styles.sheetLabel}>More…</Text>
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
    right: 18,
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
