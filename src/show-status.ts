/**
 * Shared show progress/status logic — TV Time color semantics:
 * yellow = watching · green = caught up on a running show ·
 * purple = completed an ended show.
 */
import type { ShowProgress } from '@/db';
import { showMeta } from '@/metadata';
import { colors } from '@/theme';

/** Episodes that have actually aired — announced/future episodes must never
 * count against the viewer, or caught-up shows look forever unfinished.
 * Specials (season 0) are excluded, like the real app. */
export function airedTotalOf(tvdbId: number): number | null {
  const m = showMeta(tvdbId);
  if (!m) return null;
  const keys = Object.keys(m.episodes);
  if (keys.length === 0) return m.totalEpisodes || null;
  const today = new Date().toISOString().slice(0, 10);
  let aired = 0;
  for (const k of keys) {
    if (k.startsWith('0-')) continue;
    const air = m.episodes[k]?.air;
    if (!air || air <= today) aired++;
  }
  return aired || m.totalEpisodes || null;
}

/** overall show progress 0..1 — aired totals from metadata where available */
export function progressOf(sp: ShowProgress): number {
  if (sp.finished) return 1; // user manually marked it complete
  const seen = Math.max(sp.watched, sp.episodesSeen);
  const total = airedTotalOf(sp.tvdbId);
  if (total && total > 0) return Math.min(seen / total, 1);
  if (seen === 0) return 0;
  return Math.min(seen / (seen + 15), 0.95);
}

/** bar color by status */
export function progressColorOf(sp: ShowProgress): string {
  if (sp.finished) return colors.status.finished; // user manually marked it complete
  const m = showMeta(sp.tvdbId);
  const seen = Math.max(sp.watched, sp.episodesSeen);
  const total = airedTotalOf(sp.tvdbId);
  if (total && seen >= total) {
    // purple only when the show is truly over — a show between seasons or
    // with announced unaired episodes is still "caught up" green, like the
    // real app (inProduction alone flips false while awaiting renewal)
    const ended = m?.status === 'Ended' || m?.status === 'Canceled';
    const hasUnaired = (m?.totalEpisodes ?? 0) > total;
    return ended && !hasUnaired ? colors.status.finished : colors.green;
  }
  /*
   * WATCHING — the brand, never `colors.yellow`. That token becomes INK in the
   * light theme so filled controls read black-on-white; a poster's progress
   * bar is a surface reporting a status, and ink turns every show still being
   * watched into a black stripe. This one function paints the bar on every
   * poster in the app — Watch Next, All shows, the profile shelves — so it was
   * the one place the mistake showed up everywhere at once.
   */
  return colors.brand;
}
