/**
 * Recovering the imported favourite characters.
 *
 * TV Time's export file `show_character_episode_vote.csv` names the show, the
 * season and the episode — and identifies the character only as
 * `show_character_id`. There is no character name anywhere in the export. That
 * was taken to mean the votes were unrecoverable, and the seeder drops a vote
 * with no name (see `seedableCharacters`), so those rows were counted, stored,
 * and never sent to anyone.
 *
 * They were recoverable the whole time. TV Time was built on TheTVDB — that is
 * why the export's primary key for a show is a `tvdbId` — and
 * `show_character_id` is a TheTVDB character id, so `/characters/{id}` gives
 * the name straight back:
 *
 *     65427983 → Conan Edogawa        63696764 → Olivier Mira Armstrong
 *     64923224 → Steve Harrington     68699185 → Eddie Munson
 *
 * Not every id survives: TheTVDB has removed records over the years, and the
 * oldest ids (`358674`, a Breaking Bad vote from 2022) now 404. Misses are
 * normal, expected, and permanent — which is the whole reason for `nameTried`.
 *
 * This runs on launch, behind `runAfterInteractions`, at low concurrency, and
 * is a complete no-op once every id has been answered.
 */
import { getUnnamedCharacterVotes, markCharacterNameTried, setCharacterVoteName } from '@/db';
import { characterIdsNeedingNames } from '@/pure';
import { pool } from '@/tmdb';
import { tvdbCharacter } from '@/tvdb';

/** Same ceiling the show-metadata passes use — TheTVDB is not generous and
 *  this is background work nobody is waiting on. */
const CONCURRENCY = 3;

/**
 * One launch's worth of recovery. Resolves; never rejects, never blocks.
 *
 * The three outcomes of a lookup are kept apart deliberately:
 *
 *  - a NAME is written to every vote for that character and the id is marked
 *    answered;
 *  - a definitive MISS (TheTVDB says no such character) marks the id answered
 *    with no name, so it is never asked again on any future launch;
 *  - a FAILED request (offline, timeout, rate limit, rejected key) marks
 *    NOTHING. This is the important one. A phone in aeroplane mode fails every
 *    lookup in the batch; treating that as a miss would stamp `nameTried` on
 *    the user's entire history of favourites and permanently destroy the
 *    chance of recovering any of them — for a reason that had nothing to do
 *    with the data.
 */
export async function backfillCharacterNames(): Promise<void> {
  try {
    const ids = characterIdsNeedingNames(getUnnamedCharacterVotes());
    if (!ids.length) return;
    await pool(
      ids,
      async (id) => {
        const res = await tvdbCharacter(id);
        if (res.status === 'ok') {
          const name = (res.character.name ?? '').trim();
          if (name) setCharacterVoteName(id, name);
          else markCharacterNameTried(id);
        } else if (res.status === 'gone') {
          markCharacterNameTried(id);
        }
        // 'failed' → leave the row exactly as it was, and try again next launch
        return null;
      },
      CONCURRENCY,
    );
  } catch {
    // a background backfill must never be the thing that breaks a launch
  }
}
