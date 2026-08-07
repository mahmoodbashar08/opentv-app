/**
 * Firebase Analytics, gated on community consent.
 *
 * The deal, stated on the join screen: users who join the community accept
 * usage analytics; users who never join are never tracked — the app must not
 * even initialise collection for them. `firebase.json` therefore ships with
 * every auto-collection flag off, and this module is the only place that can
 * turn collection on. It does so exactly when a community session starts, and
 * off again the moment it ends.
 *
 * The require is guarded because the native module only exists in a dev-client
 * or store build that was compiled with the Firebase config files present —
 * Jest and JS-only environments get a silent no-op.
 */
type AnalyticsModule = () => {
  setAnalyticsCollectionEnabled(enabled: boolean): Promise<void>;
};

let analytics: AnalyticsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  analytics = (require('@react-native-firebase/analytics') as { default: AnalyticsModule }).default;
} catch {
  analytics = null;
}

/** Called from the community session chokepoints: sign-in → true, sign-out → false. */
export function setAnalyticsConsent(enabled: boolean): void {
  void analytics?.()
    .setAnalyticsCollectionEnabled(enabled)
    .catch(() => {
      // analytics must never break sign-in/out
    });
}
