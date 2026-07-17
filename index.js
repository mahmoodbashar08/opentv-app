// Custom entry: register the Android widget task handler BEFORE the app loads
// (the launcher can wake the JS runtime headless, with no UI mounted), then
// hand off to expo-router's standard entry.
import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { widgetTaskHandler } = require('./widgets/widget-task-handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('expo-router/entry');
