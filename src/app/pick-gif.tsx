/**
 * Pick a GIF for a GIF widget. The searching lives in `GifSearch`, shared with
 * the banner picker; this screen only decides what happens to the file.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GifSearch, saveGif, type GifHit } from '@/components/gif-search';
import { getProfileLayout, setProfileLayout } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { newUid, normalise, notifyLayoutSaved, parseLayout, serialise, specOf, type WidgetSpan } from '@/profile-layout';
import { colors, space } from '@/theme';

export default function PickGifScreen() {
  const { span } = useLocalSearchParams<{ span?: string }>();
  const chosen: WidgetSpan = span === '2x1' || span === '2x2' ? span : specOf('gif').span;
  const [saving, setSaving] = useState<string | null>(null);

  const choose = async (hit: GifHit) => {
    if (saving) return;
    setSaving(hit.id);
    try {
      const name = await saveGif(hit, 'widget-gif');
      tapLight();
      const raw = getProfileLayout();
      const items = normalise(parseLayout(raw), []);
      const next = [...items, { uid: newUid('gif'), id: 'gif', span: chosen, data: name }];
      setProfileLayout(serialise(next, raw));
      notifyLayoutSaved();
      router.back();
    } catch (err) {
      Alert.alert(t('pickGif.failedTitle'), err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={s.page}>
      <View style={s.head}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={s.title}>{t('pickGif.title')}</Text>
        <View style={{ width: 26 }} />
      </View>
      <GifSearch onPick={(h) => void choose(h)} busyId={saving} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: 60,
    paddingBottom: 6,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
});
