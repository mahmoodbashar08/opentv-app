/**
 * The pure half of the comment section.
 *
 * Every rule here has a twin in `backend/src/pure.ts`, and the cases are
 * chosen to be the ones where two implementations of one rule drift: the
 * boundary of the length limit, an emoji-only body, a reply to a reply. A
 * divergence would show as the app happily sending something the server then
 * refuses — the worst kind, because the user wrote the thing first.
 *
 * Nothing here touches the network. `community-comments.ts` is one `fetch`
 * away from the wire and is verified by using the app, not by a mock that
 * would only ever assert what I already believe.
 */
import {
  COMMENT_BODY_MAX,
  REPORT_REASONS,
  canReplyTo,
  commentBodyError,
  commentErrorKey,
  relativeTime,
  reportReasonKey,
  spoilerHidden,
} from './pure';

describe('commentBodyError', () => {
  it('refuses an empty body', () => {
    expect(commentBodyError('')).toBe('empty');
  });

  it('refuses whitespace-only, including newlines and tabs', () => {
    for (const body of [' ', '   ', '\n', '\t', ' \n\t \r\n ']) {
      expect(commentBodyError(body)).toBe('empty');
    }
  });

  it('accepts an ordinary comment', () => {
    expect(commentBodyError('That finale was something else.')).toBeNull();
  });

  it('accepts one at exactly the limit', () => {
    expect(commentBodyError('a'.repeat(COMMENT_BODY_MAX))).toBeNull();
  });

  it('refuses one character more', () => {
    expect(commentBodyError('a'.repeat(COMMENT_BODY_MAX + 1))).toBe('too_long');
  });

  it('measures the trimmed body, not the typed one', () => {
    // Trailing whitespace must not be what pushes a comment over the line.
    expect(commentBodyError(`${'a'.repeat(COMMENT_BODY_MAX)}     `)).toBeNull();
  });

  it('accepts an emoji-only comment', () => {
    // The entire reason the server counts code points. A surrogate-pair count
    // would make this 6 characters, and 1,001 of them "too long".
    expect(commentBodyError('😭😭😭')).toBeNull();
  });

  it('counts emoji as one character each, like the server', () => {
    // 2,000 astral code points is 4,000 UTF-16 units. It is under the limit.
    expect(commentBodyError('😭'.repeat(COMMENT_BODY_MAX))).toBeNull();
    expect(commentBodyError('😭'.repeat(COMMENT_BODY_MAX + 1))).toBe('too_long');
  });

  it('accepts Arabic at the same limit as English', () => {
    expect(commentBodyError('م'.repeat(COMMENT_BODY_MAX))).toBeNull();
    expect(commentBodyError('م'.repeat(COMMENT_BODY_MAX + 1))).toBe('too_long');
  });
});

describe('canReplyTo', () => {
  it('allows a reply to a top-level comment', () => {
    expect(canReplyTo({ parent_id: null })).toBe(true);
  });

  it('refuses a reply to a reply — one level, and the server agrees', () => {
    expect(canReplyTo({ parent_id: 'c_abc' })).toBe(false);
  });
});

describe('spoilerHidden', () => {
  const flagged = { id: 'c_1', is_spoiler: 1 };
  const plain = { id: 'c_2', is_spoiler: 0 };

  it('hides a flagged comment nobody has revealed', () => {
    expect(spoilerHidden(flagged, new Set())).toBe(true);
  });

  it('shows it once revealed', () => {
    expect(spoilerHidden(flagged, new Set(['c_1']))).toBe(false);
  });

  it('never hides an unflagged comment', () => {
    expect(spoilerHidden(plain, new Set())).toBe(false);
    expect(spoilerHidden(plain, new Set(['c_2']))).toBe(false);
  });

  it('reveals only the comment that was tapped', () => {
    expect(spoilerHidden(flagged, new Set(['c_9', 'c_2']))).toBe(true);
  });

  it('accepts the boolean shape as well as the server column', () => {
    expect(spoilerHidden({ id: 'c_3', is_spoiler: true }, new Set())).toBe(true);
    expect(spoilerHidden({ id: 'c_3', is_spoiler: false }, new Set())).toBe(false);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-07-31T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('reads anything under a minute as now', () => {
    expect(relativeTime(ago(0), now)).toEqual({ key: 'community.time.now', count: 0 });
    expect(relativeTime(ago(59_000), now)).toEqual({ key: 'community.time.now', count: 0 });
  });

  it('steps through the units at their boundaries', () => {
    expect(relativeTime(ago(MIN), now)).toEqual({ key: 'community.time.minutes', count: 1 });
    expect(relativeTime(ago(59 * MIN), now)).toEqual({ key: 'community.time.minutes', count: 59 });
    expect(relativeTime(ago(HOUR), now)).toEqual({ key: 'community.time.hours', count: 1 });
    expect(relativeTime(ago(23 * HOUR), now)).toEqual({ key: 'community.time.hours', count: 23 });
    expect(relativeTime(ago(DAY), now)).toEqual({ key: 'community.time.days', count: 1 });
    expect(relativeTime(ago(6 * DAY), now)).toEqual({ key: 'community.time.days', count: 6 });
    expect(relativeTime(ago(7 * DAY), now)).toEqual({ key: 'community.time.weeks', count: 1 });
    expect(relativeTime(ago(29 * DAY), now)).toEqual({ key: 'community.time.weeks', count: 4 });
    expect(relativeTime(ago(30 * DAY), now)).toEqual({ key: 'community.time.months', count: 1 });
    expect(relativeTime(ago(364 * DAY), now)).toEqual({ key: 'community.time.months', count: 12 });
    expect(relativeTime(ago(365 * DAY), now)).toEqual({ key: 'community.time.years', count: 1 });
    expect(relativeTime(ago(800 * DAY), now)).toEqual({ key: 'community.time.years', count: 2 });
  });

  it('reads a future timestamp as now rather than as a negative age', () => {
    // Phone clocks are wrong. "in -2 minutes" makes the whole screen look broken.
    expect(relativeTime(ago(-5 * HOUR), now)).toEqual({ key: 'community.time.now', count: 0 });
  });

  it('returns null for anything unparseable', () => {
    for (const bad of ['', 'yesterday', 'Invalid Date', '2026-13-45T99:99:99Z']) {
      expect(relativeTime(bad, now)).toBeNull();
    }
  });
});

describe('commentErrorKey', () => {
  it('says a comment is too long when the server refuses its size', () => {
    expect(commentErrorKey('too_large')).toBe('community.comments.errTooLong');
    expect(commentErrorKey('invalid_body')).toBe('community.comments.errTooLong');
  });

  it('says a comment is gone when it no longer exists', () => {
    expect(commentErrorKey('not_found')).toBe('community.comments.errGone');
    // DELETE answers 403 for "not yours" and for "no such id" alike, so the
    // app must not translate it as a sign-in problem the way the join screen
    // does. Same code, different surface, different sentence.
    expect(commentErrorKey('forbidden')).toBe('community.comments.errGone');
  });

  it('falls through to the shared mapping for everything else', () => {
    expect(commentErrorKey('network')).toBe('community.error.network');
    expect(commentErrorKey('rate_limited')).toBe('community.error.rateLimited');
    expect(commentErrorKey('unauthenticated')).toBe('community.error.signInRejected');
  });

  it('never fails on an unknown code — a failure path that fails is not one', () => {
    for (const code of ['internal', 'blocked', '', 'brand_new_code']) {
      expect(commentErrorKey(code)).toBe('community.error.generic');
    }
  });
});

describe('reportReasonKey', () => {
  it('has a distinct label for every reason the server accepts', () => {
    const keys = REPORT_REASONS.map(reportReasonKey);
    expect(keys).toEqual([
      'community.report.spam',
      'community.report.harassment',
      'community.report.hate',
      'community.report.sexual',
      'community.report.violence',
      'community.report.spoiler',
      'community.report.other',
    ]);
    expect(new Set(keys).size).toBe(REPORT_REASONS.length);
  });

  it('mirrors the server list exactly — order included', () => {
    // `REPORT_REASONS` in backend/src/pure.ts. A reason the app offers and the
    // server rejects is a report that silently never gets filed.
    expect([...REPORT_REASONS]).toEqual(['spam', 'harassment', 'hate', 'sexual', 'violence', 'spoiler', 'other']);
  });
});
