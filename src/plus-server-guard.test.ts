/**
 * A grant is only a grant from the server that sells the tier.
 *
 * The community server is self-hostable, and `/v1/me` answers `is_plus` on
 * whatever server the phone is pointed at. Without the guard, "free Plus, just
 * paste this URL" would work — and the cost of that falls on the reader who
 * pastes it, whose comments and profile then live on a stranger's box.
 */
const meta: Record<string, string> = {};
let custom = false;

jest.mock('@/db', () => ({
  getMeta: (k: string) => meta[k] ?? null,
  setMeta: (k: string, v: string) => {
    meta[k] = v;
  },
}));
jest.mock('@/server-url', () => ({ isCustomServer: () => custom }));
jest.mock('@/app-icon', () => ({ setIcon: () => Promise.resolve(true) }));

import { cloudStorageAllowed, serverGrantedPlus, setPlusEntitled, setServerPlus } from '@/plus';

describe('server-granted Plus', () => {
  beforeEach(() => {
    custom = false;
    setServerPlus(null);
  });

  test('the official server may grant it', () => {
    setServerPlus(true);
    expect(serverGrantedPlus()).toBe(true);
  });

  test('a self-hosted server may not', () => {
    custom = true;
    setServerPlus(true);
    expect(serverGrantedPlus()).toBe(false);
  });

  test('and it cannot be smuggled in before the switch either', () => {
    setServerPlus(true);
    custom = true;
    setServerPlus(true);
    expect(serverGrantedPlus()).toBe(false);
  });
});

/**
 * The mirror image: Plus pays for OUR storage, a server you run yourself is
 * yours to fill. So the backup/sync gate opens for either — and grants nothing
 * else, which the guard above is still there to make sure of.
 */
describe('cloud storage on a server you run', () => {
  beforeEach(() => {
    custom = false;
    // Already stamped, so flipping Plus on schedules no "backup is on" nudge.
    meta.cloudBackupAutoOn = '1';
    setPlusEntitled(false);
  });

  test('neither Plus nor a custom server: the paywall', () => {
    expect(cloudStorageAllowed()).toBe(false);
  });

  test('Plus opens it on the official server', () => {
    setPlusEntitled(true);
    expect(cloudStorageAllowed()).toBe(true);
  });

  test('a server of your own opens it without Plus', () => {
    custom = true;
    expect(cloudStorageAllowed()).toBe(true);
  });

  test('and still grants no Plus', () => {
    custom = true;
    setServerPlus(true);
    expect(cloudStorageAllowed()).toBe(true);
    expect(serverGrantedPlus()).toBe(false);
  });
});
