/** Copy to rc-keys.ts and paste the RevenueCat PUBLIC SDK keys (app.revenuecat.com
 *  → Project → API keys → "Public app-specific" — one per platform, `appl_…` and
 *  `goog_…`). They are public by design and ship in the binary; the secret keys
 *  never belong here.
 *
 *  LEFT EMPTY ON PURPOSE. An empty string means "purchases are not configured
 *  yet": `initPurchases()` does nothing, the paywall still shows what Plus is,
 *  and the buy buttons say so instead of failing at the store. That is what
 *  lets everything else be built before the products exist. */
export const RC_API_KEY_IOS = '';
export const RC_API_KEY_ANDROID = '';
