import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  NetworkDown,
  isNetworkError,
  netGuard,
  netIsOpen,
  netReachable,
  netReset,
  netUnreachable,
} from '@/net-circuit';

const THRESHOLD = 10;

describe('net-circuit', () => {
  beforeEach(() => {
    netReset();
    jest.useRealTimers();
  });

  it('stays closed while requests are getting through', () => {
    for (let i = 0; i < 100; i++) {
      netReachable();
      expect(netIsOpen()).toBe(false);
    }
  });

  it('tolerates failures that are interrupted by a success', () => {
    // A flaky socket is not a dead network. Only a CONSECUTIVE run counts, or
    // one bad request in every ten would eventually trip the breaker on a
    // perfectly healthy connection.
    for (let i = 0; i < 50; i++) {
      for (let f = 0; f < THRESHOLD - 1; f++) netUnreachable();
      netReachable();
    }
    expect(netIsOpen()).toBe(false);
  });

  it('opens after a full wave of failures, and then costs nothing', () => {
    for (let i = 0; i < THRESHOLD; i++) netUnreachable();
    expect(netIsOpen()).toBe(true);
    expect(() => netGuard()).toThrow(NetworkDown);
  });

  it('is the whole point: the 490 requests after the first 10 do not wait', () => {
    // The bug this exists for. `pool` catches every failure and keeps going,
    // so 500 shows on a dead network cost 500 / 10 x 15s. Once the breaker is
    // open the remaining calls are refused without a socket, which is what
    // turns twelve minutes into fifteen seconds.
    let attempted = 0;
    const call = () => {
      try {
        netGuard();
      } catch {
        return;
      }
      attempted++;
      netUnreachable();
    };
    for (let i = 0; i < 500; i++) call();
    expect(attempted).toBe(THRESHOLD);
  });

  it('lets exactly one request through after the cooldown, not all of them', () => {
    for (let i = 0; i < THRESHOLD; i++) netUnreachable();
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 31_000;
      // half-open: the first caller probes...
      expect(netIsOpen()).toBe(false);
      // ...and everybody else still waits, or the import walks straight back
      // into a full wave of fifteen-second timeouts.
      expect(netIsOpen()).toBe(true);
      expect(netIsOpen()).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('closes when the probe succeeds', () => {
    for (let i = 0; i < THRESHOLD; i++) netUnreachable();
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 31_000;
      expect(netIsOpen()).toBe(false); // probe allowed
      netReachable(); // the network came back
    } finally {
      Date.now = realNow;
    }
    expect(netIsOpen()).toBe(false);
  });

  it('restarts the cooldown when the probe fails', () => {
    for (let i = 0; i < THRESHOLD; i++) netUnreachable();
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 31_000;
      expect(netIsOpen()).toBe(false); // probe allowed
      netUnreachable(); // still dead
      expect(netIsOpen()).toBe(true); // shut again, not perpetually half-open
    } finally {
      Date.now = realNow;
    }
  });

  describe('isNetworkError', () => {
    it('counts an aborted request — that is the 15s timeout firing', () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      expect(isNetworkError(err)).toBe(true);
    });

    it("counts React Native's bare network failure", () => {
      expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    });

    it('does NOT count an HTTP status', () => {
      // THE SUBTLETY THE WHOLE THING TURNS ON. A 404 means the server is
      // reachable and the show is not there. Counting it would let a library
      // of obscure titles convince the app it is offline and stop fetching
      // anything at all.
      expect(isNetworkError(new Error('TMDB 404'))).toBe(false);
      expect(isNetworkError(new Error('TMDB 500'))).toBe(false);
    });

    it('counts a refusal from the breaker itself', () => {
      expect(isNetworkError(new NetworkDown())).toBe(true);
    });
  });
});
