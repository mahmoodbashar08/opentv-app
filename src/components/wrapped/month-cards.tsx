/**
 * The month deck (1.6.5). Each card is an object from the cinema or the TV,
 * not a template with a number on it: a marquee, a contact sheet, a ticket
 * stub, a TV listings page, a stamp.
 *
 * WHY IT WAS REBUILT. A month of five films came out as "you definitely had a
 * type", three of the five posters, a TV card reading "0 shows you stayed
 * with", and a calendar of grey squares. Nothing anyone would post. The rules
 * now: every title appears (the contact sheet), no card renders a zero (see
 * `wrappedMonthSlides`), and type never sits on raw artwork — it gets a solid
 * ground or a picture dimmed to night.
 */
import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
import { filmOfTheMonth, watchingType } from '@/pure';
import type { Wrapped } from '@/stats-calc';

import type { CardProps } from './cards';
import { APP_ICON, Brand, Canvas, Display, Label, Media, Sub, YellowLight, fitSize, wordLines, wrappedColours as C } from './primitives';

const n = (v: number) => formatCount(v, currentLocale());
const abs = (s: ViewStyle): ViewStyle => ({ position: 'absolute', ...s });
const INK = '#0A0A0A';
const PAPER = '#F6F2E7';
const tt = (key: string, opts?: Record<string, unknown>) => t(key as any, opts as any) as string;
const m = (key: string, opts?: Record<string, unknown>) => tt(`plus.wrapped.cards.m.${key}`, opts);

const shortDate = (at: string | Date) =>
  (typeof at === 'string' ? new Date(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`) : at).toLocaleDateString(currentLocale(), {
    day: 'numeric',
    month: 'short',
  });

/** Small masthead: one line, so the card below it gets the room. */
function Head({ label, kicker }: { label: string; kicker?: string }) {
  return (
    <View style={abs({ left: 18, top: 18, right: 18 })}>
      <Label size={10}>{kicker ?? tt('plus.wrapped.cards.hookKicker')}</Label>
      <Text style={{ color: C.INK, fontSize: 17, fontWeight: '900', letterSpacing: -0.4, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function Foot({ handle, right }: { handle: string | null; right?: string }) {
  return (
    <View style={abs({ left: 0, right: 0, bottom: 0 })}>
      <Brand handle={handle} right={right} />
    </View>
  );
}

/** "5 films · 12 episodes", only the parts that are not zero. */
function counts(d: Wrapped): string {
  return [
    d.films > 0 ? tt('plus.wrapped.cards.scaleFilms', { count: d.films }).replace(String(d.films), n(d.films)) : null,
    d.episodes > 0 ? tt('plus.wrapped.cards.scaleEpisodes', { count: d.episodes }).replace(String(d.episodes), n(d.episodes)) : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
}

/** Everything watched, as frames: shows first (with their episode count), then films by date. */
function frames(d: Wrapped) {
  return [
    ...d.topShows.map((s) => ({ poster: s.poster, title: s.name, note: `${n(s.episodes)} EP` })),
    ...d.filmList.map((f) => ({ poster: f.poster, title: f.title, note: f.at ? shortDate(f.at).toUpperCase() : '' })),
  ];
}

/* ── marquee ─────────────────────────────────────────────────────────────── */
/**
 * The cinema's own sign: a backlit letterboard in a frame of bulbs, the month
 * on it like the week's feature. Lobby posters of what played underneath.
 */
export function MonthMarquee({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const hours = Math.round(d.minutes / 60);
  const big = n(hours >= 1 ? hours : d.minutes);
  const unit = tt(hours >= 1 ? 'plus.wrapped.cards.scaleHours' : 'plus.wrapped.cards.scaleMinutes', { count: hours >= 1 ? hours : d.minutes });
  const month = label.split(' ')[0] ?? label;
  const boardW = width - 36;
  const bulbs = Math.floor(boardW / 17);
  const lobby = frames(d).filter((f) => f.poster).slice(0, 4);
  const posterW = Math.min((width - 36 - 10 * 3) / 4, H * 0.1);
  const monthSize = fitSize(month, boardW - 44, 52, 26, 1);
  const numSize = Math.min(100, (boardW - 44) / Math.max(1, (big.length + unit.length * 0.55) * 0.62));
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.6} x={width * 0.5} y={H * 0.36} strength={1.1} />
      <Head label={label} />
      <View style={abs({ left: 18, right: 18, top: H * 0.13 })}>
        <View style={{ backgroundColor: '#121212', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,212,0,0.35)' }}>
          <BulbRow count={bulbs} />
          <View style={{ backgroundColor: PAPER, marginHorizontal: 12, marginVertical: 10, borderRadius: 4, paddingVertical: 18, paddingHorizontal: 10, alignItems: 'center' }}>
            {/* the letterboard's grooves */}
            {Array.from({ length: 7 }, (_, i) => (
              <View key={i} style={abs({ left: 0, right: 0, top: 14 + i * 26, height: 1, backgroundColor: 'rgba(0,0,0,0.06)' })} />
            ))}
            <Text style={{ color: INK, fontSize: 13, fontWeight: '900', letterSpacing: 4, textTransform: 'uppercase' }}>{m('nowShowing')}</Text>
            <Display size={monthSize} lines={1} colour={INK} align="center" style={{ textTransform: 'uppercase', marginTop: 6, letterSpacing: 1 }}>{month}</Display>
            <View style={{ height: 3, width: 60, backgroundColor: INK, marginVertical: 10 }} />
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Display size={numSize} lines={1} colour={INK} style={{ letterSpacing: -numSize * 0.04 }}>{big}</Display>
              <Display size={numSize * 0.36} lines={1} colour={INK} style={{ marginLeft: 8, textTransform: 'uppercase' }}>{unit}</Display>
            </View>
          </View>
          <BulbRow count={bulbs} />
        </View>
        <Display size={24} lines={1} colour={C.YELLOW} align="center" style={{ marginTop: 18 }}>{counts(d)}</Display>
        {/* IN FLOW, under the counts — pinned to the foot, one poster in a
            small month sat on top of "4 episodes". */}
        {lobby.length ? (
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            {lobby.map((f, i) => (
              <Image key={i} source={{ uri: f.poster! }} style={{ width: posterW, height: posterW * 1.5, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }} contentFit="cover" cachePolicy="disk" />
            ))}
          </View>
        ) : null}
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

function BulbRow({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.YELLOW, opacity: i % 2 ? 0.75 : 1, shadowColor: C.YELLOW, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } }} />
      ))}
    </View>
  );
}

/* ── contact sheet ───────────────────────────────────────────────────────── */
/**
 * EVERY title, on film. Strips of frames with sprocket holes, the date (or the
 * episode count) printed in the rebate like edge code. The frame size follows
 * the count, so two films are two big frames and twelve are a sheet.
 */
export function MonthContactSheet({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const all = frames(d);
  const max = 12;
  const shown = all.length > max ? all.slice(0, max - 1) : all;
  const more = all.length - shown.length;
  const count = shown.length + (more > 0 ? 1 : 0);
  const perRow = count <= 2 ? count : count <= 6 ? 3 : 4;
  const rows = Math.ceil(count / perRow);
  const gap = 6;
  const rebate = 14;
  const room = H * 0.62;
  let fw = (width - 24 - gap * (perRow - 1)) / perRow;
  const rowH = (w: number) => w * 1.5 + rebate * 2 + 8;
  if (rows * rowH(fw) + (rows - 1) * 8 > room) fw = (room - (rows - 1) * 8) / rows / 1.5 - (rebate * 2 + 8) / 1.5;
  const stripW = perRow * fw + gap * (perRow - 1) + 24;
  const cells: ({ poster: string | null; title: string; note: string } | 'more')[] = [...shown, ...(more > 0 ? (['more'] as const) : [])];
  return (
    <Canvas width={width}>
      <Head label={label} kicker={m('sheetTitle')} />
      <View style={abs({ left: 0, right: 0, top: H * 0.13, alignItems: 'center', gap: 8 })}>
        {Array.from({ length: rows }, (_, r) => (
          <View key={r} style={{ width: stripW, backgroundColor: '#151310', paddingHorizontal: 12, paddingVertical: 4 }}>
            <Sprockets width={stripW - 24} />
            <View style={{ flexDirection: 'row', gap, marginVertical: 2 }}>
              {cells.slice(r * perRow, r * perRow + perRow).map((c, i) => (
                <View key={i} style={{ width: fw }}>
                  {c === 'more' ? (
                    <View style={{ width: fw, height: fw * 1.5, borderRadius: 2, backgroundColor: '#22201C', alignItems: 'center', justifyContent: 'center' }}>
                      <Display size={Math.min(34, fw * 0.4)} lines={1} colour={C.YELLOW}>{m('sheetMore', { count: more + 1 }).replace(String(more + 1), n(more + 1))}</Display>
                    </View>
                  ) : c.poster ? (
                    <Image source={{ uri: c.poster }} style={{ width: fw, height: fw * 1.5, borderRadius: 2 }} contentFit="cover" cachePolicy="disk" />
                  ) : (
                    <View style={{ width: fw, height: fw * 1.5, borderRadius: 2, backgroundColor: '#22201C', padding: 6, justifyContent: 'flex-end' }}>
                      <Text numberOfLines={4} style={{ color: C.INK, fontSize: Math.max(9, fw * 0.11), fontWeight: '800' }}>{c.title}</Text>
                    </View>
                  )}
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: '#E8A33C', fontSize: 8.5, fontWeight: '800', letterSpacing: fw < 70 ? 0.4 : 1, marginTop: 3, fontVariant: ['tabular-nums'] }}>
                    {c === 'more' ? '' : fw < 70 ? c.note : `${r * perRow + i + 1}A  ${c.note}`}
                  </Text>
                </View>
              ))}
            </View>
            <Sprockets width={stripW - 24} />
          </View>
        ))}
      </View>
      <View style={abs({ left: 18, right: 18, bottom: 62 })}>
        <Display size={26} lines={1} colour={C.INK}>{counts(d)}</Display>
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

function Sprockets({ width }: { width: number }) {
  const holes = Math.max(4, Math.floor(width / 13));
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', height: 7, marginVertical: 3 }}>
      {Array.from({ length: holes }, (_, i) => (
        <View key={i} style={{ width: 6, height: 7, borderRadius: 1.5, backgroundColor: '#050505' }} />
      ))}
    </View>
  );
}

/* ── ticket stub ─────────────────────────────────────────────────────────── */
/** The film of the month as the ticket you kept: your rating printed on it. */
export function MonthTicket({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const f = filmOfTheMonth(d.filmList);
  if (!f) return null;
  const tw = width - 44;
  const posterW = tw * 0.34;
  const titleSize = fitSize(f.title, tw - posterW - 44, 34, 18, wordLines(f.title, 3));
  const stars = f.stars ? '★'.repeat(f.stars) + '☆'.repeat(5 - f.stars) : null;
  const notch = 13;
  return (
    <Canvas width={width}>
      {f.poster ? <Image source={{ uri: f.poster }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={28} cachePolicy="disk" /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 0.62 }]} />
      <Head label={label} kicker={m('ticketKicker')} />
      <View style={abs({ left: 22, right: 22, top: H * 0.16 })}>
        <View style={{ backgroundColor: PAPER, borderRadius: 14, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.YELLOW, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: INK, fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>OPENTV</Text>
            <Text style={{ color: INK, fontSize: 11, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' }}>{m('admitOne')}</Text>
          </View>
          <View style={{ flexDirection: 'row', padding: 14, gap: 14 }}>
            {f.poster ? <Image source={{ uri: f.poster }} style={{ width: posterW, height: posterW * 1.5, borderRadius: 6 }} contentFit="cover" cachePolicy="disk" /> : null}
            <View style={{ flex: 1, justifyContent: 'space-between' }}>
              <View>
                <Display size={titleSize} lines={wordLines(f.title, 3)} minScale={0.4} colour={INK} style={{ textTransform: 'uppercase', letterSpacing: -titleSize * 0.03 }}>{f.title}</Display>
                {f.year ? <Text style={{ color: '#55524A', fontSize: 13, fontWeight: '700', marginTop: 4 }}>{f.year}</Text> : null}
              </View>
              {f.rewatch ? <Text style={{ color: '#55524A', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' }}>{m('ticketRewatch')}</Text> : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 16, gap: 10 }}>
            <Field k={m('ticketSeen')} v={f.at ? shortDate(f.at) : '—'} />
            <Field k={m('ticketRuntime')} v={m('minutes', { count: f.minutes })} />
            <Field k={m('ticketRating')} v={stars ?? m('ticketUnrated')} gold={!!stars} />
          </View>
          {/* the perforation, with the two half-circle notches cut out of it */}
          <View style={{ height: notch * 2, justifyContent: 'center' }}>
            <View style={{ marginHorizontal: notch + 6, borderTopWidth: 2, borderColor: '#C9C3B3', borderStyle: 'dashed' }} />
            <View style={abs({ left: -notch, top: 0, width: notch * 2, height: notch * 2, borderRadius: notch, backgroundColor: '#0B0B0B' })} />
            <View style={abs({ right: -notch, top: 0, width: notch * 2, height: notch * 2, borderRadius: notch, backgroundColor: '#0B0B0B' })} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 4, paddingBottom: 16 }}>
            <View style={{ flex: 1, marginRight: 14 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: INK, fontSize: 11, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' }}>{m('ticketKicker')}</Text>
              <Text style={{ color: '#55524A', fontSize: 12, fontWeight: '700', marginTop: 2 }}>{label}</Text>
            </View>
            <Barcode seed={f.title} />
          </View>
        </View>
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

function Field({ k, v, gold }: { k: string; v: string; gold?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ color: '#7A7569', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' }}>{k}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: gold ? '#C99A00' : INK, fontSize: 15, fontWeight: '900', marginTop: 3 }}>{v}</Text>
    </View>
  );
}

/** Bars from the title's letters, so every ticket's code is its own. */
function Barcode({ seed }: { seed: string }) {
  const bars = Array.from({ length: 26 }, (_, i) => ((seed.charCodeAt(i % Math.max(1, seed.length)) ?? 7) * (i + 3)) % 4);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', height: 32, gap: 1.5 }}>
      {bars.map((b, i) => (
        <View key={i} style={{ width: b + 1, backgroundColor: INK }} />
      ))}
    </View>
  );
}

/* ── TV listings ─────────────────────────────────────────────────────────── */
/** The biggest day, printed like the evening's TV guide: time, title, episode. */
export function MonthGuide({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const day = new Date(`${d.biggestDay.date}T12:00:00`);
  const weekday = day.toLocaleDateString(currentLocale(), { weekday: 'long' });
  const date = day.toLocaleDateString(currentLocale(), { day: 'numeric', month: 'long' });
  // A run of the same show is one listing ("8 EP"), not eight identical rows.
  const items: { title: string; sub: string; time: Date }[] = [];
  let run = 0;
  for (const x of d.dayItems(d.biggestDay.date)) {
    const last = items[items.length - 1];
    if (last && last.title === x.title && /^S\d/.test(x.sub)) {
      run++;
      last.sub = `${n(run)} EP`;
    } else {
      run = 1;
      items.push({ ...x });
    }
  }
  // ONE SHOW ALL DAY is a binge, not a schedule: a one-row listing is an
  // empty card, so the show itself takes it.
  if (items.length === 1) {
    const show = d.topShows.find((x) => x.name === items[0].title);
    const art = show?.backdrop ?? show?.poster ?? null;
    const t1 = items[0].title;
    const ts = fitSize(t1, width - 36, 52, 24, wordLines(t1, 3));
    return (
      <Canvas width={width}>
        {art ? <Media uri={art} style={abs({ left: 0, right: 0, top: 0, height: H * 0.62 })} dim={0.35} fade="bottom" focus="top" /> : null}
        <Head label={label} kicker={m('guideKicker')} />
        <View style={abs({ left: 18, right: 18, bottom: 62 })}>
          <Display size={40} lines={1} colour={C.YELLOW} style={{ textTransform: 'uppercase' }}>{weekday}</Display>
          <Display size={24} lines={1} colour={C.INK} style={{ textTransform: 'uppercase', marginBottom: 16 }}>{date}</Display>
          <Display size={120} lines={1} colour={C.YELLOW} style={{ letterSpacing: -5 }}>{n(d.biggestDay.count)}</Display>
          <Display size={ts} lines={wordLines(t1, 3)} minScale={0.3} colour={C.INK} style={{ textTransform: 'uppercase', marginTop: 4 }}>{t1}</Display>
          <Sub size={16} colour={C.INK} style={{ marginTop: 8, fontWeight: '700' }}>{tt('plus.wrapped.cards.proof.binger', { count: d.biggestDay.count }).replace(String(d.biggestDay.count), n(d.biggestDay.count))}</Sub>
        </View>
        <Foot handle={handle} />
      </Canvas>
    );
  }
  const maxRows = 6;
  const rows = items.length > maxRows ? items.slice(0, maxRows - 1) : items;
  const extra = items.length - rows.length;
  const time = (x: Date) => x.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.2} x={width * 0.85} y={H * 0.15} strength={0.7} />
      <Head label={label} kicker={m('guideKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.13 })}>
        <Display size={44} lines={1} colour={C.YELLOW} style={{ textTransform: 'uppercase' }}>{weekday}</Display>
        <Display size={30} lines={1} colour={C.INK} style={{ textTransform: 'uppercase', marginTop: 2 }}>{date}</Display>
        <View style={{ height: 3, backgroundColor: C.INK, marginTop: 14 }} />
        {rows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)', gap: 12 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: C.YELLOW, fontSize: 14, fontWeight: '900', width: 72, fontVariant: ['tabular-nums'] }}>{time(r.time)}</Text>
            <Text numberOfLines={1} style={{ flex: 1, color: C.INK, fontSize: 16, fontWeight: '800' }}>{r.title}</Text>
            <Text style={{ color: C.GREY, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{r.sub}</Text>
          </View>
        ))}
        {extra > 0 ? <Sub size={13} style={{ marginTop: 8 }}>{m('sheetMore', { count: extra }).replace(String(extra), n(extra))}</Sub> : null}
      </View>
      <View style={abs({ left: 18, right: 18, bottom: 62 })}>
        <Display size={30} lines={1} colour={C.INK}>{m('guideLine', { count: d.biggestDay.count }).replace(String(d.biggestDay.count), n(d.biggestDay.count))}</Display>
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

/* ── new vs again ────────────────────────────────────────────────────────── */
export function MonthRewatch({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const total = Math.max(1, d.firstTimes + d.rewatches);
  const barW = width - 36;
  const again = d.filmList.filter((f) => f.rewatch && f.poster).slice(0, 3);
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.3} x={width * 0.75} y={H * 0.55} strength={0.9} />
      <Head label={label} kicker={m('rewatchKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.14 })}>
        <Display size={92} lines={1} colour={C.INK} style={{ letterSpacing: -4 }}>{n(d.firstTimes)}</Display>
        <Display size={26} lines={1} colour={C.INK} style={{ textTransform: 'uppercase', marginTop: -6 }}>{m('rewatchFirst')}</Display>
        <View style={{ flexDirection: 'row', height: 18, marginVertical: 22, borderRadius: 9, overflow: 'hidden', width: barW }}>
          <View style={{ width: (barW * d.firstTimes) / total, backgroundColor: '#E9E9EE' }} />
          <View style={{ flex: 1, backgroundColor: C.YELLOW }} />
        </View>
        <Display size={92} lines={1} colour={C.YELLOW} style={{ letterSpacing: -4 }}>{n(d.rewatches)}</Display>
        <Display size={26} lines={1} colour={C.YELLOW} style={{ textTransform: 'uppercase', marginTop: -6 }}>{m('rewatchAgain')}</Display>
        {again.length ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
            {again.map((f, i) => (
              <Image key={i} source={{ uri: f.poster! }} style={{ width: 54, height: 81, borderRadius: 4 }} contentFit="cover" cachePolicy="disk" />
            ))}
          </View>
        ) : null}
        <Sub size={17} colour={C.INK} style={{ fontWeight: '700', marginTop: 18 }}>{m('rewatchLine')}</Sub>
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

/* ── the type, as a stamp ────────────────────────────────────────────────── */
function typeOf(d: Wrapped) {
  const type = watchingType(d, d.totalDays);
  const name = tt(`plus.wrapped.cards.types.${type}.name`);
  const desc = tt(`plus.wrapped.cards.types.${type}.desc`);
  const share = d.episodes > 0 ? Math.round(((d.topShows[0]?.episodes ?? 0) / d.episodes) * 100) : 0;
  const late = Math.round(d.lateShare * 100);
  const proof: Record<typeof type, string> = {
    binger: tt('plus.wrapped.cards.proof.binger', { count: d.biggestDay.count }),
    comfort: tt('plus.wrapped.cards.proof.comfort', { share }),
    regular: tt('plus.wrapped.cards.proof.regular', { active: n(d.activeDays), total: n(d.totalDays) }),
    explorer: tt('plus.wrapped.cards.proof.explorer', { count: d.newShows }),
    loyalist: tt('plus.wrapped.cards.proof.loyalist', { count: d.continuedShows }),
    filmPurist: tt('plus.wrapped.cards.proof.filmPurist', { count: d.films }),
    doubleFeature: tt('plus.wrapped.cards.proof.doubleFeature', { count: d.maxFilmsInDay }),
    nightOwl: tt('plus.wrapped.cards.proof.nightOwl', { share: late }),
  };
  return { type, name, flat: name.replace('\n', ' '), desc, proof: proof[type] };
}

/**
 * THE YELLOW CARD. The one place the deck inverts: the type set in black on a
 * yellow ground, inside a stamped border, with the evidence under it.
 */
export function MonthType({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const { name, flat, desc, proof } = typeOf(d);
  const lines = wordLines(flat, 3);
  const size = fitSize(flat, width - 76, 86, 34, lines);
  const posters = frames(d).filter((f) => f.poster).slice(0, 3);
  return (
    <Canvas width={width} style={{ backgroundColor: C.YELLOW }}>
      <View style={abs({ left: 18, top: 18, right: 18 })}>
        <Text style={{ color: INK, fontSize: 10, fontWeight: '900', letterSpacing: 1.8, textTransform: 'uppercase' }}>{tt('plus.wrapped.cards.typeKicker')}</Text>
        <Text style={{ color: INK, fontSize: 17, fontWeight: '900', marginTop: 2 }}>{label}</Text>
      </View>
      <View style={abs({ left: 18, right: 18, top: H * 0.17, borderWidth: 3, borderColor: INK, padding: 18, transform: [{ rotate: '-2deg' }] })}>
        <Display size={size} lines={lines} minScale={0.3} colour={INK} style={{ textTransform: 'uppercase', letterSpacing: -size * 0.04 }}>{name}</Display>
        <View style={{ height: 3, backgroundColor: INK, marginVertical: 14, width: 64 }} />
        <Display size={26} lines={2} colour={INK}>{proof}</Display>
      </View>
      <View style={abs({ left: 18, right: 18, top: H * 0.58 })}>
        <Sub size={18} colour={INK} style={{ fontWeight: '700' }}>{desc}</Sub>
        {posters.length ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            {posters.map((f, i) => (
              <Image key={i} source={{ uri: f.poster! }} style={{ width: 70, height: 105, borderRadius: 6, borderWidth: 2, borderColor: INK }} contentFit="cover" cachePolicy="disk" />
            ))}
          </View>
        ) : null}
      </View>
      <View style={abs({ left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 18, paddingBottom: 16 })}>
        <Image source={APP_ICON} style={{ width: 18, height: 18, borderRadius: 4 }} />
        <Text style={{ color: INK, fontSize: 11.5, fontWeight: '900', letterSpacing: 1.6 }}>OPENTV</Text>
        {handle ? <Text style={{ color: '#3A3300', fontSize: 10.5, marginLeft: 4 }}>@{handle}</Text> : null}
      </View>
    </Canvas>
  );
}

/* ── closing ─────────────────────────────────────────────────────────────── */
/**
 * THE ONE TO POST. Three posters standing tall across the top, the month in
 * yellow, your type on a chip, the numbers, and every title by name.
 */
export function MonthClosing({ d, label, width, handle, name }: CardProps) {
  const H = width * (16 / 9);
  const art = frames(d).filter((f) => f.poster).slice(0, 3);
  const { flat } = typeOf(d);
  const month = label.split(' ')[0] ?? label;
  const who = name ?? handle;
  const hours = Math.round(d.minutes / 60);
  const pw = (width - 36 - 10 * 2) / 3;
  const titles = frames(d).map((f) => f.title).join('  ·  ');
  const size = fitSize(month, width - 36, 84, 40, 1);
  const top = art[0]?.poster;
  return (
    <Canvas width={width}>
      {top ? <Media uri={top} style={abs({ left: 0, right: 0, top: 0, height: H * 0.5 })} dim={0.65} fade="bottom" /> : null}
      <YellowLight size={width * 1.2} x={width * 0.2} y={H * 0.62} strength={0.6} />
      <Head label={label} kicker={m('closingKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.12, flexDirection: 'row', gap: 10, justifyContent: art.length < 3 ? 'center' : 'flex-start' })}>
        {art.map((f, i) => (
          <Image key={i} source={{ uri: f.poster! }} style={{ width: pw, height: pw * 1.5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', transform: [{ translateY: i === 1 ? 14 : 0 }] }} contentFit="cover" cachePolicy="disk" />
        ))}
      </View>
      <View style={abs({ left: 18, right: 18, top: H * 0.48, bottom: 60 })}>
        {who ? <Label colour={C.GREY} size={11}>{tt('plus.wrapped.cards.heroName', { name: who })}</Label> : null}
        <Display size={size} lines={1} minScale={0.3} colour={C.YELLOW} style={{ textTransform: 'uppercase', letterSpacing: -size * 0.045 }}>{month}</Display>
        <View style={{ alignSelf: 'flex-start', backgroundColor: C.YELLOW, paddingHorizontal: 12, paddingVertical: 6, marginTop: 8, transform: [{ skewX: '-10deg' }] }}>
          <Text style={{ color: INK, fontSize: 14, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase', transform: [{ skewX: '10deg' }] }}>{flat}</Text>
        </View>
        <Display size={28} lines={1} colour={C.INK} style={{ marginTop: 14 }}>
          {[hours >= 1 ? `${n(hours)}h` : null, counts(d)].filter(Boolean).join('  ·  ')}
        </Display>
        <View style={{ flex: 1 }} />
        <Sub size={13} colour={C.INK} style={{ fontWeight: '600' }} numberOfLines={3}>{titles}</Sub>
      </View>
      <Foot handle={handle} right={`${tt('plus.wrapped.cards.hookKicker')}`} />
    </Canvas>
  );
}

/* ── genres ──────────────────────────────────────────────────────────────── */
/** The month's taste as one bar, cut by how much time each genre took. */
export function MonthGenres({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const top = d.topGenres.slice(0, 4);
  const total = Math.max(1, top.reduce((a, g) => a + g.minutes, 0));
  const first = top[0]?.name ?? '';
  const size = fitSize(first, width - 36, 92, 36, wordLines(first, 2));
  const shades = [C.YELLOW, '#E9E9EE', '#8C8C96', '#46464E'];
  const barW = width - 36;
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.4} x={width * 0.2} y={H * 0.3} strength={0.9} />
      <Head label={label} kicker={m('genresKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.17 })}>
        <Display size={size} lines={wordLines(first, 2)} minScale={0.3} colour={C.YELLOW} style={{ textTransform: 'uppercase', letterSpacing: -size * 0.04 }}>{first}</Display>
        {top[1] ? <Display size={26} lines={1} colour={C.INK} style={{ marginTop: 8 }}>{m('genresLine', { genre: top[1].name })}</Display> : null}
        <View style={{ flexDirection: 'row', height: 26, marginTop: 30, borderRadius: 6, overflow: 'hidden', width: barW }}>
          {top.map((g, i) => (
            <View key={g.name} style={{ width: (barW * g.minutes) / total, backgroundColor: shades[i] }} />
          ))}
        </View>
        <View style={{ marginTop: 18, gap: 12 }}>
          {top.map((g, i) => (
            <View key={g.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: shades[i] }} />
              <Text numberOfLines={1} style={{ flex: 1, color: C.INK, fontSize: 17, fontWeight: '800' }}>{g.name}</Text>
              <Text style={{ color: i === 0 ? C.YELLOW : C.GREY, fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{Math.round((g.minutes / total) * 100)}%</Text>
            </View>
          ))}
        </View>
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

/* ── the clock ───────────────────────────────────────────────────────────── */
/** Twenty-four hours as twenty-four bars: when, in the day, the watching happened. */
export function MonthClock({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const max = Math.max(1, ...d.hours);
  const peak = d.hours.indexOf(max);
  const at = new Date(2000, 0, 1, peak).toLocaleTimeString(currentLocale(), { hour: 'numeric' });
  const day = d.hours.slice(6, 18).reduce((a, b) => a + b, 0);
  const all = d.hours.reduce((a, b) => a + b, 0);
  // Said about the PEAK, so the line can never contradict the big number.
  const verdict = peak >= 21 || peak < 4 ? m('clockNight') : peak >= 8 && peak < 18 && day > all / 2 ? m('clockDay') : null;
  const gap = 3;
  const bw = (width - 36 - gap * 23) / 24;
  const chartH = H * 0.3;
  const tick = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(currentLocale(), { hour: 'numeric' });
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.3} x={18 + peak * (bw + gap)} y={H * 0.55} strength={1} />
      <Head label={label} kicker={m('clockKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.15 })}>
        <Display size={58} lines={2} colour={C.INK} style={{ textTransform: 'uppercase' }}>{m('clockPeak', { time: at })}</Display>
        {verdict ? <Display size={24} lines={1} colour={C.YELLOW} style={{ marginTop: 8 }}>{verdict}</Display> : null}
      </View>
      <View style={abs({ left: 18, right: 18, top: H * 0.42 })}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: chartH, gap }}>
          {d.hours.map((c, i) => (
            <View key={i} style={{ width: bw, height: Math.max(3, (c / max) * chartH), borderRadius: 2, backgroundColor: c === 0 ? '#1A1A1E' : C.YELLOW, opacity: c === 0 || i === peak ? 1 : 0.35 + 0.5 * (c / max) }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          {[0, 6, 12, 18].map((h) => (
            <Text key={h} style={{ color: C.FAINT, fontSize: 11, fontWeight: '800' }}>{tick(h)}</Text>
          ))}
          <Text style={{ color: C.FAINT, fontSize: 11, fontWeight: '800' }}>{tick(0)}</Text>
        </View>
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

/* ── verdict ─────────────────────────────────────────────────────────────── */
/** Your average, and how your stars actually fell. */
export function MonthVerdict({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const avg = d.averageRating ?? 0;
  const max = Math.max(1, ...d.starCounts);
  const barRoom = width - 36 - 78 - 44;
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.4} x={width * 0.3} y={H * 0.28} strength={1.1} />
      <Head label={label} kicker={m('verdictKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.15 })}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Display size={150} lines={1} colour={C.YELLOW} style={{ letterSpacing: -6 }}>{avg.toLocaleString(currentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</Display>
          <Text style={{ color: C.YELLOW, fontSize: 64, fontWeight: '900', marginLeft: 6 }}>★</Text>
        </View>
        <Display size={24} lines={1} colour={C.INK}>{m('verdictLine', { count: d.ratedCount }).replace(String(d.ratedCount), n(d.ratedCount))}</Display>
        <View style={{ marginTop: 34, gap: 12 }}>
          {[5, 4, 3, 2, 1].map((s) => {
            const c = d.starCounts[s - 1] ?? 0;
            return (
              <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text numberOfLines={1} style={{ width: 78, color: C.YELLOW, fontSize: 13 }}>{'★'.repeat(s)}</Text>
                <View style={{ width: Math.max(4, (c / max) * barRoom), height: 16, borderRadius: 4, backgroundColor: c ? '#E9E9EE' : '#1A1A1E' }} />
                <Text style={{ color: C.GREY, fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{n(c)}</Text>
              </View>
            );
          })}
        </View>
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

/** 320 → "5h 20m", 49 → "49m". */
const span = (min: number) => (min >= 60 ? `${n(Math.floor(min / 60))}h${min % 60 ? ` ${n(min % 60)}m` : ''}` : `${n(min)}m`);

/* ── top titles ──────────────────────────────────────────────────────────── */
/** The month ranked by the time each title took: the chart, numbered. */
export function MonthTop({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const rows = d.ranked.slice(0, 5);
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.3} x={width * 0.1} y={H * 0.25} strength={0.8} />
      <Head label={label} kicker={m('topKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.13, gap: 12 })}>
        {rows.map((r, i) => {
          const big = i === 0;
          const pw = big ? 74 : 50;
          return (
            <View key={`${r.title}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ width: 34, color: big ? C.YELLOW : C.INK, fontSize: big ? 44 : 30, fontWeight: '900', letterSpacing: -1.5, fontVariant: ['tabular-nums'] }}>{n(i + 1)}</Text>
              {r.poster ? (
                <Image source={{ uri: r.poster }} style={{ width: pw, height: pw * 1.5, borderRadius: 5, borderWidth: big ? 2 : 0, borderColor: C.YELLOW }} contentFit="cover" cachePolicy="disk" />
              ) : (
                <View style={{ width: pw, height: pw * 1.5, borderRadius: 5, backgroundColor: '#1A1A1E' }} />
              )}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={{ color: C.INK, fontSize: big ? 20 : 16, fontWeight: '900', letterSpacing: -0.3 }}>{r.title}</Text>
                <Text numberOfLines={1} style={{ color: big ? C.YELLOW : C.GREY, fontSize: 13, fontWeight: '800', marginTop: 3 }}>
                  {[span(r.minutes), r.film ? null : tt('plus.wrapped.cards.scaleEpisodes', { count: r.episodes }).replace(String(r.episodes), n(r.episodes))].filter(Boolean).join('  ·  ')}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

/* ── bookends ────────────────────────────────────────────────────────────── */
/** What the month opened with and what it closed with. */
export function MonthBookends({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const pw = width * 0.3;
  const half = (x: Wrapped['firstWatch'], word: string, yellow: boolean) =>
    x ? (
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        {x.poster ? <Image source={{ uri: x.poster }} style={{ width: pw, height: pw * 1.5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }} contentFit="cover" cachePolicy="disk" /> : null}
        <View style={{ flex: 1 }}>
          <Label size={11} colour={yellow ? C.YELLOW : C.GREY}>{word}</Label>
          <Display size={fitSize(x.title, width - pw - 50, 30, 16, wordLines(x.title, 3))} lines={wordLines(x.title, 3)} minScale={0.4} colour={C.INK} style={{ textTransform: 'uppercase', marginTop: 6 }}>{x.title}</Display>
          <Text style={{ color: C.GREY, fontSize: 13, fontWeight: '700', marginTop: 6 }}>
            {[shortDate(x.at), /^S\d/.test(x.sub) ? x.sub : null].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
      </View>
    ) : null;
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.2} x={width * 0.8} y={H * 0.72} strength={0.8} />
      <Head label={label} kicker={m('bookendsKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.14 })}>
        {half(d.firstWatch, m('openedWith'), false)}
        <View style={{ height: 2, backgroundColor: 'rgba(255,255,255,0.14)', marginVertical: 22 }} />
        {half(d.lastWatch, m('closedWith'), true)}
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

/* ── the night of the week ───────────────────────────────────────────────── */
export function MonthWeekday({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  // Monday first; 2024-01-01 was a Monday, so day i is Jan (1 + i).
  const order = [1, 2, 3, 4, 5, 6, 0];
  const name = (wd: number, style: 'long' | 'short') => new Date(2024, 0, wd === 0 ? 7 : wd).toLocaleDateString(currentLocale(), { weekday: style });
  const max = Math.max(1, ...d.weekdays);
  const peak = d.weekdays.indexOf(max);
  const day = name(peak, 'long');
  const size = fitSize(day, width - 36, 76, 34, 1);
  const chartH = H * 0.28;
  const bw = (width - 36 - 8 * 6) / 7;
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.3} x={18 + order.indexOf(peak) * (bw + 8) + bw / 2} y={H * 0.62} strength={1} />
      <Head label={label} kicker={m('weekdayKicker')} />
      <View style={abs({ left: 18, right: 18, top: H * 0.15 })}>
        <Display size={size} lines={1} minScale={0.3} colour={C.YELLOW} style={{ textTransform: 'uppercase', letterSpacing: -size * 0.04 }}>{day}</Display>
        <Display size={22} lines={2} colour={C.INK} style={{ marginTop: 6 }}>{m('weekdayLine', { day })}</Display>
      </View>
      <View style={abs({ left: 18, right: 18, top: H * 0.44 })}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: chartH, gap: 8 }}>
          {order.map((wd) => (
            <View key={wd} style={{ width: bw, height: Math.max(4, (d.weekdays[wd] / max) * chartH), borderRadius: 6, backgroundColor: wd === peak ? C.YELLOW : '#2A2A30' }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {order.map((wd) => (
            <Text key={wd} numberOfLines={1} style={{ width: bw, textAlign: 'center', color: wd === peak ? C.YELLOW : C.FAINT, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' }}>{name(wd, 'short')}</Text>
          ))}
        </View>
      </View>
      <Foot handle={handle} />
    </Canvas>
  );
}

/* ── summary ─────────────────────────────────────────────────────────────── */
/**
 * THE MONTH ON ONE CARD — the one people post to a story (3 Oct: Movie
 * Paradise's single recap card is what gets shared and tagged). The month, the
 * four films and four shows that took the most time, as posters with their
 * rank and the reader's own rating (films) or episode count (shows), then the
 * four numbers, then who and where. First in the deck, so it is the default
 * share; the rest of the deck stays for swiping. A section with nothing in it
 * is left out rather than drawn empty.
 */
export function MonthSummary({ d, label, width, handle }: CardProps) {
  const H = width * (16 / 9);
  const [month, year] = [label.split(' ')[0] ?? label, label.split(' ').slice(1).join(' ')];
  const films = [...d.filmList]
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || b.minutes - a.minutes)
    .slice(0, 4)
    .map((f) => ({ poster: f.poster, title: f.title, badge: f.stars ? `★ ${f.stars}` : null }));
  const shows = d.topShows.slice(0, 4).map((s) => ({ poster: s.poster, title: s.name, badge: `${n(s.episodes)} EP` }));
  const rows = [films.length ? { key: 'films', label: m('summaryTopFilms'), items: films } : null, shows.length ? { key: 'shows', label: m('summaryTopShows'), items: shows } : null].filter(
    (r): r is { key: string; label: string; items: typeof films } => r != null,
  );
  const gap = 8;
  const posterW = (width - 36 - gap * 3) / 4;
  const hours = Math.round(d.minutes / 60);
  const stats = [
    { v: hours >= 1 ? `${n(hours)}h` : `${n(d.minutes)}m`, k: m('summaryWatched') },
    { v: n(d.episodes), k: m('summaryEpisodes') },
    { v: n(d.films), k: m('summaryFilms') },
    { v: n(d.newShows + d.continuedShows), k: m('summaryShows') },
  ];
  return (
    <Canvas width={width}>
      <YellowLight size={width * 1.5} x={width * 0.5} y={H * 0.12} strength={0.9} />
      {/* who and what: the app's mark left, the reader's @handle right */}
      <View style={abs({ left: 18, right: 18, top: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Image source={APP_ICON} style={{ width: 20, height: 20, borderRadius: 5 }} />
          <Text style={{ color: C.INK, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 }}>OPENTV</Text>
        </View>
        {handle ? (
          <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ color: C.GREY, fontSize: 10.5, fontWeight: '700' }}>@{handle}</Text>
          </View>
        ) : null}
      </View>

      <View style={abs({ left: 18, right: 18, top: H * 0.085, alignItems: 'center' })}>
        <Label size={12} style={{ letterSpacing: 4 }}>{month}</Label>
        {year ? <Display size={Math.min(64, width * 0.17)} lines={1} align="center">{year}</Display> : null}
        <View style={{ marginTop: 6, borderWidth: 1.5, borderColor: C.YELLOW, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 }}>
          <Text style={{ color: C.YELLOW, fontSize: 9.5, fontWeight: '900', letterSpacing: 2.4 }}>{m('summaryWrapped')}</Text>
        </View>
      </View>

      <View style={abs({ left: 18, right: 18, top: H * 0.29, gap: 14 })}>
        {rows.map((r) => (
          <View key={r.key} style={{ gap: 7 }}>
            <Text style={{ color: C.GREY, fontSize: 9.5, fontWeight: '900', letterSpacing: 2, textAlign: 'center' }}>— {r.label} —</Text>
            <View style={{ flexDirection: 'row', gap, justifyContent: 'center' }}>
              {r.items.map((it, i) => (
                <View key={`${it.title}-${i}`} style={{ width: posterW }}>
                  {it.poster ? (
                    <Image source={{ uri: it.poster }} style={{ width: posterW, height: posterW * 1.5, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }} contentFit="cover" cachePolicy="disk" />
                  ) : (
                    <View style={{ width: posterW, height: posterW * 1.5, borderRadius: 6, backgroundColor: '#1A1A1E', padding: 6, justifyContent: 'flex-end' }}>
                      <Text numberOfLines={3} style={{ color: C.INK, fontSize: 9, fontWeight: '800' }}>{it.title}</Text>
                    </View>
                  )}
                  {/* the rank, top-left, like a chart position */}
                  <View style={abs({ left: -4, top: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: C.YELLOW, alignItems: 'center', justifyContent: 'center' })}>
                    <Text style={{ color: '#0A0A0A', fontSize: 10, fontWeight: '900' }}>{i + 1}</Text>
                  </View>
                  {it.badge ? (
                    <View style={abs({ right: 4, top: 4, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, backgroundColor: 'rgba(0,0,0,0.72)' })}>
                      <Text style={{ color: C.YELLOW, fontSize: 8, fontWeight: '900' }}>{it.badge}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {/* the four numbers, in one bar */}
      <View style={abs({ left: 18, right: 18, bottom: 54, flexDirection: 'row', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingVertical: 12 })}>
        {stats.map((s, i) => (
          <View key={s.k} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: 'rgba(255,255,255,0.18)' }}>
            <Text style={{ color: C.INK, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 }}>{s.v}</Text>
            <Text style={{ color: C.YELLOW, fontSize: 7.5, fontWeight: '900', letterSpacing: 1.4, marginTop: 2 }}>{s.k}</Text>
          </View>
        ))}
      </View>

      <View style={abs({ left: 0, right: 0, bottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 })}>
        <Image source={APP_ICON} style={{ width: 14, height: 14, borderRadius: 3 }} />
        <Text style={{ color: C.GREY, fontSize: 11, fontWeight: '700' }}>theopentv.com</Text>
      </View>
    </Canvas>
  );
}
