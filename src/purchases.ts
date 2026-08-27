/**
 * RevenueCat — the only thing in the app allowed to answer "is this person Plus".
 *
 * It writes the answer through `setPlusEntitled()` in `@/plus`; every screen
 * reads it from there. Nothing else imports this module except the paywall and
 * the one `initPurchases()` call at launch.
 *
 * THREE THINGS THAT ARE NOT ACCIDENTS
 *
 * 1. The SDK is `require`d behind a try/catch, the same way `analytics.ts` does
 *    it. The native module only exists in a dev client or store build compiled
 *    with it; Jest and an older dev client must get a silent no-op rather than a
 *    crash at import time.
 *
 * 2. Empty keys mean "not configured yet", not "broken". `initPurchases()`
 *    returns immediately, every call below answers `unavailable`, and the
 *    paywall shows what Plus is with its buttons in an unavailable state. The
 *    whole Plus feature set can therefore be built and reviewed before a single
 *    store product exists.
 *
 * 3. Plus does NOT require a community account. The app's promise is that no
 *    account is needed, and a paid tier that quietly needed one would break it.
 *    So RC is configured with the community profile id when there is one — which
 *    is what carries a subscription across that person's devices — and with
 *    RC's own anonymous id when there is not. Somebody who joins later stays on
 *    the anonymous id for that launch; their receipt is still on the store
 *    account, so a restore recovers it either way.
 */
import { Platform } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';

import { getProfileId } from '@/community-session';
import { serverGrantedPlus, setPlusEntitled } from '@/plus';
import { annualSavingPercent } from '@/pure';
import { RC_API_KEY_ANDROID, RC_API_KEY_IOS } from '@/rc-keys';

/** The entitlement identifier to create in the RevenueCat dashboard. */
const ENTITLEMENT = 'plus';

/** The slice of the SDK this module uses. Typed so `any` never enters. */
type PurchasesSdk = {
  configure(config: { apiKey: string; appUserID?: string | null }): void;
  setLogHandler(handler: (level: string, message: string) => void): void;
  logIn(appUserID: string): Promise<{ customerInfo: CustomerInfo }>;
  addCustomerInfoUpdateListener(listener: (info: CustomerInfo) => void): void;
  getOfferings(): Promise<{ current: { monthly: PurchasesPackage | null; annual: PurchasesPackage | null } | null }>;
  purchasePackage(pkg: PurchasesPackage): Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases(): Promise<CustomerInfo>;
  getCustomerInfo(): Promise<CustomerInfo>;
};

let sdk: PurchasesSdk | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sdk = (require('react-native-purchases') as { default: PurchasesSdk }).default;
} catch {
  sdk = null;
}

const apiKey = Platform.OS === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID;

let configured = false;

/**
 * THE STORE IS ONE OF TWO SOURCES, and this used to behave as though it were
 * the only one.
 *
 * A subscription lives in the receipt, which is what makes this listener right
 * about cancellations, refunds and lapses — those must revoke, and only the
 * store knows. But Plus can also be GIVEN, straight onto `profiles`, and no
 * receipt exists for that. Setting the flag from `entitlements.active` alone
 * therefore un-entitled every gifted account a second or two after
 * `refreshSession` had entitled it.
 *
 * So: either source may grant, and revoking needs both to agree. `serverPlus`
 * is `null` when the server could not be asked, which falls back to the store
 * alone rather than pretending it said no — see the note on it in `plus.ts`.
 *
 * This is also what makes a grant with an END DATE work. `plus_until` lapses,
 * the next `/v1/me` answers false, the store still answers false, and the two
 * agreeing is what finally takes it off the phone.
 */
function applyEntitlement(info: CustomerInfo): void {
  const fromStore = info.entitlements.active[ENTITLEMENT] != null;
  setPlusEntitled(fromStore || serverGrantedPlus());
}

/**
 * Called once, at launch. Safe to call again — the second call does nothing.
 * Never throws: a store that cannot be reached must not stop the app starting.
 */
export function initPurchases(): void {
  if (configured || !sdk || !apiKey) return;
  try {
    /*
     * A CANCELLED PURCHASE IS NOT AN ERROR, and the SDK logs it as one.
     *
     * Somebody tapping "cancel" on Apple's sheet is the most ordinary outcome
     * there is — `buy()` already returns `cancelled` and the paywall stays
     * quiet. But the SDK writes that through `console.error`, and in a debug
     * build LogBox turns every console.error into a full red screen. So
     * testing a purchase flow meant dismissing a crash-looking overlay each
     * time, and a real error would have been indistinguishable from it.
     *
     * Routed to `console.log` instead: nothing is hidden, and the one thing
     * LogBox exists to shout about stays meaningful.
     */
    try {
      sdk.setLogHandler((level, message) => {
        // eslint-disable-next-line no-console
        console.log(`[RevenueCat ${level}] ${message}`);
      });
    } catch {
      // An older SDK without a log handler. Noisy, never broken.
    }
    sdk.configure({ apiKey, appUserID: getProfileId() });
    configured = true;
    // The listener is the important half: it fires on launch, after a purchase,
    // after a restore, and when a subscription lapses or is refunded — so the
    // entitlement follows the store rather than the last thing the UI saw.
    sdk.addCustomerInfoUpdateListener(applyEntitlement);
    void sdk.getCustomerInfo().then(applyEntitlement).catch(() => {
      // Offline. The cached entitlement in meta stands, which is the point of
      // caching it — a bought app must be Plus on a plane.
    });
  } catch {
    configured = false;
  }
}

/**
 * Called when the community sign-in completes, for the device that joined
 * AFTER launch: `initPurchases` ran while signed out, so RevenueCat knows this
 * phone by an anonymous id, and a purchase made now would reach the webhook as
 * `$RCAnonymousID:…` — un-mappable, no badge, caps never lifted server-side.
 * `logIn` aliases the anonymous history onto the profile id, after which the
 * webhook can act. The entitlement itself never depended on this; it lives on
 * the store account and in the cached flag either way.
 *
 * Fire-and-forget and never throws: naming the buyer to the badge system must
 * not be able to break signing in.
 */
export function logInPurchases(profileId: string): void {
  if (!configured || !sdk) return;
  sdk
    .logIn(profileId)
    .then(({ customerInfo }) => applyEntitlement(customerInfo))
    .catch(() => {
      // Offline or RC hiccup. The webhook maps this profile on the next
      // launch's configure(), so nothing is lost — only delayed.
    });
}

/** The two packages the paywall offers. Either may be null. */
export type Plans = { monthly: PurchasesPackage | null; annual: PurchasesPackage | null };

/**
 * Every call below returns a result instead of throwing. The UI has exactly
 * three things to say — it worked, you cancelled, it did not work — and a raw
 * StoreKit error string is not one of them.
 */
export type PurchaseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

const unavailable = { ok: false, reason: 'unavailable' } as const;

export async function getOffering(): Promise<PurchaseResult<Plans>> {
  if (!sdk || !configured) return unavailable;
  try {
    const current = (await sdk.getOfferings()).current;
    if (!current) return unavailable;
    return { ok: true, value: { monthly: current.monthly, annual: current.annual } };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** `value` is whether the entitlement is active afterwards. */
export async function buy(pkg: PurchasesPackage): Promise<PurchaseResult<boolean>> {
  if (!sdk || !configured) return unavailable;
  try {
    const { customerInfo } = await sdk.purchasePackage(pkg);
    applyEntitlement(customerInfo);
    return { ok: true, value: customerInfo.entitlements.active[ENTITLEMENT] != null };
  } catch (e) {
    // RC signals a cancelled sheet with a flag on the error, not a distinct
    // type. Cancelling is not a failure and must not raise an alert.
    if (typeof e === 'object' && e !== null && (e as { userCancelled?: boolean }).userCancelled === true) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'failed' };
  }
}

/**
 * What a subscriber's subscription is actually doing.
 *
 * WHY THIS EXISTS. The paid screen said "thank you" and nothing else, so
 * somebody paying had no way to see when they would be charged again, or
 * whether they would be — which is the single most common reason people cancel
 * a subscription they would otherwise have kept: not knowing.
 *
 * `willRenew` IS THE IMPORTANT FIELD, not the date. The same date means
 * "renews on" or "ends on" depending on it, and those are opposite sentences.
 * A cancelled subscriber still has Plus until the date, and telling them it
 * renews then would be a lie they discover at the wrong moment.
 *
 * `managementURL` is Apple's own subscription screen. Cancelling must never be
 * something this app makes hard to find: Apple requires the route to exist, and
 * hiding it is how a tier earns refund requests instead of renewals.
 *
 * Null when there is nothing to say — not configured, not subscribed, or the
 * call failed. Every caller treats all three the same way.
 */
export type PlusStatus = {
  /** ISO date the period ends. Null for a lifetime or a sandbox oddity. */
  expires: string | null;
  /** True: charged again on that date. False: access ends on it. */
  willRenew: boolean;
  /** Apple's manage-subscription page for this account. */
  managementUrl: string | null;
  /** True while in a free trial, which changes what the date means again. */
  trial: boolean;
};

export async function plusStatus(): Promise<PlusStatus | null> {
  if (!sdk || !configured) return null;
  try {
    const info = await sdk.getCustomerInfo();
    const ent = info.entitlements.active[ENTITLEMENT];
    if (!ent) return null;
    return {
      expires: ent.expirationDate,
      willRenew: ent.willRenew,
      managementUrl: info.managementURL,
      trial: ent.periodType === 'TRIAL' || ent.periodType === 'trial',
    };
  } catch {
    return null;
  }
}

/** `value` is whether anything was restored. */
export async function restore(): Promise<PurchaseResult<boolean>> {
  if (!sdk || !configured) return unavailable;
  try {
    const info = await sdk.restorePurchases();
    applyEntitlement(info);
    return { ok: true, value: info.entitlements.active[ENTITLEMENT] != null };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** The annual saving as a whole percent, or null. Maths in `pure.ts`, tested. */
export function annualSaving(plans: Plans): number | null {
  return annualSavingPercent(plans.monthly?.product.price, plans.annual?.product.price);
}

/** True when the package's introductory phase costs nothing — i.e. a free trial. */
export function hasFreeTrial(pkg: PurchasesPackage | null): boolean {
  return pkg?.product.introPrice?.price === 0;
}
