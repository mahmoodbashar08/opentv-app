/** Copy to src/giphy-key.ts (gitignored) and set a GIPHY API key.
 *
 *  Free and instant: developers.giphy.com → Create an App → API. Beta keys are
 *  limited to 100 searches an hour, which this picker's one-debounced-request
 *  pattern never approaches. Without a key the GIF picker explains itself and
 *  offers nothing — widgets holding already-saved GIFs keep working.
 *
 *  (Tenor was the first choice and is DEAD: Google shut the API down for good
 *  on 30 June 2026. If a file mentions Tenor, it is stale.) */
export const GIPHY_API_KEY = '';
