/**
 * One list, drawn as a band of its first few posters with the name across it.
 *
 * SHARED BY YOUR LISTS AND SOMEBODY ELSE'S. The two screens looked alike by
 * coincidence and drifted apart the moment either changed: yours was a wall of
 * posters, a stranger's was a numbered list of words. One component, and the
 * differences become props — a visitor gets no ⋯ menu and no destination of
 * their own, because there is nothing for them to rename, reorder or delete.
 *
 * EVERY BAND IS THE SAME HEIGHT. Tiles are `aspectRatio: 2/3`, so a band is
 * `tileWidth * 1.5`, and an EMPTY list is padded to match rather than
 * collapsing. Height came only from the tiles once, so a list made a moment ago
 * drew a row of zero height — on screen, in the database, and impossible to see
 * or tap, which reads exactly like "creating a list does nothing". It also
 * matters for the drag: uniform slots are what make a drop target computable.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Poster } from '@/components/poster';
import { t } from '@/i18n';
import { colors, radius } from '@/theme';

export type CollageList = {
  name: string;
  /** Only ever true on your own: a visitor never sees a hidden list at all. */
  hidden?: boolean;
  items?: readonly { name: string; poster: string | null }[];
};

/** The height of every band. Exported because the drag needs the slot size. */
export const collageHeight = (tileW: number): number => Math.round(tileW * 1.5);

export function ListCollage({
  list,
  cols,
  tileW,
  onPress,
  onMenu,
}: {
  list: CollageList;
  cols: number;
  tileW: number;
  onPress?: () => void;
  /** The ⋯ button. Omitted for somebody else's list, and while rearranging —
   *  a drag handle and a menu in the same corner is a coin toss. */
  onMenu?: () => void;
}) {
  const covers = (list.items ?? []).slice(0, cols);
  const empty = covers.length === 0;

  return (
    <Pressable
      style={[styles.collage, empty && styles.collageEmpty, { height: collageHeight(tileW) }]}
      disabled={onPress == null}
      onPress={onPress}>
      {covers.map((it, k) => (
        <View key={`${it.name}-${k}`} style={{ width: tileW }}>
          <Poster name={it.name} uri={it.poster} />
        </View>
      ))}
      {/* dim the artwork so the name pops — skipped with no artwork, where it
          would only make the name harder to read */}
      {!empty && <View style={styles.collageDim} pointerEvents="none" />}
      <Text style={styles.collageName}>{list.name}</Text>
      {/* A SWITCH NOBODY CAN SEE IS A SWITCH NOBODY TRUSTS. "Hide from profile"
          only shows its effect on somebody else's screen, so it says so here. */}
      {list.hidden === true && (
        <View style={styles.hiddenBadge}>
          <Ionicons name="lock-closed" size={11} color={colors.text} />
          <Text style={styles.hiddenBadgeText}>{t('listsIndex.hiddenBadge')}</Text>
        </View>
      )}
      {onMenu != null && (
        <Pressable
          style={styles.dots}
          hitSlop={12}
          onPress={(e) => {
            e.stopPropagation();
            onMenu();
          }}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  collage: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: 12,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  collageDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' },
  collageEmpty: { backgroundColor: colors.panel, justifyContent: 'flex-end' },
  collageName: {
    position: 'absolute',
    start: 14,
    bottom: 12,
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 10,
  },
  hiddenBadge: {
    position: 'absolute',
    start: 14,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hiddenBadgeText: { color: colors.text, fontSize: 10.5, fontWeight: '700' },
  dots: {
    position: 'absolute',
    top: 10,
    end: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
