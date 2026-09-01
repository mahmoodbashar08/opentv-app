/**
 * Putting back the films TV Time left out of your lists.
 *
 * WHAT IS BROKEN. `lists-prod-lists.csv` stores a list entry as
 * `map[type:movie uuid:d42b395b-…]` and nothing else — no title, no year, no
 * poster. The importer can only name one if the same uuid happens to reappear
 * in the tracking rows, which do carry `movie_name`. So a film is nameable if
 * and only if the owner WATCHED it, and a list is mostly things they have not.
 * Measured on a real export: `avenger` held 22 films and 8 could be named. A
 * second developer's importer read the same file with completely different code
 * and resolved the same 8 — the information is not in the ZIP at all.
 *
 * WHAT LEAVES THE PHONE, and why it is the safe half. The request carries the
 * uuids the export could NOT name — films the owner listed and never watched.
 * It is unauthenticated, it carries no profile id and no token, and the answer
 * is the same for everybody who asks about the same film. What it cannot do is
 * describe what somebody watched, which is the thing this server refuses to
 * hold. That is also what lets it run for a user who declined the community:
 * there is no account involved and nothing about them in it.
 *
 * The alternative was downloading the whole catalogue and matching on-device —
 * no question ever sent, but half a megabyte per phone for a screen most people
 * open once. The uuids of unwatched films were the cheaper thing to give up.
 *
 * NOTHING HERE THROWS. A list that is still missing films is exactly the
 * situation before this ran, and it retries on the next import or tap.
 */
import { api } from '@/api';
import { track } from '@/analytics';
import { getCustomLists, saveCustomLists } from '@/db';
import { applyResolvedTitles, unresolvedUuids, type CatalogueTitle, type RepairableList } from '@/pure';

/** What one call asks about. The server caps at the same number. */
const BATCH = 200;

export type RepairOutcome = {
  /** Entries with no name before this ran. */
  holes: number;
  /** How many now have one. */
  fixed: number;
  /** False when the server could not be reached — different from "0 fixed". */
  ran: boolean;
};

/**
 * One pass over every list.
 *
 * Costs NOTHING when there is nothing to do: the uuids are read out of the
 * lists first, and a library with no holes returns before any network call. So
 * this is safe to run at the end of every import.
 */
export async function repairLists(): Promise<RepairOutcome> {
  const lists = getCustomLists() as unknown as RepairableList[];
  const wanted = unresolvedUuids(lists, 5000);
  if (wanted.length === 0) return { holes: 0, fixed: 0, ran: true };

  /*
   * BATCHED, AND A FAILED BATCH DOES NOT ABANDON THE REST. A library with
   * several long watchlists can hold more uuids than one request may carry, and
   * a person whose third batch times out should still get the first two.
   */
  const found: Record<string, CatalogueTitle> = {};
  let ran = false;
  for (let i = 0; i < wanted.length; i += BATCH) {
    try {
      const res = await api<{ names?: Record<string, CatalogueTitle | string> }>('/v1/movie-names/resolve', {
        method: 'POST',
        body: { uuids: wanted.slice(i, i + BATCH) },
      });
      ran = true;
      for (const [uuid, v] of Object.entries(res.names ?? {})) {
        // The route answered plain strings before it carried ids. Accept both,
        // so an old Worker and a new app do not simply fail to understand each
        // other — the names alone are still most of the value.
        found[uuid] = typeof v === 'string' ? { title: v } : v;
      }
    } catch {
      // Offline, rate-limited, or the route is not deployed yet. Whatever came
      // back already is still applied below.
    }
  }
  if (!ran) return { holes: wanted.length, fixed: 0, ran: false };

  const { lists: next, fixed } = applyResolvedTitles(lists, found);
  if (fixed > 0) saveCustomLists(next as unknown as ReturnType<typeof getCustomLists>);

  /*
   * SHAPE, NEVER CONTENT. Two counts and no identifiers — not a uuid, not a
   * title, not a list name. `holes` without `fixed` would not answer the only
   * question worth asking, which is whether the catalogue is worth keeping.
   */
  track('list_repair', { holes: wanted.length, fixed });
  return { holes: wanted.length, fixed, ran: true };
}
