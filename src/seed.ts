/**
 * Typed view over the bundled seed data. Public builds ship these files
 * EMPTY — a virgin install starts with no library — so the explicit types
 * here keep every legacy seed-reading code path compiling.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const raw = require('@/data/seed.json');

export type SeedShow = {
  tvdbId: number;
  name: string;
  posterUrl?: string | null;
  episodesSeen: number;
  followed?: boolean;
  favorited?: boolean;
  archived?: boolean;
};
export type SeedMovie = {
  name: string;
  originalName?: string | null;
  poster?: string | null;
  year?: string | null;
  tmdbId?: number | null;
  stars?: number | null;
  watchedAt?: string | null;
  runtime?: number | null;
  addedAt?: string | null;
};
export type SeedComment = {
  type: string;
  entity: string;
  text: string;
  date: string;
  likes: number;
  replies: number;
  image?: string | null;
};
export type SeedListItem = { name: string; poster: string | null };
export type SeedList = { name: string; movieCount: number; items: SeedListItem[] };
export type SeedFavoriteShow = { tvdbId: number; name: string; poster: string | null };

export type Seed = {
  profile: {
    username: string;
    since: string;
    clock: { months: number; days: number; hours: number };
    episodesWatched: number;
    following: number;
    followers: number;
    comments: number;
    movieMinutes: number;
  };
  lists: SeedList[];
  comments: SeedComment[];
  movies: SeedMovie[];
  shows: SeedShow[];
  favoriteShowOrder: number[];
  favoriteShows: SeedFavoriteShow[];
  favoriteMovies: { count: number; items: SeedListItem[] };
  watchlist: SeedMovie[];
};

const seed = raw as Seed;
export default seed;
