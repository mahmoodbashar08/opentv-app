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
};
const ALL_OFF: NotifyToggles = {
  episode: false,
  finale: false,
  catchup: false,
  movieNight: false,
  inactivity: false,
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
    expect(n.title).toBe('Severance — new episode');
    expect(n.body).toBe('S02E05 · Cold Harbor airs today');
    expect(new Date(n.at).getHours()).toBe(20);
    expect(new Date(n.at).toISOString().slice(0, 10)).toBe('2026-07-28');
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
    expect(out[0].title).toBe('Severance — season finale');
    expect(out[0].body).toBe('🔥 Season finale tonight!');
  });

  it('prefers series-finale wording over season-finale', () => {
    const out = planNotifications(
      input({ upcoming: [ep({ season: 2, lastSeason: 2, episode: 10, seasonTotal: 10, ended: true })] }),
      NOW,
      ALL_ON,
    );
    expect(out[0].title).toBe('Severance — series finale');
    expect(out[0].body).toBe('🎬 The final episode airs today');
  });

  it('falls back to a plain reminder when finales are switched off', () => {
    const out = planNotifications(
      input({ upcoming: [ep({ episode: 10, seasonTotal: 10 })] }),
      NOW,
      { ...ALL_ON, finale: false },
    );
    expect(out[0].kind).toBe('episode');
    expect(out[0].title).toBe('Severance — new episode');
  });
});

describe('planNotifications — catch-up', () => {
  const near = { showId: 7, showName: 'Dark', season: 3, remaining: 2 };

  it('fires when a season is nearly finished', () => {
    const out = planNotifications(input({ catchUp: [near] }), NOW, ALL_ON);
    expect(out[0].kind).toBe('catchup');
    expect(out[0].body).toBe('Only 2 episodes left in Season 3');
  });

  it('uses the singular for one episode', () => {
    const out = planNotifications(input({ catchUp: [{ ...near, remaining: 1 }] }), NOW, ALL_ON);
    expect(out[0].body).toBe('Only 1 episode left in Season 3');
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
    expect(n.body).toBe('12 films on your watchlist');
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
    expect(n.body).toBe('3 episodes waiting for you');
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
