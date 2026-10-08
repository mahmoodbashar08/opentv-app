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

export type Season = {
  id: SeasonId;
  decorations: readonly string[];
  /** The avatar frame's colour, the tint at the foot of the banner, and what
   *  drifts across it for a few seconds when the profile opens. The banner
   *  itself is never replaced — a full-page colour was too much (8 Oct). */
  ring: string;
  tint: string;
  effect: string;
};

export const SEASONS: readonly Season[] = [
  { id: 'halloween', decorations: ['🎃', '🦇', '👻', '🕸️', '🍬', '🧹'], ring: '#FF7A1A', tint: 'rgba(255,122,26,0.45)', effect: '🦇' },
  { id: 'christmas', decorations: ['🎄', '🎅', '⛄', '🎁', '❄️', '⭐'], ring: '#E11D48', tint: 'rgba(225,29,72,0.35)', effect: '❄️' },
];

const EVENT = 'seasonEvent';
const DECO = 'seasonDecoration';
const THEME = 'seasonTheme';
const OFF = 'seasonalOff';

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
 * What sits on the avatar: the chosen decoration while its season is
 * available, else the running event's first one for somebody who never chose.
 */
export function currentDecoration(plus: boolean): string | null {
  if (!seasonalOn()) return null;
  const seasons = availableSeasons(plus);
  const chosen = chosenDecoration();
  if (chosen === '') return null;
  if (chosen && seasons.some((s) => s.decorations.includes(chosen))) return chosen;
  return activeEvent()?.decorations[0] ?? null;
}

/** The theme template in force, if it was chosen and is still available. */
export function currentTheme(plus: boolean): Season | null {
  if (!seasonalOn()) return null;
  const id = chosenTheme();
  return availableSeasons(plus).find((s) => s.id === id) ?? null;
}
