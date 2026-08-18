/**
 * Everything a profile can hold, offered.
 *
 * IT USED TO LIST ONLY WHAT HAD BEEN REMOVED, and a full profile therefore
 * opened a sheet that said "nothing to add". True of a one-of-each model, and a
 * useless answer: somebody who wants a second Photo, or the same square twice,
 * was told the feature does not exist. A profile may now hold as many of a
 * widget as it likes — the way a home screen may hold two clocks — so the only
 * things that leave this list are the page's own furniture once placed. There
 * is one Banner, one Bio, one of each shelf.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WidgetBox, renderWidget } from '@/components/profile-widgets';
import { previewSlot } from '@/components/widget-previews';
import { CONTENT_MAX_WIDTH, gridMetrics } from '@/components/ui';
import db, { getProfileLayout, setProfileLayout } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import {
  WIDGET_NAME,
  alreadyPlaced,
  availableToAdd,
  newUid,
  normalise,
  notifyLayoutSaved,
  parseLayout,
  serialise,
  specOf,
  type Placed,
  type WidgetSpan,
} from '@/profile-layout';
import { colors, radius, space } from '@/theme';

/** The shelf keys the Profile tab passes. They must match it exactly, or a
 *  shelf offered here is an id that screen has never heard of — `normalise`
 *  drops it on the next render and the add silently does nothing. */
function shelfKeys(): string[] {
  const one = (sql: string): number => db.getFirstSync<{ n: number }>(sql)?.n ?? 0;
  const keys: string[] = [];
  if (one('SELECT COUNT(*) AS n FROM shows') > 0) keys.push('shows');
  if (one('SELECT COUNT(*) AS n FROM shows WHERE favorited = 1') > 0) keys.push('fav-shows');
  if (one('SELECT COUNT(*) AS n FROM movies') > 0) keys.push('movies');
  if (one('SELECT COUNT(*) AS n FROM movies WHERE favorited = 1') > 0) keys.push('fav-movies');
  return keys;
}


const ICONS: Record<string, string> = {
  since: 'calendar-outline',
  character: 'person-outline',
  streak: 'flame-outline',
  genre: 'pricetag-outline',
  thisYear: 'today-outline',
  binge: 'timer-outline',
  primeTime: 'moon-outline',
  finished: 'checkmark-done-outline',
  rated: 'star-outline',
  firstEver: 'play-outline',
  watchlist: 'bookmark-outline',
  emotions: 'happy-outline',
  topRated: 'trophy-outline',
  nowWatching: 'tv-outline',
  artwork: 'image-outline',
  gif: 'film-outline',
};

/** As much of the screen as a bottom sheet can take without becoming a page. */
const SHEET_MAX = Dimensions.get('window').height * 0.62;

export default function AddWidgetSheet() {
  const W = Math.min(Dimensions.get('window').width, CONTENT_MAX_WIDTH);
  const keys = useMemo(() => shelfKeys(), []);
  const [layout, setLayout] = useState<Placed[]>(() => normalise(parseLayout(getProfileLayout()), keys));
  /** The widget being previewed, over the list rather than instead of it. */
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  /*
   * THE PROFILE'S OWN ORDER.
   *
   * This briefly sorted by what was missing, on the theory that people come
   * here for the widget they do not have. That gave the list a different order
   * every time it opened, depending on what was on the profile -- so the row
   * somebody reached for last time was somewhere else, and the sheet could not
   * be learned.
   *
   * It reads in the default arrangement's order instead: the page's own
   * furniture first -- banner, bio, counts, activity, stats -- then the
   * widgets, then the shelves, exactly as they sit on an untouched profile. A
   * fixed order can be remembered; a helpful one cannot.
   */
  const rows = availableToAdd(layout, keys);

  const commit = (next: Placed[]) => {
    setLayout(next);
    // `serialise`, not `JSON.stringify`: it carries forward the record of
    // every widget this profile has ever held, which is what stops a removed
    // one being mistaken for a new one and re-appended. See `normalise`.
    setProfileLayout(serialise(next, getProfileLayout()));
    // TELL THE TAB. This sheet is a transparentModal, so the profile underneath
    // was never blurred and its focus effect will not re-fire on the way back —
    // without this the new widget is in SQLite and nowhere on screen.
    notifyLayoutSaved();
    // Straight back to the grid: adding one widget is the common case, and
    // making people find Close afterwards is a tap that buys nothing.
    router.back();
  };

  /**
   * Back to the arrangement nobody chose.
   *
   * CLEARS the stored value rather than writing the default one out. They are
   * the same page today, but a profile that has never been arranged should stay
   * that way -- so a later release that adds a widget delivers it here as it
   * would to anybody else. Writing the default out would freeze this profile
   * against the version that happened to reset it.
   */
  const reset = () => {
    Alert.alert(t('editLayout.resetTitle'), t('editLayout.resetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('editLayout.reset'),
        style: 'destructive',
        onPress: () => {
          tapLight();
          setProfileLayout(null);
          setLayout(normalise(null, keys));
          notifyLayoutSaved();
          router.back();
        },
      },
    ]);
  };

  /**
   * EVERY WIDGET GOES THROUGH ITS PREVIEW.
   *
   * Not only the resizable ones. Seeing the thing before it lands on the
   * profile is worth as much for a widget with one size as for one with three,
   * and a list where some rows add instantly and others open a screen is a list
   * nobody can predict. Poster is the exception, and only because it cannot be
   * previewed until it has a picture -- that IS its first step.
   */
  const add = (id: string) => {
    tapLight();
    /*
     * THE PREVIEW IS NOT A SCREEN. It was, twice: pushed, where a transparent
     * modal keeps drawing over whatever is above it, and then replaced, which
     * threw the list away so closing the preview could not come back to it.
     * Both were navigation solving something that is not navigation — the
     * preview belongs to this sheet, sits over it, and closing it returns here.
     */
    /*
     * EVERY WIDGET GOES THROUGH ITS PREVIEW, including the ones with a single
     * size. Seeing the thing before it lands on the profile is the point, and
     * it is worth as much for a widget that can only be one shape as for one
     * that can be three -- a list where some rows open a preview and others
     * silently add is a list nobody can predict.
     */
    setPreviewing(id);
  };

  /**
   * The widget itself, at the size being looked at.
   *
   * WRAPPED IN A BOX WITH AN EXPLICIT HEIGHT, which is not decoration. Every
   * widget's own container is `flex: 1` plus a height, and `flex: 1` means
   * `flexBasis: 0` — which BEATS the height whenever the parent's own height is
   * auto. On the profile that never showed, because a block there is absolutely
   * positioned with a height; here the parent was content-sized, the basis won,
   * and every preview collapsed to a black sliver.
   */
  const stage = (id: string, sp: WidgetSpan) => {
    const m = gridMetrics(W);
    /*
     * NOT EVERYTHING CAN BE DRAWN HERE.
     *
     * The widgets are drawn by `renderWidget`, which this sheet can call. The
     * page's own sections -- the heatmap, Lists, Stats, the shelves -- are built
     * by the Profile screen and handed to the template as slots, because they
     * need that screen's data and its navigation. There is nothing this sheet
     * could call to produce one.
     *
     * So they get a card of the right SIZE with their name in it. That is not a
     * preview of the content and does not pretend to be -- but the pager's
     * question is "how big", and an outline answers it honestly. A blank
     * rectangle answered nothing at all.
     */
    /*
     * ONE LANGUAGE FOR BOTH KINDS.
     *
     * The widgets arrive already dressed — `renderWidget` draws the card, the
     * label, the size. The profile's sections arrive as bare content, because
     * on the profile they are not cards. Shown side by side in the same pager
     * that read as two different screens: Top genre was a widget, Movies was a
     * pile of posters. So a section's content is put in the same `WidgetBox`
     * the widgets wear, with the same label, at the same size — the preview's
     * promise is "this shape, this big", and now every page keeps it the same
     * way.
     */
    const w = sp === '1x1' ? m.col : m.block;
    const slot = previewSlot(id, sp, w - 24);
    const live =
      renderWidget(id, sp, true) ??
      (slot != null ? (
        <WidgetBox label={WIDGET_NAME[id] ? t(WIDGET_NAME[id] as never) : id} span={sp} hug>
          {slot}
        </WidgetBox>
      ) : null);
    return (
      /* A fifth again taller than the widget it holds, so the thing being
         judged has air round it instead of touching the dots. */
      <View
        style={{ width: W, height: m.height(2) * 1.2, alignItems: 'center', justifyContent: 'center' }}
        pointerEvents="none">
        <View style={{ width: sp === '1x1' ? m.col : m.block, height: m.height(sp === '2x2' ? 2 : 1) }}>
          {live ?? (
            <View style={s.outline}>
              <Ionicons name={(ICONS[id] ?? 'apps-outline') as never} size={26} color={colors.faint} />
              <Text style={s.outlineText} numberOfLines={2}>
                {WIDGET_NAME[id] ? t(WIDGET_NAME[id] as never) : id}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const spans = previewing ? specOf(previewing).spans : [];
  const chosen: WidgetSpan = spans[Math.min(page, spans.length - 1)] ?? '1x1';

  const confirm = () => {
    if (!previewing) return;
    tapLight();
    /*
     * POSTER PICKS ITS SIZE FIRST, ITS PICTURE SECOND.
     *
     * It used to jump straight to the library, which meant choosing an image
     * and only then discovering what shape it would be — and the shape is most
     * of the decision for a widget that is nothing but a picture. The size is
     * carried to the picker, which creates the widget once there is something
     * to put in it. Backing out of the picker still leaves no empty widget
     * behind.
     */
    if (previewing === 'artwork') {
      router.replace(`/pick-artwork?span=${chosen}`);
      return;
    }
    if (previewing === 'gif') {
      router.replace(`/pick-gif?span=${chosen}`);
      return;
    }
    // Same reason as the two above: a links widget with no links is an empty
    // box, so the editor creates it once there is something in it. Backing out
    // leaves nothing behind.
    if (previewing === 'links') {
      router.replace(`/edit-links?span=${chosen}`);
      return;
    }
    commit([...layout, { uid: newUid(previewing), id: previewing, span: chosen }]);
  };

  return (
    /*
     * NO `Pressable` ANYWHERE ABOVE THE PAGER.
     *
     * This was the root of the sheet, and disabling its `onPress` while a
     * preview was open did not help: `Pressable` attaches responder handlers
     * regardless and claims the touch the instant a finger lands, so the
     * horizontal ScrollView two levels down never saw a move. Every previous
     * attempt fixed the tap-through and left the swipe dead, or the reverse.
     *
     * The dismiss is a LAYER now, not an ancestor: a Pressable filling the
     * space above the sheet. Tapping there closes, tapping the sheet does
     * nothing because nothing there wants the touch, and the pager owns its own
     * gesture because there is no longer anybody above it to take it first.
     */
    <View style={s.backdrop}>
      <Pressable style={{ flex: 1 }} onPress={() => router.back()} />

      <View style={s.sheet}>
        <View style={s.head}>
          <Text style={s.title}>{t('editLayout.add')}</Text>
          {/* HERE RATHER THAN ON THE GRID. Reset is wanted once, after an
              experiment somebody did not like, and the moment they want it is
              the moment they are already looking for a way to change what is on
              the profile. A permanent button on the page would cost every visit
              to serve that one occasion. */}
          <Pressable hitSlop={10} onPress={reset}>
            <Text style={s.reset}>{t('editLayout.reset')}</Text>
          </Pressable>
        </View>
        {rows.length === 0 ? (
          <Text style={s.empty}>{t('editLayout.nothingToAdd')}</Text>
        ) : (
          /* Tall. A short sheet over a stripped profile left a slab of empty
             page above it, and the void read as the app being broken rather
             than as a profile with nothing on it yet. */
          <ScrollView style={{ maxHeight: SHEET_MAX }}>
            {rows.map((id) => {
              // Only the banner and the bio; everything else may be repeated.
              const placed = alreadyPlaced(id, layout);
              return (
                <View key={id}>
                  <Pressable style={s.row} disabled={placed} onPress={() => add(id)}>
                    <Ionicons
                      name={(ICONS[id] ?? 'apps-outline') as never}
                      size={20}
                      color={placed ? colors.faint : colors.text}
                    />
                    <Text style={[s.label, placed && { color: colors.faint }]} numberOfLines={1}>
                      {WIDGET_NAME[id] ? t(WIDGET_NAME[id] as never) : id}
                    </Text>
                    {/* A tick rather than a missing row: somebody looking for
                        the banner needs to be told it is already there, not
                        left wondering where the feature went. */}
                    {placed && <Ionicons name="checkmark" size={18} color={colors.faint} />}
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* OVER THE LIST, NOT INSTEAD OF IT. Smaller than the sheet beneath, so
          the thing it came from is still visible behind — which is what makes
          the X obviously a way back rather than a way out. */}
      {previewing != null && (
        /*
         * THE PAGER MUST NOT HAVE A `Pressable` ABOVE IT.
         *
         * Dismiss-on-tap-outside was a Pressable wrapping everything, with a
         * second one round the sheet to swallow the tap. A Pressable claims the
         * responder the moment a finger lands, so the horizontal ScrollView
         * inside never got the chance to take it over -- which is why swiping
         * did nothing. The backdrop is now its own layer BEHIND the sheet and
         * the sheet is a plain View: tapping outside still closes, and the
         * pager gets the gesture it needs.
         */
        <View style={s.previewBack}>
          {/* THE BACKDROP IS ONLY THE PART ABOVE THE SHEET.
              It was an absolute fill sitting behind everything, and a plain
              View does not claim a touch -- so a tap anywhere INSIDE the sheet
              fell straight through to it and closed the thing being looked at.
              Given the space above instead, it can only be hit where there is
              nothing else. */}
          <Pressable style={{ flex: 1 }} onPress={() => setPreviewing(null)} />
          <View style={s.preview}>
            <View style={s.previewHead}>
              <Text style={s.previewTitle} numberOfLines={1}>
                {WIDGET_NAME[previewing] ? t(WIDGET_NAME[previewing] as never) : previewing}
              </Text>
              <Pressable
                hitSlop={12}
                onPress={() => {
                  setPreviewing(null);
                  setPage(0);
                }}>
                <Ionicons name="close" size={24} color={colors.dim} />
              </Pressable>
            </View>

            <ScrollView
              horizontal
              /* SNAP TO THE PAGE WIDTH, not the scroll view's. `pagingEnabled`
                 snaps to the VIEW's width, which is the sheet's; the pages are
                 a screen wide. The two disagreed, so it settled between them or
                 refused to move at all. */
              snapToInterval={W}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}
              onScrollEndDrag={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}
              style={{ marginHorizontal: -space.xl }}>
              {spans.map((sp) => (
                <View key={sp}>{stage(previewing, sp)}</View>
              ))}
            </ScrollView>

            {/* ALWAYS, even when there is one. A lone dot says nothing by
                itself — but every other preview has a row of dots there, and
                the widget with one size losing them made it look like a
                different kind of screen rather than the same screen with fewer
                pages. Consistency is the information. */}
            <View style={s.dots}>
              {spans.map((sp, i) => (
                <View key={sp} style={[s.dot, i === page && s.dotOn]} />
              ))}
            </View>

            <Pressable style={s.confirm} onPress={confirm}>
              <Ionicons name="add-circle" size={20} color={colors.onYellow} />
              <Text style={s.confirmText}>{t('editLayout.addWidget')}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  /* NO DIM. A veil over the page is for a modal that demands an answer; this
     one is a drawer opened mid-job, and darkening the profile behind it made
     the arrangement being edited harder to see at exactly the moment somebody
     is deciding what to add to it. Tapping outside still closes it. */
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#232326',
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingTop: 14,
    paddingBottom: 30,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: 8,
  },
  title: { color: colors.dim, fontSize: 14, fontWeight: '600' },
  reset: { color: colors.dim, fontSize: 14, fontWeight: '700' },
  empty: { color: colors.faint, fontSize: 15, paddingHorizontal: space.xl, paddingVertical: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.xl,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333338',
  },
  label: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  sizes: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: space.xl,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#333338',
  },
  sizeChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.card,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  glyph: { backgroundColor: colors.dim, borderRadius: 3 },
  outline: {
    flex: 1,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
  },
  outlineText: { color: colors.dim, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  previewBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  preview: {
    backgroundColor: '#2C2C30',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: space.xl,
    paddingTop: 16,
    paddingBottom: 30,
  },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  previewTitle: { color: colors.text, fontSize: 20, fontWeight: '800', flex: 1 },
  dots: { flexDirection: 'row', gap: 7, alignSelf: 'center', paddingBottom: 16 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.dim },
  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.yellow,
    borderRadius: 26,
    paddingVertical: 14,
  },
  confirmText: { color: colors.onYellow, fontSize: 17, fontWeight: '800' },
  count: { color: colors.text, fontSize: 17, fontWeight: '800' },
});
