/**
 * The rules of both waiting-screen games.
 *
 * Worth testing despite being a toy, for one reason: this code runs on the UI
 * THREAD, called from a Reanimated frame callback while `migrations.ts` blocks
 * the JS thread. A crash there is not a caught exception in a screen, it is the
 * animation loop of an app that is mid-repair — so every branch gets exercised
 * here, on the JS side, where a failure is a red test instead of a frozen phone.
 */
import {
  BUCKET_W,
  COLS,
  KERNEL,
  newPopcorn,
  newSnake,
  nextGame,
  placeFood,
  ROWS,
  slideBucket,
  stepPopcorn,
  stepSnake,
  turnSnake,
  type PopcornState,
  type SnakeState,
} from '@/games';

const snake = (over: Partial<SnakeState> = {}): SnakeState => ({
  ...newSnake(1),
  food: { x: 99, y: 99 }, // off-board unless a test puts it somewhere
  ...over,
});

describe('the snake', () => {
  it('moves head-first in its direction', () => {
    const s = stepSnake(snake(), 1);
    expect(s.body[0]).toEqual({ x: 5, y: 10 });
    expect(s.body).toHaveLength(3);
  });

  it('WRAPS at the walls rather than dying', () => {
    // A game that ends because you looked away for a second is a punishment on
    // a screen somebody is already waiting on.
    let s = snake({ body: [{ x: COLS - 1, y: 5 }], dir: 'right' });
    s = stepSnake(s, 1);
    expect(s.body[0]).toEqual({ x: 0, y: 5 });
    expect(s.over).toBe(false);

    let up = snake({ body: [{ x: 3, y: 0 }], dir: 'up' });
    up = stepSnake(up, 1);
    expect(up.body[0]).toEqual({ x: 3, y: ROWS - 1 });
  });

  it('grows and scores on food, and moves the food', () => {
    const s = stepSnake(snake({ food: { x: 5, y: 10 } }), 7);
    expect(s.score).toBe(1);
    expect(s.body).toHaveLength(4);
    expect(s.food).not.toEqual({ x: 5, y: 10 });
  });

  it('dies on its own body', () => {
    const s = stepSnake(
      snake({
        body: [
          { x: 5, y: 10 },
          { x: 5, y: 11 },
          { x: 4, y: 11 },
          { x: 4, y: 10 },
          { x: 3, y: 10 },
        ],
        dir: 'left',
      }),
      1,
    );
    expect(s.over).toBe(true);
  });

  it('does NOT die on the cell its tail is leaving', () => {
    /*
     * The last cell is vacated on the same tick. Counting it kills a snake that
     * has merely turned, for no reason a player can see — the classic version
     * of this bug.
     */
    const s = stepSnake(
      snake({
        body: [
          { x: 5, y: 10 },
          { x: 5, y: 11 },
          { x: 6, y: 11 },
          { x: 6, y: 10 },
        ],
        dir: 'right',
      }),
      1,
    );
    expect(s.over).toBe(false);
  });

  it('refuses a reversal instead of ending the game on it', () => {
    // A thumb-slip on a waiting screen should cost nothing.
    const s = turnSnake(snake({ dir: 'right' }), 'left');
    expect(s.dir).toBe('right');
    expect(turnSnake(snake({ dir: 'right' }), 'up').dir).toBe('up');
  });

  it('is frozen once it is over', () => {
    const dead = snake({ over: true });
    expect(stepSnake(dead, 1)).toBe(dead);
  });

  it('never puts food under the snake', () => {
    const body = Array.from({ length: 30 }, (_, i) => ({ x: i % COLS, y: Math.floor(i / COLS) }));
    for (let seed = 1; seed < 60; seed++) {
      const f = placeFood(body, seed);
      expect(body.some((p) => p.x === f.x && p.y === f.y)).toBe(false);
    }
  });

  it('places food on the board, always', () => {
    for (let seed = 1; seed < 200; seed++) {
      const f = placeFood([], seed);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThan(COLS);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThan(ROWS);
    }
  });
});

describe('the popcorn catcher', () => {
  const W = 300;
  const H = 240;

  it('keeps the bucket on the board and centres it on the finger', () => {
    expect(slideBucket(newPopcorn(W), -50, W).bucketX).toBe(0);
    expect(slideBucket(newPopcorn(W), 9999, W).bucketX).toBe(W - BUCKET_W);
    expect(slideBucket(newPopcorn(W), 150, W).bucketX).toBe(150 - BUCKET_W / 2);
  });

  it('scores a kernel that lands on the bucket', () => {
    const s: PopcornState = { ...newPopcorn(W), bucketX: 100, kernels: [{ x: 110, y: H - 45, speed: 8, clock: false }] };
    const next = stepPopcorn(s, 50, W, H, 1);
    expect(next.score).toBe(1);
    expect(next.kernels.some((k) => k.y > H - 46 && !k.clock)).toBe(false);
  });

  it('a clock buys five seconds and does not score', () => {
    const s: PopcornState = { ...newPopcorn(W), bucketX: 100, kernels: [{ x: 110, y: H - 45, speed: 8, clock: true }] };
    const before = s.msLeft;
    const next = stepPopcorn(s, 50, W, H, 1);
    expect(next.score).toBe(0);
    expect(next.msLeft).toBeGreaterThan(before);
  });

  it('drops a kernel that misses, without scoring it', () => {
    const s: PopcornState = { ...newPopcorn(W), bucketX: 0, kernels: [{ x: W - 30, y: H - 12, speed: 8, clock: false }] };
    const next = stepPopcorn(s, 50, W, H, 1);
    expect(next.score).toBe(0);
    expect(next.kernels.filter((k) => k.x === W - 30)).toHaveLength(0);
  });

  it('ends when the round runs out, and clears the board', () => {
    const s: PopcornState = { ...newPopcorn(W), msLeft: 20, kernels: [{ x: 10, y: 10, speed: 4, clock: false }] };
    const next = stepPopcorn(s, 50, W, H, 1);
    expect(next.over).toBe(true);
    expect(next.kernels).toHaveLength(0);
  });

  it('is frozen once it is over', () => {
    const dead: PopcornState = { ...newPopcorn(W), over: true };
    expect(stepPopcorn(dead, 50, W, H, 1)).toBe(dead);
  });

  it('falls at the same rate whatever the frame rate', () => {
    /*
     * The shipped game moved a kernel by `speed` every 50ms tick. This one runs
     * off the frame callback, so the step is scaled by dt — without that, the
     * round plays three times faster on a 120Hz phone than on a 60Hz one, and
     * everybody's best score would depend on their hardware.
     */
    const one = { ...newPopcorn(W), kernels: [{ x: 10, y: 0, speed: 4, clock: false }] };
    const slow = stepPopcorn(one, 50, W, H, 1).kernels[0];
    let fast = one;
    for (let i = 0; i < 5; i++) fast = stepPopcorn(fast, 10, W, H, 1);
    expect(fast.kernels[0].y).toBeCloseTo(slow.y, 5);
  });

  it('spawns inside the arena', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = stepPopcorn({ ...newPopcorn(W), spawnIn: 0 }, 50, W, H, seed);
      const born = s.kernels.find((k) => k.y < 0);
      expect(born).toBeDefined();
      expect(born!.x).toBeGreaterThanOrEqual(0);
      expect(born!.x).toBeLessThanOrEqual(W - KERNEL);
    }
  });
});

describe('the shuffle button', () => {
  it('cycles and comes back round', () => {
    expect(nextGame('popcorn')).toBe('snake');
    expect(nextGame('snake')).toBe('popcorn');
  });
});
