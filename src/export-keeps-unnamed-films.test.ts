/**
 * A BACKUP THAT DELETES SOMETHING IS WORSE THAN NO BACKUP.
 *
 * `exporter.ts` wrote a custom list from `items` only. The films a TV Time
 * export never named are NOT in `items` — they are kept separately as raw
 * uuids, because a uuid is all the export ever gave us — so every backup and
 * every "export my library" dropped them. Worse, `totalCount` is recomputed on
 * import from what survived, so the restored list reported its new shorter size
 * as if that had always been correct. Nothing anywhere said data had been lost.
 *
 * Measured on a real device: a 22-film watch order stored as
 * `items=8, totalCount=8, unresolved=0`. Two round trips through our own export
 * and it is 8 for ever.
 *
 * This lives in `pure.ts` and not in the exporter because the exporter reaches
 * SQLite and jest cannot import it — which is exactly why the one line that
 * decided what a backup contained had no test at all.
 */
import { listObjectsColumn } from '@/pure';

const UUID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

/** The name→uuid map the exporter builds from the tracking rows. */
const uuids = new Map([
  ['Iron Man', UUID(1)],
  ['Thor', UUID(2)],
]);

describe('listObjectsColumn', () => {
  it('writes shows by TheTVDB id and films by uuid', () => {
    const out = listObjectsColumn(
      [
        { kind: 'show', name: 'Breaking Bad', tvdbId: 81189 },
        { kind: 'movie', name: 'Iron Man' },
      ],
      [],
      uuids,
    );
    expect(out).toBe(`[map[id:81189 type:series] map[type:movie uuid:${UUID(1)}]]`);
  });

  it('KEEPS the films the export could never name', () => {
    // The whole bug. These are not in `items`, so writing `items` only is what
    // made a restore come back with a shorter list than the one it replaced.
    const out = listObjectsColumn([{ kind: 'movie', name: 'Iron Man' }], [UUID(9), UUID(10)], uuids);
    expect(out).toContain(`map[type:movie uuid:${UUID(9)}]`);
    expect(out).toContain(`map[type:movie uuid:${UUID(10)}]`);
  });

  it('writes them in TV Time’s own shape, so our importer needs no special case', () => {
    const out = listObjectsColumn([], [UUID(9)], uuids);
    // Byte-for-byte what a real `lists-prod-lists.csv` holds for a film.
    expect(out).toBe(`[map[type:movie uuid:${UUID(9)}]]`);
  });

  it('does not write a film twice when it is both named and still unresolved', () => {
    /*
     * A partial repair leaves this state: the uuid resolved to "Iron Man" and
     * was added to `items`, but another list still lists the same uuid as
     * outstanding. Writing both would grow the list by one on EVERY export, so
     * a library that is backed up weekly would inflate on its own.
     */
    const out = listObjectsColumn([{ kind: 'movie', name: 'Iron Man' }], [UUID(1)], uuids);
    expect(out).toBe(`[map[type:movie uuid:${UUID(1)}]]`);
  });

  it('drops a named film it has no uuid for rather than inventing one', () => {
    // It cannot be written in TV Time's shape at all. It is still a NAMED film,
    // so the library the import rebuilds from carries it either way — where an
    // invented uuid would be a permanent wrong answer in everybody's catalogue.
    const out = listObjectsColumn([{ kind: 'movie', name: 'A Film Nobody Tracked' }], [], uuids);
    expect(out).toBe('[]');
  });

  it('survives a round trip: 8 named + 14 unnamed comes back as 22', () => {
    // The real shape, and the thing the old exporter turned into 8.
    const named = Array.from({ length: 8 }, (_, i) => ({ kind: 'movie' as const, name: `Film ${i}` }));
    const map = new Map(named.map((f, i) => [f.name, UUID(100 + i)]));
    const missing = Array.from({ length: 14 }, (_, i) => UUID(200 + i));

    const out = listObjectsColumn(named, missing, map);
    const written = [...out.matchAll(/uuid:([0-9a-f-]{36})/g)].map((m) => m[1]);
    expect(written).toHaveLength(22);
    expect(new Set(written).size).toBe(22);
    for (const u of missing) expect(written).toContain(u);
  });

  it('an empty list is still a list', () => {
    expect(listObjectsColumn([], [], uuids)).toBe('[]');
  });
});
