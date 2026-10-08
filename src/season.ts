/**
 * Seasonal avatar decorations (8 Oct): a pumpkin for Halloween, a tree for
 * Christmas, on every profile avatar this phone draws — the date decides,
 * a switch in Settings turns it off. Never covers the face: it sits on the
 * avatar's edge, outside the clipped circle.
 */
import { getMeta, setMeta } from '@/db';
import { seasonalDecoration } from '@/pure';

const OFF = 'seasonalOff';

export const seasonalOn = (): boolean => getMeta(OFF) !== '1';
export const setSeasonalOn = (on: boolean): void => setMeta(OFF, on ? '' : '1');

export function currentDecoration(now = new Date()): '🎃' | '🎄' | null {
  return seasonalOn() ? seasonalDecoration(now.getMonth() + 1, now.getDate()) : null;
}
