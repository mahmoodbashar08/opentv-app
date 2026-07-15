import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { PillButton, Screen } from '@/components/ui';
import { colors, space } from '@/theme';

export default function CreateListScreen() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hidden, setHidden] = useState(false);

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.headTitle}>Create a new list</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.blue, fontSize: 16 }}>Cancel</Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: space.lg, gap: 22, marginTop: 10 }}>
        <View>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="New list"
            placeholderTextColor={colors.faint}
            value={name}
            onChangeText={setName}
          />
        </View>
        <View>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={styles.input}
            placeholder="(optional)"
            placeholderTextColor={colors.faint}
            value={description}
            onChangeText={setDescription}
          />
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={styles.footer}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.blue, fontSize: 15, fontWeight: '600' }}>Hide from profile 🔒</Text>
          <Switch value={hidden} onValueChange={setHidden} trackColor={{ true: colors.green }} />
        </View>
        <View style={{ alignItems: 'center', marginTop: 16 }}>
          <PillButton label="Create list" onPress={() => router.back()} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  headTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  label: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  input: {
    color: colors.text,
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 8,
  },
  footer: { paddingHorizontal: space.lg, paddingBottom: 28 },
});
