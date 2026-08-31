/**
 * The interests poll has to remember.
 *
 * REPORTED FROM THE OUTSIDE: "when you are choosing 'what you have been
 * invested in' it does not save anything you choose". It didn't — the poll
 * wrote React state and nothing else, so an answer lasted exactly as long as
 * the screen. Nothing looked broken, which is why it went unnoticed: a tap that
 * means nothing looks the same as a tap that means something.
 *
 * `db.ts` is a two-line wrapper over these, so pinning them pins the feature.
 */
import { interestKey, parseInterest } from './pure';

describe('interestKey', () => {
  it('keeps films and shows apart even on the same id', () => {
    // A film called "42" must not read back show 42's answer.
    expect(interestKey('movie', '42')).not.toBe(interestKey('show', 42));
  });

  it('keeps two shows apart', () => {
    expect(interestKey('show', 111)).not.toBe(interestKey('show', 222));
  });

  it('is stable, because a changed key is a silently forgotten answer', () => {
    expect(interestKey('show', 121361)).toBe('interest:show:121361');
    expect(interestKey('movie', 'Dune')).toBe('interest:movie:Dune');
  });
});

describe('parseInterest', () => {
  it('gives back the option that was chosen', () => {
    expect(parseInterest('2')).toBe(2);
  });

  it('reads index 0 as the first option, not as "nothing"', () => {
    // THE TRAP: a cleared answer is stored as '', and Number('') is 0 — which
    // is a real option. Emptiness has to be rejected before anything is parsed.
    expect(parseInterest('0')).toBe(0);
  });

  it('reads a cleared answer as no answer', () => {
    expect(parseInterest('')).toBeNull();
    expect(parseInterest(null)).toBeNull();
  });

  it('refuses anything that is not a whole option index', () => {
    // A meta table survives export, backup and restore, so it can come back
    // holding something no version of this app ever wrote.
    expect(parseInterest('two')).toBeNull();
    expect(parseInterest('1.5')).toBeNull();
    expect(parseInterest('-1')).toBeNull();
  });
});
