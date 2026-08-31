/**
 * ONE DOOR FOR BOTH KINDS OF LIST.
 *
 * Starting a shared list used to be a separate button on the Lists screen
 * leading to a separate screen -- which made "a list" and "a list with other
 * people in it" two features rather than one question asked at the moment
 * somebody is already naming a list. Now the kind is chosen here, and the
 * choice is the ONLY difference: a shared list is created on the server and
 * has members, a personal one is a row in SQLite.
 *
 * The switch is absent while EDITING. A list cannot change kind after the
 * fact -- one of them has other people's work in it -- and offering a control
 * that silently does nothing is worse than not offering it.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api';
import { communityErrorText } from '@/community-error-text';
import { createSharedList } from '@/community-shared-lists';
import { useJoined } from '@/community-session';
import { PillButton, Screen } from '@/components/ui';
import { createList, getCustomLists, renameList, setListHidden } from '@/db';
import { listsChanged } from '@/community-publish';
import { PLUS_AVAILABLE } from '@/plus';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

export default function CreateListScreen() {
  // when `edit` is set we're renaming an existing list rather than creating one
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = typeof edit === 'string' && edit.length > 0;
  const [name, setName] = useState(editing ? edit : '');
  const [description, setDescription] = useState('');
  /** Personal until somebody says otherwise -- the common case, and the safe one. */
  const [withFriends, setWithFriends] = useState(false);
  const [busy, setBusy] = useState(false);
  const joined = useJoined();
  // EDITING SHOWS THE LIST'S OWN SETTING. It defaulted to off whichever list you
  // opened, so a hidden list looked visible and saving would have published it.
  const [hidden, setHidden] = useState(() =>
    editing ? (getCustomLists().find((l) => l.name === edit)?.hidden ?? false) : false,
  );

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(t('listCreate.nameRequiredTitle'), t('listCreate.nameRequiredBody'));
      return;
    }

    if (withFriends && !editing) {
      /*
       * PAST THE FREE ONE THIS IS THE PAYWALL'S DOOR, and the server owns the
       * rule -- it counts the lists, not the app -- so the refusal is caught
       * and turned into the paywall rather than an error alert. Being told the
       * price is a better answer than being told no.
       */
      if (busy) return;
      setBusy(true);
      void createSharedList(trimmed)
        .then((list) => {
          listsChanged();
          router.replace(`/shared/${list.id}`);
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.code === 'plus_required') {
            if (PLUS_AVAILABLE) router.replace('/paywall?from=shared_list');
            else Alert.alert(t('shared.title'), t('shared.plusSoon'));
          } else {
            Alert.alert(t('shared.title'), communityErrorText(e));
          }
        })
        .finally(() => setBusy(false));
      return;
    }
    const ok = editing ? renameList(edit, trimmed) : createList(trimmed, hidden);
    if (!ok) {
      Alert.alert(t('listCreate.nameTakenTitle'), t('listCreate.nameTakenBody'));
      return;
    }
    // AFTER the rename, and against the NEW name — `setListHidden` finds a list
    // by name, and the old one no longer exists by the time this runs.
    setListHidden(trimmed, hidden);
    listsChanged();
    router.back();
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.headTitle}>{editing ? t('listCreate.editTitle') : t('listCreate.createTitle')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.blue, fontSize: 16 }}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: space.lg, gap: 22, marginTop: 10 }}>
        {/* Only when JOINED and only when creating: a list cannot change kind
            afterwards, and somebody who never joined the community has one
            kind available to them. */}
        {!editing && joined && (
          <View>
            <View style={styles.kindRow}>
              {[false, true].map((mode) => (
                <Pressable
                  key={String(mode)}
                  style={[styles.kind, withFriends === mode && styles.kindOn]}
                  onPress={() => setWithFriends(mode)}>
                  <Text style={[styles.kindText, withFriends === mode && styles.kindTextOn]}>
                    {mode ? t('listCreate.kindWithFriends') : t('listCreate.kindJustMe')}
                  </Text>
                </Pressable>
              ))}
            </View>
            {withFriends && <Text style={styles.kindHint}>{t('listCreate.kindHint')}</Text>}
          </View>
        )}
        <View>
          <Text style={styles.label}>{t('listCreate.nameLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('listCreate.namePlaceholder')}
            placeholderTextColor={colors.faint}
            value={name}
            onChangeText={setName}
          />
        </View>
        {/* Neither belongs to a shared list: the server stores no description,
            and "hide from profile" is one person's switch over something
            several people are in. */}
        <View style={withFriends && !editing ? { display: 'none' } : undefined}>
          <Text style={styles.label}>{t('listCreate.descriptionLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('listCreate.descriptionPlaceholder')}
            placeholderTextColor={colors.faint}
            value={description}
            onChangeText={setDescription}
          />
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={styles.footer}>
        {!(withFriends && !editing) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.blue, fontSize: 15, fontWeight: '600' }}>{t('listCreate.hideFromProfile')}</Text>
            <Switch value={hidden} onValueChange={setHidden} trackColor={{ true: colors.green }} />
          </View>
        )}
        <View style={{ alignItems: 'center', marginTop: 16 }}>
          {busy ? (
            <ActivityIndicator color={colors.yellow} />
          ) : (
            <PillButton label={editing ? t('listCreate.saveChanges') : t('listCreate.createList')} onPress={submit} />
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kindRow: { flexDirection: 'row', gap: 8 },
  kind: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: radius.card,
    alignItems: 'center',
    backgroundColor: colors.lift,
  },
  kindOn: { backgroundColor: colors.yellow },
  kindText: { color: colors.dim, fontSize: 14, fontWeight: '700' },
  kindTextOn: { color: colors.onYellow },
  kindHint: { color: colors.faint, fontSize: 12.5, lineHeight: 18, marginTop: 10 },
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
