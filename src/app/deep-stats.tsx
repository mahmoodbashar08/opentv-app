/**
 * The Deep Stats dashboard. PLACEHOLDER — the stats agent owns this screen.
 * Registered in _layout as a plain push like `stats`.
 */
import { Text } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';

export default function DeepStatsScreen() {
  return (
    <Screen>
      <NavHeader title="Deep Stats" close />
      <Text style={{ color: '#A7A7AE', padding: 20 }}>Coming together on the plus branch.</Text>
    </Screen>
  );
}
