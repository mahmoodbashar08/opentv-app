/**
 * One sentence to show somebody when a community call fails.
 *
 * WHY THIS IS NOT JUST `t(communityErrorKey(code))`, which is what every screen
 * did before it. That mapping is right for every code the build knows about,
 * and a build only knows the codes that existed the day it was archived. A code
 * added to the server afterwards lands in the `default:` branch as
 * `community.error.generic` — "Something went wrong. Try again." — for ever, in
 * every copy of the app already on a phone.
 *
 * That is not hypothetical: closing email sign-up added `unavailable`, whose
 * message said sign-up was temporarily off and to use Apple or Google. 1.3.0
 * had no such code, so it showed the shrug instead, and the person reporting it
 * reasonably concluded the app was broken. The server was answering perfectly;
 * the app was throwing the answer away.
 *
 * So: localised string when the code is known, the server's own sentence when
 * it is not, and the generic only when there is neither. The English is the
 * trade — a true sentence in one language beats a useless one in six.
 */
import { ApiError } from '@/api';
import { t } from '@/i18n';
import { communityErrorKey } from '@/pure';

export function communityErrorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : typeof e === 'string' ? e : 'unknown';
  const key = communityErrorKey(code);
  // Only when the mapping had nothing specific to say. A known code's
  // translation always wins over the server's English.
  if (key === 'community.error.generic' && e instanceof ApiError && e.serverMessage) {
    return e.serverMessage;
  }
  return t(key);
}
