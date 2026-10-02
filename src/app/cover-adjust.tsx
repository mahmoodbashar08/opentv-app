/**
 * Adjusting the banner: drag to choose which part shows, pinch to zoom, and —
 * on Plus — drag the handle on its edge to make it taller, or put the picture
 * behind the whole profile.
 *
 * A SEE-THROUGH LAYER OVER THE REAL PROFILE, not a preview of one: every
 * change goes to `setLiveCoverFrame` and the Profile tab underneath redraws
 * its own banner — name, picture, theme and widgets on top — so what is set
 * here is exactly what the profile and every visitor see. Cancel puts it back.
 *
 * Moving and zooming are everyone's (X does it for free); size and background
 * are Plus, like the GIF itself.
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
import { backdropImage, BANNER_MAX_SIZE, bannerGeometry, bannerHeight, CENTRE_FRAME, coverFrameString, parseCoverFrame, type CoverFrame } from '@/pure';
import { colors, radius, space } from '@/theme';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function CoverAdjustScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: winH } = useWindowDimensions();
  const plus = usePlus();
  const uri = visibleCoverUri(plus);
  const layout = plus ? asProfileLayout(getMeta('profileThemeLayout')) : 'classic';
  const [frame, setFrame] = useState<CoverFrame>(() => parseCoverFrame(getMeta('coverFrame')));
  // Size and background are Plus: without it the banner keeps its normal shape.
  const shaped: CoverFrame = plus ? frame : { ...frame, size: 0, bg: false };
  const H = insets.top + bannerHeight(layout, shaped.size, W);
  const normalH = insets.top + bannerHeight(layout, 0, W);
  // The picture's box: the banner, or the whole screen when it is the background.
  const boxFor = (f: CoverFrame) => ({ w: W, h: plus && f.bg ? winH : H });

  // The profile underneath draws this frame while the layer is open.
  useEffect(() => {
    setLiveCoverFrame(shaped);
  }, [shaped]);

  /*
   * THE HANDLE RESIZES. Dragging the yellow handle on the banner's edge down
   * makes the banner taller, up makes it shorter — the banner's own edge,
   * moved directly, instead of a switch between two heights (2 Oct). Never
   * shorter than normal (the name and picture are laid out for it), never
   * taller than `BANNER_MAX_SIZE` of the width.
   */
  const resize = Gesture.Pan()
    .runOnJS(true)
    .onChange((e) => {
      setFrame((f) => {
        const current = insets.top + bannerHeight(layout, f.size, W);
        const next = clamp(current + e.changeY, normalH, insets.top + BANNER_MAX_SIZE * W);
        return { ...f, size: next <= normalH + 1 ? 0 : (next - insets.top) / W };
      });
    });

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
        if (plus && f.bg) {
          // FLOWING UNDER THE PAGE: sideways where it is wider than the
          // screen, up and down where it is taller than the banner.
          const b = backdropImage(W, H, ratio, f.zoom, f.x, f.y);
          return {
            ...f,
            x: b.slackX > 1 ? clamp(f.x - e.changeX / b.slackX, 0, 1) : f.x,
            y: b.slackY > 1 ? clamp(f.y - e.changeY / b.slackY, 0, 1) : f.y,
          };
        }
        let zoom = f.zoom;
        let g = bannerGeometry(boxFor(f), ratio, zoom);
        // NO ROOM THAT WAY? MAKE SOME. A picture exactly as tall as the banner
        // cannot move up or down, and a drag that does nothing reads as
        // broken (2 Oct: a wide GIF, dragged up and down, "not working at
        // all"). So the first drag along a locked axis zooms in until that
        // axis has a quarter of the banner to move in, then follows the finger.
        const lockedY = g.yMax - g.yMin < 0.02 && Math.abs(e.changeY) > Math.abs(e.changeX);
        const lockedX = g.xMax - g.xMin < 0.02 && Math.abs(e.changeX) > Math.abs(e.changeY);
        if (lockedY) zoom = clamp((boxFor(f).h * 1.25) / g.baseH, zoom, 3);
        if (lockedX) zoom = clamp((W * 1.25) / g.baseW, zoom, 3);
        if (zoom !== f.zoom) g = bannerGeometry(boxFor(f), ratio, zoom);
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
        if (plus && f.bg) return { ...f, zoom };
        const g = bannerGeometry(boxFor(f), liveCoverRatio(), zoom);
        // Zooming out can leave the point past the new edges; pull it back.
        return { ...f, zoom, x: clamp(f.x, g.xMin, g.xMax), y: clamp(f.y, g.yMin, g.yMax) };
      });
    });

  const done = () => {
    tapLight();
    setMeta('coverFrame', coverFrameString(shaped));
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
        </View>
      </GestureDetector>
      {/* The handle on the banner's edge: drag it down for a taller banner
          (Plus). Outside the move area, so it never fights the picture drag. */}
      {plus && (
        <GestureDetector gesture={resize}>
          <View style={[styles.handle, { top: H - 26 }]} hitSlop={16}>
            <Ionicons name="swap-vertical" size={24} color={colors.onYellow} />
          </View>
        </GestureDetector>
      )}

      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Text style={styles.title}>{t('coverAdjust.title')}</Text>
        {uri == null && <Text style={styles.rowSub}>{t('editProfile.chooseCover')}</Text>}

        {plus && (
          <>
            <Text style={styles.rowSub}>{t('coverAdjust.resizeHint')}</Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t('coverAdjust.background')}</Text>
                <Text style={styles.rowSub}>{t('coverAdjust.backgroundSub')}</Text>
              </View>
              <Switch
                value={frame.bg}
                onValueChange={(v) => {
                  tapSelection();
                  setFrame((f) => ({ ...f, bg: v }));
                }}
                trackColor={{ true: colors.yellow }}
              />
            </View>
          </>
        )}

        <View style={styles.buttons}>
          <Pressable style={styles.secondary} onPress={cancel}>
            <Text style={styles.secondaryText}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={() => {
              tapSelection();
              setFrame(CENTRE_FRAME);
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
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
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
