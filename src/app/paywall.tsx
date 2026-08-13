/**
 * The OpenTV Plus paywall. PLACEHOLDER — the purchases agent owns this screen.
 * Registered in _layout as a transparentModal sheet like `join`.
 */
import { Text } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';

export default function PaywallScreen() {
  return (
    <Screen>
      <NavHeader title="OpenTV Plus" close />
      <Text style={{ color: '#A7A7AE', padding: 20 }}>Coming together on the plus branch.</Text>
    </Screen>
  );
}
