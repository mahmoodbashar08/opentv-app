/**
 * iCloud Drive access for backups. Loaded optionally so a binary built
 * before this native module existed (or Expo Go) renders the JS just fine —
 * callers must handle `null` as "iCloud unsupported in this build".
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export type CloudFileInfo = {
  exists: boolean;
  downloaded: boolean;
  modifiedAt: number | null; // epoch ms
  size: number | null;
};

type ICloudDriveModule = {
  isAvailable(): boolean;
  /** same check off the JS thread — safe to call from tap handlers */
  isAvailableAsync(): Promise<boolean>;
  writeFile(name: string, base64: string): Promise<void>;
  fileInfo(name: string): Promise<CloudFileInfo>;
  readFile(name: string, timeoutMs: number): Promise<string>;
};

export default requireOptionalNativeModule<ICloudDriveModule>('ICloudDrive');
