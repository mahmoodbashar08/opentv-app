/**
 * Bottom sheet of icon rows — the shape TV Time used for a show's menu.
 *
 * Deliberately not ActionSheetIOS: the system sheet can't show icons, and a
 * long list of plain text rows reads as a wall. Rows here carry the same icon
 * vocabulary as the rest of the app, so the menu is scannable at a glance.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space } from '@/theme';

export type SheetAction = {
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** renders red — reserved for anything that destroys data */
  destructive?: boolean;
  onPress: () => void;
};

export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Modal's own "slide" would drag the backdrop up with the sheet, showing its
  // top edge — so the sheet slides while the backdrop only fades.
  const slide = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) {
      slide.setValue(1);
      return;
    }
    Animated.timing(slide, {
      toValue: 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            paddingBottom: Math.max(insets.bottom, 14),
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }) }],
          },
        ]}>
        {title != null && (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        )}
        {actions.map((a, i) => (
          <Pressable
            key={a.text}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.rowPressed]}
            onPress={() => {
              onClose();
              // let the sheet finish closing before the action pushes a screen
              // or opens its own alert, or the two animations fight
              requestAnimationFrame(a.onPress);
            }}>
            <Ionicons name={a.icon} size={21} color={a.destructive ? colors.danger : colors.text} />
            <Text style={[styles.label, a.destructive && { color: colors.danger }]} numberOfLines={1}>
              {a.text}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 6,
  },
  title: {
    color: colors.dim,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: space.lg },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowPressed: { backgroundColor: '#26262A' },
  label: { color: colors.text, fontSize: 16.5, flex: 1 },
});
