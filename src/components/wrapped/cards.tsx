/**
 * The eight Wrapped cards. Each owns its composition.
 *
 * DIFFERENT ON PURPOSE. The old deck was one card with different strings;
 * these share a language (`primitives.tsx`) and nothing else. Artwork is
 * used where it gives a card identity and withheld where type does the work
 * better — the biggest-day and activity cards have none by design.
 *
 * TWO FAMILIES, ONE CAMPAIGN. 01, 02, 03, 04 and 08 are pictures with type
 * on them; 05, 06 and 07 are type and yellow on black. The masthead, the
 * brand strip, the yellow, the corner radius and the way a picture dissolves
 * into black are what make them one deck.
 *
 * MONTH AND YEAR ARE NOT THE SAME CARD WITH A DIFFERENT LABEL. Scale and
 * obsession already carry a year by the size of their numbers; personality,
 * biggest day, activity and the hero each have a year composition of their
 * own, because a year is an era and a month is a month.
 *
 * EVERYTHING IS THE READER'S OWN DATA: their posters and backdrops, their
 * numbers, their name. `deckArt` decides what each card gets and a card lays
 * out for the count it received. There are no empty frames.
 */
import { View, type ViewStyle } from 'react-native';
import { Text } from 'react-native';

import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
import { monthlyActivity, pickArtwork, titlesInGenre, watchingType } from '@/pure';
import type { Wrapped } from '@/stats-calc';

import { ActivityGrid, Brand, Canvas, Display, Gradient, Label, Media, MonthBars, Period, Rule, Sub, YellowLight, fitSize, numberSize, wordLines, wrappedColours as C } from './primitives';

export type CardProps = {
  d: Wrapped;
  /** "August 2026" */
  label: string;
  unit: 'month' | 'year';
  width: number;
  handle: string | null;
  /** The reader's display name, for the hero. */
  name: string | null;
};

const n = (v: number) => formatCount(v, currentLocale());
const unitWord = (u: 'month' | 'year') => (u === 'month' ? t('plus.wrapped.cards.unitMonth') : t('plus.wrapped.cards.unitYear'));

/** "{{count}} episodes" with the count formatted for the locale: 1,480 not 1480. */
const plural = (key: 'plus.wrapped.cards.scaleEpisodes' | 'plus.wrapped.cards.scaleFilms' | 'plus.wrapped.cards.obsessionEpisodes', count: number) => t(key, { count }).replace(String(count), n(count));

const abs = (s: ViewStyle): ViewStyle => ({ position: 'absolute', ...s });

/**
 * Which picture goes on which card, decided once for the deck.
 *
 * The obsession card is ABOUT the top show, so it owns that show's artwork.
 * Every other card asks for something else first and falls back to the top
 * show only when there is nothing else — so a month of five shows is the
 * whole month, and a month of one show is still that one show everywhere
 * rather than a card with a hole in it. The taste card asks the titles of
 * its own genres before the rest.
 */
function deckArt(d: Wrapped) {
  const top = d.topShows[0];
  const obsession = [top?.backdrop, top?.poster].filter((u): u is string => !!u);
  const opening = pickArtwork(d.topShows, ['wide', 'tall', 'wide'], obsession);
  const scale = pickArtwork(d.topShows, ['any'], [...obsession, ...opening]);
  const inA = titlesInGenre(d.topShows, d.topGenres[0]?.name);
  const inB = titlesInGenre(d.topShows, d.topGenres[1]?.name);
  const tasteA = pickArtwork(inA, ['wide'], [...obsession, ...opening, ...scale]);
  const tasteB = pickArtwork(inB, ['wide'], [...obsession, ...opening, ...scale, ...tasteA]);
  // The hero may lead with the top show — it is the identity — but not with
  // the picture the opening already led with.
  const hero = pickArtwork(d.topShows, ['wide', 'tall', 'tall'], [...opening.slice(0, 1), ...scale, ...tasteA]);
  // One title: the second genre has no picture of its own, and the same
  // still twice is not a spread. The card lays out for one.
  const b = tasteB[0] && tasteB[0] !== tasteA[0] ? tasteB[0] : null;
  const personality = pickArtwork(d.topShows, ['any'], [...obsession, ...opening, ...scale, ...tasteA, ...tasteB, ...hero]);
  return { opening, scale, tasteA: tasteA[0] ?? null, tasteB: b, hero, personality };
}

/** Kicker + period, top-left of every card. */
function Masthead({ label, size = 22 }: { label: string; size?: number }) {
  return (
    <View style={abs({ left: 18, top: 20, right: 18 })}>
      <Label>{t('plus.wrapped.cards.hookKicker')}</Label>
      <Period size={size}>{label}</Period>
    </View>
  );
}

function Foot({ handle, right }: { handle: string | null; right: string }) {
  return (
    <View style={abs({ left: 0, right: 0, bottom: 0 })}>
      <Brand handle={handle} right={right} />
    </View>
  );
}

/** The month word of "June 2026", or the year itself. */
const periodWord = (label: string) => label.split(' ')[0] ?? label;

/* ── 01 · the hook ──────────────────────────────────────────────────────── */
/**
 * One world, not a scrapbook. The best backdrop is the ground; one poster
 * stands on it and one more still leans in from the edge, both straight,
 * both smaller than it, so the eye has somewhere to land first.
 */
export function WrappedOpening({ d, label, unit, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const [a, b, c] = deckArt(d).opening;
  return (
    <Canvas width={width}>
      {a ? <Media uri={a} style={abs({ left: 0, right: 0, top: 0, height: H * 0.6 })} fade="bottom" dim={0.08} focus="top" /> : null}
      {c ? <Media uri={c} style={abs({ right: 0, top: H * 0.43, width: width * 0.46, height: width * 0.27, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 })} fade="left" dim={0.18} /> : null}
      {b ? <Media uri={b} style={abs({ left: 18, top: H * 0.36, width: width * 0.27, height: width * 0.4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' })} /> : null}
      <Gradient edge="bottom" strength={1} style={{ top: H * 0.42 }} />
      {a ? <Gradient edge="top" strength={0.75} style={{ bottom: H * 0.78 }} /> : null}
      {!a ? <YellowLight size={width * 1.1} x={width * 0.8} y={H * 0.3} strength={1.2} /> : <YellowLight size={width * 0.9} x={width * 0.75} y={H * 0.62} strength={0.45} />}

      <Masthead label={label} size={30} />

      <View style={abs({ left: 18, right: 18, bottom: 62 })}>
        <Display size={36} lines={2} colour={C.INK}>{t('plus.wrapped.cards.hookLine1', { period: periodWord(label) })}</Display>
        <View style={{ height: 6 }} />
        <Display size={36} lines={2} colour={C.YELLOW}>{t('plus.wrapped.cards.hookLine2')}</Display>
      </View>
      <Foot handle={handle} right={unitWord(unit)} />
    </Canvas>
  );
}

/* ── 02 · the scale ─────────────────────────────────────────────────────── */
export function WrappedScale({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const hours = Math.round(d.minutes / 60);
  const big = hours >= 1 ? n(hours) : n(d.minutes);
  const unitKey = hours >= 1 ? 'plus.wrapped.cards.scaleHours' : 'plus.wrapped.cards.scaleMinutes';
  // The whole card is a scene: a backdrop from the top titles, full-bleed,
  // held down to a night level so the yellow number is the brightest thing
  // on it. Not the obsession card's picture if there is another.
  const [bg] = deckArt(d).scale;
  // A short number is set larger than a long one, but never so large that a
  // one-digit month looks like a typo: one digit tops out where two do.
  const size = Math.min(numberSize(big, width - 26), 196);
  const unitSize = Math.min(64, size * 0.34);
  return (
    <Canvas width={width}>
      {bg ? <Media uri={bg} style={abs({ left: 0, right: 0, top: 0, bottom: 0 })} dim={0.42} focus="top" /> : null}
      {/* Dark at the top for the masthead and at the foot for the totals; the
          middle keeps the picture, which is where the number sits over it. */}
      <Gradient edge="top" strength={0.95} style={{ bottom: H * 0.45 }} />
      <Gradient edge="bottom" strength={1} style={{ top: H * 0.45 }} />
      <YellowLight size={width * 1.5} x={width * 0.32} y={H * 0.36} strength={1.4} />
      <Masthead label={label} size={26} />
      {/* The number IS the graphic: enormous, yellow, hard against the left,
          with the unit set tight beneath it in white so the two read as one. */}
      <View style={abs({ left: 10, top: H * 0.19, right: 18 })}>
        <Display size={size} lines={1} minScale={0.3} colour={C.YELLOW} style={{ letterSpacing: -size * 0.03, lineHeight: size * 1.02 }}>{big}</Display>
        <Display size={unitSize} lines={1} colour={C.INK} style={{ marginLeft: 8, marginTop: -4, textTransform: 'uppercase', letterSpacing: -1 }}>{t(unitKey as 'plus.wrapped.cards.scaleHours', { count: hours >= 1 ? hours : d.minutes })}</Display>
      </View>
      <View style={abs({ right: 18, bottom: 78, alignItems: 'flex-end' })}>
        {d.episodes > 0 ? <Display size={38} lines={1} colour={C.INK} align="right">{plural('plus.wrapped.cards.scaleEpisodes', d.episodes)}</Display> : null}
        {d.films > 0 ? <Display size={38} lines={1} colour={C.INK} align="right" style={{ marginTop: 4 }}>{plural('plus.wrapped.cards.scaleFilms', d.films)}</Display> : null}
      </View>
      <Foot handle={handle} right={t('plus.wrapped.cards.scaleFoot')} />
    </Canvas>
  );
}

/* ── 03 · the obsession ─────────────────────────────────────────────────── */
export function WrappedObsession({ d, label, unit, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const top = d.topShows[0];
  const backdrop = top?.backdrop ?? null;
  const poster = top?.poster ?? null;
  const hero = backdrop ?? poster;
  const title = top?.name ?? '';
  // LOST at 84pt; THE HAUNTING OF HILL HOUSE at whatever three lines hold.
  const lines = wordLines(title, 3);
  const size = fitSize(title, width - 36, 84, 30, lines);
  return (
    <Canvas width={width}>
      {hero ? <Media uri={hero} style={abs({ left: 0, right: 0, top: 0, height: H * 0.66 })} fade="bottom" dim={0.08} focus="top" /> : <YellowLight size={width * 1.3} x={width * 0.5} y={H * 0.3} />}
      {backdrop && poster ? <Media uri={poster} style={abs({ right: 16, top: H * 0.3, width: width * 0.24, height: width * 0.36, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' })} /> : null}
      {/* The gradient starts where the title will, whatever its height, so a
          three-line title is as readable as a one-line one. */}
      <Gradient edge="bottom" style={{ top: H * 0.34 }} />
      <Masthead label={label} />
      <View style={abs({ left: 18, right: 18, bottom: 56 })}>
        <Label style={{ marginBottom: 8 }}>{t('plus.wrapped.cards.obsessionKicker')}</Label>
        <Display size={size} lines={lines} minScale={0.3} colour={C.INK} style={{ textTransform: 'uppercase', letterSpacing: -size * 0.035, lineHeight: size * 1.02 }}>{title}</Display>
        <Display size={30} lines={1} colour={C.YELLOW} style={{ marginTop: 10, textTransform: 'uppercase' }}>{plural('plus.wrapped.cards.obsessionEpisodes', top?.episodes ?? 0)}</Display>
        <Sub style={{ marginTop: 4 }}>{t('plus.wrapped.cards.obsessionSub', { unit: unitWord(unit) })}</Sub>
      </View>
      <Foot handle={handle} right={t('plus.wrapped.cards.obsessionFoot')} />
    </Canvas>
  );
}

/* ── 04 · your taste ────────────────────────────────────────────────────── */
/**
 * A magazine spread, not a mosaic. Two pictures only: the first genre's
 * world fills the top and dissolves downward; the second's rises from the
 * foot and dissolves upward; and the genre word sits ACROSS the seam where
 * the first fades out, so it belongs to the picture rather than to a gap
 * between pictures.
 */
export function WrappedTaste({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const primary = d.topGenres[0]?.name ?? '';
  const secondary = d.topGenres[1]?.name ?? null;
  const { tasteA, tasteB } = deckArt(d);
  const lines = wordLines(primary, 2);
  const size = fitSize(primary, width - 36, 108, 40, lines);
  return (
    <Canvas width={width}>
      {tasteA ? <Media uri={tasteA} style={abs({ left: 0, right: 0, top: 0, height: H * 0.58 })} fade="bottom" dim={0.06} focus="top" /> : null}
      {tasteB ? <Media uri={tasteB} style={abs({ left: 0, right: 0, bottom: 0, height: H * 0.4 })} fade="top" dim={0.22} /> : null}
      {/* the brand strip needs a dark foot under the second picture */}
      {tasteB ? <Gradient edge="bottom" strength={0.9} style={{ top: H * 0.82 }} /> : null}
      <YellowLight size={width * 1.1} x={width * 0.25} y={tasteB ? H * 0.52 : H * 0.7} strength={tasteB ? 0.6 : 0.9} />
      <Masthead label={label} />
      {/* with one picture the type takes the middle instead of a seam */}
      <View style={abs({ left: 18, right: 18, top: tasteB ? H * 0.41 : H * 0.52 })}>
        <Label style={{ marginBottom: 6 }}>{t('plus.wrapped.cards.tasteKicker', { period: periodWord(label) })}</Label>
        <Display size={size} lines={lines} minScale={0.3} colour={C.INK} style={{ textTransform: 'uppercase', letterSpacing: -size * 0.045, lineHeight: size * 1.02 }}>{primary}</Display>
        <Sub size={18} colour={C.INK} style={{ marginTop: 8, fontWeight: '600' }}>{secondary ? t('plus.wrapped.cards.tasteSecond', { genre: secondary }) : t('plus.wrapped.cards.tasteAlone')}</Sub>
      </View>
      <Foot handle={handle} right={t('plus.wrapped.cards.tasteFoot')} />
    </Canvas>
  );
}

/* ── 05 · watching personality ──────────────────────────────────────────── */
function personality(d: Wrapped) {
  const type = watchingType(d, d.totalDays);
  const name = t(`plus.wrapped.cards.types.${type}.name` as 'plus.wrapped.cards.types.loyalist.name');
  const desc = t(`plus.wrapped.cards.types.${type}.desc` as 'plus.wrapped.cards.types.loyalist.desc');
  const share = d.episodes > 0 ? Math.round(((d.topShows[0]?.episodes ?? 0) / d.episodes) * 100) : 0;
  const proof =
    type === 'binger'
      ? t('plus.wrapped.cards.proof.binger', { count: d.biggestDay.count })
      : type === 'comfort'
        ? t('plus.wrapped.cards.proof.comfort', { share })
        : type === 'regular'
          ? t('plus.wrapped.cards.proof.regular', { active: n(d.activeDays), total: n(d.totalDays) })
          : type === 'explorer'
            ? t('plus.wrapped.cards.proof.explorer', { count: d.newShows })
            : t('plus.wrapped.cards.proof.loyalist', { count: d.continuedShows });
  return { type, name, flat: name.replace('\n', ' '), desc, proof };
}

/** "4 new shows" → "new shows": the number is set separately, larger. */
const stripCount = (s: string) => s.replace(/^\d[\d,.\s]*\s?/, '');

/**
 * THE INVERTED CARD. No artwork by design — so instead of a word in the
 * middle of black, the yellow becomes the ground: a plate across the card
 * with the type set in black ink on it, the one place in the deck the
 * colours swap. The type carries its own EVIDENCE — a real figure from the
 * period that earned it — so the card proves rather than asserts.
 *
 * A month gets the skewed plate and the immediate facts. A year gets a
 * stamp: squared, outlined, the year on it, and a column of evidence — an
 * award for twelve months, not a note about four weeks.
 */
export function WrappedPersonality(p: CardProps) {
  return p.unit === 'year' ? <PersonalityYear {...p} /> : <PersonalityMonth {...p} />;
}

function PersonalityMonth({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const { name, flat, desc, proof } = personality(d);
  // The type as a portrait: a still from the month held down to a night
  // level, the name enormous in white across it, the evidence in yellow
  // under it. The same scene language as scale and obsession — a person,
  // not a badge.
  const [bg] = deckArt(d).personality;
  const lines = wordLines(flat, 3);
  const size = fitSize(flat, width - 36, 92, 36, lines);
  return (
    <Canvas width={width}>
      {bg ? <Media uri={bg} style={abs({ left: 0, right: 0, top: 0, bottom: 0 })} dim={0.5} focus="top" /> : null}
      <Gradient edge="top" strength={0.9} style={{ bottom: H * 0.5 }} />
      <Gradient edge="bottom" strength={1} style={{ top: H * 0.3 }} />
      <YellowLight size={width * 1.3} x={width * 0.2} y={H * 0.58} strength={0.9} />
      <Masthead label={label} />
      <View style={abs({ left: 18, right: 18, top: H * 0.34 })}>
        <Label style={{ marginBottom: 10 }}>{t('plus.wrapped.cards.typeKicker')}</Label>
        <Display size={size} lines={lines} minScale={0.3} colour={C.INK} style={{ textTransform: 'uppercase', letterSpacing: -size * 0.04, lineHeight: size * 1.02 }}>{name}</Display>
        <View style={{ height: 4, width: 56, backgroundColor: C.YELLOW, marginTop: 14 }} />
        <Display size={28} lines={2} colour={C.YELLOW} style={{ marginTop: 14, letterSpacing: -0.8 }}>{proof}</Display>
        <Sub size={15} colour={C.INK} style={{ marginTop: 8, fontWeight: '600' }}>{desc}</Sub>
      </View>
      <View style={abs({ left: 18, right: 18, bottom: 68, flexDirection: 'row', alignItems: 'center' })}>
        <View style={{ flex: 1 }}>
          <Display size={30} lines={1} colour={C.INK}>{n(d.newShows)}</Display>
          <Sub size={12}>{stripCount(t('plus.wrapped.cards.typeNew', { count: d.newShows }))}</Sub>
        </View>
        <View style={{ width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.18)', marginHorizontal: 16 }} />
        <View style={{ flex: 1 }}>
          <Display size={30} lines={1} colour={C.INK}>{n(d.continuedShows)}</Display>
          <Sub size={12}>{stripCount(t('plus.wrapped.cards.typeContinued', { count: d.continuedShows }))}</Sub>
        </View>
      </View>
      <Foot handle={handle} right={t('plus.wrapped.cards.typeFoot')} />
    </Canvas>
  );
}

function PersonalityYear({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const { name, flat, desc, proof } = personality(d);
  const plateTop = H * 0.2;
  const plateH = H * 0.26;
  const size = fitSize(flat, width - 36 - 28, 66);
  const rows: [string, string][] = [
    [proof, ''],
    [n(d.newShows), stripCount(t('plus.wrapped.cards.typeNew', { count: d.newShows }))],
    [n(d.continuedShows), stripCount(t('plus.wrapped.cards.typeContinued', { count: d.continuedShows }))],
    [`${n(d.activeDays)} / ${n(d.totalDays)}`, t('plus.wrapped.cards.activityStreak', { count: d.totalDays }).replace(/^[\d,.\s]+/, '')],
  ];
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.4} x={width * 0.5} y={plateTop + plateH / 2} strength={0.8} />
      <Masthead label={label} />
      <View style={abs({ left: 18, top: plateTop - 30 })}>
        <Label>{t('plus.wrapped.cards.typeKickerYear', { period: label })}</Label>
      </View>
      {/* The stamp: squared, inset outline, the year in the corner. */}
      <View style={abs({ left: 18, right: 18, top: plateTop, height: plateH, backgroundColor: C.YELLOW, padding: 8 })}>
        <View style={{ flex: 1, borderWidth: 2, borderColor: '#0A0A0A', justifyContent: 'center', paddingHorizontal: 12 }}>
          <Display size={size} lines={wordLines(flat, 3)} minScale={0.3} colour="#0A0A0A" style={{ textTransform: 'uppercase', letterSpacing: -3, lineHeight: size * 1.02 }}>{name}</Display>
          <Label colour="#0A0A0A" size={12} style={{ position: 'absolute', right: 12, bottom: 10 }}>{label}</Label>
        </View>
      </View>
      <View style={abs({ left: 18, right: 18, top: plateTop + plateH + 22, bottom: 70 })}>
        <Sub size={15} colour={C.INK} style={{ fontWeight: '700', lineHeight: 20 }} numberOfLines={2}>{desc}</Sub>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {rows.map(([big, small], i) => (
            <View key={i}>
              {i > 0 ? <Rule /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 6, gap: 10 }}>
                <Display size={i === 0 ? 24 : 26} lines={1} colour={i === 0 ? C.YELLOW : C.INK} style={{ flexShrink: 1 }}>{big}</Display>
                {small ? <Sub size={13} style={{ flexShrink: 1 }} numberOfLines={1}>{small}</Sub> : null}
              </View>
            </View>
          ))}
        </View>
      </View>
      <Foot handle={handle} right={t('plus.wrapped.cards.typeFoot')} />
    </Canvas>
  );
}

/* ── 06 · biggest day ───────────────────────────────────────────────────── */
/**
 * A month: an abstract calendar with the day lit, the question, the number.
 * A year: the date itself is the headline — one day out of 365 — with the
 * year as a strip of twelve months, its month lit, and a drier line under
 * the number, because a year's biggest day deserves an incident report.
 */
export function WrappedBiggestDay(p: CardProps) {
  return p.unit === 'year' ? <BiggestDayYear {...p} /> : <BiggestDayMonth {...p} />;
}

function BiggestDayMonth({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const locale = currentLocale();
  const date = new Date(`${d.biggestDay.date}T00:00:00`);
  const dayText = date.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const count = n(d.biggestDay.count);
  // An abstract month: six rows of seven, the day lit. Cells are floored and
  // the grid sized by height as well as width, so the 31st never wraps into
  // the question below — everything on this card is in flow, top to bottom.
  const dayIndex = Math.max(0, date.getDate() - 1);
  const gap = 6;
  const cell = Math.floor(Math.min((width - 36 - gap * 6) / 7, (H * 0.3 - gap * 5) / 6));
  const gridW = cell * 7 + gap * 6 + 1;
  const numRoom = width * 0.5;
  const numSize = Math.min(numberSize(count, numRoom), H * 0.2);
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.2} x={width * 0.62} y={H * 0.52} strength={1.1} />
      <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 20 }}>
        <Label>{t('plus.wrapped.cards.hookKicker')}</Label>
        <Period size={22}>{label}</Period>
        <View style={{ height: H * 0.04 }} />
        <View style={{ width: gridW, flexDirection: 'row', flexWrap: 'wrap', gap, opacity: 0.9 }}>
          {Array.from({ length: 42 }, (_, i) => (
            <View key={i} style={{ width: cell, height: cell * 0.72, borderRadius: 6, backgroundColor: i === dayIndex ? C.YELLOW : '#141417', borderWidth: i === dayIndex ? 0 : 1, borderColor: 'rgba(255,255,255,0.06)' }} />
          ))}
        </View>
        <View style={{ height: H * 0.035 }} />
        <Display size={30} lines={2} colour={C.INK} style={{ textTransform: 'uppercase', letterSpacing: -1 }}>{t('plus.wrapped.cards.dayKicker', { date: dayText })}</Display>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 }}>
          <View style={{ maxWidth: numRoom, flexShrink: 1 }}>
            <Display size={numSize} lines={1} minScale={0.3} colour={C.YELLOW} style={{ letterSpacing: -5, lineHeight: numSize * 1.02 }}>{count}</Display>
          </View>
          <View style={{ marginLeft: 12, marginBottom: numSize * 0.12, flex: 1 }}>
            <Display size={30} lines={1} colour={C.INK} style={{ textTransform: 'uppercase' }}>{t('plus.wrapped.cards.dayUnit', { count: d.biggestDay.count })}</Display>
            <View style={{ height: 6, width: '80%', backgroundColor: C.YELLOW, marginTop: 6, transform: [{ skewX: '-18deg' }] }} />
          </View>
        </View>
        <Sub size={18} colour={C.INK} style={{ fontWeight: '600', marginTop: 18 }}>{t('plus.wrapped.cards.dayLine')}</Sub>
        <View style={{ flex: 1 }} />
      </View>
      <Brand handle={handle} right={t('plus.wrapped.cards.dayFoot')} />
    </Canvas>
  );
}

function BiggestDayYear({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const locale = currentLocale();
  const date = new Date(`${d.biggestDay.date}T00:00:00`);
  const dateText = date.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const weekday = date.toLocaleDateString(locale, { weekday: 'long' });
  const count = n(d.biggestDay.count);
  const month = date.getMonth();
  const gap = 4;
  const cell = Math.floor((width - 36 - gap * 11) / 12);
  const dateLines = wordLines(dateText, 2);
  const dateSize = fitSize(dateText, width - 36, 64, 30, dateLines);
  const numSize = Math.min(numberSize(count, width * 0.55), H * 0.22);
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.3} x={width * 0.3} y={H * 0.62} strength={1.1} />
      <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 20 }}>
        <Label>{t('plus.wrapped.cards.hookKicker')}</Label>
        <Period size={22}>{label}</Period>
        <View style={{ height: H * 0.06 }} />
        <Label style={{ marginBottom: 8 }}>{t('plus.wrapped.cards.dayKickerYear')}</Label>
        <Display size={dateSize} lines={dateLines} minScale={0.3} colour={C.INK} style={{ textTransform: 'uppercase', letterSpacing: -dateSize * 0.04, lineHeight: dateSize * 1.02 }}>{dateText}</Display>
        {/* the year as twelve months, the one it happened in lit */}
        <View style={{ flexDirection: 'row', gap, marginTop: 18 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <View key={i} style={{ width: cell, height: 10, borderRadius: 3, backgroundColor: i === month ? C.YELLOW : '#1A1A1E' }} />
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={{ maxWidth: width * 0.55, flexShrink: 1 }}>
            <Display size={numSize} lines={1} minScale={0.3} colour={C.YELLOW} style={{ letterSpacing: -numSize * 0.04, lineHeight: numSize * 1.02 }}>{count}</Display>
          </View>
          <View style={{ marginLeft: 12, marginBottom: numSize * 0.14, flex: 1 }}>
            <Display size={30} lines={1} minScale={0.5} colour={C.INK} style={{ textTransform: 'uppercase' }}>{t('plus.wrapped.cards.dayUnit', { count: d.biggestDay.count })}</Display>
          </View>
        </View>
        <Sub size={18} colour={C.INK} style={{ fontWeight: '600', marginTop: 14, marginBottom: 12 }}>{t('plus.wrapped.cards.dayLineYear', { weekday })}</Sub>
      </View>
      <Brand handle={handle} right={t('plus.wrapped.cards.dayFoot')} />
    </Canvas>
  );
}

/* ── 07 · activity ──────────────────────────────────────────────────────── */
/**
 * Month = days, year = months. A month is a field of day cells big enough to
 * be the picture, lit by how heavy each day was, with THE day glowing. A
 * year is twelve bars, one a month, and the day count set as the headline.
 */
export function WrappedActivity(p: CardProps) {
  return p.unit === 'year' ? <ActivityYear {...p} /> : <ActivityMonth {...p} />;
}

function ActivityMonth({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const rows = Math.max(1, Math.ceil(d.days.length / 7));
  const gap = 7;
  // The field takes as much of the card as its rows allow, floored so the
  // seventh cell never wraps, and capped so five rows leave room below.
  const cell = Math.floor(Math.min((width - 36 - gap * 6) / 7, (H * 0.4 - gap * (rows - 1)) / rows));
  const realStreak = d.longestStreak >= 2;
  // "A lot" is a claim; below two days in five it is not true, and the card
  // says the plainer thing instead.
  const aLot = d.totalDays > 0 && d.activeDays / d.totalDays >= 0.4;
  return (
    <Canvas width={width}>
      <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 20 }}>
        <Label>{t('plus.wrapped.cards.hookKicker')}</Label>
        <Period size={22}>{label}</Period>
        <View style={{ height: H * 0.035 }} />
        <Display size={34} lines={3} colour={C.INK} style={{ textTransform: 'uppercase', letterSpacing: -1.2 }}>{t(aLot ? 'plus.wrapped.cards.activityTitle' : 'plus.wrapped.cards.activityTitleSome')}</Display>
        <View style={{ marginTop: 16 }}>
          <ActivityGrid days={d.days} width={width - 36} gap={gap} cell={cell} />
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Display size={72} lines={1} colour={C.YELLOW} style={{ flexShrink: 1, letterSpacing: -3 }}>{n(d.activeDays)}</Display>
          <Display size={24} lines={1} colour={C.GREY} style={{ marginLeft: 10, flexShrink: 1, textTransform: 'uppercase' }}>{t('plus.wrapped.cards.activityDays', { active: '', total: n(d.totalDays) }).replace(/^\s*\/\s*/, '/ ')}</Display>
        </View>
        {realStreak ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: 6 }}>
            <Display size={26} lines={1} colour={C.INK} style={{ flexShrink: 1 }}>{t('plus.wrapped.cards.activityStreak', { count: d.longestStreak })}</Display>
            <Sub size={15} colour={C.GREY} style={{ marginLeft: 8, flexShrink: 1 }}>{t('plus.wrapped.cards.activityStreakSub')}</Sub>
          </View>
        ) : (
          <Sub size={15} colour={C.GREY} style={{ marginTop: 6 }}>{t('plus.wrapped.activeDaysSub', { count: d.activeDays })}</Sub>
        )}
        <View style={{ height: 16 }} />
      </View>
      <Brand handle={handle} right={t('plus.wrapped.cards.activityFoot')} />
    </Canvas>
  );
}

function ActivityYear({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const months = monthlyActivity(d.days);
  const count = n(d.activeDays);
  const numSize = Math.min(numberSize(count, width * 0.6), H * 0.2);
  const aLot = d.totalDays > 0 && d.activeDays / d.totalDays >= 0.4;
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.3} x={width * 0.25} y={H * 0.72} strength={1} />
      <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 20 }}>
        <Label>{t('plus.wrapped.cards.hookKicker')}</Label>
        <Period size={22}>{label}</Period>
        <View style={{ height: H * 0.04 }} />
        <Display size={34} lines={3} colour={C.INK} style={{ textTransform: 'uppercase', letterSpacing: -1.2 }}>{t(aLot ? 'plus.wrapped.cards.activityTitle' : 'plus.wrapped.cards.activityTitleSome')}</Display>
        <Sub size={15} style={{ marginTop: 8 }}>{t('plus.wrapped.cards.activityYearSub', { active: count, total: n(d.totalDays) })}</Sub>
        <View style={{ marginTop: 22 }}>
          <MonthBars months={months} width={width - 36} height={H * 0.2} locale={currentLocale()} />
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={{ maxWidth: width * 0.6, flexShrink: 1 }}>
            <Display size={numSize} lines={1} minScale={0.3} colour={C.YELLOW} style={{ letterSpacing: -numSize * 0.04, lineHeight: numSize * 1.02 }}>{count}</Display>
          </View>
          <Display size={30} lines={1} colour={C.INK} style={{ marginLeft: 12, marginBottom: numSize * 0.12, flex: 1, textTransform: 'uppercase' }}>{t('plus.wrapped.cards.activityYearDays', { count: d.activeDays })}</Display>
        </View>
        {d.longestStreak >= 2 ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: 8 }}>
            <Display size={26} lines={1} colour={C.INK} style={{ flexShrink: 1 }}>{t('plus.wrapped.cards.activityStreak', { count: d.longestStreak })}</Display>
            <Sub size={15} colour={C.GREY} style={{ marginLeft: 8, flexShrink: 1 }}>{t('plus.wrapped.cards.activityStreakSub')}</Sub>
          </View>
        ) : null}
        <View style={{ height: 16 }} />
      </View>
      <Brand handle={handle} right={t('plus.wrapped.cards.activityFoot')} />
    </Canvas>
  );
}

/* ── 08 · the hero share card ───────────────────────────────────────────── */
/**
 * THE ONE TO POST. Identity, not a summary of the deck: the period as a
 * poster title, the watching type, three numbers, three names. A month
 * leads with a picture and sets the month word under it; a year is the year
 * itself, across the whole card, over a full-bleed still.
 */
export function WrappedHeroShare(p: CardProps) {
  return p.unit === 'year' ? <HeroYear {...p} /> : <HeroMonth {...p} />;
}

function heroFacts(d: Wrapped) {
  const type = watchingType(d, d.totalDays);
  const typeName = t(`plus.wrapped.cards.types.${type}.name` as 'plus.wrapped.cards.types.loyalist.name').replace('\n', ' ');
  const hours = Math.round(d.minutes / 60);
  const titles = d.topShows.slice(0, 3).map((s) => s.name).join(' · ');
  return { typeName, hours, titles };
}

function TypeChip({ children }: { children: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: C.YELLOW, paddingHorizontal: 12, paddingVertical: 6, transform: [{ skewX: '-10deg' }] }}>
      <Text style={{ color: '#0A0A0A', fontSize: 15, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase', transform: [{ skewX: '10deg' }] }}>{children}</Text>
    </View>
  );
}

function HeroStats({ d, hours, size, stacked }: { d: Wrapped; hours: number; size: number; stacked?: boolean }) {
  const items = [
    hours >= 1 ? `${n(hours)}h` : null,
    d.episodes > 0 ? plural('plus.wrapped.cards.scaleEpisodes', d.episodes) : null,
    d.films > 0 ? plural('plus.wrapped.cards.scaleFilms', d.films) : null,
  ].filter((s): s is string => !!s);
  return (
    <View style={stacked ? undefined : { flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
      {items.map((s) => (
        <Display key={s} size={size} lines={1} colour={C.INK} style={{ flexShrink: 1 }}>{s}</Display>
      ))}
    </View>
  );
}

function HeroMonth({ d, label, unit, width, handle, name }: CardProps) {
  const H = width * (16 / 9);
  const [a, b] = deckArt(d).hero;
  const { typeName, hours, titles } = heroFacts(d);
  const month = periodWord(label);
  const year = label.split(' ').slice(1).join(' ') || label;
  const who = name ?? handle;
  const size = fitSize(month, width - 36, 96, 40, 1);
  return (
    <Canvas width={width}>
      {a ? <Media uri={a} style={abs({ left: 0, right: 0, top: 0, height: H * 0.52 })} fade="bottom" dim={0.1} focus="top" /> : <YellowLight size={width * 1.3} x={width * 0.5} y={H * 0.25} />}
      {b ? <Media uri={b} style={abs({ right: 18, top: H * 0.3, width: width * 0.22, height: width * 0.33, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' })} /> : null}
      <Gradient edge="bottom" strength={1} style={{ top: H * 0.3, bottom: H * 0.3 }} />
      <YellowLight size={width * 1.1} x={width * 0.15} y={H * 0.6} strength={0.5} />
      <Masthead label={label} />
      {/* Bounded top AND bottom, the names pinned to the foot, so a stacked
          set of three numbers can never push them onto the brand strip. */}
      <View style={abs({ left: 18, right: 18, top: H * 0.46, bottom: 64 })}>
        {who ? <Label colour={C.GREY} size={12}>{t('plus.wrapped.cards.heroName', { name: who })}</Label> : null}
        <Display size={size} lines={1} minScale={0.3} colour={C.YELLOW} style={{ textTransform: 'uppercase', letterSpacing: -size * 0.045, lineHeight: size * 1.02 }}>{month}</Display>
        <View style={{ marginTop: 10 }}>
          <TypeChip>{typeName}</TypeChip>
        </View>
        <View style={{ marginTop: 14 }}>
          <HeroStats d={d} hours={hours} size={28} stacked />
        </View>
        <View style={{ flex: 1 }} />
        {titles ? <Sub size={14} colour={C.INK} style={{ fontWeight: '600' }} numberOfLines={1}>{titles}</Sub> : null}
      </View>
      <View style={abs({ left: 0, right: 0, bottom: 0 })}>
        <Rule />
        <Brand handle={handle} right={`${t('plus.wrapped.cards.hookKicker')} · ${year}`} />
      </View>
    </Canvas>
  );
}

function HeroYear({ d, label, width, handle, name }: CardProps) {
  const H = width * (16 / 9);
  const [a, b] = deckArt(d).hero;
  const { typeName, hours, titles } = heroFacts(d);
  const who = name ?? handle;
  // The year across the whole width: four digits, one line, as big as the
  // card is wide.
  const size = Math.min((width - 20) / (label.length * 0.6), H * 0.19);
  return (
    <Canvas width={width}>
      {a ? <Media uri={a} style={abs({ left: 0, right: 0, top: 0, bottom: 0 })} dim={0.4} focus="top" /> : <YellowLight size={width * 1.3} x={width * 0.5} y={H * 0.3} />}
      <Gradient edge="top" strength={0.9} style={{ bottom: H * 0.55 }} />
      <Gradient edge="bottom" strength={1} style={{ top: H * 0.35 }} />
      {b ? <Media uri={b} style={abs({ right: 18, top: H * 0.11, width: width * 0.18, height: width * 0.27, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' })} /> : null}
      <YellowLight size={width * 1.4} x={width * 0.3} y={H * 0.42} strength={0.9} />
      <Masthead label={label} />
      <View style={abs({ left: 12, right: 12, top: H * 0.3 })}>
        <Display size={size} lines={1} minScale={0.3} colour={C.YELLOW} align="left" style={{ letterSpacing: -size * 0.05, lineHeight: size * 1.02 }}>{label}</Display>
      </View>
      <View style={abs({ left: 18, right: 18, bottom: 62 })}>
        {who ? <Label colour={C.GREY} size={12} style={{ marginBottom: 8 }}>{t('plus.wrapped.cards.heroName', { name: who })}</Label> : null}
        <TypeChip>{typeName}</TypeChip>
        <View style={{ marginTop: 16 }}>
          <HeroStats d={d} hours={hours} size={34} stacked />
        </View>
        {titles ? <Sub size={14} colour={C.INK} style={{ marginTop: 14, fontWeight: '600' }} numberOfLines={2}>{titles}</Sub> : null}
      </View>
      <View style={abs({ left: 0, right: 0, bottom: 0 })}>
        <Rule />
        <Brand handle={handle} right={`${t('plus.wrapped.cards.hookKicker')} · ${label}`} />
      </View>
    </Canvas>
  );
}
