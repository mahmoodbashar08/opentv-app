/**
 * Cross-platform text prompt. Replaces Alert.prompt, which is iOS-only — on
 * Android it silently does nothing, so profile fields (name, birth year,
 * country) could not be edited there at all. A plain Modal + TextInput works on
 * both.
 */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

export function PromptModal({
  visible,
  title,
  initial,
  keyboardType = 'default',
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initial: string;
  keyboardType?: 'default' | 'number-pad';
  /** return true if the value was accepted (modal closes); false keeps it open */
  onSubmit: (value: string) => boolean;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  // refill with the current value every time it reopens for a different field
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.center} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType={keyboardType}
            autoFocus
            selectTextOnFocus
            style={styles.input}
            placeholderTextColor={colors.faint}
            returnKeyType="done"
            onSubmitEditing={() => onSubmit(text)}
          />
          <View style={styles.row}>
            <Pressable style={styles.btn} onPress={onCancel} hitSlop={6}>
              <Text style={styles.cancel}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => onSubmit(text)} hitSlop={6}>
              <Text style={styles.save}>{t('promptModal.save')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: space.xl },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.card, borderRadius: 14, padding: space.lg },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 14 },
  input: {
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  btn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill },
  cancel: { color: colors.dim, fontSize: 15, fontWeight: '600' },
  save: { color: colors.yellow, fontSize: 15, fontWeight: '800' },
});
