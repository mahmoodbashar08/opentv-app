/**
 * Reconnection stopped for good after one stamp — 29 Sep 2026.
 *
 * 45 of 59 importers had never told the server their TV Time id, so none of
 * their friends could find them. The stamp that says "already reconciled"
 * described the friend list and not the account, so it went on matching after
 * a sign-in as somebody else, and old stamps from builds that marked no-ops
 * done matched for ever.
 */
import { friendsFingerprint } from './pure';

describe('friendsFingerprint', () => {
  const ids = [11, 22, 33];

  it('is stable for the same account and list', () => {
    expect(friendsFingerprint('p_a', 7, ids)).toBe(friendsFingerprint('p_a', 7, ids));
  });

  it('changes when the account changes, even with the same list', () => {
    expect(friendsFingerprint('p_a', 7, ids)).not.toBe(friendsFingerprint('p_b', 7, ids));
  });

  it('changes when the list or the own id changes', () => {
    expect(friendsFingerprint('p_a', 7, ids)).not.toBe(friendsFingerprint('p_a', 7, [11, 22]));
    expect(friendsFingerprint('p_a', 7, ids)).not.toBe(friendsFingerprint('p_a', 8, ids));
  });

  it('never equals a stamp written by the old, account-less format', () => {
    // old: `${own}:${n}:${hash}` — no '|' — so every member reconciles once more
    expect(friendsFingerprint('p_a', 7, ids)).toContain('|');
  });
});
