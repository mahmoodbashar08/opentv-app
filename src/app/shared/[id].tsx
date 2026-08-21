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
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { TitlePicker } from '@/components/title-picker';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { avatarUri } from '@/community-comments';
import { communityErrorText } from '@/community-error-text';
import { listAddChoices } from '@/db';
import { Poster } from '@/components/poster';
import { gridGeometry } from '@/pure';
import {
  addSharedItem,
  fetchSharedList,
  leaveOrDeleteSharedList,
  removeSharedItem,
  rotateSharedInvite,
  setSharedItemWatched,
  type SharedItem,
  type SharedListDetail,
  type SharedMember,
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
  /** Remove-mode, the same two-state toggle `/lists/[id]` uses. Never a drag:
   *  a shared list has no single owner to decide its order. */
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  // The same column count the personal list derives, so the two lay out
  // identically on a rotated tablet.
  const cols = gridGeometry(useWindowDimensions().width, space.md, 3).cols;
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

  /**
   * A VISITOR READS; A MEMBER TAKES PART.
   *
   * This screen is now reachable from a profile by somebody who was never
   * invited, because the list is on its members' profiles. They see what the
   * list is and who is in it -- and none of the controls, because every one of
   * them is a write the server would refuse anyway. Showing a button that
   * cannot work is a worse answer than not showing it.
   *
   * An older server sends no `is_member`, and every reader it answers at all is
   * a member -- so an absent field means yes, and existing screens are
   * unchanged.
   */
  const member = list.is_member !== false;

  /** The ⋯ menu: everything about the LIST rather than a title inside it. */
  const listActions = (): SheetAction[] => [
    ...(list?.invite_code
      ? [
          { text: t('shared.shareInvite'), icon: 'share-outline' as const, onPress: () => void shareInvite() },
          { text: t('shared.newCode'), icon: 'refresh' as const, onPress: () => void rotate() },
        ]
      : []),
    {
      text: list?.is_owner ? t('shared.deleteList') : t('shared.leaveList'),
      icon: (list?.is_owner ? 'trash-outline' : 'exit-outline') as SheetAction['icon'],
      destructive: true,
      onPress: confirmLeave,
    },
  ];

  return (
    <Screen>
      {/*
       * A SHARED LIST IS A LIST, AND SHOULD READ AS ONE.
       *
       * This screen was built as a feed -- a vertical stack of rows, each with
       * a small poster, a name and a tick -- while `/lists/[id]` is a title, a
       * button and a grid of full posters. They are the same object with the
       * same job, reached from the same shelf, and looking like two different
       * features was the whole of the complaint.
       *
       * So the layout is that screen's, to the pixel where it can be: header
       * actions, big title, the add button pinned under it, the sort line, a
       * three-up poster grid, a count at the bottom.
       *
       * WHAT IS NOT COPIED IS THE PART THAT DIFFERS. Every poster carries the
       * avatar of whoever put it there, because "Sara added this" is the reason
       * anybody opens a shared list on a Tuesday -- a bag of titles nobody is
       * attached to is a bookmark folder. And a tick marks what YOU have
       * watched, which the personal list has no need of.
       */}
      <NavHeader
        right={
          member ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              {editing ? (
                <Pressable hitSlop={8} onPress={() => setEditing(false)}>
                  <Text style={styles.action}>{t('common.done')}</Text>
                </Pressable>
              ) : (
                <>
                  {list.items.length > 0 && (
                    <Pressable hitSlop={8} onPress={() => setEditing(true)}>
                      <Text style={styles.action}>{t('profile.edit')}</Text>
                    </Pressable>
                  )}
                  <Pressable hitSlop={10} onPress={() => setSheet(true)}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
                  </Pressable>
                </>
              )}
            </View>
          ) : undefined
        }
      />

      <View style={{ paddingHorizontal: space.lg, gap: 12, paddingBottom: 12 }}>
        <Text style={styles.bigTitle}>{list.name}</Text>
        {member && <PillButton label={t('listDetail.addShowsMovies')} onPress={() => setPicking(true)} />}

        {/* WHO IS HERE, in one line rather than a stack of cards. The old
            member cards pushed the list itself below the fold on a list with
            three people in it. */}
        <View style={styles.whoRow}>
          {list.members.slice(0, 6).map((m) => (
            <MemberDot key={m.id} member={m} />
          ))}
          <Text style={styles.whoText} numberOfLines={1}>
            {t('shared.memberCount', { count: list.members.length })}
          </Text>
        </View>

        <Text style={styles.sort}>
          {editing ? t('listDetail.editHint') : `${t('listDetail.sortBy')} `}
          {!editing && <Text style={{ color: colors.blue }}>{t('shared.sortAdded')}</Text>}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        key={cols}
        data={list.items}
        keyExtractor={(i) => i.id}
        numColumns={cols}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ paddingHorizontal: space.md, gap: 3, paddingBottom: 40 }}
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
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t('shared.noItemsTitle')}</Text>
            <Text style={styles.blurb}>{t('shared.noItemsBody')}</Text>
          </View>
        }
        ListFooterComponent={
          list.items.length > 0 ? (
            <Text style={styles.note}>{t('listDetail.itemsCountFull', { count: list.items.length })}</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const ticked = me != null && item.watched_by.includes(me.id);
          const adder = list.members.find((m) => m.id === item.added_by) ?? null;
          return (
            <Pressable
              style={{ flex: 1 / cols }}
              onPress={() => (editing ? undefined : openItem(item))}
              onLongPress={() => {
                if (!member) return;
                tapLight();
                setMenu(item);
              }}
              delayLongPress={300}>
              <Poster name={item.title ?? ''} uri={item.poster} />

              {/* WHOSE PICK IT WAS. Bottom-leading, over the poster's darkest
                  corner, small enough not to hide a face. */}
              {adder != null && (
                <View style={styles.adder}>
                  <MemberDot member={adder} small />
                </View>
              )}

              {/* Only YOUR tick is drawn here; everybody's progress is the
                  member row above. A visitor sees neither. */}
              {member && (
                <Pressable
                  style={[styles.gridTick, ticked && styles.gridTickOn]}
                  hitSlop={6}
                  disabled={busy === item.id}
                  onPress={() => toggleWatched(item)}>
                  <Ionicons name="checkmark" size={13} color={ticked ? colors.onYellow : '#FFF'} />
                </Pressable>
              )}

              {editing && (
                <Pressable style={styles.remove} hitSlop={8} onPress={() => setMenu(item)}>
                  <Ionicons name="close" size={13} color="#000" />
                </Pressable>
              )}
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
      {/* The list's own menu: the invite code, a new code, and the way out.
          They left the header when it gained Edit, and they belong together --
          each one is about the LIST rather than about a title in it. */}
      <ActionSheet
        visible={sheet}
        title={list.name}
        actions={listActions()}
        onClose={() => setSheet(false)}
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

/**
 * One member, as a circle.
 *
 * Their picture when there is one and their initial when there is not --
 * avatars are not always served, and a letter is the true state of the world
 * rather than a spinner that never resolves. `small` is the badge that sits on
 * a poster; the default is the row under the title.
 */
function MemberDot({ member, small }: { member: SharedMember; small?: boolean }) {
  const uri = avatarUri(member.avatar_key);
  const box = small ? styles.dotSmall : styles.dot;
  if (uri) return <Image source={{ uri }} style={box} contentFit="cover" cachePolicy="disk" />;
  return (
    <View style={[box, styles.dotLetter]}>
      <Text style={[styles.dotText, small && { fontSize: 9 }]}>
        {(member.display_name?.[0] ?? member.handle[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { color: colors.blue, fontSize: 15.5, fontWeight: '600' },
  bigTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sort: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 14 },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  whoText: { color: colors.dim, fontSize: 12.5, marginStart: 4, flex: 1 },
  dot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.card },
  dotSmall: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.card },
  dotLetter: { alignItems: 'center', justifyContent: 'center' },
  dotText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  /* Bottom-leading, over the poster's darkest corner. */
  adder: { position: 'absolute', bottom: 5, start: 5, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.55)' },
  gridTick: {
    position: 'absolute',
    top: 5,
    end: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)',
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTickOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  remove: {
    position: 'absolute',
    top: 4,
    start: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E8E8EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
