/**
 * Random data, for testing, in development builds only.
 *
 * WHY THIS EXISTS. Every screen in the community layer is a picture of what
 * OTHER people thought, and until an app has other people it renders the same
 * three states for ever: nothing, or one opinion at 100%. That made whole
 * features effectively untested — a star bar that splits, a feelings row with
 * two answers, a thread with more than one voice, a favourite that is not
 * unanimous. Importing an archive does not help: it is one person's opinions,
 * however many rows it has.
 *
 * WHAT IT DOES. Writes ratings, feelings and favourite characters onto shows
 * the library already has, at random, using the SAME `db.ts` functions the
 * screens use. Nothing here bypasses a layer or writes a shape the app cannot
 * produce itself — a generator that took a shortcut would prove the shortcut
 * works and nothing else.
 *
 * IT CANNOT REACH A RELEASE BUILD. Every entry point is behind `__DEV__`, which
 * the bundler evaluates as a constant: in a production build the branch is dead
 * and the whole module is dropped. `settings.tsx` guards the row with the same
 * constant, so there is no path to it in a shipped app.
 *
 * IT IS LOCAL, AND THAT IS THE POINT. It writes to this phone's SQLite exactly
 * as a tap would. Whether any of it reaches the server is then the community
 * layer's ordinary decision — seeding, the same as for imported rows — so what
 * gets tested is the real pipeline rather than a special case of it.
 */
import {
  getShowNames,
  getSeasonEpisodes,
  setCharacterVote,
  setEpisodeRating,
  toggleEpisodeEmotion,
} from '@/db';

/** How much a single tap generates. Small enough to stay instant, big enough
 *  that a percentage has something to divide. */
export const DEV_SEED_SHOWS = 12;
export const DEV_SEED_EPISODES_PER_SHOW = 6;

/** The twelve emotions, by the value the database stores (index + 28). */
const EMOTION_VALUES = Array.from({ length: 12 }, (_, i) => i + 28);

/** Names with nothing behind them — a favourite poll needs SOMETHING to count. */
const CHARACTERS = [
  'Eren Yeager',
  'Mikasa Ackerman',
  'Levi',
  'Walter White',
  'Jesse Pinkman',
  'Eleven',
  'Steve Harrington',
  'Tyrion Lannister',
  'Arya Stark',
  'Nacho Varga',
];

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)] as T;
}

export type DevSeedResult = { shows: number; ratings: number; emotions: number; favourites: number };

/**
 * Fill the library with opinions.
 *
 * `random` is a parameter so a test can pass a deterministic source; the app
 * passes `Math.random`. Every write is wrapped: a show whose season has no
 * episodes, a row that violates something — none of it should abort a run the
 * user asked for and can simply repeat.
 */
export function generateTestData(random: () => number = Math.random): DevSeedResult {
  const out: DevSeedResult = { shows: 0, ratings: 0, emotions: 0, favourites: 0 };
  if (!__DEV__) return out;

  let shows: { tvdbId: number; name: string }[] = [];
  try {
    shows = getShowNames();
  } catch {
    return out;
  }
  if (shows.length === 0) return out;

  // A shuffled prefix rather than a random pick per iteration: picking with
  // replacement would hit the same show twice and leave the run smaller than
  // it claims.
  const shuffled = [...shows].sort(() => random() - 0.5).slice(0, DEV_SEED_SHOWS);

  for (const show of shuffled) {
    // Season 1 is the one every show has; a library where it is empty simply
    // contributes nothing rather than failing the run. `getSeasonEpisodes`
    // takes the season as an argument and does not repeat it on each row, so
    // it is held here.
    const SEASON = 1;
    let episodes: { episode: number }[] = [];
    try {
      episodes = getSeasonEpisodes(show.tvdbId, SEASON).slice(0, DEV_SEED_EPISODES_PER_SHOW);
    } catch {
      continue;
    }
    if (episodes.length === 0) continue;
    out.shows++;

    for (const ep of episodes) {
      try {
        // 1–5, weighted to the top the way real ratings are: nobody's library
        // is a uniform distribution, and a bar that is flat by construction
        // tests nothing about how a real one renders.
        const stars = 3 + Math.floor(random() * 3);
        setEpisodeRating(show.tvdbId, SEASON, ep.episode, Math.min(5, stars));
        out.ratings++;
      } catch {
        // one bad row, not a failed run
      }
      try {
        // One or two feelings — the multi-select case is the one that was
        // wrong for weeks, so it must be generated, not assumed.
        const count = random() < 0.4 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          toggleEpisodeEmotion(show.tvdbId, SEASON, ep.episode, pick(EMOTION_VALUES, random));
          out.emotions++;
        }
      } catch {
        // ditto
      }
    }

    try {
      const first = episodes[0];
      if (first) {
        setCharacterVote(show.tvdbId, SEASON, first.episode, pick(CHARACTERS, random));
        out.favourites++;
      }
    } catch {
      // ditto
    }
  }
  return out;
}
