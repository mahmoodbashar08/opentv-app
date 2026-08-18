/**
 * Starting a shared list.
 *
 * PAST THE FREE ONE THIS IS THE PAYWALL'S DOOR, and the screen says so before
 * the tap rather than after it: being refused by a server is a worse
 * introduction to a paid feature than being told the price while you are still
 * deciding. `requirePlus` is not used here because the server owns this rule --
 * it counts the lists, not the app -- so the refusal is caught and turned into
 * the paywall, which is the same destination by a more honest route.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { ApiError } from '@/api';
import { communityErrorText } from '@/community-error-text';
import { createSharedList } from '@/community-shared-lists';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { PLUS_AVAILABLE } from '@/plus';
import { colors, radius, space } from '@/theme';

export default function CreateSharedListScreen() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    try {
      const list = await createSharedList(trimmed);
      tapLight();
      router.replace(`/shared/${list.id}`);
    } catch (e) {
      // The one failure with a screen of its own rather than an alert.
      if (e instanceof ApiError && e.code === 'plus_required') {
        if (PLUS_AVAILABLE) router.replace('/paywall?from=shared_list');
        else Alert.alert(t('shared.title'), t('shared.plusSoon'));
      } else {
        Alert.alert(t('shared.title'), communityErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <NavHeader title={t('shared.newTitle')} />
      <View style={styles.body}>
        <Text style={styles.blurb}>{t('shared.newBlurb')}</Text>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('shared.namePlaceholder')}
          placeholderTextColor={colors.faint}
          style={styles.input}
          maxLength={60}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />

        <Pressable
          style={[styles.cta, (name.trim().length === 0 || busy) && { opacity: 0.45 }]}
          disabled={name.trim().length === 0 || busy}
          onPress={submit}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.onYellow} />
          ) : (
            <Text style={styles.ctaText}>{t('shared.createAction')}</Text>
          )}
        </Pressable>

        <Text style={styles.footnote}>{t('shared.newFootnote')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: 18 },
  blurb: { color: colors.dim, fontSize: 14.5, lineHeight: 21 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: colors.onYellow, fontSize: 14, fontWeight: '800', letterSpacing: 0.6 },
  footnote: { color: colors.faint, fontSize: 12.5, lineHeight: 18 },
});
