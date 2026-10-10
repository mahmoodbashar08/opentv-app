/**
 * Your devices — the phones and tablets that sync with this account.
 *
 * THE LIST LIVES ON THE SERVER, and for once that is right: it is a list OF
 * devices, so no one device can hold it. What is on it is what each phone
 * said about itself when it synced — a name, a platform, when — and nothing
 * about what is watched on it. Drop the table whole and nobody loses a row of
 * their library; the server's one promise is untouched.
 *
 * `device-sync.ts` sends the name with every sync, reads the list back, drops
 * a device from it, and handles being turned away (`syncRefusal`). This file
 * is the pure part — what to call this phone, how to order the list — kept
 * free of the session and the database so it runs under the plain test
 * runner.
 */

export type Device = {
  device: string;
  name: string | null;
  platform: string | null;
  first_seen: string;
  last_seen: string;
};

/**
 * WHAT THIS PHONE CALLS ITSELF on the list.
 *
 * The user's own name for it when the phone will say — "Mahmood's iPhone" —
 * because that is what tells two iPhones apart. iOS 16+ answers a bare
 * "iPhone" until an entitlement nobody has asked for is granted, and a list
 * of five rows all called "iPhone" is no list; the model ("iPhone 15 Pro")
 * says more than that, so a name the model merely begins with is passed over
 * for the model. Nothing else is read off the phone.
 */
export function pickDeviceName(deviceName: string | null | undefined, modelName: string | null | undefined): string | null {
  const name = (deviceName ?? '').trim();
  const model = (modelName ?? '').trim();
  const generic =
    !name || /^(iphone|ipad|ipod|android)$/i.test(name) || (model !== '' && model.toLowerCase().startsWith(name.toLowerCase()));
  return (generic ? model || name : name) || null;
}

/** This phone first, then the server's order (most recently used first). */
export function orderDevices<T extends { device: string }>(list: readonly T[], thisDevice: string): T[] {
  return [...list].sort((a, b) => Number(b.device === thisDevice) - Number(a.device === thisDevice));
}

/**
 * The two answers that mean "this phone may not sync any more" — removed by
 * its owner, or one too many. Anything else is an ordinary failure and the
 * outbox simply waits.
 */
export function syncRefusal(code: string): 'device_removed' | 'device_limit' | null {
  return code === 'device_removed' || code === 'device_limit' ? code : null;
}
