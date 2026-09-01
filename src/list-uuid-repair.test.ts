/**
 * REPAIRING THE FILMS THE EXPORT COULD NOT NAME.
 *
 * The numbers here are measured, not invented. One real `lists-prod-lists.csv`
 * held a list called `avenger` with 22 films in it, of which the importer could
 * name 8 — the other 14 appear nowhere else in the entire export, because
 * TV Time kept those titles server-side. A second developer's importer read the
 * same file with completely different code and resolved the same 8, which is
 * how we know it is not a parsing bug: the information is not there.
 *
 * So the repair asks a catalogue built from other people's libraries. That
 * makes the failure modes silent ones — a wrong rule here does not crash, it
 * quietly changes what somebody's list says it contains — and every test below
 * pins one of them.
 */
import { applyResolvedTitles, unresolvedUuids, type RepairableList } from '@/pure';

const U = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

const list = (over: Partial<RepairableList> = {}): RepairableList => ({
  name: 'avenger',
  items: [{ kind: 'movie', name: 'Iron Man', poster: null }],
  movieCount: 1,
  totalCount: 3,
  unresolved: [U(1), U(2)],
  ...over,
});

describe('unresolvedUuids', () => {
  it('collects what still needs a name', () => {
    expect(unresolvedUuids([list()])).toEqual([U(1), U(2)]);
  });

  it('asks once for a film that sits in several lists', () => {
    // "watchlist" and "to rewatch" overlap heavily. Asking twice is a bigger
    // request for no more information.
    const a = list({ name: 'a', unresolved: [U(1), U(2)] });
    const b = list({ name: 'b', unresolved: [U(2), U(3)] });
    expect(unresolvedUuids([a, b])).toEqual([U(1), U(2), U(3)]);
  });

  it('ignores anything that is not a uuid', () => {
    // A malformed id matches nothing and would only widen the request body.
    expect(unresolvedUuids([list({ unresolved: ['', 'nope', '123', U(9)] })])).toEqual([U(9)]);
  });

  it('caps the request', () => {
    const many = Array.from({ length: 500 }, (_, i) => U(i));
    expect(unresolvedUuids([list({ unresolved: many })], 200)).toHaveLength(200);
  });

  it('is empty for a list with nothing outstanding', () => {
    expect(unresolvedUuids([list({ unresolved: [] }), list({ unresolved: undefined })])).toEqual([]);
  });
});

describe('what counts as a film to restore', () => {
  /*
   * A SERIES ENTRY CARRIES A uuid OF ITS OWN. Measured on a real export: a list
   * of 26 shows has 26 `uuid:` fields in it, beside the `id:` each row also
   * states. Matching the uuid without checking the type collected all 26 and
   * offered them as films with no name — a banner promising to restore titles
   * it could never find, on a list that was already complete.
   *
   * The importer's own regexes, restated. `rebuildImportedListsFromZip` runs
   * inside the importer where jest cannot reach it, so this pins the RULE.
   */
  const filmUuids = (objects: string) => {
    const out: string[] = [];
    for (const mm of objects.matchAll(/map\[([^\]]*)\]/g)) {
      const body = mm[1];
      if (!/type:(movie|series)/.test(body)) continue;
      if (!/type:movie/.test(body)) continue;
      const u = /uuid:([0-9a-f-]{36})/.exec(body)?.[1];
      if (u) out.push(u);
    }
    return out;
  };

  it('ignores the uuid on a series entry', () => {
    const objects = `[map[created_at:1.6e+09 id:267440 type:series uuid:${U(1)}] map[type:movie uuid:${U(2)}]]`;
    expect(filmUuids(objects)).toEqual([U(2)]);
  });

  it('takes every film, and nothing that is neither', () => {
    const objects = `[map[type:movie uuid:${U(1)}] map[type:list uuid:${U(3)}] map[type:movie uuid:${U(2)}]]`;
    expect(filmUuids(objects)).toEqual([U(1), U(2)]);
  });
});

describe('applyResolvedTitles', () => {
  it('adds the film and stops asking about it', () => {
    const { lists, fixed } = applyResolvedTitles([list()], { [U(1)]: { title: 'The Avengers' } });
    expect(fixed).toBe(1);
    expect(lists[0].items.map((i) => i.name)).toEqual(['Iron Man', 'The Avengers']);
    expect(lists[0].unresolved).toEqual([U(2)]);
    expect(lists[0].movieCount).toBe(2);
  });

  it('KEEPS a uuid the catalogue did not know', () => {
    /*
     * The catalogue is built from other people's libraries, so a miss today is
     * a hit next month. Dropping it would shrink the list to the size we can
     * draw — the exact lie this feature exists to undo — and would make the
     * miss permanent, because nothing would ever ask again.
     */
    const { lists, fixed } = applyResolvedTitles([list()], {});
    expect(fixed).toBe(0);
    expect(lists[0].unresolved).toEqual([U(1), U(2)]);
    expect(lists[0].items).toHaveLength(1);
  });

  it('does not move totalCount', () => {
    // These films were always IN the list; they just had no name. Adding to the
    // total would count them a second time and the list would grow as it healed.
    const { lists } = applyResolvedTitles([list()], { [U(1)]: { title: 'The Avengers' }, [U(2)]: { title: 'Thor' } });
    expect(lists[0].totalCount).toBe(3);
    expect(lists[0].items).toHaveLength(3);
  });

  it('never adds a film the list already has, and does not count it', () => {
    /*
     * The recovery feeds EVERY uuid in the export back in, because a stored
     * item carries no uuid to match against — so a uuid resolving to a film
     * already present is the normal case, not an edge one. It must still be
     * dropped from `unresolved` (it is answered), but counting it made the
     * alert claim 22 films restored to a list that gained 14.
     */
    const { lists, fixed } = applyResolvedTitles([list()], { [U(1)]: { title: 'Iron Man' } });
    expect(fixed).toBe(0);
    expect(lists[0].items).toHaveLength(1);
    expect(lists[0].unresolved).toEqual([U(2)]);
  });

  it('treats an empty or blank name as a miss', () => {
    const { lists, fixed } = applyResolvedTitles([list()], { [U(1)]: { title: '   ' }, [U(2)]: { title: '' } });
    expect(fixed).toBe(0);
    expect(lists[0].unresolved).toEqual([U(1), U(2)]);
  });

  it('leaves userCreated alone', () => {
    /*
     * `userCreated` protects a list from being rebuilt by a re-import. A
     * repaired list must stay re-importable, or this repair freezes it against
     * every future one — including itself, run again with a fuller catalogue.
     */
    const l = { ...list(), userCreated: false } as RepairableList & { userCreated: boolean };
    const { lists } = applyResolvedTitles([l], { [U(1)]: { title: 'The Avengers' } });
    expect(lists[0].userCreated).toBe(false);
  });

  it('returns untouched lists by identity, so nothing rewrites what it did not change', () => {
    const untouched = list({ name: 'done', unresolved: [] });
    const { lists } = applyResolvedTitles([untouched, list()], { [U(1)]: { title: 'The Avengers' } });
    expect(lists[0]).toBe(untouched);
  });

  it('carries the ids through, because a title alone makes every screen guess', () => {
    /*
     * A film with only a name has to be SEARCHED for wherever it is opened —
     * the detail screen shows the first hit, then corrects itself when a better
     * match lands, which reads as the app malfunctioning. An id settles it
     * before anything is drawn. 13 of the 14 in the real list carried one.
     */
    const { lists } = applyResolvedTitles([list()], {
      [U(1)]: { title: 'The Avengers', tmdb_id: 24428, tvdb_id: 31 },
    });
    const added = lists[0].items[1];
    expect(added.tmdbId).toBe(24428);
    expect(added.tvdbId).toBe(31);
  });

  it('refuses a zero or fractional id rather than writing a fake one', () => {
    // Every screen treats "has an id" as "do not search". A 0 written here is
    // indistinguishable from a real id at the call site and would send the
    // film to a lookup that can only fail.
    const { lists } = applyResolvedTitles([list()], {
      [U(1)]: { title: 'A', tmdb_id: 0, tvdb_id: -3 },
      [U(2)]: { title: 'B', tmdb_id: 1.5 },
    });
    expect(lists[0].items[1].tmdbId).toBeUndefined();
    expect(lists[0].items[1].tvdbId).toBeUndefined();
    expect(lists[0].items[2].tmdbId).toBeUndefined();
  });

  it('adds the film even when the catalogue has no ids for it', () => {
    // 1 of the 14 had neither. A name is still worth far more than a uuid.
    const { lists, fixed } = applyResolvedTitles([list()], { [U(1)]: { title: 'The Incredible Hulk' } });
    expect(fixed).toBe(1);
    expect(lists[0].items[1].name).toBe('The Incredible Hulk');
    expect(lists[0].items[1].tmdbId).toBeUndefined();
  });

  it('counts 14, not 22, when the recovery hands back every uuid', () => {
    /*
     * THE SHAPE THAT ACTUALLY SHIPS. `rebuildImportedListsFromZip` cannot tell
     * which stored item came from which uuid, so it puts ALL of a list's uuids
     * back — here 22, of which 8 name films the list already holds. The alert
     * says what it added, and a user counting posters can check it.
     */
    const known = Array.from({ length: 8 }, (_, i) => ({ kind: 'movie' as const, name: `Known ${i}`, poster: null }));
    const dupes = Array.from({ length: 8 }, (_, i) => U(200 + i));
    const missing = Array.from({ length: 14 }, (_, i) => U(100 + i));
    const avenger = list({ items: known, movieCount: 8, totalCount: 22, unresolved: [...dupes, ...missing] });
    const found = {
      ...Object.fromEntries(dupes.map((u, i) => [u, { title: `Known ${i}` }])),
      ...Object.fromEntries(missing.map((u, i) => [u, { title: `Marvel ${i}` }])),
    };

    const { lists, fixed } = applyResolvedTitles([avenger], found);
    expect(fixed).toBe(14);
    expect(lists[0].items).toHaveLength(22);
    // Every uuid was answered, duplicates included, so none is asked about again.
    expect(lists[0].unresolved).toEqual([]);
  });

  it('repairs the real case: 8 of 22 named, 14 restored', () => {
    // The measured shape of `avenger`, end to end.
    const known = Array.from({ length: 8 }, (_, i) => ({
      kind: 'movie' as const,
      name: `Known ${i}`,
      poster: null,
    }));
    const missing = Array.from({ length: 14 }, (_, i) => U(100 + i));
    const avenger = list({ items: known, movieCount: 8, totalCount: 22, unresolved: missing });
    const names = Object.fromEntries(missing.map((u, i) => [u, { title: `Marvel ${i}`, tmdb_id: 1000 + i }]));

    const { lists, fixed } = applyResolvedTitles([avenger], names);
    expect(fixed).toBe(14);
    expect(lists[0].items).toHaveLength(22);
    expect(lists[0].movieCount).toBe(22);
    expect(lists[0].totalCount).toBe(22);
    expect(lists[0].unresolved).toEqual([]);
  });
});
