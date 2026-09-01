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

/**
 * THE BOARD IS SIZED BY THE SCREEN, not fixed here.
 *
 * A constant 14×20 grid has an aspect ratio and the arena it is drawn in does
 * not match it: square cells left the board floating in a wider box, and
 * stretching them to fill made wide flat bars. Both are wrong, and the fix is
 * not a compromise between them — it is to stop pretending the grid is a
 * property of the game. Every function below takes the board it is playing on,
 * so the caller picks a cell size and asks for as many rows and columns as fit.
 *
 * These stay as the smallest sensible board, and as what the tests play on.
 */
export const COLS = 14;
export const ROWS = 20;

/** How big a cell should be drawn, in points. Thumb-sized, not pixel art. */
export const CELL = 22;

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
export function placeFood(body: readonly Point[], seed: number, cols = COLS, rows = ROWS): Point {
  'worklet';
  let s = seed;
  for (let i = 0; i < 40; i++) {
    // A small LCG. Any decent one would do; this one fits in a worklet.
    s = (s * 1103515245 + 12345) % 2147483648;
    const x = Math.abs(s) % cols;
    s = (s * 1103515245 + 12345) % 2147483648;
    const y = Math.abs(s) % rows;
    let clear = true;
    for (const p of body) if (p.x === x && p.y === y) clear = false;
    if (clear) return { x, y };
  }
  // A board so full there is nowhere to put it. Vanishingly unlikely at this
  // size, and a corner is a better answer than a loop that never ends.
  return { x: 0, y: 0 };
}

export function newSnake(seed: number, cols = COLS, rows = ROWS): SnakeState {
  'worklet';
  // Three cells in from the left, halfway down, whatever the board size.
  const y = Math.floor(rows / 2);
  const body = [
    { x: 4, y },
    { x: 3, y },
    { x: 2, y },
  ];
  return { body, dir: 'right', food: placeFood(body, seed, cols, rows), score: 0, over: false };
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

export function stepSnake(s: SnakeState, seed: number, cols = COLS, rows = ROWS): SnakeState {
  'worklet';
  if (s.over) return s;
  const head = s.body[0];
  const next: Point = {
    x: head.x + (s.dir === 'left' ? -1 : s.dir === 'right' ? 1 : 0),
    y: head.y + (s.dir === 'up' ? -1 : s.dir === 'down' ? 1 : 0),
  };

  // THE WALLS WRAP. A game that ends because you looked away for a second is a
  // punishment on a screen somebody is already waiting on.
  if (next.x < 0) next.x = cols - 1;
  if (next.x >= cols) next.x = 0;
  if (next.y < 0) next.y = rows - 1;
  if (next.y >= rows) next.y = 0;

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
    food: ate ? placeFood(body, seed, cols, rows) : s.food,
    score: ate ? s.score + 1 : s.score,
    over: false,
  };
}

// ── the popcorn catcher ──────────────────────────────────────────────────────

/**
 * THE RULES OF THE GAME THAT ALREADY SHIPPED, moved here unchanged.
 *
 * `components/popcorn-game.tsx` has had these since 1.1.7, written against
 * `setInterval` and a React state update per tick. That is precisely why it
 * could never go on the repair screen — the changelog recorded the feature as
 * "blocked on the setInterval-on-JS-thread problem", because the thread it
 * needs is the one `migrations.ts` is holding.
 *
 * So the numbers below are the shipped ones, deliberately: the same 45-second
 * round, the same bucket width, the same speed-up per point, the same one-in-
 * nine clock. Only where they run has changed. A game people have a best score
 * in must not quietly become a different game.
 *
 * Pixels, not cells, because that is what it always was — the arena is however
 * wide the screen gives it.
 */
export type Kernel = { x: number; y: number; speed: number; clock: boolean };

export type PopcornState = {
  kernels: Kernel[];
  /** Left edge of the bucket, in points. */
  bucketX: number;
  score: number;
  msLeft: number;
  /** Counts down to the next kernel. */
  spawnIn: number;
  /** Set when a clock is caught, so the view can flash "+5s". */
  bonusAt: number;
  over: boolean;
};

export const ROUND_MS = 45_000;
export const BUCKET_W = 56;
export const KERNEL = 26;

export function newPopcorn(width: number): PopcornState {
  'worklet';
  return {
    kernels: [],
    bucketX: Math.max(0, (width - BUCKET_W) / 2),
    score: 0,
    msLeft: ROUND_MS,
    spawnIn: 0,
    bonusAt: 0,
    over: false,
  };
}

export function slideBucket(s: PopcornState, x: number, width: number): PopcornState {
  'worklet';
  // Centred on the finger, and a tap jumps to it — the shipped behaviour.
  const bucketX = Math.max(0, Math.min(x - BUCKET_W / 2, width - BUCKET_W));
  return bucketX === s.bucketX ? s : { ...s, bucketX };
}

export function stepPopcorn(
  s: PopcornState,
  dt: number,
  width: number,
  height: number,
  seed: number,
): PopcornState {
  'worklet';
  if (s.over) return s;
  const msLeft = s.msLeft - dt;
  if (msLeft <= 0) return { ...s, kernels: [], msLeft: 0, over: true };

  let rnd = seed;
  const next = () => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return Math.abs(rnd) / 2147483648;
  };

  const catchY = height - 44;
  const kernels: Kernel[] = [];
  let score = s.score;
  let bonus = 0;

  for (const k of s.kernels) {
    // Speed is per 50ms tick in the shipped game; scaled by dt so the round
    // plays the same however often the frame callback runs.
    const y = k.y + k.speed * (dt / 50);
    const caught = y >= catchY && k.x + KERNEL / 2 >= s.bucketX && k.x + KERNEL / 2 <= s.bucketX + BUCKET_W;
    if (caught) {
      if (k.clock) bonus += 5000;
      else score += 1;
      continue;
    }
    if (y < height - 10) kernels.push({ x: k.x, y, speed: k.speed, clock: k.clock });
  }

  let spawnIn = s.spawnIn - dt;
  if (spawnIn <= 0) {
    // Gets a touch quicker as you score — never unfair, it is a snack.
    const speedup = Math.min(score * 0.06, 4);
    const clockOk = ROUND_MS - msLeft > 5000 && next() < 0.11;
    kernels.push({
      x: next() * Math.max(width - KERNEL, 1),
      y: -KERNEL,
      speed: 4 + speedup + next() * 2,
      clock: clockOk,
    });
    spawnIn = Math.max(900 - score * 12, 380);
  }

  return {
    kernels,
    bucketX: s.bucketX,
    score,
    msLeft: msLeft + bonus,
    spawnIn,
    bonusAt: bonus > 0 ? s.bonusAt + 1 : s.bonusAt,
    over: false,
  };
}

// ── which game is on ─────────────────────────────────────────────────────────

/**
 * The shuffle button cycles rather than opening a menu.
 *
 * Two games do not justify a picker, and a picker on a waiting screen is one
 * more thing to read. One control, one outcome, and it is discoverable by
 * pressing it.
 */
export const GAMES = ['snake', 'popcorn'] as const;
export type Game = (typeof GAMES)[number];

export function nextGame(g: Game): Game {
  'worklet';
  const i = GAMES.indexOf(g);
  return GAMES[(i + 1) % GAMES.length];
}
