/**
 * Two small games for the one screen in this app where somebody waits.
 *
 * WHERE THEY GO IS THE WHOLE IDEA. Startup repair can hold its overlay for
 * minutes on a large library, and the only thing on it is a number going up.
 * That is the Chrome dinosaur situation exactly — a wait nobody chose, on a
 * screen that otherwise just asks you to watch it. Not a settings easter egg: a
 * game nobody stumbles into is a game nobody plays, and becomes code maintained
 * for ever for the few who find it.
 *
 * ALL THE RULES ARE HERE, AND NOTHING ELSE IS. Everything below is a pure
 * function of state and a tick — no timers, no components, no drawing. That is
 * what lets the frame loop run on the UI thread while `migrations.ts` is
 * blocking the JS thread, which is the entire engineering problem: a game that
 * stutters exactly when it is meant to distract you is worse than the progress
 * bar it replaced.
 *
 * `'worklet'` on each of these lets Reanimated call them from the UI thread.
 * They must stay free of closures over JS-thread state for that to hold.
 */

/** The board, in cells. Small enough to draw as plain views. */
export const COLS = 14;
export const ROWS = 20;

export type Point = { x: number; y: number };
export type Dir = 'up' | 'down' | 'left' | 'right';

// ── the snake, which eats popcorn ────────────────────────────────────────────

export type SnakeState = {
  /** Head first. */
  body: Point[];
  dir: Dir;
  food: Point;
  score: number;
  over: boolean;
};

/*
 * ORDER MATTERS IN THIS FILE, and not for style.
 *
 * Reanimated's babel plugin captures a worklet's closure AT DEFINITION TIME, so
 * a worklet that calls one declared later in the module captures `undefined`
 * and dies with "undefined is not a function" on the first frame. Normal
 * function hoisting does not save it. `placeFood` therefore sits above every
 * worklet that uses it.
 *
 * Jest does not run that transform, so this is invisible to the tests — it
 * shipped green and crashed on the device.
 */
/**
 * Somewhere the snake is not.
 *
 * Deterministic from a seed rather than `Math.random`, because this has to run
 * on the UI thread where the JS random is not available — and because a
 * reproducible board is testable at all.
 */
export function placeFood(body: readonly Point[], seed: number): Point {
  'worklet';
  let s = seed;
  for (let i = 0; i < 40; i++) {
    // A small LCG. Any decent one would do; this one fits in a worklet.
    s = (s * 1103515245 + 12345) % 2147483648;
    const x = Math.abs(s) % COLS;
    s = (s * 1103515245 + 12345) % 2147483648;
    const y = Math.abs(s) % ROWS;
    let clear = true;
    for (const p of body) if (p.x === x && p.y === y) clear = false;
    if (clear) return { x, y };
  }
  // A board so full there is nowhere to put it. Vanishingly unlikely at this
  // size, and a corner is a better answer than a loop that never ends.
  return { x: 0, y: 0 };
}

export function newSnake(seed: number): SnakeState {
  'worklet';
  return {
    body: [
      { x: 4, y: 10 },
      { x: 3, y: 10 },
      { x: 2, y: 10 },
    ],
    dir: 'right',
    food: placeFood([{ x: 4, y: 10 }], seed),
    score: 0,
    over: false,
  };
}

/** A reversal would run the head straight into the neck. Ignored, not fatal. */
export function turnSnake(s: SnakeState, dir: Dir): SnakeState {
  'worklet';
  const opposite =
    (s.dir === 'up' && dir === 'down') ||
    (s.dir === 'down' && dir === 'up') ||
    (s.dir === 'left' && dir === 'right') ||
    (s.dir === 'right' && dir === 'left');
  if (opposite) return s;
  return { ...s, dir };
}

export function stepSnake(s: SnakeState, seed: number): SnakeState {
  'worklet';
  if (s.over) return s;
  const head = s.body[0];
  const next: Point = {
    x: head.x + (s.dir === 'left' ? -1 : s.dir === 'right' ? 1 : 0),
    y: head.y + (s.dir === 'up' ? -1 : s.dir === 'down' ? 1 : 0),
  };

  // THE WALLS WRAP. A game that ends because you looked away for a second is a
  // punishment on a screen somebody is already waiting on.
  if (next.x < 0) next.x = COLS - 1;
  if (next.x >= COLS) next.x = 0;
  if (next.y < 0) next.y = ROWS - 1;
  if (next.y >= ROWS) next.y = 0;

  /*
   * THE LAST CELL IS NOT A CRASH. It moves out of the way on this same tick,
   * so counting it makes a snake that has just turned kill itself for no reason
   * a player can see. Everything ahead of it is checked.
   */
  for (let i = 0; i < s.body.length - 1; i++) {
    if (s.body[i].x === next.x && s.body[i].y === next.y) return { ...s, over: true };
  }

  const ate = next.x === s.food.x && next.y === s.food.y;
  const body = [next, ...s.body];
  if (!ate) body.pop();
  return {
    body,
    dir: s.dir,
    food: ate ? placeFood(body, seed) : s.food,
    score: ate ? s.score + 1 : s.score,
    over: false,
  };
}

// ── catching popcorn in a bucket ─────────────────────────────────────────────

export type CatchState = {
  /** Bucket centre, in cells. */
  bucket: number;
  /** Falling pieces. */
  drops: Point[];
  score: number;
  missed: number;
  over: boolean;
};

/** Three misses. Enough to be a game, few enough to end while you still care. */
export const MAX_MISSES = 3;
/** How wide the bucket is, in cells. */
export const BUCKET = 3;

export function newCatch(): CatchState {
  'worklet';
  return { bucket: Math.floor(COLS / 2), drops: [], score: 0, missed: 0, over: false };
}

export function moveBucket(s: CatchState, by: number): CatchState {
  'worklet';
  const half = Math.floor(BUCKET / 2);
  const bucket = Math.max(half, Math.min(COLS - 1 - half, s.bucket + by));
  return bucket === s.bucket ? s : { ...s, bucket };
}

export function stepCatch(s: CatchState, seed: number, spawn: boolean): CatchState {
  'worklet';
  if (s.over) return s;
  const half = Math.floor(BUCKET / 2);
  const drops: Point[] = [];
  let score = s.score;
  let missed = s.missed;

  for (const d of s.drops) {
    const y = d.y + 1;
    if (y < ROWS - 1) {
      drops.push({ x: d.x, y });
      continue;
    }
    // It reached the bucket's row. Caught or missed, it leaves the board either
    // way — a piece that lingers would be counted twice on the next tick.
    if (Math.abs(d.x - s.bucket) <= half) score++;
    else missed++;
  }

  if (spawn) {
    let n = seed;
    n = (n * 1103515245 + 12345) % 2147483648;
    drops.push({ x: Math.abs(n) % COLS, y: 0 });
  }

  return { bucket: s.bucket, drops, score, missed, over: missed >= MAX_MISSES };
}

// ── which game is on ─────────────────────────────────────────────────────────

/**
 * The shuffle button cycles rather than opening a menu.
 *
 * Two games do not justify a picker, and a picker on a waiting screen is one
 * more thing to read. One control, one outcome, and it is discoverable by
 * pressing it.
 */
export const GAMES = ['snake', 'catch'] as const;
export type Game = (typeof GAMES)[number];

export function nextGame(g: Game): Game {
  'worklet';
  const i = GAMES.indexOf(g);
  return GAMES[(i + 1) % GAMES.length];
}
