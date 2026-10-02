/**
 * Adjusting the banner: drag to choose which part shows, pinch to zoom, and —
 * for a GIF, on Plus — make it tall so the whole (mostly square) GIF shows.
 *
 * The preview IS the banner: the same `BannerImage` and the same
 * `bannerHeight` the profile draws with, at full width, so what is set here is
 * exactly what the profile and every visitor see.
 *
 * Moving and zooming are everyone's (X does it for free); tall is Plus, like
 * the GIF itself. Artwork never goes tall: it is 16:9, and a near-square box
 * would cut its sides off.
 */
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appearanceChanged } from '@/community-appearance';
import { asProfileLayout, BannerImage } from '@/components/profile-template';
import { getMeta, setMeta } from '@/db';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { visibleCoverUri } from '@/library';
import { usePlus } from '@/plus';
import { bannerHeight, CENTRE_FRAME, coverFrameString, isGifCover, parseCoverFrame, type CoverFrame } from '@/pure';
import { colors, radius, space } from '@/theme';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function CoverAdjustScreen() {
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const plus = usePlus();
  const uri = visibleCoverUri(plus);
  const gif = isGifCover(uri);
  const layout = plus ? asProfileLayout(getMeta('profileThemeLayout')) : 'classic';
  const [frame, setFrame] = useState<CoverFrame>(() => parseCoverFrame(getMeta('coverFrame')));
  const tall = frame.tall && gif && plus;
  const H = insets.top + bannerHeight(layout, tall, gif, W);

  // Where the gesture started, so a drag moves from there rather than jumping.
  const start = useRef(frame);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => {
      start.current = frame;
    })
    .onUpdate((e) => {
      // Dragging the picture right shows more of its left, so the focal point
      // moves the other way; divided by the zoom so a zoomed picture moves
      // under the finger rather than racing ahead of it.
      setFrame((f) => ({
        ...f,
        x: clamp(start.current.x - e.translationX / (W * f.zoom), 0, 1),
        y: clamp(start.current.y - e.translationY / (H * f.zoom), 0, 1),
      }));
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onBegin(() => {
      start.current = frame;
    })
    .onUpdate((e) => {
      setFrame((f) => ({ ...f, zoom: clamp(start.current.zoom * e.scale, 1, 3) }));
    });

  const done = () => {
    tapLight();
    const saved: CoverFrame = { ...frame, tall };
    setMeta('coverFrame', coverFrameString(saved));
    appearanceChanged();
    router.back();
  };

  return (
    <View style={styles.screen}>
      <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
        <View style={{ width: W, height: H, backgroundColor: colors.card }}>
          {uri != null && <BannerImage uri={uri} frame={frame} />}
        </View>
      </GestureDetector>

      <View style={styles.body}>
        <Text style={styles.title}>{t('coverAdjust.title')}</Text>
        <Text style={styles.hint}>{t('coverAdjust.hint')}</Text>

        {gif && plus && (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('coverAdjust.tall')}</Text>
              <Text style={styles.rowSub}>{t('coverAdjust.tallSub')}</Text>
            </View>
            <Switch
              value={frame.tall}
              onValueChange={(v) => {
                tapSelection();
                setFrame((f) => ({ ...f, tall: v }));
              }}
              trackColor={{ true: colors.yellow }}
            />
          </View>
        )}

        <View style={[styles.buttons, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <Pressable
            style={styles.secondary}
            onPress={() => {
              tapSelection();
              setFrame((f) => ({ ...CENTRE_FRAME, tall: f.tall }));
            }}>
            <Text style={styles.secondaryText}>{t('coverAdjust.reset')}</Text>
          </Pressable>
          <Pressable style={styles.primary} onPress={done}>
            <Text style={styles.primaryText}>{t('common.done')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.xl },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  hint: { color: colors.dim, fontSize: 15, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: colors.dim, fontSize: 13.5, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: space.md, marginTop: 'auto' },
  secondary: { flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.raise },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  primary: { flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.yellow },
  primaryText: { color: colors.onYellow, fontWeight: '800', fontSize: 15 },
});
