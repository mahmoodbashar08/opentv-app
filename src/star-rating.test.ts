import { DatabaseSync } from 'node:sqlite';

import {
  convertToTenOnce,
  filledStarText,
  ratingFromStars,
  ratingFromTen,
  ratingAt,
  ratingForTap,
  starSlots,
  starsValue,
  starText,
  stepRating,
  wholeStars,
  type SyncDb,
} from '@/star-rating';
import { starPercents } from '@/pure';

/*
 * Half stars for films (2.0.0, plan item 14) and then episodes: stored out of
 * ten, five stars on screen, a tap is a whole star and a slide gives halves.
 */

describe('the conversions', () => {
  it('keeps a score already out of ten, and refuses what is not one', () => {
    expect(ratingFromTen(7)).toBe(7);
    expect(ratingFromTen(10)).toBe(10);
    expect(ratingFromTen(1)).toBe(1);
    expect(ratingFromTen(0)).toBeNull();
    expect(ratingFromTen(11)).toBeNull();
    expect(ratingFromTen(NaN)).toBeNull();
    expect(ratingFromTen('7')).toBeNull();
    expect(ratingFromTen(null)).toBeNull();
  });

  it('reads stars out of five, halves exactly — Letterboxd 3.5 is 7', () => {
    expect(ratingFromStars(3.5)).toBe(7);
    expect(ratingFromStars(0.5)).toBe(1);
    expect(ratingFromStars(5)).toBe(10);
    expect(ratingFromStars(4)).toBe(8); // an old whole-star row doubles
    expect(ratingFromStars(0)).toBeNull();
    expect(ratingFromStars(6)).toBe(10); // clamped, as the importers always were
    expect(ratingFromStars(undefined)).toBeNull();
  });

  it('rounds a half UP to a whole star for places that only have whole stars', () => {
    expect(wholeStars(7)).toBe(4);
    expect(wholeStars(8)).toBe(4);
    expect(wholeStars(1)).toBe(1);
    expect(wholeStars(10)).toBe(5);
    expect(wholeStars(null)).toBeNull();
  });

  it('reads ten as stars for a person', () => {
    expect(starsValue(7)).toBe(3.5);
    expect(starsValue(8)).toBe(4);
  });
});

describe('how a half star displays', () => {
  it('draws 3.5 as three full, one half, one empty', () => {
    expect(starSlots(7)).toEqual(['full', 'full', 'full', 'half', 'empty']);
  });

  it('draws whole ratings with no half at all', () => {
    expect(starSlots(8)).toEqual(['full', 'full', 'full', 'full', 'empty']);
    expect(starSlots(10)).toEqual(['full', 'full', 'full', 'full', 'full']);
  });

  it('draws half a star as a half, and unrated as five empties', () => {
    expect(starSlots(1)).toEqual(['half', 'empty', 'empty', 'empty', 'empty']);
    expect(starSlots(null)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  });

  it('prints as text the way Letterboxd writes it', () => {
    expect(starText(7)).toBe('★★★½☆');
    expect(starText(10)).toBe('★★★★★');
    expect(starText(2)).toBe('★☆☆☆☆');
  });

  it('prints only the stars given, for rows that never drew empties', () => {
    expect(filledStarText(7)).toBe('★★★½');
    expect(filledStarText(8)).toBe('★★★★');
    expect(filledStarText(1)).toBe('½');
    expect(filledStarText(null)).toBe('');
  });
});

describe('a finger on the star row', () => {
  const W = 200; // five stars, 40 points each, 20 per half

  it('gives the half star under the finger', () => {
    expect(ratingAt(130, W)).toBe(7); // first half of the fourth star
    expect(ratingAt(150, W)).toBe(8); // second half of the fourth star
    expect(ratingAt(10, W)).toBe(1);
    expect(ratingAt(199, W)).toBe(10);
  });

  it('holds the end values when the slide runs off the row', () => {
    expect(ratingAt(-30, W)).toBe(1);
    expect(ratingAt(0, W)).toBe(1);
    expect(ratingAt(400, W)).toBe(10);
  });

  it('measures from the right in a right-to-left layout', () => {
    expect(ratingAt(190, W, true)).toBe(1);
    expect(ratingAt(70, W, true)).toBe(7);
    expect(ratingAt(0, W, true)).toBe(10);
  });

  it('survives a row that has not been measured yet', () => {
    expect(ratingAt(50, 0)).toBe(1);
  });

  it('a TAP is a whole star, exactly as before half stars', () => {
    expect(ratingForTap(0)).toBe(2);
    expect(ratingForTap(3)).toBe(8);
    expect(ratingForTap(4)).toBe(10);
    expect(ratingForTap(9)).toBe(10);
  });
});

describe('the screen reader steps half a star', () => {
  it('moves up and down by halves', () => {
    expect(stepRating(7, 1)).toBe(8);
    expect(stepRating(7, -1)).toBe(6);
  });

  it('starts at half a star, and takes the rating back below it', () => {
    expect(stepRating(null, 1)).toBe(1);
    expect(stepRating(1, -1)).toBeNull();
    expect(stepRating(null, -1)).toBeNull();
  });

  it('stops at five stars', () => {
    expect(stepRating(10, 1)).toBe(10);
  });
});

describe("the room's shares under a film's five stars", () => {
  it('puts a half-star vote under the star it rounds up to', () => {
    // one 7 (3.5) and one 8 (4): both stand under the fourth star
    expect(starPercents({ '7': 1, '8': 1 }, 2, true)).toEqual([0, 0, 0, 100, 0]);
    expect(starPercents({ '1': 1, '10': 1 }, 2, true)).toEqual([50, 0, 0, 0, 50]);
  });

  it('folds an episode\'s half-star votes in the same way, now episodes take halves', () => {
    // the episode screen passes `halves` too since 2.0.0
    expect(starPercents({ '9': 1, '10': 1, '3': 2 }, 4, true)).toEqual([0, 50, 0, 0, 50]);
  });

  it('without `halves` still ignores an odd score, as before anything sent one', () => {
    expect(starPercents({ '7': 1, '8': 1 }, 2)).toEqual([0, 0, 0, 100, 0]);
    expect(starPercents({ '7': 1 }, 1)).toBeNull();
  });
});

/*
 * THE ONE-TIME CONVERSION, against a real SQLite (Node's own) rather than a
 * mock: the claim is about what the statements do to rows.
 */
describe('whole stars to ten, once', () => {
  const open = () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE movies (name TEXT PRIMARY KEY, stars INTEGER);
      CREATE TABLE episode_ratings (showId INTEGER, season INTEGER, episode INTEGER, stars INTEGER NOT NULL,
        PRIMARY KEY (showId, season, episode));
    `);
    const db: SyncDb = {
      getFirstSync: <T,>(sql: string) => (raw.prepare(sql).get() as T | undefined) ?? null,
      runSync: (sql: string) => raw.prepare(sql).run(),
      withTransactionSync: (task: () => void) => {
        raw.exec('BEGIN');
        try {
          task();
          raw.exec('COMMIT');
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      },
    };
    const stars = (table: string) => (raw.prepare(`SELECT stars FROM ${table} ORDER BY rowid`).all() as { stars: number }[]).map((r) => r.stars);
    const flag = (key: string) => (raw.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
    return { raw, db, stars, flag };
  };

  it('doubles every episode rating, and only once however often it runs', () => {
    const { raw, db, stars, flag } = open();
    raw.exec('INSERT INTO episode_ratings VALUES (1, 1, 1, 1), (1, 1, 2, 4), (1, 1, 3, 5)');
    convertToTenOnce(db, 'episode_ratings', 'episodeStarsScale');
    convertToTenOnce(db, 'episode_ratings', 'episodeStarsScale');
    expect(stars('episode_ratings')).toEqual([2, 8, 10]);
    expect(flag('episodeStarsScale')).toBe('10');
  });

  it('has its own flag: a phone that already converted its films still converts its episodes', () => {
    const { raw, db, stars } = open();
    raw.exec("INSERT INTO movies VALUES ('Heat', 7); INSERT INTO episode_ratings VALUES (1, 1, 1, 4)");
    raw.exec("INSERT INTO meta VALUES ('movieStarsScale', '10')");
    convertToTenOnce(db, 'movies', 'movieStarsScale');
    convertToTenOnce(db, 'episode_ratings', 'episodeStarsScale');
    expect(stars('movies')).toEqual([7]); // already ten, left alone
    expect(stars('episode_ratings')).toEqual([8]);
  });

  it('flags an empty table, so a new install never doubles what it imports later', () => {
    const { raw, db, stars, flag } = open();
    convertToTenOnce(db, 'episode_ratings', 'episodeStarsScale');
    expect(flag('episodeStarsScale')).toBe('10');
    raw.exec('INSERT INTO episode_ratings VALUES (1, 1, 1, 7)');
    convertToTenOnce(db, 'episode_ratings', 'episodeStarsScale');
    expect(stars('episode_ratings')).toEqual([7]);
  });

  it('leaves the table untouched and unflagged when the transaction fails', () => {
    const { raw, db, stars, flag } = open();
    raw.exec('INSERT INTO episode_ratings VALUES (1, 1, 1, 3)');
    // the flag write fails AFTER the UPDATE has run, inside the transaction
    raw.exec("CREATE TRIGGER no_flag BEFORE INSERT ON meta BEGIN SELECT RAISE(ABORT, 'crash'); END");
    expect(() => convertToTenOnce(db, 'episode_ratings', 'episodeStarsScale')).toThrow('crash');
    expect(stars('episode_ratings')).toEqual([3]);
    expect(flag('episodeStarsScale')).toBeUndefined();
  });
});
