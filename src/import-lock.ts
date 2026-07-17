/**
 * Serializes every import run in the app — the user-initiated pickAndImport and
 * the startup resumeInterruptedImport — onto a single promise chain. Both share
 * the importPending meta flag and the one staged ZIP path (tvtime-importing.zip)
 * and both have network awaits mid-run, so without this they could interleave:
 * a startup resume finishing mid-way through a user's fresh import would delete
 * the user's staged ZIP and clear the flag, and last-writer-wins could clobber
 * the preserved original with stale bytes. Queuing them makes each import run to
 * completion before the next begins. Single JS thread, so a module-level chain
 * is enough; the queued task runs whether the previous one resolved or threw.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withImportLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // keep the chain alive regardless of how this run settled
  tail = run.then(
    () => {},
    () => {},
  );
  return run;
}
