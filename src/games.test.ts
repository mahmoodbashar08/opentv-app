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
  BUCKET,
  COLS,
  MAX_MISSES,
  moveBucket,
  newCatch,
  newSnake,
  nextGame,
  placeFood,
  ROWS,
  stepCatch,
  stepSnake,
  turnSnake,
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

describe('catching popcorn', () => {
  it('keeps the bucket on the board', () => {
    let s = newCatch();
    for (let i = 0; i < 50; i++) s = moveBucket(s, -1);
    expect(s.bucket).toBe(Math.floor(BUCKET / 2));
    for (let i = 0; i < 50; i++) s = moveBucket(s, 1);
    expect(s.bucket).toBe(COLS - 1 - Math.floor(BUCKET / 2));
  });

  it('scores a piece that lands on the bucket', () => {
    const s = stepCatch({ ...newCatch(), bucket: 5, drops: [{ x: 5, y: ROWS - 2 }] }, 1, false);
    expect(s.score).toBe(1);
    expect(s.drops).toHaveLength(0);
  });

  it('catches with the bucket’s whole width, not just its centre', () => {
    const half = Math.floor(BUCKET / 2);
    const s = stepCatch({ ...newCatch(), bucket: 5, drops: [{ x: 5 + half, y: ROWS - 2 }] }, 1, false);
    expect(s.score).toBe(1);
  });

  it('counts a miss and ends after three', () => {
    let s = { ...newCatch(), bucket: 0 };
    for (let i = 0; i < MAX_MISSES; i++) {
      s = stepCatch({ ...s, drops: [{ x: COLS - 1, y: ROWS - 2 }] }, 1, false);
    }
    expect(s.missed).toBe(MAX_MISSES);
    expect(s.over).toBe(true);
  });

  it('removes a landed piece so it cannot be counted twice', () => {
    // A piece that lingered on the bucket's row would score every tick.
    const s = stepCatch({ ...newCatch(), bucket: 5, drops: [{ x: 5, y: ROWS - 2 }] }, 1, false);
    const again = stepCatch(s, 1, false);
    expect(again.score).toBe(1);
  });

  it('spawns inside the board', () => {
    for (let seed = 1; seed < 100; seed++) {
      const s = stepCatch(newCatch(), seed, true);
      expect(s.drops).toHaveLength(1);
      expect(s.drops[0].x).toBeGreaterThanOrEqual(0);
      expect(s.drops[0].x).toBeLessThan(COLS);
      expect(s.drops[0].y).toBe(0);
    }
  });

  it('is frozen once it is over', () => {
    const dead = { ...newCatch(), over: true };
    expect(stepCatch(dead, 1, true)).toBe(dead);
  });
});

describe('the shuffle button', () => {
  it('cycles and comes back round', () => {
    expect(nextGame('snake')).toBe('catch');
    expect(nextGame('catch')).toBe('snake');
  });
});
