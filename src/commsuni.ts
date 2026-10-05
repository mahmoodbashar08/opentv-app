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
  author: { name: string | null; avatar: string | null; color: string | null };
  origin: { kind: 'tvtime' | 'partner'; slug: string; displayName: string };
  likes: number;
  replyCount: number;
  isSpoiler: boolean;
  /** Hosted by the app that posted it; https only (the server checks). */
  image?: string | null;
  /** A private archive picture, served by our server: `archiveImageSource`. */
  archiveImage?: boolean;
};

/** What a CommsUni thread is addressed by: always a TVDB id (the API cannot
 *  resolve TMDB), an episode by its show's id plus season and episode. */
export type BoardTarget =
  | { type: 'episode'; id: number; season: number; episode: number }
  | { type: 'show' | 'movie'; id: number };

export type BoardSort = 'most_liked' | 'most_recent' | 'most_relevant';

/** Per-language top-level counts: first page only, under the same source filter. */
export type LanguageCount = { language: string; count: number };

export type BoardPage = {
  comments: SharedComment[];
  nextCursor: string | null;
  archived: boolean;
  languageCounts?: LanguageCount[] | null;
};

/** Narrowing asked of THEIR server (§9), never done here. Null = all. */
export type BoardFilter = { source: string | null; language: string | null };

/* ── consent ──────────────────────────────────────────────────────────────
 *
 * The integration guide's consent gate, which is prescriptive rather than
 * advisory: two explicit unselected choices, dismissal recording neither, and
 * an identity question asked ONLY after somebody has agreed to share.
 */

const DECISION_KEY = 'commsuni.decision';
const IDENTITY_KEY = 'commsuni.identity';
const PROMPT_VERSION_KEY = 'commsuni.promptVersion';
const COVERS_KEY = 'commsuni.coversExisting';

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
export async function recordDecision(
  d: Exclude<Decision, null>,
  id?: Identity,
  /**
   * WHETHER THE WORDS THEY READ SAID "AND YOUR EXISTING COMMENTS".
   *
   * Not a formality. The guide draws its sharpest line here: agreeing to share
   * new comments, on a prompt that never mentioned a history, does NOT
   * authorise publishing one. Passing `true` from a screen whose copy did not
   * say so is how an app quietly publishes everything somebody ever wrote.
   *
   * It is a parameter rather than a constant so the consent screen and a
   * one-line settings toggle cannot claim the same scope.
   */
  coversExisting = false,
): Promise<void> {
  setMeta(DECISION_KEY, d);
  setMeta(PROMPT_VERSION_KEY, String(PROMPT_VERSION));
  setMeta(COVERS_KEY, d === 'share' && coversExisting ? '1' : '0');
  if (d === 'share' && id) setMeta(IDENTITY_KEY, id);
  void pushDecision(d, id, d === 'share' && coversExisting);
}

/** Whether this reader's own history may be sent. Mirrors the server's
 *  `backfillAllowed`, so a screen can answer without a round trip. */
export function backfillAllowed(): boolean {
  return sharingOn() && getMeta(COVERS_KEY) === '1';
}

/** Change the identity later, from settings. Actor-wide and resolved at read
 *  time by the archive, so it retroactively changes the name shown on comments
 *  already shared -- which is why the settings copy has to say so. */
export async function setIdentity(id: Identity): Promise<void> {
  setMeta(IDENTITY_KEY, id);
  if (decision() === 'share') void pushDecision('share', id, getMeta(COVERS_KEY) === '1');
}

async function pushDecision(d: Exclude<Decision, null>, id?: Identity, coversExisting = false): Promise<void> {
  try {
    const token = await getToken();
    if (!token) return;
    await fetch(`${serverUrl()}/v1/commsuni/consent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: d,
        identity: d === 'share' ? (id ?? identity()) : undefined,
        promptVersion: PROMPT_VERSION,
        coversExisting,
      }),
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

/*
 * READING NEEDS MEMBERSHIP, NOT CONSENT TO SHARE. The consent gate is about
 * sending somebody's words to the shared board; looking at the board asks
 * nothing of them. The guide's one rule for reads is that guests never reach
 * the archive, and a member is not a guest.
 */
/** The last session token a read used, for image sources that must be synchronous. */
let lastToken: string | null = null;

/**
 * An archive picture, by CommsUni comment id — a board comment's own id, or the
 * original TV Time id an imported comment kept. Our server fetches it once and
 * caches the picture; null until a read has given us a token to send.
 */
export function archiveImageSource(commentId: string): { uri: string; headers: Record<string, string> } | null {
  if (!lastToken || !isJoined()) return null;
  return { uri: `${serverUrl()}/v1/commsuni/media/${encodeURIComponent(commentId)}`, headers: { Authorization: `Bearer ${lastToken}` } };
}

/** Make `archiveImageSource` usable on a screen that has not read the board. */
export async function primeArchiveImages(): Promise<boolean> {
  if (!isJoined()) return false;
  lastToken = (await getToken()) ?? null;
  return lastToken != null;
}

async function get<T>(path: string): Promise<T | null> {
  if (!isJoined()) return null;
  try {
    const token = await getToken();
    if (!token) return null;
    lastToken = token;
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

/** One page of a thread on the shared board, or null when there is nothing
 *  to add. Null covers: not a member, no token, rate-limited, offline, key
 *  revoked, service gone. The caller shows its own comments and stops. */
export function boardPage(
  target: BoardTarget,
  sort: BoardSort,
  cursor: string | null,
  filter: BoardFilter = { source: null, language: null },
): Promise<BoardPage | null> {
  const q = new URLSearchParams({ type: target.type, id: String(target.id), sort });
  if (target.type === 'episode') {
    q.set('season', String(target.season));
    q.set('episode', String(target.episode));
  }
  if (cursor) q.set('cursor', cursor);
  if (filter.source) q.set('source', filter.source);
  if (filter.language) q.set('language', filter.language);
  return get<BoardPage>(`/comments?${q.toString()}`);
}

/**
 * The comment a tap is opening, handed to its page in memory: CommsUni has it
 * already in the board's page, so the page needs only the replies from the
 * network, not the comment a second time.
 */
const opened = new Map<string, SharedComment>();
export function rememberShared(c: SharedComment): void {
  opened.set(c.id, c);
}
export function sharedById(id: string): SharedComment | null {
  return opened.get(id) ?? null;
}

/** One thread's replies, fetched when it is opened. Null on any failure. */
export function boardReplies(
  commentId: string,
  /** A reply's own replies — the guide's second level, same thread. */
  branch?: string,
): Promise<{ replies: SharedComment[]; nextCursor: string | null } | null> {
  const q = new URLSearchParams({ id: commentId });
  if (branch) q.set('parent', branch);
  return get(`/replies?${q.toString()}`);
}

/** Cached for the session: the catalogue changes when an app joins, and the
 *  server already keeps it a day. */
let sourcesCache: Source[] | null = null;

/** The branding table for source badges. Cached hard: it is a small table that
 *  changes when an app joins the ecosystem, not per request. */
export async function sources(): Promise<Source[]> {
  if (sourcesCache) return sourcesCache;
  const got = (await get<{ sources: Source[] }>('/sources'))?.sources ?? [];
  if (got.length) sourcesCache = got;
  return got;
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
export async function share(commentId: string, tvdbMovie: number | null): Promise<boolean> {
  if (!sharingOn()) return false;
  try {
    const token = await getToken();
    if (!token) return false;
    // By id: the server reads the comment it already has and shares that, so
    // nothing reaches CommsUni that did not pass OpenTV's own posting rules.
    const res = await fetch(`${serverUrl()}/v1/commsuni/share`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: commentId, tvdb_movie: tvdbMovie ?? undefined }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ── replying on the board ───────────────────────────────────────────────
 *
 * A reply to a CommsUni comment lives on CommsUni only — there is no OpenTV
 * comment for it to be a copy of. So the phone keeps the ids of its own
 * replies, which is what lets it offer Delete on them and nobody else's.
 */
const MY_REPLIES_KEY = 'commsuniMyReplies';

export function myReplyIds(): Set<string> {
  try {
    return new Set(JSON.parse(getMeta(MY_REPLIES_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

function setMyReplyIds(ids: Set<string>): void {
  setMeta(MY_REPLIES_KEY, JSON.stringify([...ids]));
}

/** The id CommsUni gave the last reply sent from here, so the screen can
 *  show it before their next read includes it. */
let lastReplyId: string | null = null;
export const takeLastReplyId = (): string | null => {
  const id = lastReplyId;
  lastReplyId = null;
  return id;
};

export type ReplyResult = 'ok' | 'too_long' | 'rate_limited' | 'gif_refused' | 'failed';

/** `clientId` is the idempotency key: the same one on a retry posts once. */
export async function replyOnBoard(
  parentId: string,
  text: string,
  clientId: string,
  root?: string,
  extras: { spoiler?: boolean; gif?: string | null } = {},
): Promise<ReplyResult> {
  if (!sharingOn()) return 'failed';
  try {
    const token = await getToken();
    if (!token) return 'failed';
    const res = await fetch(`${serverUrl()}/v1/commsuni/reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent: parentId,
        text,
        client_id: clientId,
        ...(root && root !== parentId ? { root } : {}),
        ...(extras.spoiler ? { spoiler: true } : {}),
        ...(extras.gif ? { gif: extras.gif } : {}),
      }),
    });
    if (res.status === 429) return 'rate_limited';
    // A GIF-only reply CommsUni would not take yet (its host not allowlisted).
    if (res.status === 422) return 'gif_refused';
    if (res.status === 400) return 'too_long';
    if (!res.ok) return 'failed';
    const got = (await res.json()) as { commsuni_id?: string | null };
    if (got.commsuni_id) {
      setMyReplyIds(myReplyIds().add(got.commsuni_id));
      lastReplyId = got.commsuni_id;
    }
    return 'ok';
  } catch {
    return 'failed';
  }
}

export async function deleteBoardReply(id: string, parentId: string): Promise<boolean> {
  try {
    const token = await getToken();
    if (!token) return false;
    const res = await fetch(`${serverUrl()}/v1/commsuni/reply/${encodeURIComponent(id)}?parent=${encodeURIComponent(parentId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const ids = myReplyIds();
    ids.delete(id);
    setMyReplyIds(ids);
    return true;
  } catch {
    return false;
  }
}

export type ReportReason = 'spam' | 'abuse' | 'spoiler' | 'sexual' | 'illegal' | 'other' | 'mine_hide' | 'mine_claim';

/**
 * Report a comment on the shared board. `mine_*` only for an archived TV Time
 * comment (`origin.kind === 'tvtime'`), as the guide requires; the server
 * refuses it otherwise. True when CommsUni accepted it (a repeat counts).
 */
export async function reportOnBoard(id: string, reason: ReportReason, archived: boolean): Promise<boolean> {
  try {
    const token = await getToken();
    if (!token) return false;
    const res = await fetch(`${serverUrl()}/v1/commsuni/report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, reason, archived, client_id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
