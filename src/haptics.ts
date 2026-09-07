/**
 * Safe haptics — no-ops silently when the native module isn't in the
 * installed binary yet (e.g. before a dev-client rebuild).
 *
 * AND SWITCHABLE, since 1.6.3. Every buzz in the app comes through the two
 * functions below, so one gate here turns the lot off — 59 files call these and
 * not one of them has to know the setting exists.
 *
 * THE VALUE IS CACHED, not read per tap. Marking a season watched fires one of
 * these per episode, and a SQLite read inside that loop is a real cost for a
 * preference that changes about twice in a lifetime. `setHapticsOn` is the only
 * writer, so the cache cannot drift from the row: the toggle calls it.
 *
 * ON BY DEFAULT, because a tracker whose confirmation you cannot feel is the
 * app most people already have. A reader who does not want it says so once —
 * which is exactly what the first person to ask for this could not do.
 */
import * as Haptics from 'expo-haptics';

import { getMeta, setMeta } from '@/db';

export const HAPTICS_KEY = 'hapticsOff';

/** Lazily read once, then owned by `setHapticsOn`. `null` = not yet read. */
let enabled: boolean | null = null;

/**
 * Whether a tap should buzz. Exported so the settings screen can render the
 * switch from the same source the buzz reads, rather than its own copy.
 */
export function hapticsOn(): boolean {
  if (enabled === null) {
    try {
      enabled = getMeta(HAPTICS_KEY) !== '1';
    } catch {
      // No database yet (a test, or the very first launch) — buzz, as before.
      return true;
    }
  }
  return enabled;
}

/** Persist the choice and update the cache in one step. */
export function setHapticsOn(on: boolean): void {
  enabled = on;
  setMeta(HAPTICS_KEY, on ? '0' : '1');
}

export function tapSelection(): void {
  if (!hapticsOn()) return;
  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {
    // native module unavailable — skip the vibration, never crash
  }
}

export function tapLight(): void {
  if (!hapticsOn()) return;
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // native module unavailable — skip the vibration, never crash
  }
}
