/**
 * One shared list.
 *
 * THIS SCREEN FETCHES, and it is one of the very few here that may. Nothing on
 * it is yours alone: the list belongs to everybody in it, so there is no local
 * copy that could be authoritative. Every screen showing YOUR shows, films,
 * history or stats still reads SQLite and still must.
 *
 * WHO ADDED WHAT IS THE POINT, not decoration. A bag of titles nobody is
 * attached to is a bookmark folder. "Sara added this" is why somebody opens the
 * app on a Tuesday, so it is on every row, and the members strip shows how far
 * each person has got — which is the small, friendly pressure that makes a
 * shared list a plan instead of an archive.
 *
 * TICKING SOMETHING OFF IS NOT MARKING IT WATCHED. It says "I have seen this
 * one, in this list, for these people" and reaches nothing else: not the
 * library, not the history, not the profile. The server has no watch history
 * and this does not give it one.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { TitlePicker } from '@/components/title-picker';
import { NavHeader, Screen } from '@/components/ui';
import { communityErrorText } from '@/community-error-text';
import { listAddChoices } from '@/db';
import {
  addSharedItem,
  fetchSharedList,
  leaveOrDeleteSharedList,
  removeSharedItem,
  rotateSharedInvite,
  setSharedItemWatched,
  type SharedItem,
  type SharedListDetail,
} from '@/community-shared-lists';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';

export default function SharedListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [list, setList] = useState<SharedListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState<SharedItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /*
   * ADDING FROM THE LIST ITSELF, as well as from a title's own page.
   *
   * The show page answers "Ali would like this" and this answers "what shall
   * we watch"; they are the same act arriving from two different thoughts, and
   * a list with no way to add to it reads as a list somebody else fills in.
   */
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const choices = useMemo(() => listAddChoices().map((c) => ({ key: c.ref, name: c.name, poster: c.uri })), []);

  const addChoice = async (ref: string, name: string, poster: string | null) => {
    if (adding) return;
    setAdding(true);
    try {
      // The ref carries what it is as well as which one, so nothing here has to
      // guess a kind from a name.
      const isMovie = ref.startsWith('movie:');
      await addSharedItem(id, {
        source: isMovie ? 'movie' : 'tvdb',
        key: ref.slice(ref.indexOf(':') + 1),
        title: name,
        poster,
      });
      tapLight();
      setPicking(false);
      await load();
    } catch (e) {
      Alert.alert(t('shared.title'), communityErrorText(e));
    } finally {
      setAdding(false);
    }
  };

  const load = useCallback(async () => {
    try {
      setList(await fetchSharedList(String(id)));
      setError(null);
    } catch (e) {
      setError(communityErrorText(e));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const me = useMemo(() => list?.members.find((m) => m.is_me) ?? null, [list]);

  const toggleWatched = async (item: SharedItem) => {
    if (!me || busy) return;
    const on = item.watched_by.includes(me.id);
    setBusy(item.id);
    // Optimistic: the tick is the most-tapped control here and a round trip
    // before it moves makes the whole list feel broken.
    setList((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((i) =>
              i.id === item.id
                ? { ...i, watched_by: on ? i.watched_by.filter((w) => w !== me.id) : [...i.watched_by, me.id] }
                : i,
            ),
            members: prev.members.map((m) =>
              m.id === me.id ? { ...m, watched: m.watched + (on ? -1 : 1) } : m,
            ),
          }
        : prev,
    );
    tapSelection();
    try {
      await setSharedItemWatched(String(id), item.id, !on);
    } catch {
      // Put it back rather than leave a tick that is not true on the server.
      await load();
    } finally {
      setBusy(null);
    }
  };

  const openItem = (item: SharedItem) => {
    if (item.target_source === 'tvdb') router.push(`/show/${item.target_key}`);
    else router.push(`/movie/${encodeURIComponent(item.target_key)}`);
  };

  const shareInvite = async () => {
    if (!list?.invite_code) return;
    await Share.share({ message: t('shared.inviteMessage', { name: list.name, code: list.invite_code }) });
  };

  const itemActions = (item: SharedItem): SheetAction[] => {
    const mine = me != null && item.added_by === me.id;
    const canRemove = mine || list?.is_owner === true;
    const out: SheetAction[] = [
      { text: t('shared.open'), icon: 'open-outline', onPress: () => { setMenu(null); openItem(item); } },
    ];
    if (canRemove) {
      out.push({
        text: t('shared.remove'),
        icon: 'trash-outline',
        destructive: true,
        onPress: async () => {
          setMenu(null);
          try {
            await removeSharedItem(String(id), item.id);
            await load();
          } catch (e) {
            Alert.alert(t('shared.title'), communityErrorText(e));
          }
        },
      });
    }
    return out;
  };

  const confirmLeave = () => {
    const owner = list?.is_owner === true;
    Alert.alert(
      owner ? t('shared.deleteTitle') : t('shared.leaveTitle'),
      owner ? t('shared.deleteBody') : t('shared.leaveBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: owner ? t('shared.deleteAction') : t('shared.leaveAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveOrDeleteSharedList(String(id));
              router.back();
            } catch (e) {
              Alert.alert(t('shared.title'), communityErrorText(e));
            }
          },
        },
      ],
    );
  };

  const rotate = () => {
    Alert.alert(t('shared.rotateTitle'), t('shared.rotateBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('shared.rotateAction'),
        style: 'destructive',
        onPress: async () => {
          try {
            await rotateSharedInvite(String(id));
            await load();
            tapLight();
          } catch (e) {
            Alert.alert(t('shared.title'), communityErrorText(e));
          }
        },
      },
    ]);
  };

  if (list == null) {
    return (
      <Screen>
        <NavHeader title={t('shared.title')} />
        <View style={styles.centre}>
          {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.yellow} />}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader
        title={list.name}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <Pressable hitSlop={10} onPress={() => setPicking(true)}>
              <Ionicons name="add" size={24} color={colors.text} />
            </Pressable>
            <Pressable hitSlop={10} onPress={confirmLeave}>
              <Ionicons name={list.is_owner ? 'trash-outline' : 'exit-outline'} size={19} color={colors.dim} />
            </Pressable>
          </View>
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(i) => i.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.dim}
          />
        }
        contentContainerStyle={{ padding: space.md, paddingBottom: 90, gap: 8 }}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 6 }}>
            {/* Who is here, and how far each of them has got. */}
            <View style={styles.members}>
              {list.members.map((m) => (
                <View key={m.id} style={styles.member}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.is_me ? t('shared.you') : m.display_name || `@${m.handle}`}
                  </Text>
                  <Text style={styles.memberCount}>
                    {t('shared.memberProgress', { done: m.watched, total: list.items.length })}
                  </Text>
                </View>
              ))}
            </View>

            {list.invite_code ? (
              <View style={styles.inviteBox}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{t('shared.inviteLabel')}</Text>
                  <Text style={styles.code} selectable>
                    {list.invite_code}
                  </Text>
                  <Text style={styles.footnote}>{t('shared.joinIsFree')}</Text>
                </View>
                <View style={{ gap: 8 }}>
                  <Pressable style={styles.inviteBtn} onPress={shareInvite}>
                    <Ionicons name="share-outline" size={16} color={colors.onYellow} />
                  </Pressable>
                  <Pressable style={styles.inviteBtnQuiet} onPress={rotate}>
                    <Ionicons name="refresh" size={16} color={colors.dim} />
                  </Pressable>
                </View>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t('shared.noItemsTitle')}</Text>
            <Text style={styles.blurb}>{t('shared.noItemsBody')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const ticked = me != null && item.watched_by.includes(me.id);
          const adder = list.members.find((m) => m.id === item.added_by);
          return (
            <Pressable
              style={styles.item}
              onPress={() => openItem(item)}
              onLongPress={() => {
                tapLight();
                setMenu(item);
              }}
              delayLongPress={300}>
              <View style={styles.poster}>
                {item.poster ? (
                  <Image source={{ uri: item.poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                ) : (
                  <Ionicons
                    name={item.target_source === 'tvdb' ? 'tv-outline' : 'film-outline'}
                    size={18}
                    color={colors.faint}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.title || item.target_key}
                </Text>
                <Text style={styles.itemSub} numberOfLines={1}>
                  {adder
                    ? adder.is_me
                      ? t('shared.addedByYou')
                      : t('shared.addedBy', { who: adder.display_name || `@${adder.handle}` })
                    : t('shared.addedBySomeone')}
                  {item.watched_by.length > 0
                    ? ` · ${t('shared.seenByCount', { count: item.watched_by.length })}`
                    : ''}
                </Text>
              </View>
              <Pressable
                hitSlop={10}
                disabled={busy === item.id}
                onPress={() => toggleWatched(item)}
                style={[styles.tick, ticked && styles.tickOn]}>
                <Ionicons name="checkmark" size={16} color={ticked ? colors.onYellow : colors.faint} />
              </Pressable>
            </Pressable>
          );
        }}
      />

      <ActionSheet
        visible={menu != null}
        title={menu?.title ?? ''}
        actions={menu ? itemActions(menu) : []}
        onClose={() => setMenu(null)}
      />
      {/*
        THE SAME PICKER THE ARTWORK AND GIF FLOWS USE. A third searchable list
        of somebody's own library would be a third place for it to behave
        differently — and this one already handles the search, the empty state
        and the rows.

        AN OVERLAY RATHER THAN A PUSHED SCREEN: this list is a transparent
        modal, and anything pushed on top of one renders underneath it. That is
        the same trap the widget preview hit, twice.
      */}
      {picking && (
        <View style={styles.pickerVeil}>
          <View style={styles.pickerHead}>
            <Text style={styles.pickerTitle}>{t('shared.addTitle')}</Text>
            <Pressable hitSlop={12} onPress={() => setPicking(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          {adding && <ActivityIndicator color={colors.dim} style={{ paddingBottom: 8 }} />}
          <TitlePicker
            items={choices}
            empty={t('shared.addEmpty')}
            onPick={(c) => void addChoice(c.key, c.name, c.poster ?? null)}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pickerVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    paddingTop: 54,
  },
  pickerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: 10,
  },
  pickerTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  error: { color: colors.danger, fontSize: 13.5, textAlign: 'center' },
  blurb: { color: colors.dim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 30, paddingHorizontal: space.md },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },

  members: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  member: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 13,
    gap: 2,
  },
  memberName: { color: colors.text, fontSize: 12.5, fontWeight: '700', maxWidth: 140 },
  memberCount: { color: colors.faint, fontSize: 11, fontVariant: ['tabular-nums'] },

  inviteBox: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 14,
    alignItems: 'center',
  },
  label: { color: colors.dim, fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', fontWeight: '700' },
  code: { color: colors.yellow, fontSize: 22, fontWeight: '800', letterSpacing: 3, marginTop: 4 },
  footnote: { color: colors.faint, fontSize: 11.5, marginTop: 4 },
  inviteBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteBtnQuiet: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 10,
  },
  poster: {
    width: 42,
    height: 60,
    borderRadius: 6,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  itemSub: { color: colors.faint, fontSize: 12, marginTop: 3 },
  tick: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
});
