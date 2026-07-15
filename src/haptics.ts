/**
 * Safe haptics — no-ops silently when the native module isn't in the
 * installed binary yet (e.g. before a dev-client rebuild).
 */
import * as Haptics from 'expo-haptics';

export function tapSelection(): void {
  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {
    // native module unavailable — skip the vibration, never crash
  }
}

export function tapLight(): void {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // native module unavailable — skip the vibration, never crash
  }
}
