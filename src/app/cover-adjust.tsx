/**
 * Adjusting the banner: drag to choose which part shows, pinch to zoom, and —
 * for a GIF, on Plus — make it tall so the whole (mostly square) GIF shows.
 *
 * A SEE-THROUGH LAYER OVER THE REAL PROFILE, not a preview of one: every
 * change goes to `setLiveCoverFrame` and the Profile tab underneath redraws
 * its own banner — name, picture, theme and widgets on top — so what is set
 * here is exactly what the profile and every visitor see. Cancel puts it back.
 *
 * Moving and zooming are everyone's (X does it for free); tall is Plus, like
 * the GIF itself. Artwork never goes tall: it is 16:9, and a near-square box
 * would cut its sides off.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appearanceChanged } from '@/community-appearance';
import { asProfileLayout } from '@/components/profile-template';
import { liveCoverRatio, setLiveCoverFrame } from '@/cover-frame-live';
import { getMeta, setMeta } from '@/db';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { visibleCoverUri } from '@/library';
import { usePlus } from '@/plus';
import { bannerGeometry, bannerHeight, CENTRE_FRAME, coverFrameString, isGifCover, parseCoverFrame, type CoverFrame } from '@/pure';
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

  // The profile underneath draws this frame while the layer is open.
  useEffect(() => {
    setLiveCoverFrame({ ...frame, tall });
  }, [frame, tall]);

  const cancel = () => {
    setLiveCoverFrame(null);
    router.back();
  };

  // Where the gesture started, so a drag moves from there rather than jumping.
  // STEP BY STEP, not "since the start": each event moves the frame by its
  // own small change, so nothing has to remember where the gesture began.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onChange((e) => {
      // EXACTLY WITH THE FINGER: n points of drag move the picture n points,
      // so the focal point moves n / (picture size), and stops at the
      // picture's edges instead of counting on past them (2 Oct).
      setFrame((f) => {
        const ratio = liveCoverRatio();
        let zoom = f.zoom;
        let g = bannerGeometry({ w: W, h: H }, ratio, zoom);
        // NO ROOM THAT WAY? MAKE SOME. A picture exactly as tall as the banner
        // cannot move up or down, and a drag that does nothing reads as
        // broken (2 Oct: a wide GIF, dragged up and down, "not working at
        // all"). So the first drag along a locked axis zooms in until that
        // axis has a quarter of the banner to move in, then follows the finger.
        const lockedY = g.yMax - g.yMin < 0.02 && Math.abs(e.changeY) > Math.abs(e.changeX);
        const lockedX = g.xMax - g.xMin < 0.02 && Math.abs(e.changeX) > Math.abs(e.changeY);
        if (lockedY) zoom = clamp((H * 1.25) / g.baseH, zoom, 3);
        if (lockedX) zoom = clamp((W * 1.25) / g.baseW, zoom, 3);
        if (zoom !== f.zoom) g = bannerGeometry({ w: W, h: H }, ratio, zoom);
        return {
          ...f,
          zoom,
          x: clamp(f.x - e.changeX / g.w, g.xMin, g.xMax),
          y: clamp(f.y - e.changeY / g.h, g.yMin, g.yMax),
        };
      });
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onChange((e) => {
      setFrame((f) => {
        const zoom = clamp(f.zoom * e.scaleChange, 1, 3);
        const g = bannerGeometry({ w: W, h: H }, liveCoverRatio(), zoom);
        // Zooming out can leave the point past the new edges; pull it back.
        return { ...f, zoom, x: clamp(f.x, g.xMin, g.xMax), y: clamp(f.y, g.yMin, g.yMax) };
      });
    });

  const done = () => {
    tapLight();
    const saved: CoverFrame = { ...frame, tall };
    setMeta('coverFrame', coverFrameString(saved));
    appearanceChanged();
    router.back();
    // Held until the profile has re-read the saved frame on focus, so the
    // banner does not flick back to the old one for a moment.
    setTimeout(() => setLiveCoverFrame(null), 600);
  };

  return (
    <View style={styles.screen}>
      {/* The banner area of the profile below: transparent, it only catches
          the fingers. A thin outline says where the banner ends. */}
      <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
        <View style={[styles.catcher, { height: H }]}>
          <View style={[styles.hintPill, { top: insets.top + 8 }]}>
            <Text style={styles.hintText}>{t('coverAdjust.hint')}</Text>
          </View>
          {/* The handle on the line: what is draggable, said without words. */}
          <View style={styles.handle} pointerEvents="none">
            <Ionicons name="move" size={22} color={colors.onYellow} />
          </View>
        </View>
      </GestureDetector>

      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Text style={styles.title}>{t('coverAdjust.title')}</Text>
        {uri == null && <Text style={styles.rowSub}>{t('editProfile.chooseCover')}</Text>}

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

        <View style={styles.buttons}>
          <Pressable style={styles.secondary} onPress={cancel}>
            <Text style={styles.secondaryText}>{t('common.cancel')}</Text>
          </Pressable>
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
  screen: { flex: 1, backgroundColor: 'transparent' },
  catcher: { width: '100%', borderBottomWidth: 2, borderColor: colors.yellow, borderStyle: 'dashed' },
  hintPill: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  hintText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  handle: {
    position: 'absolute',
    bottom: -22,
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  panel: {
    marginTop: 'auto',
    backgroundColor: colors.panel,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    gap: space.md,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: colors.dim, fontSize: 13.5, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  secondary: { flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.raise },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  primary: { flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.yellow },
  primaryText: { color: colors.onYellow, fontWeight: '800', fontSize: 15 },
});
