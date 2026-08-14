/**
 * The library filters, and the presets that name a set of them.
 *
 * PERSISTED, which is the whole point of the rewrite. Filters used to live in
 * a module variable that the grid reset on mount, so somebody who filters the
 * same way every day re-picked it every day. They live in `meta` now and
 * survive a relaunch -- which is exactly why the sheet has a loud RESET, and
 * why the grid's pill counts the active axes: a filter you cannot see and
 * cannot clear is indistinguishable from a library that lost half its shows.
 *
 * REACT COMPILER: same contract as `plus.ts`. `useFilters()` in render goes
 * through `useSyncExternalStore`, so a change re-renders every subscriber;
 * `getFilters()` is for handlers. Never read the module variable in render.
 */
import { useSyncExternalStore } from 'react';

import { getMeta, setMeta } from '@/db';
import {
  DEFAULT_FILTERS,
  parseFilterSet,
  parsePresets,
  serialisePresets,
  upsertPreset,
  type FilterKind,
  type FilterPreset,
  type FilterSet,
} from '@/pure';

export { DEFAULT_FILTERS } from '@/pure';

const META_KEY = (kind: FilterKind): string => `filters:${kind}`;
const PRESETS_KEY = 'filterPresets';

const listeners = new Set<() => void>();
/** Cached so getSnapshot is cheap AND referentially stable between writes. */
const cache: Record<FilterKind, FilterSet | null> = { show: null, movie: null };
let presetCache: FilterPreset[] | null = null;

function notify(): void {
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getFilters(kind: FilterKind): FilterSet {
  const hit = cache[kind];
  if (hit) return hit;
  const loaded = parseFilterSet(getMeta(META_KEY(kind)));
  cache[kind] = loaded;
  return loaded;
}

export function setFilters(kind: FilterKind, f: FilterSet): void {
  cache[kind] = f;
  setMeta(META_KEY(kind), JSON.stringify(f));
  notify();
}

export function resetFilters(kind: FilterKind): void {
  setFilters(kind, { ...DEFAULT_FILTERS });
}

/** Render-safe subscription. Both grids and the sheet read through this. */
export function useFilters(kind: FilterKind): FilterSet {
  return useSyncExternalStore(subscribe, () => getFilters(kind));
}

export function getPresets(): FilterPreset[] {
  if (!presetCache) presetCache = parsePresets(getMeta(PRESETS_KEY));
  return presetCache;
}

function writePresets(list: FilterPreset[]): void {
  presetCache = list;
  setMeta(PRESETS_KEY, serialisePresets(list));
  notify();
}

export function usePresets(kind: FilterKind): FilterPreset[] {
  const all = useSyncExternalStore(subscribe, getPresets);
  return all.filter((p) => p.kind === kind);
}

/** Save a new preset, or overwrite one by id when renaming/updating. */
export function savePreset(preset: FilterPreset): void {
  writePresets(upsertPreset(getPresets(), preset));
}

export function renamePreset(id: string, name: string): void {
  const found = getPresets().find((p) => p.id === id);
  if (found) savePreset({ ...found, name });
}

export function deletePreset(id: string): void {
  writePresets(getPresets().filter((p) => p.id !== id));
}

export function newPresetId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
