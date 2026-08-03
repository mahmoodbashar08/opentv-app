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
import { signIn } from '@/community-session';

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
async function adopt(s: EmailSession): Promise<{ needsHandle: boolean; verified: boolean }> {
  const me = await api<Me>('/v1/me', { token: s.token });
  await signIn(s.token, me.id, me.handle);
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
export async function registerWithEmail(
  email: string,
  password: string,
): Promise<{ pending: true } | { pending: false; needsHandle: boolean; verified: boolean }> {
  const res = await api<EmailSession & { ok?: boolean }>('/v1/auth/email/register', {
    method: 'POST',
    body: { email, password },
  });
  if (!res?.token) return { pending: true };
  return { pending: false, ...(await adopt(res)) };
}

export async function loginWithEmail(
  email: string,
  password: string,
): Promise<{ needsHandle: boolean; verified: boolean }> {
  const res = await api<EmailSession>('/v1/auth/email/login', {
    method: 'POST',
    body: { email, password },
  });
  return adopt(res);
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
}

/** Another confirmation email. 429 means the cooldown — a minute, not an error. */
export async function resendConfirmation(): Promise<void> {
  const { getToken } = await import('@/community-session');
  const token = await getToken();
  await api<{ ok: boolean }>('/v1/me/email/resend', { method: 'POST', token });
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
