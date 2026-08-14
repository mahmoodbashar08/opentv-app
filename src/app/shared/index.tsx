/**
 * Every list you share with somebody, and the two ways to get another one.
 *
 * THE EMPTY STATE IS THE MAIN STATE and is written as such. Almost everybody
 * opening this has none, and a blank screen with a title on it teaches nothing
 * about what a shared list even is. So the empty case explains the feature in
 * one sentence and offers both doors — start one, or paste a code somebody
 * sent you — because half the people arriving here were invited.
 *
 * JOIN IS NOT BEHIND ANYTHING. Not Plus, not a follow, not an account age.
 * Somebody who was sent a link is the most valuable person on this screen: they
 * did not come looking for the app, the app came to them.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { communityErrorText } from '@/community-error-text';
import { useJoined } from '@/community-session';
import { fetchSharedLists, joinSharedList, type SharedListRow } from '@/community-shared-lists';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';

export default function SharedListsScreen() {
  const joined = useJoined();
  const [rows, setRows] = useState<SharedListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    if (!joined) {
      setRows([]);
      return;
    }
    try {
      setRows(await fetchSharedLists());
      setError(null);
    } catch (e) {
      // A shared list that fails quietly looks like a list your friends never
      // used. Say which of the two it is.
      setError(communityErrorText(e));
    }
  }, [joined]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const submitCode = async () => {
    const trimmed = code.trim();
    if (trimmed.length === 0 || joining) return;
    setJoining(true);
    try {
      const res = await joinSharedList(trimmed);
      tapLight();
      setCode('');
      await load();
      router.push(`/shared/${res.id}`);
    } catch (e) {
      Alert.alert(t('shared.joinFailedTitle'), communityErrorText(e));
    } finally {
      setJoining(false);
    }
  };

  return (
    <Screen>
      <NavHeader title={t('shared.title')} />

      {!joined ? (
        <View style={styles.centre}>
          <Ionicons name="people-outline" size={34} color={colors.faint} />
          <Text style={styles.blurb}>{t('shared.needsAccount')}</Text>
          <Pressable style={styles.cta} onPress={() => router.push('/join')}>
            <Text style={styles.ctaText}>{t('shared.join')}</Text>
          </Pressable>
        </View>
      ) : rows == null ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.yellow} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.dim} />}
          contentContainerStyle={{ padding: space.md, paddingBottom: 60, gap: 8 }}
          ListHeaderComponent={
            error ? <Text style={styles.error}>{error}</Text> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t('shared.emptyTitle')}</Text>
              <Text style={styles.blurb}>{t('shared.emptyBody')}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/shared/${item.id}`)}>
              <View style={styles.rowIcon}>
                <Ionicons name="people" size={18} color={colors.yellow} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowSub}>
                  {t('shared.rowSub', { members: item.members, items: item.items })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.faint} />
            </Pressable>
          )}
          ListFooterComponent={
            <View style={{ gap: 14, marginTop: 22 }}>
              <Pressable style={styles.cta} onPress={() => router.push('/shared/create')}>
                <Ionicons name="add" size={17} color={colors.onYellow} />
                <Text style={styles.ctaText}>{t('shared.startOne')}</Text>
              </Pressable>

              <View style={{ gap: 8 }}>
                <Text style={styles.label}>{t('shared.haveACode')}</Text>
                <View style={styles.codeRow}>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder={t('shared.codePlaceholder')}
                    placeholderTextColor={colors.faint}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.codeInput}
                    onSubmitEditing={submitCode}
                    returnKeyType="go"
                  />
                  <Pressable
                    style={[styles.codeGo, code.trim().length === 0 && { opacity: 0.4 }]}
                    disabled={code.trim().length === 0 || joining}
                    onPress={submitCode}>
                    {joining ? (
                      <ActivityIndicator size="small" color={colors.onYellow} />
                    ) : (
                      <Text style={styles.codeGoText}>{t('shared.joinAction')}</Text>
                    )}
                  </Pressable>
                </View>
                {/* Says it out loud, because the assumption is the opposite. */}
                <Text style={styles.footnote}>{t('shared.joinIsFree')}</Text>
              </View>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: space.lg },
  blurb: { color: colors.dim, fontSize: 14.5, lineHeight: 21, textAlign: 'center' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 34, paddingHorizontal: space.md },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13.5, marginBottom: 12, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 12,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  rowSub: { color: colors.faint, fontSize: 12.5, marginTop: 3 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 13,
    paddingHorizontal: 22,
  },
  ctaText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 0.6 },
  label: { color: colors.dim, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: '700' },
  codeRow: { flexDirection: 'row', gap: 8 },
  codeInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontSize: 16,
    letterSpacing: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  codeGo: {
    backgroundColor: colors.yellow,
    borderRadius: radius.card,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 84,
  },
  codeGoText: { color: colors.onYellow, fontSize: 13, fontWeight: '800' },
  footnote: { color: colors.faint, fontSize: 12.5, lineHeight: 18 },
});
