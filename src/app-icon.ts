/**
 * Alternate app icons — a one-call adapter over `expo-alternate-app-icons`.
 *
 * WIRED BY HAND ON iOS (8 Oct), because prebuild is never run here: each icon
 * is an `<Name>.appiconset` in `Images.xcassets`, and the app target's
 * `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` lists them, so actool writes
 * the Info.plist entries itself. Android comes from the plugin block in
 * `app.json`, which EAS's prebuild applies.
 *
 * NAMES ARE PascalCase NATIVELY — the plugin capitalises them for Android's
 * activity aliases, and the iOS sets match. The app keeps its lower-case ids;
 * `native()` is the only place they meet.
 *
 * A build without the module (an older dev client) still runs: `supported()`
 * answers false and the picker says so.
 */
type IconModule = {
  supportsAlternateIcons: boolean;
  getAppIconName(): string;
  setAlternateAppIcon(name: string | null): Promise<string>;
};

let mod: IconModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('expo-alternate-app-icons') as IconModule;
} catch {
  mod = null;
}

/**
 * The variants, named by their accent. `null` is the shipped OT icon — it is
 * never paywalled, because taking a paid icon away must always be possible.
 */
// halloween / christmas: the seasonal icons (8 Oct).
export const APP_ICONS = ['default', 'orange', 'purple', 'teal', 'halloween', 'christmas'] as const;
export type AppIconName = (typeof APP_ICONS)[number];

export function supported(): boolean {
  return mod?.supportsAlternateIcons === true;
}

const native = (name: AppIconName) => name[0]!.toUpperCase() + name.slice(1);

export function currentIcon(): AppIconName {
  const name = mod?.getAppIconName()?.toLowerCase();
  return (APP_ICONS as readonly string[]).includes(name ?? '') ? (name as AppIconName) : 'default';
}

/** Resolves to whether it took. Never throws: a refused icon is not a crash. */
export async function setIcon(name: AppIconName): Promise<boolean> {
  if (!mod?.supportsAlternateIcons) return false;
  try {
    await mod.setAlternateAppIcon(name === 'default' ? null : native(name));
    return true;
  } catch {
    return false;
  }
}
