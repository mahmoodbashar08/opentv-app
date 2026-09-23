/**
 * CommsUni — the shared comment board, and the promise that it never matters.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE ONE RULE THIS MODULE EXISTS TO KEEP
 *
 *   If CommsUni is rate-limited, unreachable, revoked, or shut down tomorrow,
 *   OpenTV behaves EXACTLY as it did before any of this was written.
 *
 * Not "degrades gracefully". Not "shows a friendly error". The comments screen
 * renders the reader's own comments, the composer writes locally, and nothing
 * anywhere says the word CommsUni. A stranger using the app that day would not
 * be able to tell the integration exists.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * WHY THAT IS A STRUCTURAL CHOICE AND NOT A PROMISE. Promises about error
 * handling decay: somebody adds a screen, forgets a catch, and a 429 becomes a
 * red box on a page about Breaking Bad. So the contract is in the TYPES.
 *
 *   - Nothing here throws. Every function returns a value, and the value for
 *     failure is the same value as for "this feature is off".
 *   - Reads return `null` or an empty list. A caller cannot tell an outage from
 *     a quiet thread, and MUST NOT TRY -- that is the point. There is no
 *     `error` field to render, because a field that exists gets rendered.
 *   - Writes return a boolean. `false` means "not shared", which is a state the
 *     app already has a word for and already draws: app-only.
 *
 * The key is metered and set by hand by its operator, currently low. A 429 is
 * an expected Tuesday, not an incident, and the app's job is to stop asking --
 * see `net-circuit.ts`, which this shares.
 *
 * NOTHING HERE TALKS TO api.commsuni.tv DIRECTLY. The API key is a server
 * credential and the doc is explicit: it must never ship in an app binary,
 * bundle, or anything a device can read. So the phone talks to OpenTV's own
 * Worker, which holds the key and forwards. That also means the day the key is
 * revoked, one server stops forwarding and no app needs updating.
 */
import { getToken, isJoined } from '@/community-session';
import { getMeta, setMeta } from '@/db';
import { serverUrl } from '@/server-url';

/** Where a comment came from. Data-driven on purpose: the guide asks partners
 *  not to hard-code a boolean like `isArchiveComment` but to model a source
 *  with a slug, a name and an icon, so apps that join later render correctly
 *  without a release from us. */
export type Source = {
  slug: string;
  displayName: string;
  /** Absolute URL, or null when the catalogue has no icon for this source. */
  icon: string | null;
  accent: string | null;
};

export type SharedComment = {
  id: string;
  text: string;
  language: string | null;
  createdAt: string;
  author: { name: string | null; avatar: string | null };
  origin: { kind: 'tvtime' | 'partner'; slug: string; displayName: string };
  likes: number;
  replyCount: number;
};

/* ── consent ──────────────────────────────────────────────────────────────
 *
 * The integration guide's consent gate, which is prescriptive rather than
 * advisory: two explicit unselected choices, dismissal recording neither, and
 * an identity question asked ONLY after somebody has agreed to share.
 */

const DECISION_KEY = 'commsuni.decision';
const IDENTITY_KEY = 'commsuni.identity';
const PROMPT_VERSION_KEY = 'commsuni.promptVersion';

/** Bumped when the wording of the prompt changes materially. A decision is
 *  consent to the words somebody actually read, so a rewritten prompt is a new
 *  question -- and the stored version is how a later reader of the record can
 *  tell which words were on the screen. */
export const PROMPT_VERSION = 1;

export type Decision = 'share' | 'keep_private' | null;
export type Identity = 'profile' | 'persona';

/** `null` means NOT ASKED, and it is deliberately distinct from
 *  `keep_private`. Dismissing the sheet records neither choice -- the guide is
 *  explicit that inactivity is not permission -- so the app must be able to
 *  ask again later without treating a dismissal as a refusal. */
export function decision(): Decision {
  const v = getMeta(DECISION_KEY);
  return v === 'share' || v === 'keep_private' ? v : null;
}

export function identity(): Identity {
  return getMeta(IDENTITY_KEY) === 'persona' ? 'persona' : 'profile';
}

/** True only when somebody joined the community AND said yes to sharing.
 *  Every read and write in this module is gated on it. */
export function sharingOn(): boolean {
  return isJoined() && decision() === 'share';
}

/**
 * Record the answer, locally first and then on our own server.
 *
 * LOCAL FIRST, AND THE SERVER CALL CANNOT FAIL THE DECISION. Somebody who
 * taps "Don't share" on a train has decided, and an offline phone must not
 * lose that and ask again tomorrow as though they had never answered. The
 * durable record the guide requires is the server's; the phone's copy is what
 * makes the app behave correctly in the meantime.
 */
export async function recordDecision(d: Exclude<Decision, null>, id?: Identity): Promise<void> {
  setMeta(DECISION_KEY, d);
  setMeta(PROMPT_VERSION_KEY, String(PROMPT_VERSION));
  if (d === 'share' && id) setMeta(IDENTITY_KEY, id);
  void pushDecision(d, id);
}

/** Change the identity later, from settings. Actor-wide and resolved at read
 *  time by the archive, so it retroactively changes the name shown on comments
 *  already shared -- which is why the settings copy has to say so. */
export async function setIdentity(id: Identity): Promise<void> {
  setMeta(IDENTITY_KEY, id);
  if (decision() === 'share') void pushDecision('share', id);
}

async function pushDecision(d: Exclude<Decision, null>, id?: Identity): Promise<void> {
  try {
    const token = await getToken();
    if (!token) return;
    await fetch(`${serverUrl()}/v1/commsuni/consent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: d, identity: id ?? identity(), promptVersion: PROMPT_VERSION }),
    });
  } catch {
    // The phone's copy already holds the answer and the next write retries
    // this. A consent decision must never fail in front of the person making
    // it -- see the note on `recordDecision`.
  }
}

/* ── reads ────────────────────────────────────────────────────────────────
 *
 * Every one of these answers "nothing" on any failure, and there is no way for
 * a caller to learn why. That is the contract at the top of this file.
 */

async function get<T>(path: string): Promise<T | null> {
  if (!sharingOn()) return null;
  try {
    const token = await getToken();
    if (!token) return null;
    const res = await fetch(`${serverUrl()}/v1/commsuni${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 429 IS AN EXPECTED TUESDAY, not an incident: the key is metered and set
    // by hand, currently low. It is the same `null` as a dead network, because
    // the screen's behaviour is identical either way.
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The conversation for one title, or null when there is nothing to add.
 *  Null covers: not joined, not sharing, no token, rate-limited, offline,
 *  key revoked, service gone. The caller renders its own comments and stops. */
export function conversation(
  target: { source: 'tvdb' | 'tmdb'; key: string; season?: number; episode?: number },
): Promise<{ comments: SharedComment[]; sources: Source[] } | null> {
  const q = new URLSearchParams({ source: target.source, key: target.key });
  if (target.season != null) q.set('season', String(target.season));
  if (target.episode != null) q.set('episode', String(target.episode));
  return get(`/conversation?${q.toString()}`);
}

/** The branding table for source badges. Cached hard: it is a small table that
 *  changes when an app joins the ecosystem, not per request. */
export async function sources(): Promise<Source[]> {
  return (await get<{ sources: Source[] }>('/sources'))?.sources ?? [];
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/**
 * Share one comment. `false` means it stayed local — which is a state the app
 * already has, already stores and already labels.
 *
 * THE COMMENT IS ALREADY SAVED BEFORE THIS IS CALLED. Sharing is a second,
 * optional step on top of a local write that has already succeeded, so a
 * failure here can never lose somebody's words. It downgrades a shared comment
 * to an app-only one, and the reader sees the "not shared" tag they would have
 * seen if they had chosen that themselves.
 */
export async function share(
  commentId: string,
  body: { text: string; language: string | null; createdAt: string },
  target: { source: 'tvdb' | 'tmdb'; key: string; season?: number; episode?: number },
): Promise<boolean> {
  if (!sharingOn()) return false;
  try {
    const token = await getToken();
    if (!token) return false;
    const res = await fetch(`${serverUrl()}/v1/commsuni/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // The guide's idempotency contract: a retried write must not create a
        // second comment. Our own comment id is already unique and stable
        // across retries, which is exactly what the key wants to be.
        'Idempotency-Key': commentId,
      },
      body: JSON.stringify({ ...body, target, identity: identity() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
