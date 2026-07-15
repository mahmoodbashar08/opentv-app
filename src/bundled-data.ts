/**
 * Typed views over the remaining bundled data files. Public builds ship
 * these EMPTY (a virgin install has no badges, social graph, or character
 * votes) — the explicit types keep the legacy seed-reading paths compiling.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

export type AppBadge = { id: string; name: string; image?: string; unlocked?: boolean; date?: string };
export type WatchBadge = { id: string; show: string; tier?: string; detail?: string; image?: string; date?: string };
export const badges = require('@/data/badges.json') as { app: AppBadge[]; watch: WatchBadge[] };

export type SocialPerson = { id: string; name: string; avatar?: string | null };
export const social = require('@/data/social.json') as { followers: SocialPerson[]; followersTotal: number };

export type CharVote = { show: string; name: string; count: number };
export const charVotes = require('@/data/character-votes.json') as {
  total: number;
  shows: number;
  top: CharVote[];
  movies: { total: number; count: number };
};
