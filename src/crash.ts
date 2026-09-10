/**
 * Crash reporting — and why this one is NOT gated on community consent.
 *
 * `analytics.ts` is off until somebody joins, because usage analytics are part
 * of a deal made on the join screen. This is a different thing and the
 * difference decides the design:
 *
 *   A CRASH REPORT IS NOT USAGE. It is a stack trace of OUR OWN CODE, the app
 *   version, the device model and the OS version. It says the app broke and
 *   where. It cannot say what anybody watched, and nothing here is allowed to
 *   tell it.
 *
 * WHY IT MUST BE ON BEFORE OUR CODE RUNS. The crash this was written for is a
 * user stuck on the splash screen of a fresh install — the app never reached
 * its first render, so it never reached any line of ours. A reporter that
 * waits for JavaScript to switch it on cannot see the launch crashes, which
 * are the ones nobody can work around and the ones a user cannot describe.
 * Hence `crashlytics_auto_collection_enabled: true` in `firebase.json`: the
 * native SDK starts with the process, and this module can only turn it OFF.
 *
 * SO IT IS DISCLOSED AND IT HAS AN OFF SWITCH. Settings → Data. The choice is
 * remembered in `meta` and reapplied on every launch, because the native
 * default is now on and a preference that is not reapplied is not a preference.
 *
 * ⚠️ THE SAME RULE AS ANALYTICS: SHAPE, NEVER CONTENT. Crashlytics will happily
 * carry any string it is handed — `log()`, custom keys, an Error message. A
 * title, a handle, a search or a comment must never be passed to any of them.
 * If a message is built from user data, it does not belong here.
 */
import { getMeta, setMeta } from '@/db';

/** Set to '0' by somebody who turned reporting off. Absent means on. */
const OFF_KEY = 'crashReportsOff';

type CrashlyticsModule = () => {
  setCrashlyticsCollectionEnabled(enabled: boolean): Promise<void>;
  recordError(error: Error, jsErrorName?: string): Promise<void>;
  log(message: string): Promise<void>;
};

let crashlytics: CrashlyticsModule | null = null;
try {
  // Guarded exactly as `analytics.ts` guards its own: the native module exists
  // only in a build compiled with the Firebase config files present, and Jest
  // and any JS-only environment must get a silent no-op rather than a throw.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  crashlytics = (require('@react-native-firebase/crashlytics') as { default: CrashlyticsModule })
    .default;
} catch {
  crashlytics = null;
}

/** Whether reports are being sent. Reads the stored choice, not the SDK. */
export function crashReportsOn(): boolean {
  try {
    return getMeta(OFF_KEY) !== '1';
  } catch {
    // No database yet is not a reason to answer wrongly; the default is on.
    return true;
  }
}

/**
 * Reapply the stored choice. Called once at startup.
 *
 * A no-op for almost everybody, and deliberately so: the native default is
 * already on, so this exists to turn it back OFF for the person who said no.
 * Skipping the call in the common case would leave that person reporting again
 * after every update, which is the quiet kind of broken.
 */
export function initCrashReports(): void {
  if (crashReportsOn()) return;
  void crashlytics?.()
    .setCrashlyticsCollectionEnabled(false)
    .catch(() => {
      // Reporting must never be the reason the app fails to start.
    });
}

/** The settings switch. Takes effect immediately and survives a relaunch. */
export function setCrashReports(on: boolean): void {
  setMeta(OFF_KEY, on ? '' : '1');
  void crashlytics?.()
    .setCrashlyticsCollectionEnabled(on)
    .catch(() => {});
}

/**
 * Report something that was caught and handled — a failed restore, a corrupt
 * import — which would otherwise vanish into one of this codebase's many
 * deliberate empty catches.
 *
 * `where` is a fixed label chosen at the call site from the code, NEVER built
 * from user data. It is what turns a wall of identical stack traces into
 * "seventeen of these came from the Drive restore".
 */
export function reportHandled(where: string, error: unknown): void {
  if (!crashReportsOn()) return;
  const e = error instanceof Error ? error : new Error(String(error));
  void crashlytics?.()
    .recordError(e, where)
    .catch(() => {});
}
