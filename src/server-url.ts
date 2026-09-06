/**
 * Which community server this phone talks to.
 *
 * THE APP IS SELF-HOSTABLE AND THIS IS THE HALF THAT LIVES ON THE PHONE.
 * `backend/SELF-HOSTING.md` is one `docker compose up` and a directory; without
 * a way to point the app somewhere else, that document describes a server
 * nobody can reach. The backend is open source for the same reason the app is —
 * "there is no watch-history table on the server" should be a sentence somebody
 * can go and check, and then run for themselves.
 *
 * A BUILD-TIME CONSTANT IS THE FALLBACK, NOT THE RULE. `API_BASE_URL` stays
 * exactly what it was — the address of the official server, and what every
 * install uses until somebody deliberately changes it. This only ever reads a
 * value the user typed into Settings.
 *
 * CHANGING IT SIGNS THE DEVICE OUT, and that is not a nicety. A session token
 * is issued by one server and means nothing to another; a profile id, a handle
 * and every cached aggregate belong to the server that answered them. Carrying
 * them across is the codebase's oldest bug shape — state kept without the
 * condition it was made under — so the switch is a hard boundary: token gone,
 * identity gone, caches gone. See `switchServer` in `community-account.ts`.
 *
 * HTTPS ONLY. iOS App Transport Security refuses plain HTTP anyway, so a
 * `http://` address would be accepted here and then fail at every request with
 * a network error nobody could diagnose. Refusing it in the box is the honest
 * place. `localhost` is the one exception, for somebody testing on a simulator.
 */
import { API_BASE_URL } from '@/api-config';
import { getMeta, setMeta } from '@/db';
import { normaliseServerUrl as normalise } from '@/pure';

const KEY = 'communityServerUrl';

/** The address every request is built from. */
export function serverUrl(): string {
  return getMeta(KEY) || API_BASE_URL;
}

/** True when this phone is pointed at somebody's own server. */
export function isCustomServer(): boolean {
  const v = getMeta(KEY);
  return !!v && v !== API_BASE_URL;
}

/** The shipped address, for the "reset" affordance. */
export function officialServerUrl(): string {
  return API_BASE_URL;
}

/** The community policy: https only, apart from a machine you are standing at. */
export function normaliseServerUrl(raw: string): string | null {
  return normalise(raw);
}

/** Write it. The caller is responsible for signing out first — see the header. */
export function setServerUrl(url: string | null): void {
  setMeta(KEY, url ?? '');
}
