/**
 * Where to find us: Discord, Reddit, Instagram, TikTok, X.
 *
 * THE DEFAULTS SHIP, AND THE SERVER MAY ONLY OVERRIDE THEM. That order is not
 * a preference, it is forced by the rule the community rests on — somebody who
 * declined it never contacts the server at all. A Settings screen that fetched
 * its links would break that quietly for every person who said no, in exchange
 * for a list that changes twice a year.
 *
 * So the app always has an answer offline, on first launch, and for a decliner;
 * and a joined phone refreshes it while it is ALREADY talking to the server, on
 * a launch it was making anyway.
 *
 * WHY THE SERVER OWNS IT AT ALL: a link compiled into a release cannot be
 * fixed. A Discord invite expires after seven days unless somebody sets
 * otherwise, and a dead invite in a shipped build stays dead in every copy on
 * every phone until a store update reaches them. One row on the server fixes
 * it everywhere at once.
 */

import { getMeta, setMeta } from '@/db';
import { isSafeLinkUrl } from '@/pure';

export type AppLink = { key: string; label: string; url: string };

/**
 * KEYED, NOT ORDERED BY POSITION, so each service keeps its own icon and a link
 * the server drops simply disappears rather than shifting the rest.
 */
/* eslint-disable no-restricted-syntax -- These labels are BRAND NAMES, not
   copy. "Discord" is Discord in all six languages, and routing them through
   t() would put them in the locale files where somebody would eventually
   translate one. The rule is right about everything else; this is the case it
   is not for. */
export const DEFAULT_LINKS: readonly AppLink[] = [
  { key: 'discord', label: 'Discord', url: 'https://discord.gg/AUVPR5sfK' },
  { key: 'reddit', label: 'Reddit', url: 'https://www.reddit.com/r/OpenTvApp/' },
  { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/opentvapp/' },
  { key: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@theopentv' },
  { key: 'x', label: 'X', url: 'https://x.com/OpenTvApp' },
];
/* eslint-enable no-restricted-syntax */

const META_KEY = 'communityLinks';

/** The icon each service wears. Unknown keys get a plain globe rather than
 *  nothing, so a service added on the server needs no app release to look right. */
export function linkIcon(key: string): string {
  switch (key) {
    case 'discord':
      return 'logo-discord';
    case 'reddit':
      return 'logo-reddit';
    case 'instagram':
      return 'logo-instagram';
    case 'tiktok':
      return 'logo-tiktok';
    case 'x':
      return 'logo-twitter';
    default:
      return 'globe-outline';
  }
}

/**
 * What to show. The stored list if there is a usable one, the bundled defaults
 * otherwise — and never a mix, because a half-applied list is how a service
 * that was deliberately removed comes back.
 */
export function appLinks(): readonly AppLink[] {
  const raw = getMeta(META_KEY);
  if (!raw) return DEFAULT_LINKS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LINKS;
    const rows = parsed
      .filter((r): r is AppLink => {
        const x = r as Partial<AppLink>;
        return typeof x?.key === 'string' && typeof x.label === 'string' && isSafeLinkUrl(x.url);
      })
      .map((r) => ({ key: r.key, label: r.label, url: r.url }));
    // AN EMPTY ANSWER IS NOT AN INSTRUCTION TO SHOW NOTHING. A server that has
    // never had rows inserted, or a response that arrived truncated, would
    // otherwise silently delete the section on every phone.
    return rows.length > 0 ? rows : DEFAULT_LINKS;
  } catch {
    return DEFAULT_LINKS;
  }
}

/**
 * Take the server's list, if it sent one.
 *
 * Called from the launch sync of a phone that is already signed in — never on
 * its own account, and never for somebody who has not joined. Silent on every
 * failure: the defaults are always there, so there is nothing to report and
 * nothing a user could do about it.
 */
export function storeAppLinks(rows: unknown): void {
  if (!Array.isArray(rows) || rows.length === 0) return;
  try {
    setMeta(META_KEY, JSON.stringify(rows));
  } catch {
    // The bundled list keeps working.
  }
}
