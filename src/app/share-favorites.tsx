/**
 * A shelf of favourites as one picture.
 *
 * IT PICKS FOR YOU, AND THEN YOU CAN ARGUE WITH IT.
 *
 * The first version had no picker at all, reasoning that `favorites/[type]`
 * already has drag-to-reorder and `favoriteRank` already stores that order --
 * so the top four IS the first four, and asking again would be two orderings
 * that can disagree.
 *
 * That was wrong, and the reason is worth keeping. `favoriteRank` is
 * PERSISTENT CURATION: the order you keep. A share is AD HOC: these four, for
 * this post, today. They are not the same act. Somebody with fifty favourites
 * wanting to post a particular four would have had to drag them to the top of
 * a permanent list and then drag them back -- a worse chore than the picker
 * being avoided, and it damages the list to do it.
 *
 * So the rank still does the work nobody wants to repeat: the top N arrive
 * already chosen, and doing nothing gives a good card. Tapping is how you
 * disagree with it, and it costs the permanent order nothing.
 *
 * WHY THE COUNT IS NOT FREE EITHER. The output is a fixed rectangle, so a
 * count that does not tile leaves a hole: five posters is a row of three and a
 * row of two, and the gap reads as a missing image rather than a choice. Only
 * counts that fill their grid are offered — and that is a fact about pictures,
 * not a preference, which is why it is not a setting.
 *
 * Posters and no titles, deliberately. A title under each poster is six
 * translations, three truncation cases and a row of text competing with the
 * artwork it sits under. The posters already say what they are.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, PixelRatio, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { getHandle } from '@/community-session';
import { getFavoriteMovies, getFavoriteShows, getRecentMovies, getRecentShows } from '@/db';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { withLink } from '@/share-link';
import { colors, radius } from '@/theme';

const W = Math.min(Dimensions.get('window').width, 420);

/* The picture is 1080 wide; the preview is not. Same reasoning as the title
   share card — `captureRef` snapshots the view's own bounds at device scale,
   so the card is laid out at export size and only displayed small. */
const STORY_PX = 1080;
const EXPORT_W = Math.round(STORY_PX / PixelRatio.get());
/* Two tall shapes, Post first. The full argument is by `POST_H` in
   share-card.tsx: 4:5 is the tallest a picture can be and still be shown whole
   by Reddit, Twitter and the Instagram feed, and the bottom of this card is
   where the mark and the tagline live -- so on a 9:16 the one part that has to
   survive is the exact part a feed cuts off. */
const STORY_H = Math.round((EXPORT_W * 16) / 9);
const POST_H = Math.round((EXPORT_W * 5) / 4);
const SCREEN_H = Dimensions.get('window').height;
// Smaller than the title card's: this screen also carries a picker, and a
// 9:16 preview plus a shelf of posters plus a button does not fit otherwise.
const PREVIEW_W = Math.round(Math.min(W - 120, 244, ((SCREEN_H - 420) * 9) / 16));
const PREVIEW_STORY_H = Math.round((PREVIEW_W * 16) / 9);
const PREVIEW_POST_H = Math.round((PREVIEW_W * 5) / 4);
const PREVIEW_SCALE = PREVIEW_W / EXPORT_W;
const SF = EXPORT_W / 268;
const ss = (n: number) => Math.round(n * SF * 2) / 2;

/**
 * THE COUNTS, AND THE COLUMNS ARE NOT IN THIS LIST.
 *
 * They used to be — `{ n: 9, cols: 3 }` and so on, picked by hand. That is
 * how a 3x3 ended up with a stripe of empty card down each side: three
 * columns of 2:3 posters is a 0.67-wide shape being fitted into a frame that
 * is about 1.0, so it runs out of HEIGHT first and leaves the width unused,
 * and no amount of adjusting the padding changes that. The answer is more
 * columns, which is a different arrangement rather than a different margin.
 *
 * So the columns are computed: every divisor of the count is tried and the one
 * giving the biggest poster wins. Biggest poster and fullest card are the same
 * choice — total area is n x 1.5w², so maximising the cell maximises the grid.
 *
 * 2 and 3 are here so a shelf of three still makes a picture. 16 and 24 are
 * here because a wall of posters is its own thing, and at that size it stops
 * being a top-four and starts being a year.
 */
const COUNTS = [2, 3, 4, 6, 9, 12, 15, 16, 18, 20, 24] as const;

/**
 * THE RECENT SHELF OFFERS FOUR, and that is a different list on purpose.
 *
 * A favourites card is a top-something and every divisor is a plausible
 * answer -- nine, sixteen, twenty-four, a wall. A diary is "the last few", and
 * the last few is two, four, eight or twelve. Twenty of them is not a moment
 * any more, it is an export.
 */
const RECENT_COUNTS = [2, 4, 8, 12] as const;

const GAP = ss(9);
const PAD = ss(16);
/**
 * What the header and the floor ACTUALLY occupy, and the difference matters.
 *
 * This was ss(155) — 208pt of a 640pt card — because the header was a kicker
 * and a heading saying the same thing, the heading at 24pt over two lines
 * with 54 of padding above it. Reserving space the layout does not use is not
 * free: every point of it comes straight off the posters, which is why a 3x3
 * with titles drew 147px covers inside a 1080px picture.
 *
 * Now: 36 of padding, a heading allowed two lines at 26 (one in English, two
 * in the longer locales), and its 18 below. Below the grid: the mark, the
 * tagline, and its 26 of room.
 */
/*
 * ONE LINE, NOT TWO, and the second line is why the card looked half empty.
 *
 * The heading is "My favourite films" -- one line in English and in most of
 * the six -- and this reserved two of them on every card, in every language,
 * for ever. On the 640pt story that was 45pt of slack nobody noticed. On the
 * 450pt post it is a tenth of the whole picture, taken straight off the
 * posters, which is why six covers came out at 48pt with the card's full width
 * unused beside them.
 *
 * The heading still WRAPS to two lines where it needs to -- `numberOfLines={2}`
 * with `adjustsFontSizeToFit`, so a longer locale shrinks a little instead of
 * being cut -- it simply is not paid for in advance by everybody else.
 */
/*
 * WHAT THE CHROME COSTS, and on the 4:5 card it was costing too much.
 *
 * Header plus floor were 185pt of a 450pt card -- 41% of the picture spent on
 * a heading and a logo. The grid got what was left, and because a 2:3 poster
 * is bound by HEIGHT in a squarish card, every point taken off the top came
 * straight off the width of the posters: six covers at 60pt with 78pt of dead
 * card down each side.
 *
 * Trimmed to the padding these two blocks actually need, which is about 133.
 * Nothing is smaller -- the heading is the same size, the mark is the same
 * size -- there is simply less air around them, and the posters grew into it.
 */
const RESERVE_TOP = ss(56);
/* The floor includes a gap, because the grid used to end exactly where OPENTV
   began. `availH` is a budget the grid spends to the last point, so any room
   left between the two has to be reserved here or it does not exist. */
const RESERVE_BOTTOM = ss(45) + ss(14);

/**
 * ALWAYS TWO LINES, and the SIZE is what changes with the grid.
 *
 * One line was the wrong economy. "Ralph Breaks the Inte...", "The Shawshank
 * Rede...", "Bilal: A New Breed of..." -- three of twelve ending in an
 * ellipsis, which is not a title. Two lines hold almost every film ever made;
 * what a dense grid cannot afford is two lines AT READING SIZE, so the type
 * gets smaller rather than the title getting shorter.
 */
/**
 * DENSE IS ABOUT THE CELL, NOT THE ROW COUNT, and that was the bug behind
 * "Manches / ter by t...". Twelve posters are drawn 6x2 -- two rows, so the
 * old test called it sparse and gave it two lines of full-size type -- in
 * cells 42pt wide, which is the narrowest grid on the card. Six columns is
 * what makes a cell narrow; the number of rows says nothing about it.
 */
const isDense = (rows: number, cols: number) => rows >= 3 || cols >= 5;
/** THREE lines in a dense grid. A narrow cell is exactly where a title needs
 *  the extra line, and at these line heights the third one costs about two
 *  points of poster. */
const labelLines = (rows: number, cols: number) => (isDense(rows, cols) ? 3 : 2);
const labelLine = (rows: number, cols: number) => (isDense(rows, cols) ? ss(8.5) : ss(12));
const labelFont = (rows: number, cols: number) => (isDense(rows, cols) ? ss(7) : ss(10));
const labelHeight = (titles: boolean, rows: number, cols: number) =>
  titles ? ss(4) + labelLines(rows, cols) * labelLine(rows, cols) : 0;

/**
 * ONE SIZE FOR THE WHOLE GRID, chosen so the longest WORD fits a cell.
 *
 * Per-label `adjustsFontSizeToFit` was worse than the problem it solved: each
 * caption shrank on its own, so "Up" and "Soul" sat at full size beside a
 * "Manchester by the Sea" at two thirds of it, and the row read as a mistake.
 * A grid of captions is one typographic element and has one size.
 *
 * The size is set by the longest word, because a word is what cannot wrap:
 * "Perfect" wider than its cell is what produced "Perfec" / "t Blue". Width is
 * estimated at 0.58em per character, which is about right for this weight at
 * these sizes and does not need to be exact -- it is a floor, and it is capped
 * so a grid of short titles never grows past its design size.
 */
/* An eleventh of the card's width. It was a tenth, and the third caption line
   pushed the 3x3 and 6x3 grids two points under it -- taking nine and
   eighteen off the post's picker for the sake of two points nobody can see in
   a picture that exports at three times this size. It still refuses what it
   was put there for: twenty captioned posters on a post can only be drawn as
   ten columns of 20pt, and that is not offered. */
const MIN_CELL = Math.round(EXPORT_W / 11);

const CHAR_EM = 0.58;
function fittedLabelFont(titles: string[], cellW: number, rows: number, cols: number): number {
  const base = labelFont(rows, cols);
  if (!titles.length) return base;
  // TWO THINGS HAVE TO FIT, and only the first was being checked.
  //
  // The longest WORD, because a word cannot wrap: "Perfect" wider than its
  // cell is what produced "Perfec" / "t Blue".
  const longestWord = titles.reduce((n, t) => Math.max(n, ...t.split(/\s+/).map((w) => w.length)), 1);
  // And the longest TITLE across the lines it is allowed, because a title that
  // needs fourteen characters a line and is given eleven ends in an ellipsis
  // -- "Manches / ter by t...", which is what was on the card.
  const perLine = Math.ceil(
    titles.reduce((n, t) => Math.max(n, t.length), 1) / labelLines(rows, cols),
  );
  const needed = cellW / (CHAR_EM * Math.max(longestWord, perLine));
  // A floor, because past this nothing is readable and one freakish title is
  // not worth shrinking eleven good captions for. `Spider-Man: Across the
  // Spider-Verse` in a 42pt cell is that title, and it still ellipsises.
  return Math.max(base * 0.55, Math.min(base, needed));
}

/**
 * The smallest poster still worth calling a poster -- and it depends on
 * whether anything is written under it.
 *
 * Twenty favourites with titles on the 4:5 card came out as ten columns of
 * 20pt covers captioned "Pe r...", "Ma n...", with half the card empty
 * underneath. The arrangement was not wrong; it was the best of a set of
 * arrangements that should never have been offered, and something has to say
 * where that set ends.
 *
 * A NINTH of the width bare, an EIGHTH with a title, because the title is what
 * needs the room: at a ninth the artwork still reads as artwork -- that is the
 * 24-poster wall, and it is deliberate, a year of watching rather than a
 * top-four -- but a caption that narrow is an abbreviation. The bare floor is
 * set exactly where the wall lives so that nothing which works today stops
 * being offered.
 */
/**
 * How to arrange `count` posters on a card `cardH` tall, and how big they come
 * out. Pure, and at module scope, because the COUNT PICKER has to ask the same
 * question the card does -- a count it cannot draw properly is a count it must
 * not offer.
 *
 * WIDTH FIRST, AND THAT IS A CORRECTION.
 *
 * It used to take the biggest poster, on the reasoning that biggest poster and
 * fullest card are the same choice. They are not. A 2:3 poster in a squarish
 * card is bound by HEIGHT, so the arrangements all end up spending the full
 * height and differing in how much WIDTH they leave behind -- and the rule
 * picked twelve posters as 4x3 at 45pt, filling 60% of the width, over 6x2 at
 * 42pt filling 98%. Three points of poster for a fifth of the card down each
 * side.
 *
 * It also decides where the leftover SITS, which is the part that reads. Empty
 * space down both sides looks like a mistake; the same space above the logo
 * looks like a margin -- and it is the margin that was missing when the bottom
 * row of captions ran into OPENTV.
 *
 * So: widest grid wins, biggest poster breaks the tie, and MIN_CELL stops it
 * degenerating into a stripe of thumbnails. Two guards on top of it: a poster
 * under MIN_CELL is not an arrangement, and beyond three posters a single ROW
 * is not either -- four across an otherwise empty card is not a wall, it is a
 * shelf with nothing under it.
 *
 * WIDTHS ARE FLOORED TO WHOLE POINTS, and that is not tidiness. The cell came
 * out 72.111pt for a 3x3; the row container was set to exactly three of those
 * plus the gaps, and React Native rounds each child to device pixels
 * independently. Three cells rounding up by a third of a point each overflow a
 * container sized to the exact sum, the third poster wraps to a new row, and
 * `overflow: hidden` eats it -- a 3x3 that draws eight posters and leaves no
 * trace of the ninth. A floored width plus a point of slack cannot.
 */
function bestGrid(count: number, titles: boolean, cardH: number) {
  let best = { cols: 1, w: 0, h: 0, rows: count, gridW: 0 };
  let widest = { cols: 1, w: 0, h: 0, rows: count, gridW: 0 };
  for (let cols = 1; cols <= count; cols++) {
    if (count % cols !== 0) continue;
    const rows = count / cols;
    const labelH = labelHeight(titles, rows, cols);
    const availW = EXPORT_W - PAD * 2 - GAP * (cols - 1);
    const availH = cardH - RESERVE_TOP - RESERVE_BOTTOM - GAP * (rows - 1);
    const w = Math.floor(Math.min(availW / cols, ((availH / rows - labelH) * 2) / 3));
    const here = { cols, w, h: Math.round((w * 3) / 2) + labelH, rows, gridW: w * cols + GAP * (cols - 1) };
    // The fallback, so a count with no acceptable arrangement still reports
    // its best poster width and the picker can refuse it on that.
    if (w > best.w) best = here;
    if (w < MIN_CELL) continue;
    if (count > 3 && rows < 2) continue;
    if (here.gridW > widest.gridW || (here.gridW === widest.gridW && w > widest.w)) widest = here;
  }
  return widest.w > 0 ? widest : best;
}

export default function ShareFavoritesScreen() {
  const { type, source } = useLocalSearchParams<{ type?: string; source?: string }>();
  const isShows = type === 'shows';
  /*
   * TWO SHELVES, ONE CARD.
   *
   * A favourites shelf is curation and changes once a year; a recent shelf is a
   * diary and changes every week. They are worth sharing for opposite reasons
   * and they draw identically -- a grid of posters -- so this screen takes
   * whichever it is told and the readers in `db.ts` return the same shape.
   */
  const isRecent = source === 'recent';
  /* Read once: it cannot change while this screen is open. */
  const [handle] = useState(getHandle);
  const cardRef = useRef<View>(null);
  /* Post is the default for the same reason it is on the title card: it is the
     only one of the shapes no feed crops. */
  const [shape, setShape] = useState<'post' | 'story'>('post');
  const cardH = shape === 'story' ? STORY_H : POST_H;

  const items = useMemo(() => {
    if (isRecent) {
      return isShows
        ? getRecentShows().map((s) => ({ key: String(s.tvdbId), poster: s.posterUrl, title: s.name, on: s.watchedOn }))
        : getRecentMovies().map((m) => ({ key: m.name, poster: m.poster, title: m.title, on: m.watchedOn }));
    }
    return isShows
      ? getFavoriteShows().map((s) => ({ key: String(s.tvdbId), poster: s.posterUrl, title: s.name, on: null }))
      : getFavoriteMovies().map((m) => ({ key: m.name, poster: m.poster, title: m.title, on: null }));
  }, [isShows, isRecent]);

  /** Titles under the posters. OFF by default: the posters are the picture,
   *  and at 16 or 24 a caption under each is a wall of six-point text.
   *  Declared above `options` because it is one of the things that decides
   *  which counts can be drawn at all. */
  const [titles, setTitles] = useState(false);

  /* Only the counts they can actually fill -- offering 9 to somebody with five
     favourites is offering a picture with four holes in it -- AND only the
     ones that fit.
     
     The second half is new and it is the shape's doing. The header and the
     floor of this card are fixed content, so they cost the same 221pt on
     either shape; on the 640pt story that is a third of it and on the 450pt
     post it is half, leaving 229pt of grid. Twenty posters with titles do not
     go into 229pt, and the layout did the only thing it could: it found the
     least-bad arrangement and drew it. A control should not offer a result
     nobody would want, so the counts that cannot be drawn are simply not
     there -- turn titles off, or switch to Story, and they come back. */
  const options = (isRecent ? RECENT_COUNTS : COUNTS).filter(
    (c) => c <= items.length && bestGrid(c, titles, cardH).w >= MIN_CELL,
  );
  const [n, setN] = useState(() => (options.length ? options[options.length - 1] : 0));
  const count = (options as readonly number[]).includes(n) ? n : options[options.length - 1];

  /* Keys in the order they were chosen -- the card draws them in this order, so
     the first one tapped is the top-left poster. Seeded from the shelf's own
     order, which is why doing nothing already produces the right card. */
  const [picked, setPicked] = useState<string[]>(() =>
    items.slice(0, options.length ? options[options.length - 1] : 0).map((i) => i.key),
  );

  /* Changing the grid keeps what is already chosen and fills the rest from the
     shelf, so switching 4 to 9 does not throw away four taps. Shrinking trims
     the end, which is the half the reader was least attached to. */
  const setCount = useCallback(
    (next: number) => {
      setN(next);
      setPicked((prev) => {
        if (prev.length >= next) return prev.slice(0, next);
        const fill = items.map((i) => i.key).filter((k) => !prev.includes(k));
        return [...prev, ...fill.slice(0, next - prev.length)];
      });
    },
    [items],
  );

  /**
   * A FULL GRID USED TO EAT THE TAP.
   *
   * It returned `prev` unchanged once `count` posters were chosen, so the only
   * way to exchange one was to work out — with nothing on screen saying so —
   * that you must first tap a chosen poster to remove it and then tap the new
   * one. Two taps, in an order nobody was told, to do the single thing this
   * shelf is for. Fading the unpicked posters was meant to explain that and
   * explained nothing: it reads as "disabled", which is exactly the wrong
   * lesson.
   *
   * So a tap on a new poster when the grid is full takes the LAST slot. That
   * position is the one the reader has spent the least thought on, the badge
   * number does not move, and the swap is visible in the preview immediately.
   * Nothing dead-ends.
   */
  const toggle = useCallback(
    (key: string) => {
      tapLight();
      setPicked((prev) => {
        if (prev.includes(key)) return prev.filter((k) => k !== key);
        if (prev.length >= count) return [...prev.slice(0, count - 1), key];
        return [...prev, key];
      });
    },
    [count],
  );

  /**
   * The arrangement, chosen rather than declared.
   *
   * WIDTHS ARE FLOORED TO WHOLE POINTS, and that is not tidiness. The cell came
   * out 72.111pt for a 3x3; the row container was set to exactly three of those
   * plus the gaps, and React Native rounds each child to device pixels
   * independently. Three cells rounding up by a third of a point each overflow
   * a container sized to the exact sum, the third poster wraps to a new row,
   * and `overflow: hidden` eats it — a 3x3 that draws eight posters and leaves
   * no trace of the ninth. A floored width plus a point of slack cannot.
   */
  const layout = useMemo(() => bestGrid(count, titles, cardH), [count, titles, cardH]);

  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  /* SLICED, because `count` no longer only changes when somebody taps a
     count. Turning titles on, or switching to Post, can take the option they
     were on away -- and then `picked` still holds twenty keys while the grid
     is built for six. Without this the card drew all twenty into a six-cell
     arrangement. */
  const shown = picked.slice(0, count).map((k) => byKey.get(k)).filter((x): x is (typeof items)[number] => !!x);
  const full = picked.length >= count;

  /* One size for every caption on the card -- see `fittedLabelFont`. */
  const labelSize = useMemo(
    () => fittedLabelFont(shown.map((i) => i.title), layout.w, layout.rows, layout.cols),
    [shown, layout.w, layout.rows, layout.cols],
  );

  /* The span the grid covers, from the items on it rather than from today:
     a card made on Friday about Monday's watching should say Monday. */
  const watchedRange = useMemo(() => {
    if (!isRecent) return null;
    const dates = shown.map((i) => i.on).filter((d): d is string => !!d).sort();
    if (dates.length === 0) return null;
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short' });
    const first = fmt(dates[0]);
    const last = fmt(dates[dates.length - 1]);
    return t('shareFavorites.watchedRange', { range: first === last ? first : `${first} – ${last}` });
  }, [isRecent, shown]);

  const heading = isRecent
    ? isShows
      ? t('shareFavorites.recentShows')
      : t('shareFavorites.recentMovies')
    : isShows
      ? t('shareFavorites.headingShows')
      : t('shareFavorites.headingMovies');

  const share = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      // JPEG, NOT PNG, AND THE REASON IS WHAT THIS PICTURE IS.
      //
      // PNG is lossless: it stores every pixel exactly, which is right for flat
      // colour and transparency and wrong for this. A share card is poster
      // artwork -- a photograph, essentially -- with text laid over it, and
      // PNG was spending 3.1 MB encoding film grain byte for byte. At 0.92 the
      // same 1080x1920 card lands in the hundreds of kilobytes with nothing a
      // human can see missing.
      //
      // The alternative somebody reaches for first is dropping to 720, and it
      // is the wrong lever twice over: it costs real sharpness, and 1080 is the
      // width Instagram Stories actually wants. Fix the encoding, keep the
      // pixels.
      //
      // Nothing is lost to JPEG's lack of transparency: every one of these
      // cards is opaque by construction.
      const uri = await captureRef(cardRef, { format: 'jpg', quality: 0.92, useRenderInContext: true });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/jpeg',
          UTI: 'public.jpeg',
          dialogTitle: heading,
        });
        return;
      }
      await Share.share({ url: uri, message: withLink(heading) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('native module') || msg.includes('RNViewShot')) {
        Alert.alert(t('shareCard.buildNeededTitle'), t('shareCard.buildNeededBody'));
      } else {
        Alert.alert(t('shareCard.shareFailedTitle'), msg);
      }
    }
  };

  if (!count) {
    return (
      <Screen>
        <NavHeader title={t('shareFavorites.title')} />
        <Text style={s.empty}>
          {isShows ? t('shareFavorites.emptyShows') : t('shareFavorites.emptyMovies')}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title={t('shareFavorites.title')} />
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', gap: 14, paddingBottom: 28, paddingTop: 6 }}>
        {/* The count, and nothing else to decide. Hidden entirely when there is
            only one grid they can fill — a control with one option is furniture. */}
        {options.length > 1 && (
          <View style={s.counts}>
            {options.map((g) => (
              <Pressable
                key={g}
                style={[s.countTab, g === count && s.countTabOn]}
                onPress={() => {
                  tapLight();
                  setCount(g);
                }}>
                <Text style={[s.countText, g === count && { color: colors.onBrand }]}>{g}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          style={s.titlesRow}
          onPress={() => {
            tapLight();
            setTitles((v) => !v);
          }}>
          <Ionicons
            name={titles ? 'checkbox' : 'square-outline'}
            size={18}
            color={titles ? colors.brand : colors.faint}
          />
          <Text style={[s.titlesText, titles && { color: colors.text }]}>
            {t('shareFavorites.showTitles')}
          </Text>
        </Pressable>

        {/* Same two shapes as the title card, same default, same words. */}
        <View style={s.counts}>
          {(['post', 'story'] as const).map((k) => (
            <Pressable
              key={k}
              style={[s.shapeTab, shape === k && s.countTabOn]}
              onPress={() => {
                tapLight();
                setShape(k);
              }}>
              <Ionicons
                name={k === 'post' ? 'square-outline' : 'phone-portrait-outline'}
                size={15}
                color={shape === k ? colors.onBrand : colors.dim}
              />
              <Text style={[s.countText, shape === k && { color: colors.onBrand }]}>
                {t(k === 'post' ? 'shareCard.shapePost' : 'shareCard.shapeStory')}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={[s.box, { height: shape === 'story' ? PREVIEW_STORY_H : PREVIEW_POST_H }]}>
          <View style={s.scale}>
            <View ref={cardRef} collapsable={false} style={[s.card, { height: cardH }]}>
              <LinearGradient
                colors={['#16161A', '#08080A']}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              {/* NO KICKER. It read "MY FAVOURITES" directly above "My
                  favourite shows" — the same words twice, and between them
                  they took 203pt of a 640pt card. A third of the picture
                  spent on a label, while the posters it was labelling were
                  shrunk to fit what was left. */}
              {/* WHEN, which is the whole difference between this shelf and the
                  favourites one. A favourites grid is true whenever you look at
                  it; a recent grid is only true on a date, and a card that
                  leaves the date off is claiming the first about the second. */}
              <Text style={s.heading} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
                {heading}
              </Text>
              {!!watchedRange && <Text style={s.when}>{watchedRange}</Text>}

              {/* The +1 is the whole fix for the missing ninth poster: the
                  container is a point wider than the sum of its floored
                  children, so per-child pixel rounding can never push the last
                  one in a row onto the next line. */}
              {/* The grid takes the whole middle and sits in the centre of it.
                  Leftover height used to pile up in one place -- under the
                  last row, directly above the mark -- which is the one place
                  it reads as a mistake rather than a margin. Split above and
                  below, the same space is breathing room. */}
              <View style={s.gridBand}>
              <View
                style={[s.grid, { width: layout.w * layout.cols + GAP * (layout.cols - 1) + 1 }]}>
                {shown.map((it) => (
                  <View key={it.key} style={{ width: layout.w }}>
                    <View style={[s.cell, { width: layout.w, height: Math.round((layout.w * 3) / 2) }]}>
                      {it.poster ? (
                        <Image
                          source={{ uri: it.poster }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          cachePolicy="disk"
                        />
                      ) : (
                        <View style={[StyleSheet.absoluteFill, s.fallback]}>
                          <Text style={s.fallbackText} numberOfLines={3}>
                            {it.title}
                          </Text>
                        </View>
                      )}
                    </View>
                    {/* SHRINKS RATHER THAN BREAKING. "Perfect Blue" in a cell
                        narrower than the word "Perfect" was wrapped mid-word --
                        "Perfec" then "t Blue" -- because nothing told the label
                        it could be smaller. It can now, down to two thirds,
                        which is the difference between a title and a typo. */}
                    {titles && (
                      <Text
                        style={[
                          s.cellTitle,
                          { fontSize: labelSize, lineHeight: labelLine(layout.rows, layout.cols) },
                        ]}
                        numberOfLines={labelLines(layout.rows, layout.cols)}>
                        {it.title}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
              </View>

              <View style={s.brand}>
                <Image
                  source={require('@/assets/images/mark.png')}
                  style={s.mark}
                  contentFit="contain"
                />
                <Text style={s.brandText}>OPENTV</Text>
              </View>
              {/*
                WHOSE CARD THIS IS.
                
                None of the share cards carried a handle, so a grid of twelve
                posters arrived on somebody's timeline as an anonymous picture
                with an app's name on it -- the one thing it was NOT supposed to
                be. The tagline still sells the app; this says who is talking.
                
                Only when there is one to show: somebody who never joined the
                community has no handle, and inventing a name for them would be
                worse than the omission this replaces.
              */}
              <Text style={s.tagline} numberOfLines={2}>
                {handle ? `@${handle} · ${t('shareCard.openSourceTagline')}` : t('shareCard.openSourceTagline')}
              </Text>
            </View>
          </View>
        </View>

        {/*
          THE SHELF, and the numbers on it are the point.

          A tick would say "in", which is not enough: the card draws these in
          the order they were tapped, so the badge shows the POSITION. Somebody
          who wants a particular poster top-left can see how to get it without
          being told, and somebody who does not care never looks.

          Horizontal, because it sits under a 9:16 preview and a wrapping grid
          of every favourite would push the share button off the screen for
          anybody with more than a dozen.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.shelf}
          style={{ alignSelf: 'stretch' }}>
          {items.map((it) => {
            const at = picked.indexOf(it.key);
            const on = at >= 0;
            return (
              <Pressable
                key={it.key}
                onPress={() => toggle(it.key)}
                style={[s.pick, on && s.pickOn]}>
                {it.poster ? (
                  <Image source={{ uri: it.poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, s.fallback]}>
                    <Text style={s.pickFallbackText} numberOfLines={3}>
                      {it.title}
                    </Text>
                  </View>
                )}
                {on && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{at + 1}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/*
          TWO LINES, AND THE SECOND ONE IS ALWAYS TRUE.

          The first line changes with the state and so can only ever describe
          half of what the shelf does. Removing works whether the grid is full
          or not, and it is the action nobody guesses: a tap that ADDS is
          obvious, a tap that takes something back out is not, and the badge
          showing a position looks like a label rather than a thing you can
          undo. So it is stated outright, all the time, rather than being left
          for the reader to discover by accident.
        */}
        <Text style={s.hint}>
          {full ? t('shareFavorites.hintFull') : t('shareFavorites.hintPick', { count: count - picked.length })}
        </Text>
        <Text style={s.hintQuiet}>{t('shareFavorites.hintRemove')}</Text>

        <Pressable
          style={[s.shareBtn, !picked.length && s.shareBtnOff]}
          disabled={!picked.length}
          onPress={() => void share()}>
          <Ionicons name="share-outline" size={18} color={colors.onBrand} />
          <Text style={s.shareText}>{t('shareFavorites.share')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 60, paddingHorizontal: 32, lineHeight: 22 },

  counts: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill, padding: 3, gap: 2 },
  countTab: { minWidth: 42, alignItems: 'center', paddingVertical: 7, borderRadius: radius.pill },
  countTabOn: { backgroundColor: colors.brand },
  countText: { color: colors.dim, fontSize: 13, fontWeight: '700' },

  shapeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },

  // Height comes from the shape — see the preview box above.
  box: { width: PREVIEW_W, borderRadius: 12, overflow: 'hidden' },
  scale: { transform: [{ scale: PREVIEW_SCALE }], transformOrigin: 'top left' },
  card: {
    width: EXPORT_W,
    // Square -- `box` rounds the preview. See the note in share-card.tsx.
    overflow: 'hidden',
    backgroundColor: '#08080A',
    alignItems: 'center',
    paddingTop: ss(20),
  },

  when: { color: 'rgba(255,255,255,0.55)', fontSize: ss(11), fontWeight: '600', marginTop: ss(-10), marginBottom: ss(12), textAlign: 'center' },
  heading: {
    color: '#FFFFFF',
    fontSize: ss(22),
    lineHeight: ss(26),
    fontWeight: '900',
    letterSpacing: -0.3,
    marginBottom: ss(10),
    textAlign: 'center',
    paddingHorizontal: ss(16),
  },

  gridBand: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, justifyContent: 'center' },
  cell: { borderRadius: ss(8), overflow: 'hidden', backgroundColor: '#1C1C1E' },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#26262A', padding: ss(8) },
  fallbackText: { color: colors.brand, fontSize: ss(12), fontWeight: '800', textAlign: 'center' },
  cellTitle: {
    color: 'rgba(255,255,255,0.82)',
    // fontSize and lineHeight come from the grid — see `fittedLabelFont`.
    fontWeight: '600',
    marginTop: ss(4),
    textAlign: 'center',
  },

  // `marginTop: 'auto'` so the mark sits on the floor of the card whatever the
  // grid above it comes out as — a 2x2 and a 3x3 leave very different slack.
  brand: { flexDirection: 'row', alignItems: 'center', gap: ss(6) },
  mark: { width: ss(18), height: ss(18) },
  brandText: { color: '#FFFFFF', fontSize: ss(12), fontWeight: '900', letterSpacing: 0.8 },
  tagline: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: ss(10),
    fontWeight: '600',
    marginTop: ss(3),
    marginBottom: ss(12),
  },

  titlesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  titlesText: { color: colors.dim, fontSize: 14, fontWeight: '600' },

  shelf: { flexDirection: 'row', gap: 8, paddingHorizontal: 18 },
  pick: {
    width: 58,
    height: 87,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pickOn: { borderColor: colors.brand },
  pickFallbackText: { color: colors.brand, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: 3,
    insetInlineEnd: 3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onBrand, fontSize: 11, fontWeight: '900' },
  hint: { color: colors.dim, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingHorizontal: 24 },
  hintQuiet: { color: colors.faint, fontSize: 12.5, textAlign: 'center', paddingHorizontal: 24, marginTop: -8 },

  shareBtnOff: { opacity: 0.4 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.brand,
    paddingVertical: 13,
    paddingHorizontal: 30,
    borderRadius: radius.pill,
  },
  shareText: { color: colors.onBrand, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
});
