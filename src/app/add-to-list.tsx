import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PromptModal } from '@/components/prompt-modal';
import { NavHeader, Screen } from '@/components/ui';
import {
  addToList,
  createList,
  getCustomLists,
  getMovie,
  getShowBrief,
  removeFromList,
  type CustomListItem,
} from '@/db';
import { listsChanged } from '@/community-publish';
import { colors, space } from '@/theme';
import { t } from '@/i18n';

export default function AddToListScreen() {
  const { type, id, name } = useLocalSearchParams<{ type?: string; id?: string; name?: string }>();
  const [, setTick] = useState(0);
  const [prompt, setPrompt] = useState(false);
  const refresh = () => setTick((n) => n + 1);

  // build the item to add from the show/movie the user came from
  const item: CustomListItem | null = (() => {
    if (type === 'movie' && name) {
      const m = getMovie(decodeURIComponent(name));
      return m ? { kind: 'movie', name: m.name, poster: m.poster } : null;
    }
    const tvdbId = Number(id) || 0;
    const s = getShowBrief(tvdbId);
    return s ? { kind: 'show', name: s.name, poster: s.poster, tvdbId } : null;
  })();

  const lists = getCustomLists();
  const inList = (listName: string) =>
    !!item && lists.find((l) => l.name === listName)?.items.some((it) => it.kind === item.kind && it.name === item.name);

  const toggle = (listName: string) => {
    if (!item) return;
    if (inList(listName)) removeFromList(listName, item.name);
    else addToList(listName, item);
    listsChanged();
    refresh();
  };

  const createAndAdd = (value: string): boolean => {
    const nm = value.trim();
    if (!nm) return false;
    if (!createList(nm)) {
      Alert.alert(t('addToList.nameTakenTitle'), t('addToList.nameTakenBody'));
      return false;
    }
    if (item) addToList(nm, item);
    listsChanged();
    refresh();
    return true;
  };

  return (
    <Screen>
      <NavHeader
        title={t('addToList.title')}
        right={
          <Pressable hitSlop={10} onPress={() => router.back()}>
            <Text style={{ color: colors.blue, fontSize: 16, fontWeight: '700' }}>{t('common.done')}</Text>
          </Pressable>
        }
      />
      {item && <Text style={styles.subject} numberOfLines={1}>{item.name}</Text>}
      <FlatList
        data={lists}
        keyExtractor={(l) => l.name}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }}
        ListHeaderComponent={
          <Pressable style={[styles.row, styles.newRow]} onPress={() => setPrompt(true)}>
            <Ionicons name="add" size={22} color={colors.yellow} />
            <Text style={[styles.name, { color: colors.yellow }]}>{t('addToList.createNewList')}</Text>
          </Pressable>
        }
        renderItem={({ item: l }) => {
          const on = inList(l.name);
          return (
            <Pressable style={styles.row} onPress={() => toggle(l.name)}>
              <Text style={styles.name} numberOfLines={1}>
                {l.name}
              </Text>
              <View style={[styles.check, on && styles.checkOn]}>
                {on && <Ionicons name="checkmark" size={16} color={colors.onYellow} />}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{t('addToList.emptyLists')}</Text>}
      />
      <PromptModal
        visible={prompt}
        title={t('addToList.newListTitle')}
        initial=""
        onCancel={() => setPrompt(false)}
        onSubmit={(v) => {
          const ok = createAndAdd(v);
          if (ok) setPrompt(false);
          return ok;
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subject: { color: colors.dim, fontSize: 14, paddingHorizontal: space.lg, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  newRow: { borderBottomWidth: 1 },
  name: { flex: 1, color: colors.text, fontSize: 16 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  empty: { color: colors.faint, fontSize: 13.5, textAlign: 'center', marginTop: 24 },
});
