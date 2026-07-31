/**
 * The pure half of joining the community: when to offer it, and what counts
 * as a handle.
 *
 * The handle cases are deliberately the SAME cases `backend/src/pure.ts` is
 * tested against. Two implementations of one rule only stay identical if both
 * are held to the same evidence — and a divergence here would show a user a
 * green tick for a handle the server then refuses, which is worse than not
 * checking at all.
 */
import {
  HANDLE_MAX,
  HANDLE_MIN,
  RESERVED_HANDLES,
  communityErrorKey,
  handleFailureKey,
  isHandleValid,
  needsHandle,
  normaliseHandle,
  shouldShowJoinPrompt,
  suggestedHandle,
} from './pure';

describe('shouldShowJoinPrompt', () => {
  // The full truth table. Four booleans, sixteen rows, no gaps: the whole
  // point of putting this decision in a pure function is that "does it ever
  // nag someone who said no?" is answerable by reading a table rather than by
  // installing the app and waiting.
  const table: {
    hasImported: boolean;
    joined: boolean;
    asked: boolean;
    declined: boolean;
    expected: boolean;
  }[] = [
    // Nobody who has already joined is ever asked again.
    { hasImported: true, joined: true, asked: true, declined: true, expected: false },
    { hasImported: true, joined: true, asked: true, declined: false, expected: false },
    { hasImported: true, joined: true, asked: false, declined: true, expected: false },
    { hasImported: true, joined: true, asked: false, declined: false, expected: false },
    { hasImported: false, joined: true, asked: true, declined: true, expected: false },
    { hasImported: false, joined: true, asked: true, declined: false, expected: false },
    { hasImported: false, joined: true, asked: false, declined: true, expected: false },
    { hasImported: false, joined: true, asked: false, declined: false, expected: false },
    // "Not now" is an answer, not a postponement.
    { hasImported: true, joined: false, asked: true, declined: true, expected: false },
    { hasImported: true, joined: false, asked: false, declined: true, expected: false },
    { hasImported: false, joined: false, asked: true, declined: true, expected: false },
    { hasImported: false, joined: false, asked: false, declined: true, expected: false },
    // Shown once. Shown means shown, answered or not.
    { hasImported: true, joined: false, asked: true, declined: false, expected: false },
    { hasImported: false, joined: false, asked: true, declined: false, expected: false },
    // Never imported → never offered unprompted; Settings and the Profile
    // banner are how those users get in, and neither consults this function.
    { hasImported: false, joined: false, asked: false, declined: false, expected: false },
    // The one and only row that shows the prompt.
    { hasImported: true, joined: false, asked: false, declined: false, expected: true },
  ];

  it('covers every combination of the four flags', () => {
    expect(table.length).toBe(16);
    const seen = new Set(
      table.map((r) => `${r.hasImported}${r.joined}${r.asked}${r.declined}`),
    );
    expect(seen.size).toBe(16);
  });

  for (const row of table) {
    const label = `imported=${row.hasImported} joined=${row.joined} asked=${row.asked} declined=${row.declined}`;
    it(`${label} → ${row.expected}`, () => {
      expect(shouldShowJoinPrompt(row)).toBe(row.expected);
    });
  }

  it('shows the prompt exactly once across a realistic sequence', () => {
    // import finishes → shown, flag stamped → every later launch is silent
    const base = { hasImported: true, joined: false, declined: false };
    expect(shouldShowJoinPrompt({ ...base, asked: false })).toBe(true);
    expect(shouldShowJoinPrompt({ ...base, asked: true })).toBe(false);
  });
});

describe('normaliseHandle', () => {
  it('lowercases, trims and NFKC-folds', () => {
    expect(normaliseHandle('  MahMood  ')).toBe('mahmood');
    // NFKC folds full-width Latin onto ASCII, so this one is legitimately valid
    expect(normaliseHandle('ｆｕｌｌｗｉｄｔｈ')).toBe('fullwidth');
  });
});

describe('isHandleValid', () => {
  it('accepts the ordinary case', () => {
    expect(isHandleValid('mahmood')).toEqual({ ok: true, handle: 'mahmood' });
    expect(isHandleValid('a_b_9')).toEqual({ ok: true, handle: 'a_b_9' });
    expect(isHandleValid('_leading_underscore')).toEqual({ ok: true, handle: '_leading_underscore' });
  });

  it('folds case rather than refusing it', () => {
    expect(isHandleValid('MahMood')).toEqual({ ok: true, handle: 'mahmood' });
    expect(isHandleValid('  MAHMOOD  ')).toEqual({ ok: true, handle: 'mahmood' });
  });

  it('refuses handles that are too short', () => {
    expect(isHandleValid('ab')).toEqual({ ok: false, reason: 'too_short' });
    expect(isHandleValid('')).toEqual({ ok: false, reason: 'too_short' });
    // trimmed first, so whitespace does not pad a short handle into range
    expect(isHandleValid('  a  ')).toEqual({ ok: false, reason: 'too_short' });
  });

  it('refuses handles that are too long', () => {
    expect(isHandleValid('a'.repeat(HANDLE_MAX))).toEqual({ ok: true, handle: 'a'.repeat(HANDLE_MAX) });
    expect(isHandleValid('a'.repeat(HANDLE_MAX + 1))).toEqual({ ok: false, reason: 'too_long' });
  });

  it('refuses spaces and punctuation', () => {
    expect(isHandleValid('two words')).toEqual({ ok: false, reason: 'bad_characters' });
    expect(isHandleValid('has.dot')).toEqual({ ok: false, reason: 'bad_characters' });
    expect(isHandleValid('has-hyphen')).toEqual({ ok: false, reason: 'bad_characters' });
    expect(isHandleValid('emoji🍿here')).toEqual({ ok: false, reason: 'bad_characters' });
  });

  it('refuses a Cyrillic lookalike', () => {
    // "аdmin" — the first character is U+0430 CYRILLIC SMALL LETTER A, which
    // renders identically to "a". NFKC does NOT fold it onto ASCII (they are
    // different letters, not different forms of one), so the character rule is
    // what has to catch it. This is the whole reason the rule is [a-z0-9_].
    const cyrillic = 'аdmin';
    expect(cyrillic).not.toBe('admin');
    expect(isHandleValid(cyrillic)).toEqual({ ok: false, reason: 'bad_characters' });
  });

  it('refuses the user_ placeholder prefix', () => {
    expect(isHandleValid('user_abc123')).toEqual({ ok: false, reason: 'reserved' });
    expect(isHandleValid('USER_ABC123')).toEqual({ ok: false, reason: 'reserved' });
    // not a prefix — perfectly fine
    expect(isHandleValid('superuser_1')).toEqual({ ok: true, handle: 'superuser_1' });
  });

  it('refuses every reserved word', () => {
    for (const word of RESERVED_HANDLES) {
      expect(isHandleValid(word)).toEqual({ ok: false, reason: 'reserved' });
      expect(isHandleValid(word.toUpperCase())).toEqual({ ok: false, reason: 'reserved' });
    }
  });

  it('checks length before characters, matching the server', () => {
    // Both sides must report the SAME reason for a string that breaks two
    // rules, or the app shows a different message than the server's code.
    // "a!" is both too short AND illegal; length is checked first.
    expect(isHandleValid('a!')).toEqual({ ok: false, reason: 'too_short' });
    // 21 illegal characters: too long wins over bad characters.
    expect(isHandleValid('!'.repeat(HANDLE_MAX + 1))).toEqual({ ok: false, reason: 'too_long' });
  });

  it('agrees with the min/max the server publishes', () => {
    expect(HANDLE_MIN).toBe(3);
    expect(HANDLE_MAX).toBe(20);
  });
});

describe('needsHandle', () => {
  it('is true only for a server-minted placeholder', () => {
    expect(needsHandle('user_ab12cd34ef')).toBe(true);
    expect(needsHandle('mahmood')).toBe(false);
  });
});

describe('suggestedHandle', () => {
  it('turns an ordinary TV Time name into a handle', () => {
    expect(suggestedHandle('Mahmood')).toBe('mahmood');
    expect(suggestedHandle('Mahmood Bashar')).toBe('mahmood_bashar');
    expect(suggestedHandle('  mahmood.bashar  ')).toBe('mahmood_bashar');
  });

  it('collapses and trims separators rather than leaving them', () => {
    expect(suggestedHandle('a...b')).toBe('a_b');
    expect(suggestedHandle('!!!hello!!!')).toBe('hello');
  });

  it('truncates to the maximum without leaving a trailing separator', () => {
    const long = suggestedHandle('abcdefghij klmnopqrst uvwxyz');
    expect(long).toBe('abcdefghij_klmnopqrs');
    expect(long!.length).toBe(HANDLE_MAX);
  });

  it('gives up rather than inventing a handle', () => {
    // A name with no ASCII to salvage: an empty field the user fills in is
    // honest, "user4821" is not.
    expect(suggestedHandle('محمود')).toBeNull();
    expect(suggestedHandle('日本語')).toBeNull();
    // too short once stripped
    expect(suggestedHandle('Jo')).toBeNull();
    expect(suggestedHandle(null)).toBeNull();
    expect(suggestedHandle(undefined)).toBeNull();
    expect(suggestedHandle('')).toBeNull();
  });

  it('never suggests something the validator would refuse', () => {
    const names = ['Admin', 'OpenTV', 'user_thing', 'A B', 'x'.repeat(40), 'support'];
    for (const n of names) {
      const s = suggestedHandle(n);
      if (s !== null) expect(isHandleValid(s).ok).toBe(true);
    }
    // the reserved words in that list must come back null, not "admin"
    expect(suggestedHandle('Admin')).toBeNull();
    expect(suggestedHandle('OpenTV')).toBeNull();
    expect(suggestedHandle('support')).toBeNull();
  });
});

describe('communityErrorKey', () => {
  it('maps every code the server can send', () => {
    expect(communityErrorKey('network')).toBe('community.error.network');
    expect(communityErrorKey('rate_limited')).toBe('community.error.rateLimited');
    expect(communityErrorKey('unauthenticated')).toBe('community.error.signInRejected');
    expect(communityErrorKey('forbidden')).toBe('community.error.signInRejected');
    expect(communityErrorKey('handle_taken')).toBe('community.error.handleTaken');
    expect(communityErrorKey('handle_invalid')).toBe('community.error.handleInvalid');
  });

  it('falls back rather than throwing on anything else', () => {
    // A failure path that can itself fail is not a failure path. Unknown codes
    // are exactly what a future server change produces.
    for (const code of ['internal', 'not_found', 'invalid_body', 'blocked', 'unknown', '', 'brand_new_code']) {
      expect(communityErrorKey(code)).toBe('community.error.generic');
    }
  });
});

describe('handleFailureKey', () => {
  it('has a distinct message for each way a handle can be wrong', () => {
    const keys = (['too_short', 'too_long', 'bad_characters', 'reserved'] as const).map(handleFailureKey);
    expect(keys).toEqual([
      'community.handle.errTooShort',
      'community.handle.errTooLong',
      'community.handle.errCharacters',
      'community.handle.errReserved',
    ]);
    expect(new Set(keys).size).toBe(4);
  });
});
