/**
 * SEASONAL EVENTS (8 Oct) — avatar decorations and a profile theme template
 * for Halloween and Christmas.
 *
 * SWITCHED ON THE DASHBOARD, never by date: `/v1/links` carries `event`, which
 * the app stores here. While an event is on, everybody can use its decorations
 * and its theme; when it is switched off they are gone for free users and
 * stay for Plus, who can pick any season's look at any time.
 *
 * Only members' phones read `/v1/links` (somebody who declined the community
 * never contacts the server), so a free user without an account never sees an
 * event. Plus without an account still has everything, by the Plus rule.
 *
 * Only YOUR profile is decorated — the choice is not published, so nobody
 * else's avatar wears your pumpkin.
 */
import { getMeta, setMeta } from '@/db';

export type SeasonId = 'halloween' | 'christmas';

/** A ready-made look: every part chosen together. The first is the event's own,
 *  the one a free user gets. */
export type Preset = {
  id: string;
  deco: string;
  companions: readonly string[];
  ring: string;
  glow: boolean;
  effect: string;
};

export type Season = {
  id: SeasonId;
  /** What sits on top of the avatar. */
  decorations: readonly string[];
  /** The two small ones at its foot — up to two of these. */
  companions: readonly string[];
  /** The avatar frame's colour; the banner's tint is taken from it. */
  rings: readonly string[];
  /** What drifts across the banner for a few seconds when the page opens. */
  effects: readonly string[];
  presets: readonly Preset[];
};

export const SEASONS: readonly Season[] = [
  {
    id: 'halloween',
    decorations: ['🎃', '🦇', '👻', '🕸️', '🍬', '🧹', '💀', '🕷️', '🌙'],
    companions: ['🦇', '👻', '🕷️', '🍬', '💀', '🐈‍⬛', '🕯️', '🌙'],
    rings: ['#FF7A1A', '#8B5CF6', '#22C55E', '#E7E5E4'],
    effects: ['🦇', '👻', '🍂', '🕷️'],
    presets: [
      { id: 'pumpkin', deco: '🎃', companions: ['🦇', '👻'], ring: '#FF7A1A', glow: true, effect: '🦇' },
      { id: 'haunted', deco: '👻', companions: ['💀', '🕯️'], ring: '#E7E5E4', glow: true, effect: '👻' },
      { id: 'witch', deco: '🧹', companions: ['🐈‍⬛', '🌙'], ring: '#8B5CF6', glow: true, effect: '🦇' },
      { id: 'spider', deco: '🕸️', companions: ['🕷️', '🍬'], ring: '#22C55E', glow: false, effect: '🕷️' },
    ],
  },
  {
    id: 'christmas',
    decorations: ['🎄', '🎅', '⛄', '🎁', '❄️', '⭐', '🦌', '🔔', '🧣'],
    companions: ['🎁', '⛄', '🦌', '🔔', '🍪', '❄️', '🕯️', '⭐'],
    rings: ['#E11D48', '#16A34A', '#EAB308', '#7DD3FC'],
    effects: ['❄️', '✨', '⭐', '🎁'],
    presets: [
      { id: 'classic', deco: '🎅', companions: ['🎁', '⛄'], ring: '#E11D48', glow: false, effect: '❄️' },
      { id: 'frost', deco: '❄️', companions: ['⛄', '⭐'], ring: '#7DD3FC', glow: true, effect: '❄️' },
      { id: 'cozy', deco: '🎄', companions: ['🍪', '🕯️'], ring: '#EAB308', glow: true, effect: '✨' },
      { id: 'reindeer', deco: '🦌', companions: ['🔔', '🎁'], ring: '#16A34A', glow: false, effect: '⭐' },
    ],
  },
];

/** Everything the profile draws for the season, resolved. */
export type SeasonLook = { ring: string; glow: boolean; tint: string; effect: string; companions: readonly string[] };

const EVENT = 'seasonEvent';
const DECO = 'seasonDecoration';
const THEME = 'seasonTheme';
const OFF = 'seasonalOff';
const PARTS = 'seasonParts';

/** From `/v1/links`. Anything unknown is treated as no event. */
export function storeEvent(event: unknown): void {
  setMeta(EVENT, SEASONS.some((s) => s.id === event) ? (event as string) : '');
}

export function activeEvent(): Season | null {
  return SEASONS.find((s) => s.id === getMeta(EVENT)) ?? null;
}

/** The seasons this person may use now: the running one, or every one for Plus. */
export function availableSeasons(plus: boolean): Season[] {
  if (plus) return [...SEASONS];
  const a = activeEvent();
  return a ? [a] : [];
}

export const seasonalOn = (): boolean => getMeta(OFF) !== '1';
export const setSeasonalOn = (on: boolean): void => setMeta(OFF, on ? '' : '1');

/** '' means "none" was chosen on purpose; null means never chosen. */
export function chosenDecoration(): string | null {
  return getMeta(DECO);
}
export const setDecoration = (emoji: string): void => setMeta(DECO, emoji);
export const chosenTheme = (): SeasonId | null => (getMeta(THEME) as SeasonId) || null;
export const setTheme = (id: SeasonId | null): void => setMeta(THEME, id ?? '');

/**
 * FREE KEEPS OR REMOVES, PLUS CHOOSES (8 Oct). A free user gets the event's
 * own decoration and can take it off; picking a different one is Plus.
 */
export function decorationsFor(season: Season, plus: boolean): readonly string[] {
  return plus ? season.decorations : [season.presets[0]!.deco];
}

/**
 * What sits on the avatar: the chosen decoration while its season is
 * available, else the running event's first one for somebody who never chose.
 */
export function currentDecoration(plus: boolean): string | null {
  if (!seasonalOn()) return null;
  const seasons = availableSeasons(plus);
  const chosen = chosenDecoration();
  if (chosen === '') return null;
  if (chosen && seasons.some((s) => decorationsFor(s, plus).includes(chosen))) return chosen;
  return activeEvent()?.presets[0]?.deco ?? null;
}

/** The theme template in force, if it was chosen and is still available. */
export function currentTheme(plus: boolean): Season | null {
  if (!seasonalOn()) return null;
  const id = chosenTheme();
  return availableSeasons(plus).find((s) => s.id === id) ?? null;
}

type Parts = { companions?: string[]; ring?: string; glow?: boolean; effect?: string };

function parts(): Parts {
  try {
    return JSON.parse(getMeta(PARTS) ?? '{}') as Parts;
  } catch {
    return {};
  }
}

/** Plus changes one part at a time; the rest keep what they were. */
export function setPart(p: Parts): void {
  setMeta(PARTS, JSON.stringify({ ...parts(), ...p }));
}

/** A whole look at once — the decoration, every part, and the season's theme on. */
export function applyPreset(season: Season, preset: Preset): void {
  setDecoration(preset.deco);
  setMeta(PARTS, JSON.stringify({ companions: [...preset.companions], ring: preset.ring, glow: preset.glow, effect: preset.effect }));
  setTheme(season.id);
}

/**
 * The look in force. A free user gets the season's own look and nothing else
 * — keep it or take it off; changing a part is Plus. A part chosen for another
 * season falls back to this season's default rather than mixing the two.
 */
export function currentLook(plus: boolean): SeasonLook | null {
  const s = currentTheme(plus);
  return s ? lookFor(s, plus) : null;
}

/**
 * What `season` looks like with this person's choices — also the picker's
 * preview. `_rev` is for a render-time caller: the React Compiler memoises a
 * call against its arguments, so a changing one is what makes it read again.
 */
export function lookFor(s: Season, plus: boolean, _rev?: number): SeasonLook {
  const def = s.presets[0]!;
  const p = plus ? parts() : {};
  const ring = p.ring && s.rings.includes(p.ring) ? p.ring : def.ring;
  const companions = p.companions?.every((c) => s.companions.includes(c)) ? p.companions.slice(0, 2) : def.companions;
  return {
    ring,
    glow: p.glow ?? def.glow,
    tint: ring + '73',
    effect: p.effect && s.effects.includes(p.effect) ? p.effect : def.effect,
    companions,
  };
}

/** The raw choices, for the picker to mark what is selected. */
export const chosenParts = parts;
