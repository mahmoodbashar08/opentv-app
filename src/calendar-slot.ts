/**
 * Where an airing sits in the day — the arithmetic, on its own.
 *
 * SPLIT OUT SO IT CAN BE TESTED. `calendar-sync.ts` reaches for expo-calendar
 * and cannot be loaded in the suite at all, and this is the half that can be
 * wrong without anybody noticing: a wrong hour in somebody's diary looks
 * exactly as authoritative as a right one.
 */

/**
 * One episode or film, as the calendar needs it.
 *
 * `startsAt` and `minutes` are both optional and both absent together: either
 * we know when a thing starts and how long it runs, or it is a whole day.
 * Nothing in between is invented.
 */
export type Airing = { key: string; title: string; date: string; startsAt?: string | null; minutes?: number | null };

/*
 * AN ALL-DAY EVENT TAKES LOCAL MIDNIGHT AND NO TIME ZONE.
 *
 * Passing `timeZone: 'UTC'` alongside local midnights made iOS treat these as
 * TIMED events running 12am to 12am: they filled the whole day as a coloured
 * block, and ten episodes airing on one date were laid out as ten narrow
 * columns side by side instead of ten rows at the top of the day. `allDay`
 * was set and ignored, because a time zone is not a thing an all-day event
 * has.
 */
function localMidnight(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/**
 * Where this airing sits in the day, and for how long.
 *
 * TIMED ONLY WHEN BOTH HALVES ARE KNOWN. A start without a length, or a length
 * without a start, is a guess dressed as a fact — and a wrong hour in
 * somebody's diary looks authoritative in a way a whole-day entry never does.
 * TheTVDB gives `aired` as a bare date, so the hour can only come from the
 * SERIES' own `airsTime`, and about forty per cent of episodes carry no
 * runtime at all.
 *
 * `cursor` carries the end of the previous episode of the same show on the
 * same day, so a season released in one go lays itself out in order rather
 * than piling ten blocks on one hour.
 */
export function slot(
  a: Airing,
  cursor: Map<string, number>,
): { start: Date; end: Date; allDay: boolean } {
  const midnight = localMidnight(a.date);
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec((a.startsAt ?? '').trim());
  const minutes = typeof a.minutes === 'number' && a.minutes > 0 ? a.minutes : null;
  if (!hhmm || !minutes) {
    /*
     * AN ALL-DAY EVENT ENDS ON THE DAY IT IS ON.
     *
     * EventKit reads an all-day event's end as the LAST day it covers, not the
     * moment it stops — so midnight-to-midnight-plus-24-hours is two days, and
     * every episode was drawn across its air date AND the day after it.
     * A second before the next midnight is the same day and cannot be rounded
     * up into the following one.
     */
    return { start: midnight, end: new Date(midnight.getTime() + 86400000 - 1000), allDay: true };
  }

  const show = a.key.split('-')[0] ?? a.key;
  const lane = `${show}|${a.date}`;
  const first = midnight.getTime() + (Number(hhmm[1]) * 60 + Number(hhmm[2])) * 60000;
  const startMs = Math.max(first, cursor.get(lane) ?? first);
  const endMs = startMs + minutes * 60000;
  cursor.set(lane, endMs);
  // A marathon that runs past midnight simply ends tomorrow, which is true and
  // is what the calendar draws anyway.
  return { start: new Date(startMs), end: new Date(endMs), allDay: false };
}

