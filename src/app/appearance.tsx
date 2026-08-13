/**
 * The Appearance (themes + icons). PLACEHOLDER — the appearance agent owns this screen.
 * Registered in _layout as a plain push like `set-password`.
 */
import { Text } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';

export default function AppearanceScreen() {
  return (
    <Screen>
      <NavHeader title="Appearance" close />
      <Text style={{ color: '#A7A7AE', padding: 20 }}>Coming together on the plus branch.</Text>
    </Screen>
  );
}
