/**
 * Signing in with an email address, for people who will not use Apple or
 * Google.
 *
 * THE SERVER DECIDES EVERYTHING THAT MATTERS. Address validity, password
 * strength, whether an address is already taken, whether an account is
 * confirmed — all of it is settled server-side and reported as a `code`. The
 * checks in this file are only so somebody is not made to wait for a round trip
 * to be told their password is four characters long. Never treat a passing
 * check here as permission; the server refuses again regardless.
 *
 * WHAT THIS FILE DELIBERATELY CANNOT DO: tell you whether an address has an
 * account. Registering with a taken address answers exactly as a free one does
 * (202, no session), because an endpoint that says "that email is taken" is a
 * list of who uses this app. So `register` reports "check your inbox" either
 * way, and that is the honest thing to show.
 */
import { ApiError, api } from '@/api';
import { retryHandleClaim } from '@/community-prompt';
import { markHasPassword, rememberAccount, setUnverifiedEmail, signIn } from '@/community-session';
import { getMeta, setMeta } from '@/db';

/**
 * When the last confirmation email went out, as epoch milliseconds.
 *
 * The server allows one a minute (`RESEND_COOLDOWN_MS`), and the confirm
 * screen counts down to it rather than offering a button that answers 429.
 * Stored rather than held in state so the count survives the screen being
 * closed and reopened — and a relaunch, where the minute has usually already
 * passed and the button should simply be live.
 */
const SENT_AT_KEY = 'communityVerifySentAt';

/** One a minute, matching the server. */
export const RESEND_COOLDOWN_MS = 60_000;

export function markConfirmationSent(): void {
  setMeta(SENT_AT_KEY, String(Date.now()));
}

/** Milliseconds until another may be asked for, 0 when it is allowed now. */
export function resendWaitMs(now = Date.now()): number {
  const at = Number(getMeta(SENT_AT_KEY) ?? '');
  if (!Number.isFinite(at) || at <= 0) return 0;
  return Math.max(0, RESEND_COOLDOWN_MS - (now - at));
}

/** What a sign-in returns. `email_verified` decides which screen comes next. */
export type EmailSession = {
  token: string;
  expires_at: string;
  email_verified: boolean;
  needs_handle?: boolean;
};

/** `GET /v1/me` — reachable while unverified, which is the point: the app has
 *  to be able to draw its own state before it is allowed to do anything. */
type Me = { id: string; handle: string; email_verified?: boolean; needs_handle?: boolean };

/**
 * Store the session and the identity behind it.
 *
 * The email endpoints answer with a token and nothing else — unlike the Apple
 * and Google ones, which embed the profile — so the id and handle are fetched
 * with the token before it is committed to storage. One extra round trip on a
 * screen the user is already waiting on, and it keeps `signIn`'s contract
 * (token, id, handle) rather than inventing a second way to be signed in.
 */
async function adopt(s: EmailSession, email?: string): Promise<{ needsHandle: boolean; verified: boolean }> {
  const me = await api<Me>('/v1/me', { token: s.token });
  await signIn(s.token, me.id, me.handle);
  // REMEMBERED, because nothing else would notice. The restriction lives in the
  // token, so the server knows and the app does not — and no request is made at
  // launch, so reopening the app landed on a community that refused everything.
  setUnverifiedEmail(s.email_verified ? null : (email ?? '').trim() || null);
  // Which account this phone belongs to, kept past the session — see
  // `rememberAccount`. Written on every sign-in, not only the first, so an
  // address changed on another device catches up here.
  rememberAccount((email ?? '').trim() || null, 'email');
  return { needsHandle: s.needs_handle ?? me.needs_handle ?? false, verified: s.email_verified };
}

/**
 * Create an account.
 *
 * `pending` means the server accepted the address without minting a session —
 * which happens when it is already registered. The app must say the same thing
 * it says on success: an email is on its way. It is true in both cases; only
 * the contents differ, and only the inbox's owner sees them.
 */
/** How an address that already has an account signs into it. */
export type ExistingAccount = { taken: true; providers: string[]; hasPassword: boolean };

export async function registerWithEmail(
  email: string,
  password: string,
): Promise<ExistingAccount | { taken: false; needsHandle: boolean; verified: boolean }> {
  const res = await api<
    EmailSession & { ok?: boolean; account_exists?: boolean; providers?: string[]; has_password?: boolean }
  >('/v1/auth/email/register', {
    method: 'POST',
    body: { email, password },
  });

  // THE ADDRESS IS ALREADY IN USE, and the server says how. Nothing was
  // created and no mail was sent, so the cooldown must not be stamped either —
  // doing so would make the next screen count down a minute for a message that
  // is not coming.
  if (res?.account_exists) {
    return { taken: true, providers: res.providers ?? [], hasPassword: res.has_password === true };
  }

  // A new account: the confirmation is on its way, so the minute starts here.
  markConfirmationSent();
  return { taken: false, ...(await adopt(res, email)) };
}

export async function loginWithEmail(
  email: string,
  password: string,
): Promise<{ needsHandle: boolean; verified: boolean }> {
  const res = await api<EmailSession>('/v1/auth/email/login', {
    method: 'POST',
    body: { email, password },
  });
  return adopt(res, email);
}

/**
 * Finish the confirmation, from the link in the email.
 *
 * The server hands back a NEW token, because the restriction lives inside the
 * old one — verifying in the database and keeping the old session would leave
 * the app confirmed and still locked out. So the new token replaces the stored
 * one immediately.
 */
export async function confirmEmail(token: string): Promise<void> {
  const res = await api<EmailSession & { ok: boolean }>('/v1/auth/email/verify', {
    method: 'POST',
    body: { token },
  });
  if (res?.token) await adopt(res);
  // Confirmed — drop the gate even if the response carried no fresh token.
  setUnverifiedEmail(null);
  // AND NOW THE HANDLE CAN BE CLAIMED. `POST /v1/me/handle` refuses an
  // unverified session, which is exactly what every email sign-up had when the
  // claim first ran — so this is the first moment it can succeed.
  await retryHandleClaim();
}

/**
 * Confirm with the six-digit code instead of the link.
 *
 * WHY BOTH EXIST. The link is a deep link, so it only works on the device that
 * received the email. Reading it on a phone while signing in on a tablet or a
 * simulator leaves nothing to tap — no app on that machine claims the scheme.
 *
 * THE ADDRESS GOES WITH IT. The server finds a token BY its hash, but a
 * six-digit value used that way would be a search across every account at once,
 * so a code is only accepted alongside the address it was sent to.
 */
export async function confirmEmailWithCode(email: string, code: string): Promise<void> {
  const res = await api<EmailSession & { ok: boolean }>('/v1/auth/email/verify', {
    method: 'POST',
    body: { email: email.trim(), code: code.replace(/[\s-]/g, '') },
  });
  if (res?.token) await adopt(res);
  // Confirmed — drop the gate even if the response carried no fresh token.
  setUnverifiedEmail(null);
  // See `confirmEmail`: this is the first moment the handle claim can succeed.
  await retryHandleClaim();
}

/** Another confirmation email. 429 means the cooldown — a minute, not an error. */
export async function resendConfirmation(): Promise<void> {
  const { getToken } = await import('@/community-session');
  const token = await getToken();
  await api<{ ok: boolean }>('/v1/me/email/resend', { method: 'POST', token });
  markConfirmationSent();
}

/** Always resolves. The server answers 202 whether or not the address is known,
 *  and surfacing anything else here would rebuild the oracle it avoids. */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    await api<{ ok: boolean }>('/v1/auth/email/forgot', { method: 'POST', body: { email } });
  } catch (e) {
    // A network failure is worth knowing about; a 4xx is not, for the reason
    // above — there is nothing the user could do differently.
    if (e instanceof ApiError && e.code === 'network') throw e;
  }
}

/**
 * Add a password to an account that signs in with Apple or Google, so the same
 * person can use either door — and is not locked out on a device where the
 * provider sign-in fails, or if they stop using that Google account.
 *
 * No address is sent. The server takes it from the identity the provider
 * issued; letting the app name one would let anybody claim any address.
 */
export async function setAccountPassword(password: string): Promise<string> {
  const { getToken } = await import('@/community-session');
  const token = await getToken();
  const res = await api<{ ok: boolean; email: string }>('/v1/me/password', {
    method: 'POST',
    token,
    body: { password },
  });
  markHasPassword();
  return res.email;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await api<{ ok: boolean }>('/v1/auth/email/reset', { method: 'POST', body: { token, password } });
}

// ── the same rules the server applies, for instant feedback only ────────────

export const PASSWORD_MIN = 8;

export function emailLooksValid(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  if (s.length < 6 || s.length > 254 || /\s/.test(s)) return false;
  const at = s.indexOf('@');
  if (at < 1 || at !== s.lastIndexOf('@')) return false;
  const domain = s.slice(at + 1);
  return domain.length >= 3 && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}
