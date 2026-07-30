import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { PillButton, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { colors, space } from '@/theme';

export default function CreateTopicScreen() {
  const [text, setText] = useState('');

  return (
    <Screen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <PillButton label={t('createTopic.post')} small onPress={() => router.back()} />
      </View>
      <TextInput
        style={styles.input}
        placeholder={t('createTopic.placeholder')}
        placeholderTextColor={colors.faint}
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  input: { color: colors.text, fontSize: 17, paddingHorizontal: space.lg, paddingTop: 10, flex: 1, textAlignVertical: 'top' },
});
