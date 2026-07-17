/**
 * Asks WidgetKit to re-render the home-screen widgets after the app refreshed
 * their shared data. Loaded optionally so binaries without the module (or the
 * widget extension) keep working — callers treat `null` as "no widgets here".
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

type WidgetRefreshModule = {
  reloadAll(): void;
};

export default requireOptionalNativeModule<WidgetRefreshModule>('WidgetRefresh');
