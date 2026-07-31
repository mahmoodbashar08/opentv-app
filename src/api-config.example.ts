/** Copy this file to src/api-config.ts and set the community API's base URL.
 *
 *  Same pattern as tmdb-token.ts: the real file is gitignored so a dev build
 *  can point at `wrangler dev` (http://127.0.0.1:8787) while production points
 *  at the deployed Worker, without either ever being committed.
 *
 *  No trailing slash — `api()` joins paths as `${API_BASE_URL}${path}`. */
export const API_BASE_URL = 'https://your-worker.workers.dev';
