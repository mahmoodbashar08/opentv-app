/**
 * A name for this device that survives a restart and is not a fingerprint.
 *
 * RANDOM, NOT THE HARDWARE'S ID. The server needs to tell two devices apart —
 * that is the whole of it — and an identifier derived from the phone would be
 * one more thing about the user sitting on a server for no benefit. It is also
 * the id half of every sync op, so it must not change: a device that renamed
 * itself would start receiving its own past back.
 *
 * ITS OWN MODULE because two things need it that must not load each other.
 * The sync relay (`device-sync.ts`) drags in React Native and the backup
 * modules; the profile publisher (`community-publish.ts`) sits in the Node
 * test graph and now sends this id so the server can keep a free profile to
 * one phone (0052). Neither can import the other, so both import this.
 *
 * NOT IN THE BACKUP. `meta` is exported row by named key, never whole, so a
 * restored phone makes its own name rather than inheriting the old phone's —
 * which is what lets the server tell the two apart at all.
 */
import { getMeta, setMeta } from '@/db';

const DEVICE = 'sync.device';

export function deviceId(): string {
  let id = getMeta(DEVICE);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    setMeta(DEVICE, id);
  }
  return id;
}
