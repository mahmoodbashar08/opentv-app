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
  logEvent(name: string, params?: Record<string, string | number>): Promise<void>;
  logScreenView(params: { screen_name: string; screen_class: string }): Promise<void>;
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

/**
 * WHAT MAY BE SENT, AND WHY THE LINE IS HERE.
 *
 * The join screen promises "anonymous usage analytics" (`community.join.promise`,
 * in all six locales), and the privacy copy promises non-joiners "no analytics,
 * no tracking". Both are load-bearing, so this module carries a rule rather than
 * a convention:
 *
 *   SHAPE, NEVER CONTENT.
 *
 * Which control was pressed and which route it was pressed on is shape. Which
 * show it was, what a comment said, who was followed, what was searched for —
 * that is the user's library, and it is exactly what the server was designed
 * not to hold (see backend/README.md). It must not reach Google either, because
 * a per-title event stream reconstructs the watch history that the whole design
 * keeps on the phone. Nothing here takes a title, an id, a handle or free text,
 * and no caller should be given one to pass.
 *
 * Consent is not re-checked here: collection is off in `firebase.json` and is
 * only ever turned on by `setAnalyticsConsent(true)` at sign-in, so events
 * logged by a user who never joined are dropped by the SDK rather than queued.
 * Checking `isJoined()` as well would import the session module into this one
 * and make the cycle analytics → session → analytics.
 */
export function track(name: string, params?: Record<string, string | number>): void {
  void analytics?.()
    .logEvent(name, params)
    .catch(() => {
      // analytics must never break the interaction it is describing
    });
}

/**
 * A screen view, named by ROUTE PATTERN — `show/[id]`, never `show/402551`.
 *
 * The pattern is what `useSegments()` already hands back, which is convenient
 * and also the only safe form: a resolved path carries the tvdbId of something
 * the user is watching, so logging it would ship viewing history one screen at a
 * time. It also keeps the event count sane — Firebase caps distinct screen
 * names, and a per-title path would burn through that cap in a day.
 *
 * Firebase attaches the last screen to every subsequent event as
 * `firebase_screen`, so callers of `track()` never pass a screen themselves.
 */
export function trackScreen(name: string): void {
  void analytics?.()
    .logScreenView({ screen_name: name, screen_class: name })
    .catch(() => {});
}
