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
import { setPlusEntitled } from '@/plus';
import { annualSavingPercent } from '@/pure';
import { RC_API_KEY_ANDROID, RC_API_KEY_IOS } from '@/rc-keys';

/** The entitlement identifier to create in the RevenueCat dashboard. */
const ENTITLEMENT = 'plus';

/** The slice of the SDK this module uses. Typed so `any` never enters. */
type PurchasesSdk = {
  configure(config: { apiKey: string; appUserID?: string | null }): void;
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

function applyEntitlement(info: CustomerInfo): void {
  setPlusEntitled(info.entitlements.active[ENTITLEMENT] != null);
}

/**
 * Called once, at launch. Safe to call again — the second call does nothing.
 * Never throws: a store that cannot be reached must not stop the app starting.
 */
export function initPurchases(): void {
  if (configured || !sdk || !apiKey) return;
  try {
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
