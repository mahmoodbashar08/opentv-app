/**
 * Is this phone one of Google's pre-launch robots (Firebase Test Lab)?
 *
 * Play's pre-launch report signs in with throwaway `name.12345@gmail.com`
 * accounts and leaves real rows on the server. Android only; everywhere else,
 * and on a binary built before the module existed, the answer is `false`.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const mod = requireOptionalNativeModule<{ isTestLab(): boolean }>('TestLab');

export function isTestLab(): boolean {
  try {
    return mod?.isTestLab() ?? false;
  } catch {
    return false;
  }
}
