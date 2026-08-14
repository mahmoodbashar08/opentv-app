import {
  isSeasonFinale,
  isSeriesFinale,
  MAX_EPISODE_NOTIFICATIONS,
  nextFriday,
  planNotifications,
  type NotifyToggles,
  type PlanInput,
  type UpcomingEpisode,
} from './notification-plan';

const ALL_ON: NotifyToggles = {
  episode: true,
  finale: true,
  catchup: true,
  movieNight: true,
  inactivity: true,
  popcorn: true,
  wrapped: true,
};
const ALL_OFF: NotifyToggles = {
  episode: false,
  finale: false,
  catchup: false,
  movieNight: false,
  inactivity: false,
  popcorn: false,
  wrapped: false,
};

// Sunday 26 Jul 2026, 09:00 local
const NOW = new Date('2026-07-26T09:00:00').getTime();

const ep = (over: Partial<UpcomingEpisode> = {}): UpcomingEpisode => ({
  showId: 1,
  showName: 'Severance',
  season: 2,
  episode: 5,
  title: 'Cold Harbor',
  air: '2026-07-28',
  seasonTotal: 10,
  lastSeason: 2,
  ended: false,
  ...over,
});

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  upcoming: [],
  catchUp: [],
  watchlistCount: 0,
  unwatchedCount: 0,
  lastOpenedAt: NOW,
  popcornBest: 0,
  wrappedMonth: null,
  wrappedLabel: null,
  ...over,
});

describe('isSeasonFinale', () => {
  it('is the last episode of the season', () => {
    expect(isSeasonFinale(ep({ episode: 10, seasonTotal: 10 }))).toBe(true);
  });
  it('is not any earlier episode', () => {
    expect(isSeasonFinale(ep({ episode: 9, seasonTotal: 10 }))).toBe(false);
  });
  it('refuses to guess when the season size is unknown', () => {
    // without the total, every latest episode would look like a finale
    expect(isSeasonFinale(ep({ episode: 10, seasonTotal: null }))).toBe(false);
    expect(isSeasonFinale(ep({ episode: 10, seasonTotal: 0 }))).toBe(false);
  });
});

describe('isSeriesFinale', () => {
  it('is the last episode of the last season of an ended show', () => {
    expect(isSeriesFinale(ep({ season: 2, lastSeason: 2, episode: 10, seasonTotal: 10, ended: true }))).toBe(true);
  });
  it('is not a season finale of a running show', () => {
    expect(isSeriesFinale(ep({ season: 2, lastSeason: 2, episode: 10, seasonTotal: 10, ended: false }))).toBe(false);
  });
  it('is not an earlier season of an ended show', () => {
    expect(isSeriesFinale(ep({ season: 1, lastSeason: 2, episode: 10, seasonTotal: 10, ended: true }))).toBe(false);
  });
});

describe('planNotifications — episodes', () => {
  it('schedules an episode reminder at 20:00 on the air date', () => {
    const [n] = planNotifications(input({ upcoming: [ep()] }), NOW, ALL_ON);
    expect(n.kind).toBe('episode');
    expect(n.title).toBe('localNotifications.episodeTitle');
    expect(n.titleParams).toEqual({ show: 'Severance' });
    expect(n.bodyKey).toBe('localNotifications.episodeBodyNamed');
    expect(n.bodyParams).toEqual({ code: 'S02E05', title: 'Cold Harbor' });
    expect(new Date(n.at).getHours()).toBe(20);
    expect(new Date(n.at).toISOString().slice(0, 10)).toBe('2026-07-28');
  });

  it('falls back to the code-only body when the episode has no title', () => {
    const [n] = planNotifications(input({ upcoming: [ep({ title: null })] }), NOW, ALL_ON);
    expect(n.bodyKey).toBe('localNotifications.episodeBody');
    expect(n.bodyParams).toEqual({ code: 'S02E05' });
  });

  it('never notifies about specials', () => {
    expect(planNotifications(input({ upcoming: [ep({ season: 0, episode: 1 })] }), NOW, ALL_ON)).toEqual([]);
  });

  it('drops episodes whose slot has already passed', () => {
    expect(planNotifications(input({ upcoming: [ep({ air: '2026-07-20' })] }), NOW, ALL_ON)).toEqual([]);
  });

  it('caps a huge library at the episode budget, soonest first', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      ep({ showId: i, episode: 1, air: `2026-${String(8 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    const out = planNotifications(input({ upcoming: many }), NOW, ALL_ON);
    expect(out).toHaveLength(MAX_EPISODE_NOTIFICATIONS);
    expect(out.map((n) => n.at)).toEqual([...out.map((n) => n.at)].sort((a, b) => a - b));
  });

  it('honours the episode toggle', () => {
    expect(planNotifications(input({ upcoming: [ep()] }), NOW, { ...ALL_ON, episode: false })).toEqual([]);
  });
});

describe('planNotifications — finales cost no extra slot', () => {
  it('reworded the season-finale episode rather than adding one', () => {
    const out = planNotifications(input({ upcoming: [ep({ episode: 10, seasonTotal: 10 })] }), NOW, ALL_ON);
    expect(out).toHaveLength(1); // NOT two notifications
    expect(out[0].kind).toBe('finale');
    expect(out[0].title).toBe('localNotifications.seasonFinaleTitle');
    expect(out[0].titleParams).toEqual({ show: 'Severance' });
    expect(out[0].bodyKey).toBe('localNotifications.seasonFinaleBody');
    expect(out[0].bodyParams).toBeUndefined();
  });

  it('prefers series-finale wording over season-finale', () => {
    const out = planNotifications(
      input({ upcoming: [ep({ season: 2, lastSeason: 2, episode: 10, seasonTotal: 10, ended: true })] }),
      NOW,
      ALL_ON,
    );
    expect(out[0].title).toBe('localNotifications.seriesFinaleTitle');
    expect(out[0].titleParams).toEqual({ show: 'Severance' });
    expect(out[0].bodyKey).toBe('localNotifications.seriesFinaleBody');
    expect(out[0].bodyParams).toBeUndefined();
  });

  it('falls back to a plain reminder when finales are switched off', () => {
    const out = planNotifications(
      input({ upcoming: [ep({ episode: 10, seasonTotal: 10 })] }),
      NOW,
      { ...ALL_ON, finale: false },
    );
    expect(out[0].kind).toBe('episode');
    expect(out[0].title).toBe('localNotifications.episodeTitle');
    expect(out[0].bodyKey).toBe('localNotifications.episodeBodyNamed');
  });
});

describe('planNotifications — catch-up', () => {
  const near = { showId: 7, showName: 'Dark', season: 3, remaining: 2 };

  it('fires when a season is nearly finished', () => {
    const out = planNotifications(input({ catchUp: [near] }), NOW, ALL_ON);
    expect(out[0].kind).toBe('catchup');
    expect(out[0].title).toBe('Dark'); // literal — the show's own name, not a key
    expect(out[0].bodyKey).toBe('localNotifications.catchupBody');
    expect(out[0].bodyParams).toEqual({ count: 2, season: 3 });
  });

  it('carries the raw count for one episode — pluralisation happens at t(), not here', () => {
    const out = planNotifications(input({ catchUp: [{ ...near, remaining: 1 }] }), NOW, ALL_ON);
    expect(out[0].bodyKey).toBe('localNotifications.catchupBody');
    expect(out[0].bodyParams).toEqual({ count: 1, season: 3 });
  });

  it('never fires at 0 remaining — that is a finished season, not a nudge', () => {
    expect(planNotifications(input({ catchUp: [{ ...near, remaining: 0 }] }), NOW, ALL_ON)).toEqual([]);
  });

  it('ignores seasons that are not nearly done', () => {
    expect(planNotifications(input({ catchUp: [{ ...near, remaining: 6 }] }), NOW, ALL_ON)).toEqual([]);
  });

  it('caps how many it will send at once', () => {
    const lots = Array.from({ length: 9 }, (_, i) => ({ ...near, showId: i, remaining: 1 }));
    expect(planNotifications(input({ catchUp: lots }), NOW, ALL_ON)).toHaveLength(2);
  });
});

describe('planNotifications — movie night', () => {
  it('lands on a Friday evening', () => {
    const [n] = planNotifications(input({ watchlistCount: 12 }), NOW, ALL_ON);
    expect(n.kind).toBe('movieNight');
    expect(n.title).toBe('localNotifications.movieNightTitle');
    expect(n.bodyKey).toBe('localNotifications.movieNightBody');
    expect(n.bodyParams).toEqual({ count: 12 });
    expect(new Date(n.at).getDay()).toBe(5);
    expect(new Date(n.at).getHours()).toBe(18);
  });

  it('is suppressed on an empty watchlist — a reminder to watch nothing', () => {
    expect(planNotifications(input({ watchlistCount: 0 }), NOW, ALL_ON)).toEqual([]);
  });
});

describe('planNotifications — inactivity', () => {
  it('fires a week after the last open when episodes are waiting', () => {
    const [n] = planNotifications(input({ unwatchedCount: 3 }), NOW, ALL_ON);
    expect(n.kind).toBe('inactivity');
    expect(n.title).toBe('localNotifications.stillWatchingTitle');
    expect(n.bodyKey).toBe('localNotifications.inactivityBody');
    expect(n.bodyParams).toEqual({ count: 3 });
    expect(Math.round((n.at - NOW) / 86400000)).toBe(7);
  });

  it('is suppressed when the user is caught up — nagging with nothing to do', () => {
    expect(planNotifications(input({ unwatchedCount: 0 }), NOW, ALL_ON)).toEqual([]);
  });
});

describe('planNotifications — toggles', () => {
  it('produces nothing at all when every type is off', () => {
    const everything = input({
      upcoming: [ep()],
      catchUp: [{ showId: 7, showName: 'Dark', season: 3, remaining: 1 }],
      watchlistCount: 5,
      unwatchedCount: 5,
    });
    expect(planNotifications(everything, NOW, ALL_OFF)).toEqual([]);
  });

  it('stays inside the iOS budget with a full library and everything on', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      ep({ showId: i, air: `2026-${String(8 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    const out = planNotifications(
      input({
        upcoming: many,
        catchUp: Array.from({ length: 9 }, (_, i) => ({ showId: i, showName: 'X', season: 1, remaining: 1 })),
        watchlistCount: 5,
        unwatchedCount: 5,
      }),
      NOW,
      ALL_ON,
    );
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out).toHaveLength(MAX_EPISODE_NOTIFICATIONS + 2 + 1 + 1);
  });
});

describe('nextFriday', () => {
  it('finds the coming Friday from a Sunday', () => {
    const d = new Date(nextFriday(NOW));
    expect(d.getDay()).toBe(5);
    expect(d.getDate()).toBe(31);
  });
  it('skips to next week when this Friday evening has passed', () => {
    const fridayLate = new Date('2026-07-31T20:00:00').getTime();
    const d = new Date(nextFriday(fridayLate));
    expect(d.getDay()).toBe(5);
    expect(d.getDate()).toBe(7); // 7 Aug
  });
});


describe('planNotifications — popcorn high-score challenge', () => {
  const ON = { ...ALL_ON, popcorn: true };

  it('does not challenge someone who has never played', () => {
    expect(planNotifications(input({ popcornBest: 0 }), NOW, ON).filter((n) => n.kind === 'popcorn')).toEqual([]);
  });

  it('challenges a player to beat their own best', () => {
    const [n] = planNotifications(input({ popcornBest: 12 }), NOW, ON).filter((x) => x.kind === 'popcorn');
    expect(n.title).toBe('localNotifications.popcornTitle');
    expect(n.bodyKey).toBe('localNotifications.popcornBody');
    expect(n.bodyParams).toEqual({ score: 12 });
  });

  it('lands at a weekend afternoon, not a weekday evening', () => {
    const [n] = planNotifications(input({ popcornBest: 12 }), NOW, ON).filter((x) => x.kind === 'popcorn');
    const d = new Date(n.at);
    expect(d.getDay()).toBe(6); // Saturday
    expect(d.getHours()).toBe(15);
    expect(n.at).toBeGreaterThan(NOW);
  });

  it('stays silent when the toggle is off', () => {
    const off = { ...ON, popcorn: false };
    expect(planNotifications(input({ popcornBest: 12 }), NOW, off).filter((n) => n.kind === 'popcorn')).toEqual([]);
  });

  it('uses a stable id so re-planning does not read as a new challenge', () => {
    const a = planNotifications(input({ popcornBest: 12 }), NOW, ON).filter((n) => n.kind === 'popcorn')[0];
    const b = planNotifications(input({ popcornBest: 12 }), NOW + 1000, ON).filter((n) => n.kind === 'popcorn')[0];
    expect(a.id).toBe(b.id);
  });
});

describe('the month-closed Wrapped nudge', () => {
  const wrapped = (over: Partial<PlanInput> = {}, toggles = ALL_ON) =>
    planNotifications(input({ wrappedMonth: '2026-07', wrappedLabel: 'July 2026', ...over }), NOW, toggles).filter(
      (n) => n.kind === 'wrapped',
    );

  it('fires on the 1st of the next month, at a civilised hour', () => {
    const [n] = wrapped();
    expect(new Date(n.at).getTime()).toBe(new Date('2026-08-01T10:00:00').getTime());
    expect(n.at).toBeGreaterThan(NOW);
    // the tap has to land on THAT month, not on whatever Wrapped defaults to
    expect(n.data).toEqual({ kind: 'wrapped', month: '2026-07' });
  });

  /** Re-planning happens on every app open; a stable id is what stops the
   *  same month stacking a notification per launch. */
  it('is one notification, however often the plan is rebuilt', () => {
    const ids = [wrapped(), wrapped(), wrapped()].flat().map((n) => n.id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe('wrapped-2026-07');
  });

  it('is silent when the toggle is off, and for a month with nothing in it', () => {
    expect(wrapped({}, ALL_OFF)).toEqual([]);
    expect(wrapped({ wrappedMonth: null, wrappedLabel: null })).toEqual([]);
  });
});
