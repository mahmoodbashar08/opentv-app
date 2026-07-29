/**
 * What to notify about, and when — the rules, with no I/O.
 *
 * Kept free of `@/` and react-native imports so Jest can run it under the
 * project's plain-node config. That is the point of the split: scheduling is
 * mechanical, but "is this a season finale", "is this user actually behind",
 * "should this fire at all" is where the bugs live, so those get tests.
 *
 * iOS caps pending local notifications at 64. The budget below stays well
 * under, and finales deliberately cost nothing — a finale IS an episode
 * airing, so its reminder is already scheduled and only the wording changes.
 */

export type NotifyKind = 'episode' | 'finale' | 'catchup' | 'movieNight' | 'inactivity' | 'popcorn';

export type PlannedNotification = {
  /** stable across re-planning, so the same event doesn't read as a new one */
  id: string;
  kind: NotifyKind;
  title: string;
  body: string;
  /** ms epoch */
  at: number;
};

export type NotifyToggles = Record<NotifyKind, boolean>;

/** One upcoming episode of a followed show. */
export type UpcomingEpisode = {
  showId: number;
  showName: string;
  season: number;
  episode: number;
  title: string | null;
  /** ISO date, 'YYYY-MM-DD' */
  air: string;
  /** episodes in this season, when known — for finale detection */
  seasonTotal: number | null;
  /** highest season number the show has, for series-finale detection */
  lastSeason: number | null;
  /** the show has finished airing for good */
  ended: boolean;
};

/** A season the user is close to finishing. */
export type CatchUpCandidate = {
  showId: number;
  showName: string;
  season: number;
  remaining: number;
};

export type PlanInput = {
  upcoming: UpcomingEpisode[];
  catchUp: CatchUpCandidate[];
  /** unwatched films on the watchlist, already released */
  watchlistCount: number;
  /** episodes aired but not watched, across the library */
  unwatchedCount: number;
  /** ms epoch of the last app open */
  lastOpenedAt: number | null;
  /** the user's best popcorn score, 0 if they have never played */
  popcornBest: number;
};

/** iOS allows 64 pending; leave room for the other kinds and for headroom. */
export const MAX_EPISODE_NOTIFICATIONS = 30;
export const MAX_CATCHUP_NOTIFICATIONS = 2;
const INACTIVITY_DAYS = 7;

/** 20:00 local on the given ISO date — prime watching hour. */
export function atEvening(isoDate: string, hour = 20): number {
  return new Date(`${isoDate}T${String(hour).padStart(2, '0')}:00:00`).getTime();
}

/**
 * Is this the last episode of its season? Requires knowing the season's size:
 * without it we cannot tell a finale from any other episode, and guessing
 * would label every latest episode a finale.
 */
export function isSeasonFinale(e: UpcomingEpisode): boolean {
  return e.seasonTotal != null && e.seasonTotal > 0 && e.episode === e.seasonTotal;
}

/** The last episode of the last season of a show that has ended. */
export function isSeriesFinale(e: UpcomingEpisode): boolean {
  return e.ended && e.lastSeason != null && e.season === e.lastSeason && isSeasonFinale(e);
}

function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

/** The next Friday at `hour` local, strictly in the future. */
export function nextFriday(now: number, hour = 18): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  const FRIDAY = 5;
  let delta = (FRIDAY - d.getDay() + 7) % 7;
  if (delta === 0 && d.getTime() <= now) delta = 7; // already past this Friday's slot
  d.setDate(d.getDate() + delta);
  return d.getTime();
}

/**
 * Everything to schedule, in one pass.
 *
 * Specials (season 0) never notify — they air erratically and are not what
 * anyone is waiting for, matching the behaviour before this engine existed.
 */
export function planNotifications(input: PlanInput, now: number, enabled: NotifyToggles): PlannedNotification[] {
  const out: PlannedNotification[] = [];

  // ---- episodes, and the finales among them ------------------------------
  if (enabled.episode) {
    const dated = input.upcoming
      .filter((e) => e.season >= 1) // specials don't ping
      .map((e) => ({ e, at: atEvening(e.air) }))
      .filter((x) => Number.isFinite(x.at) && x.at > now)
      .sort((a, b) => a.at - b.at)
      .slice(0, MAX_EPISODE_NOTIFICATIONS);

    for (const { e, at } of dated) {
      const code = episodeCode(e.season, e.episode);
      // a finale replaces the wording of a reminder already being scheduled —
      // it never costs an extra slot
      const series = enabled.finale && isSeriesFinale(e);
      const season = enabled.finale && !series && isSeasonFinale(e);
      out.push({
        id: `ep-${e.showId}-${e.season}-${e.episode}`,
        kind: series || season ? 'finale' : 'episode',
        title: series ? `${e.showName} — series finale` : season ? `${e.showName} — season finale` : `${e.showName} — new episode`,
        body: series
          ? '🎬 The final episode airs today'
          : season
            ? '🔥 Season finale tonight!'
            : e.title
              ? `${code} · ${e.title} airs today`
              : `${code} airs today`,
        at,
      });
    }
  }

  // ---- catch-up: nearly done with a season -------------------------------
  if (enabled.catchup) {
    const soon = input.catchUp
      // 0 remaining is a finished season, not a nudge
      .filter((c) => c.remaining > 0 && c.remaining <= 2 && c.season >= 1)
      .sort((a, b) => a.remaining - b.remaining)
      .slice(0, MAX_CATCHUP_NOTIFICATIONS);
    // tomorrow evening, so it reads as a gentle reminder rather than a
    // reaction to whatever they just watched
    const at = now + 86400000;
    const d = new Date(at);
    d.setHours(20, 0, 0, 0);
    for (const c of soon) {
      out.push({
        id: `catchup-${c.showId}-${c.season}`,
        kind: 'catchup',
        title: c.showName,
        body: `Only ${c.remaining} episode${c.remaining === 1 ? '' : 's'} left in Season ${c.season}`,
        at: d.getTime() > now ? d.getTime() : at,
      });
    }
  }

  // ---- Friday movie night ------------------------------------------------
  // suppressed on an empty watchlist: a reminder to watch nothing is noise
  if (enabled.movieNight && input.watchlistCount > 0) {
    out.push({
      id: 'movie-night',
      kind: 'movieNight',
      title: 'Movie Night 🍿',
      body: `${input.watchlistCount} film${input.watchlistCount === 1 ? '' : 's'} on your watchlist`,
      at: nextFriday(now),
    });
  }

  // ---- come back ---------------------------------------------------------
  // only when something is actually waiting — nudging a user who is fully
  // caught up is nagging, and gives them nothing to do
  if (enabled.inactivity && input.unwatchedCount > 0) {
    const base = input.lastOpenedAt ?? now;
    out.push({
      id: 'inactivity',
      kind: 'inactivity',
      title: 'Still watching?',
      body: `${input.unwatchedCount} episode${input.unwatchedCount === 1 ? '' : 's'} waiting for you`,
      at: base + INACTIVITY_DAYS * 86400000,
    });
  }

  out.push(...planPopcornChallenge(input, now, enabled));

  return out.filter((n) => n.at > now);
}


/** The coming Saturday at 15:00 — a weekend afternoon, when a game invite is
 *  welcome, rather than competing with the evening episode reminders. */
function nextSaturdayAfternoon(now: number): number {
  const d = new Date(now);
  d.setHours(15, 0, 0, 0);
  const days = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + days);
  if (d.getTime() <= now) d.setDate(d.getDate() + 7);
  return d.getTime();
}

/**
 * The popcorn high-score challenge.
 *
 * Only ever sent to someone who has actually played — challenging a stranger
 * to beat a score they have never set is nonsense, and the game is a small
 * easter egg rather than the point of the app.
 *
 * The id carries the score, so re-planning is stable but a NEW record
 * replaces the old challenge rather than stacking a second one.
 */
export function planPopcornChallenge(input: PlanInput, now: number, enabled: NotifyToggles): PlannedNotification[] {
  if (!enabled.popcorn || input.popcornBest <= 0) return [];
  return [
    {
      id: `popcorn-${input.popcornBest}`,
      kind: 'popcorn',
      title: '\u{1F37F} Beat your best',
      body: `Your popcorn record is ${input.popcornBest}. Think you can top it?`,
      at: nextSaturdayAfternoon(now),
    },
  ];
}
