import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import seed from '@/seed';
import { colors, space } from '@/theme';

export default function AddRemoveScreen() {
  const [query, setQuery] = useState('');
  const items = seed.shows.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).slice(0, 20);

  return (
    <Screen>
      <NavHeader title="Add/remove shows & movies" />
      <View style={styles.searchLine}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          style={styles.input}
          placeholder="Search shows and movies"
          placeholderTextColor={colors.faint}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <FlatList
        data={items}
        keyExtractor={(s) => String(s.tvdbId)}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.thumb}>
              <Text style={{ color: 'rgba(255,255,255,.6)', fontWeight: '800', fontSize: 11 }}>
                {item.name.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.minus}>
              <Ionicons name="remove" size={18} color={colors.onYellow} />
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 6,
  },
  input: { color: colors.text, fontSize: 16, flex: 1, paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  thumb: { width: 42, height: 60, borderRadius: 4, backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 15.5, fontWeight: '600', flex: 1 },
  minus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
