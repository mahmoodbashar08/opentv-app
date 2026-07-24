import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { PillButton, Screen } from '@/components/ui';
import { createList, renameList } from '@/db';
import { colors, space } from '@/theme';

export default function CreateListScreen() {
  // when `edit` is set we're renaming an existing list rather than creating one
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = typeof edit === 'string' && edit.length > 0;
  const [name, setName] = useState(editing ? edit : '');
  const [description, setDescription] = useState('');
  const [hidden, setHidden] = useState(false);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Give your list a name.');
      return;
    }
    const ok = editing ? renameList(edit, trimmed) : createList(trimmed);
    if (!ok) {
      Alert.alert('That name is taken', 'You already have a list with this name — pick another.');
      return;
    }
    router.back();
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.headTitle}>{editing ? 'Edit list' : 'Create a new list'}</Text>
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
          <PillButton label={editing ? 'Save changes' : 'Create list'} onPress={submit} />
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
