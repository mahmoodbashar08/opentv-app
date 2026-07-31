/**
 * Giving imported films a TheTVDB id.
 *
 * The film screen's "Who was your favourite?" poll needs TheTVDB's cast,
 * because TheTVDB is the only one of the two catalogues that publishes a
 * picture OF THE CHARACTER; TMDB publishes a picture of the performer. All of
 * that mapping — `characterFace`, `mergeCastForPoll`, `artworkUrl`, the
 * `charPhoto` step in `tvdbMovieDetail` — has been correct the whole time. It
 * simply never ran, because it is gated on a `tvdbId` the film did not have.
 *
 * It did not have one because `movies.tvdbId` is null for every imported film.
 * The importer reads `movie_tvdb_id`, and NO file in TV Time's GDPR export has
 * a column by that name — the export identifies a film by title alone. So the
 * screen's `dbMovie?.tvdbId ?? routeTvdbId` was null, the TheTVDB effect
 * returned at its `if (!tvdbId) return`, and the poll fell back to TMDB's cast
 * and its headshots.
 *
 * This pass resolves the missing ids — by TMDB id where the film has one,
 * falling back to title + year the way `fillMovieReleaseDates` does — and
 * writes them back. It runs on launch behind `runAfterInteractions`, at low
 * concurrency, and is a complete no-op once every film has been answered.
 */
import { useSyncExternalStore } from 'react';

import {
  clearMovieTvdbTried,
  getMeta,
  getMoviesMissingTvdbId,
  markMovieTvdbTried,
  setMeta,
  setMovieTvdbId,
} from '@/db';
import { moviesNeedingTvdbMatch } from '@/pure';
import { pool } from '@/tmdb';
import { tvdbMatchMovie, tvdbMovieByTmdbId } from '@/tvdb';

/** The same ceiling the other TheTVDB passes use — background work nobody is
 *  waiting on, against an API that is not generous. */
const CONCURRENCY = 3;

/** How many films one launch will ask about. A first run on a large library
 *  (the owner's is ~546 films) would otherwise fire hundreds of searches in
 *  one burst; at 120 a launch the whole library is resolved within a handful
 *  of ordinary opens and TheTVDB never sees a spike. */
const PER_LAUNCH = 120;

/**
 * Bumped by hand whenever the matcher gets better at its job, which retires
 * every `tvdbTried` stamped by the worse one. 2: match by TMDB id first, which
 * resolves the films an ambiguous name could only ever guess at.
 */
const MATCH_REV = 2;
const MATCH_REV_KEY = 'movieTvdbMatchRev';

/** Once per revision, and cheap: one string compare on every later launch. */
function retireOldAnswers(): void {
  try {
    if (getMeta(MATCH_REV_KEY) === String(MATCH_REV)) return;
    clearMovieTvdbTried();
    setMeta(MATCH_REV_KEY, String(MATCH_REV));
  } catch {
    // Not clearing costs this build's improvement, not the launch. The next
    // one tries again, because the key stays unwritten.
  }
}

/**
 * One launch's worth of matching. Resolves; never rejects, never blocks.
 *
 * The three outcomes are kept apart deliberately:
 *
 *  - a CONFIDENT match (one exact-name hit, or several narrowed to one by the
 *    watch year) is stored, and the film is marked answered;
 *  - a definitive MISS — TheTVDB knows no film by that name, or knows several
 *    and `pickMovieMatch` had to GUESS which — marks the film answered with no
 *    id. A guess is refused on purpose: the poll is the only consumer of this
 *    id, and a wrong id means showing another film's characters as if they
 *    were this one's, which is worse than showing none. (The poster pass may
 *    still accept a guess; a wrong poster is visible and obviously wrong, a
 *    wrong cast list is not.) `tvdbTried` is set either way, because both
 *    answers came from TheTVDB and neither will change on re-asking.
 *  - a FAILED request (offline, timeout, rate limit, rejected key) marks
 *    NOTHING. This is the important one: a phone in aeroplane mode fails every
 *    lookup in the batch, and treating that as a miss would stamp `tvdbTried`
 *    across the user's entire film library and permanently give up on all of
 *    it, for a reason that had nothing to do with the films.
 */
export async function backfillMovieTvdbIds(): Promise<void> {
  try {
    retireOldAnswers();
    const todo = moviesNeedingTvdbMatch(getMoviesMissingTvdbId()).slice(0, PER_LAUNCH);
    if (!todo.length) return;
    let wrote = 0;
    await pool(
      todo,
      async (m) => {
        // BY ID FIRST. A film that came from search or trending carries TMDB's
        // id, and TheTVDB will trade it for its own — exactly, with no tie to
        // break. Only a film with no id, or one TheTVDB has not cross-indexed,
        // falls through to matching on the name. `failed` falls through too:
        // an offline lookup has told us nothing about the name route either,
        // and that route's own `failed` is what keeps the row for next launch.
        const byId = m.tmdbId ? await tvdbMovieByTmdbId(m.tmdbId) : null;
        const res = byId?.status === 'ok' ? byId : await tvdbMatchMovie(m.name, m.year);
        if (res.status === 'ok' && !res.guessed) {
          setMovieTvdbId(m.name, res.tvdbId);
          wrote++;
        } else if (res.status === 'ok' || res.status === 'none') {
          markMovieTvdbTried(m.name);
        }
        // 'failed' → leave the row exactly as it was, and try again next launch
        return null;
      },
      CONCURRENCY,
    );
    if (wrote) bumpRevision();
  } catch {
    // a background backfill must never be the thing that breaks a launch
  }
}

// ---------------------------------------------------------------------------
// Reactivity
// ---------------------------------------------------------------------------

/**
 * A film screen already open when its id lands must not need a restart.
 *
 * The screen re-reads its db row on focus, which covers every film opened
 * after this pass wrote — but a user who opens a film WHILE the backfill is
 * still running mounted before the id existed and would sit there without
 * characters until they navigated away and back. This is the same
 * `useSyncExternalStore` counter idiom `session-store.ts` uses: bumping it
 * re-renders the screen, the render re-reads `dbMovie`, `tvdbId` is suddenly
 * real and the existing detail effect fires on its own.
 */
let revision = 0;
const subs = new Set<() => void>();

function bumpRevision(): void {
  revision++;
  subs.forEach((s) => s());
}

/** Re-renders the caller whenever the backfill has written new film ids. */
export function useMovieTvdbRevision(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => revision,
  );
}
