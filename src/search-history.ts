/**
 * The search screen's memory.
 *
 * Stored in `meta` like every other small preference — it is a handful of rows,
 * not a table, and it belongs to this device rather than to the account. A
 * search history that followed you between phones would be a surprise nobody
 * asked for.
 */
import { getMeta, setMeta } from '@/db';
import {
  addSearchHistory,
  removeSearchHistory,
  type SearchHistoryEntry,
} from '@/pure';

const KEY = 'searchHistory';

export function getSearchHistory(): SearchHistoryEntry[] {
  try {
    const raw = JSON.parse(getMeta(KEY) ?? '[]') as SearchHistoryEntry[];
    return Array.isArray(raw) ? raw.filter((h) => h && typeof h.value === 'string') : [];
  } catch {
    return [];
  }
}

/** Remember something. Returns the new history so a caller can render it. */
export function rememberSearch(entry: Omit<SearchHistoryEntry, 'at'>): SearchHistoryEntry[] {
  const next = addSearchHistory(getSearchHistory(), { ...entry, at: new Date().toISOString() });
  setMeta(KEY, JSON.stringify(next));
  return next;
}

export function forgetSearch(kind: SearchHistoryEntry['kind'], value: string): SearchHistoryEntry[] {
  const next = removeSearchHistory(getSearchHistory(), kind, value);
  setMeta(KEY, JSON.stringify(next));
  return next;
}

export function clearSearchHistory(): void {
  setMeta(KEY, '[]');
}
