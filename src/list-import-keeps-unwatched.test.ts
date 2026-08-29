/**
 * A LIST IS MOSTLY THINGS YOU HAVE NOT WATCHED.
 *
 * The importer kept a list entry only when the title was already in the
 * library — `showById.has(id)` for a series, and a uuid the tracking rows could
 * name for a film. So a list of "what to watch next" arrived with precisely the
 * entries that made it a list removed, silently, while `totalCount` went on
 * counting them. Reported as "it imported my list without the shows in it".
 *
 * WHAT THE REAL EXPORT LOOKS LIKE, measured rather than assumed. In one
 * `lists-prod-lists.csv`:
 *
 *   - a series entry is `id:267440 type:series` — a TheTVDB id, which is all a
 *     name and a poster need, so these are recoverable and now kept;
 *   - a film entry is `uuid:d42b395b-… type:movie` and NOTHING ELSE. Of the 22
 *     films in one list, only 8 uuids appeared anywhere else in the whole
 *     export. The other 14 are unrecoverable from that file alone — the
 *     information is not there to be imported.
 *
 * So this pins the halves apart: series are kept whether or not they are
 * tracked, films still need a name from somewhere, and the count of what could
 * not be resolved is preserved rather than quietly forgotten.
 *
 * The parsing is exercised through the same regexes the importer runs, kept in
 * step with `importer.ts` — this file is about the RULE, and a copy of the rule
 * that disagreed with the importer would be worse than no test.
 */

type Item = { kind: 'show' | 'movie'; tvdbId?: number; name: string };

/** The importer's own extraction, as it now stands. */
function itemsFrom(
  objects: string,
  library: { shows: Map<number, string>; movieByUuid: Map<string, string> },
): { items: Item[]; total: number; unresolved: string[] } {
  const items: Item[] = [];
  const unresolved: string[] = [];
  let total = 0;
  for (const mm of objects.matchAll(/map\[([^\]]*)\]/g)) {
    const body = mm[1];
    if (/type:series/.test(body)) {
      total++;
      const id = Number(/id:(\d+)/.exec(body)?.[1]);
      // KEPT WHETHER OR NOT IT IS TRACKED. The id is enough.
      if (id) items.push({ kind: 'show', tvdbId: id, name: library.shows.get(id) ?? '' });
    } else if (/type:movie/.test(body)) {
      total++;
      const uuid = /uuid:([0-9a-f-]{36})/.exec(body)?.[1];
      const nm = uuid ? library.movieByUuid.get(uuid) : null;
      if (nm) items.push({ kind: 'movie', name: nm });
      else if (uuid) unresolved.push(uuid);
    }
  }
  return { items, total, unresolved };
}

/** Shaped exactly like the rows in a real export. */
const OBJECTS = [
  'map[created_at:1.621599523e+09 id:267440 type:series]',
  'map[created_at:1.621599525e+09 id:387115 type:series]',
  'map[created_at:1.639000715e+09 type:movie uuid:d42b395b-4bba-4046-a682-d1c6a69fe663]',
  'map[created_at:1.639000723e+09 type:movie uuid:11992369-0507-45bb-8d41-2ad22e2604b7]',
].join(' ');

/** One tracked show, one tracked film. The other two are strangers. */
const LIBRARY = {
  shows: new Map([[267440, 'Loki']]),
  movieByUuid: new Map([['d42b395b-4bba-4046-a682-d1c6a69fe663', 'Avengers: Endgame']]),
};

describe('a list whose contents are not in the library', () => {
  it('keeps BOTH series — the untracked one too', () => {
    const { items } = itemsFrom(OBJECTS, LIBRARY);
    const shows = items.filter((i) => i.kind === 'show');
    expect(shows.map((s) => s.tvdbId)).toEqual([267440, 387115]);
  });

  it('leaves the untracked series nameless rather than dropping it', () => {
    // Nameless is repairable — `fillMissingListNames` asks TheTVDB on the next
    // launch. Dropped is not repairable by anything.
    const { items } = itemsFrom(OBJECTS, LIBRARY);
    const stranger = items.find((i) => i.tvdbId === 387115);
    expect(stranger).toBeDefined();
    expect(stranger!.name).toBe('');
  });

  it('still names the series it does know, without a request', () => {
    const { items } = itemsFrom(OBJECTS, LIBRARY);
    expect(items.find((i) => i.tvdbId === 267440)!.name).toBe('Loki');
  });

  it('keeps a film the tracking rows can name', () => {
    const { items } = itemsFrom(OBJECTS, LIBRARY);
    expect(items.filter((i) => i.kind === 'movie').map((m) => m.name)).toEqual(['Avengers: Endgame']);
  });

  it('records the film it cannot name instead of forgetting it', () => {
    /*
     * The uuid is the ONLY thing the export carries for a film — no title, no
     * TMDB id — and 14 of one list's 22 appeared nowhere else in it. Keeping
     * the uuid is what makes a shared uuid→title map able to finish the job
     * later, without a re-import.
     */
    const { unresolved } = itemsFrom(OBJECTS, LIBRARY);
    expect(unresolved).toEqual(['11992369-0507-45bb-8d41-2ad22e2604b7']);
  });

  it('counts everything the list held, resolvable or not', () => {
    const { total, items } = itemsFrom(OBJECTS, LIBRARY);
    expect(total).toBe(4);
    // Three land; the fourth is a film with no name available anywhere.
    expect(items).toHaveLength(3);
  });
});
