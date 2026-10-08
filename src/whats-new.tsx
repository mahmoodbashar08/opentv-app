/**
 * "What's new" — a small dialog, once per version, for people who UPDATED.
 *
 * DECIDED ONCE, AT LAUNCH. Somebody already onboarded when the app starts is
 * an existing user on a new version, and is owed the dialog. Somebody not yet
 * onboarded is a new install: there is nothing "new" to them, so the version
 * is stamped as seen on the spot and onboarding later in the same session
 * never brings it up.
 *
 * Adding a version: add its keys to the six locale files and a row to NOTES.
 * A version with no row shows nothing.
 */
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

import { getMeta, setMeta } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import type { LocaleKey } from '@/locales/keys';
import { isOnboarded } from '@/session-store';
import { ACCENTS, colors, space } from '@/theme';

const KEY = 'whatsNewSeen';

/** Each item's own tint: a list of five identical rows reads as small print. */
const NOTES: Record<string, { icon: string; tint: string; key: LocaleKey }[]> = {
  '1.6.8': [
    { icon: '🎨', tint: ACCENTS.yellow, key: 'whatsNew.v168.templates' },
    { icon: '🎃', tint: '#FF7A1A', key: 'whatsNew.v168.seasonal' },
    { icon: '📱', tint: '#9B7BFF', key: 'whatsNew.v168.icons' },
    { icon: '🧩', tint: '#3E8BFF', key: 'whatsNew.v168.blocks' },
    { icon: '✉️', tint: '#78BE3D', key: 'whatsNew.v168.message' },
  ],
  '1.6.6': [
    { icon: '💬', tint: ACCENTS.yellow, key: 'whatsNew.v166.comments' },
    { icon: '🌐', tint: '#3E8BFF', key: 'whatsNew.v166.translate' },
    { icon: '🖼️', tint: '#FF4D8D', key: 'whatsNew.v166.banner' },
    { icon: '✏️', tint: '#78BE3D', key: 'whatsNew.v166.username' },
    { icon: '☁️', tint: '#9B7BFF', key: 'whatsNew.v166.backup' },
  ],
};

const version = (): string => Constants.expoConfig?.version ?? '';
let owed = false;

export function decideWhatsNewAtLaunch(): void {
  try {
    const v = version();
    if (!v || getMeta(KEY) === v) return;
    if (isOnboarded() && NOTES[v]) owed = true;
    else setMeta(KEY, v);
  } catch {
    // Never let a dialog stand between somebody and their library.
  }
}

/** The dialog itself. Mounted once, on the tabs. */
export function WhatsNew() {
  // Taken in the initialiser, so it is decided per mount, and stamped the
  // moment it is shown: closing the app mid-dialog does not bring it back.
  const [notes, setNotes] = useState(() => {
    if (!owed) return null;
    owed = false;
    try {
      setMeta(KEY, version());
    } catch {
      // Shown again next launch — harmless.
    }
    tapLight();
    return NOTES[version()] ?? null;
  });
  if (!notes) return null;
  const close = () => setNotes(null);

  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        {/* A Pressable that does nothing, so a tap on the card is not a tap on the backdrop. */}
        <Pressable style={s.card} onPress={() => {}}>
          <Pressable style={s.x} hitSlop={12} onPress={close} accessibilityLabel={t('whatsNew.close')}>
            <Text style={s.xText}>✕</Text>
          </Pressable>
          <Animated.View entering={ZoomIn.springify().damping(14)} style={s.head}>
            <Image source={require('@/assets/images/icon.png')} style={s.logo} />
            <View style={s.pill}>
              <Text style={s.pillText}>{version()}</Text>
            </View>
          </Animated.View>
          <Text style={s.title}>{t('whatsNew.title')}</Text>
          <View style={s.list}>
            {notes.map((n, i) => (
              // Brand colours, not the theme's: this is OpenTV saying hello.
              <Animated.View
                key={n.key}
                entering={FadeInDown.delay(150 + i * 80).duration(360)}
                style={[s.row, { backgroundColor: n.tint + '1F', borderColor: n.tint + '40' }]}>
                <View style={[s.iconWrap, { backgroundColor: n.tint + '33' }]}>
                  <Text style={s.icon}>{n.icon}</Text>
                </View>
                <Text style={s.text}>{t(n.key)}</Text>
              </Animated.View>
            ))}
          </View>
          <Pressable style={s.done} onPress={close}>
            <Text style={s.doneText}>{t('whatsNew.done')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: space.lg },
  card: { backgroundColor: '#141416', borderRadius: 24, padding: space.lg, paddingTop: 26, borderWidth: 1, borderColor: '#26262A' },
  x: { position: 'absolute', top: 16, end: 16, zIndex: 1 },
  xText: { color: colors.dim, fontSize: 18, fontWeight: '700' },
  head: { alignItems: 'center', gap: 10 },
  logo: { width: 64, height: 64, borderRadius: 16 },
  pill: { backgroundColor: ACCENTS.yellow, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 },
  pillText: { color: '#000', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  title: { color: '#FFF', fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 8, marginBottom: 16 },
  list: { gap: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 19 },
  text: { color: '#FFF', fontSize: 14.5, lineHeight: 20, flex: 1 },
  done: { marginTop: 18, backgroundColor: ACCENTS.yellow, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
  doneText: { color: '#000', fontSize: 16, fontWeight: '900' },
});
