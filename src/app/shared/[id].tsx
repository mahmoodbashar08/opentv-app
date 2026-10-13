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
 * A TOGETHER IS THIS SCREEN WITH THREE DIFFERENCES (2.0.0): the header is the
 * show rather than a list name, each face carries an episode ("S2E4") instead
 * of a count, and there is no grid, no tick and no "add" — the one show is the
 * header and the position is the tick. Invites, leave, rotate and report are
 * the shared list's own, which is the point: one family, not two features.
 *
 * TICKING SOMETHING OFF IS NOT MARKING IT WATCHED. It says "I have seen this
 * one, in this list, for these people" and reaches nothing else: not the
 * library, not the history, not the profile. The server has no watch history
 * and this does not give it one.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { TitlePicker } from '@/components/title-picker';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { track } from '@/analytics';
import { communityErrorText } from '@/community-error-text';
import { forgetTogether, noteTogetherDetail, togetherShowState } from '@/community-together';
import { MemberDot, MembersStrip, memberName } from '@/components/shared-members';
import { positionText, togetherMembers, togetherSummaryText } from '@/components/together-strip';
import { addShow, listAddChoices } from '@/db';
import { a11yAction } from '@/a11y';
import { Poster, posterSpeech } from '@/components/poster';
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
} from '@/community-shared-lists';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius, space, ls } from '@/theme';
import { withLink } from '@/share-link';

export default function SharedListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [list, setList] = useState<SharedListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState<SharedItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The together's show on this phone — set here, in the callback, never read in render. */
  const [showState, setShowState] = useState<'local' | 'absent' | 'unreadable'>('local');
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
      const d = await fetchSharedList(String(id));
      setList(d);
      setError(null);
      if (d.kind === 'together') {
        // The show page's strip reads this cache; every open refreshes it.
        noteTogetherDetail(d);
        const key = Number(d.items[0]?.target_key);
        if (Number.isFinite(key)) setShowState(togetherShowState(key));
      }
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
  const together = list?.kind === 'together';
  // Shape only, once per open: that a together was looked at, never which.
  useEffect(() => {
    if (together) track('together_open');
  }, [together]);

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
    const message = together
      ? t('together.inviteMessage', { show: list.items[0]?.title ?? list.name, code: list.invite_code })
      : t('shared.inviteMessage', { name: list.name, code: list.invite_code });
    await Share.share({ message: withLink(message) });
  };

  const addToMyShows = () => {
    const item = list?.items[0];
    const key = Number(item?.target_key);
    if (!item || !Number.isFinite(key)) return;
    addShow(key, item.title ?? '', item.poster);
    tapLight();
    setShowState(togetherShowState(key));
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
              forgetTogether(String(id));
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

  /*
   * INVITE FIRST. A shared list with only you in it is not shared yet, and
   * inviting is the first thing to do — it used to be the last item in the ⋯
   * menu while the one big button offered "Add shows & movies" (item 19). The
   * code is only ever sent to the owner, so only the owner sees the card.
   */
  const inviteFirst = member && list.invite_code != null && list.members.length < 2;
  const item0 = list.items[0] ?? null;
  const total = list.items.length;

  /** Who added it, by name — the reason anybody opens a shared list on a Tuesday. */
  const addedByText = (i: SharedItem): string => {
    const adder = list.members.find((m) => m.id === i.added_by);
    if (adder?.is_me) return t('shared.addedByYou');
    return adder ? t('shared.addedBy', { who: memberName(adder) }) : t('shared.addedBySomeone');
  };

  const header = (
    <View style={{ paddingHorizontal: space.lg, gap: 14, paddingBottom: 14 }}>
      {together && item0 ? (
        /* The show IS the header: its poster and name, not a list name. */
        <Pressable
          style={styles.showHead}
          accessibilityRole="button"
          accessibilityLabel={`${t('together.title')}, ${item0.title ?? list.name}`}
          onPress={() => openItem(item0)}>
          <View style={{ width: 70 }}>
            <Poster name={item0.title ?? list.name} uri={item0.poster} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.kicker}>{t('together.title')}</Text>
            <Text style={styles.bigTitle} numberOfLines={2}>
              {item0.title ?? list.name}
            </Text>
          </View>
        </Pressable>
      ) : (
        <Text accessibilityRole="header" style={styles.bigTitle}>
          {list.name}
        </Text>
      )}

      {inviteFirst ? (
        <View style={styles.inviteCard}>
          <Text style={styles.inviteTitle}>{t('sharedLists.inviteTitle')}</Text>
          <Text style={styles.inviteBody}>{together ? t('together.inviteBody') : t('sharedLists.inviteBody')}</Text>
          <Text style={styles.code} accessibilityLabel={`${t('shared.inviteLabel')}: ${list.invite_code?.split('').join(' ')}`}>
            {list.invite_code}
          </Text>
          <PillButton label={t('sharedLists.inviteAction')} onPress={() => void shareInvite()} trackId="shared_invite_first" />
        </View>
      ) : null}

      {/* WHO IS HERE, with names and how far each has got. The owner's "+" at
          the end keeps inviting one tap away once the card above is gone. */}
      <MembersStrip
        rows={
          together
            ? togetherMembers(list).map((r) => ({ member: r.member, label: member ? positionText(r.position) : '' }))
            : list.members.map((m) => ({
                member: m,
                label: member ? t('shared.memberProgress', { done: m.watched, total }) : '',
              }))
        }
        onInvite={!inviteFirst && list.invite_code != null ? () => void shareInvite() : undefined}
      />

      {together && member && (
        <View style={{ gap: 10 }}>
          <Text style={styles.summary}>{togetherSummaryText(list)}</Text>
          {showState === 'unreadable' && <Text style={styles.dim}>{t('together.cantRead')}</Text>}
          {/* The invitee who does not track the show yet: one tap, and their
              ticks start moving their face. Until then they are "Not started". */}
          {showState === 'absent' && <PillButton label={t('together.addToMyShows')} onPress={addToMyShows} trackId="together_add_show" />}
        </View>
      )}

      {!together && member && (
        <PillButton
          label={t('listDetail.addShowsMovies')}
          // Second to the invite while nobody else is here.
          variant={inviteFirst ? 'outline' : 'yellow'}
          onPress={() => setPicking(true)}
        />
      )}
      {editing && <Text style={styles.hint}>{t('listDetail.editHint')}</Text>}
    </View>
  );

  return (
    <Screen>
      {/*
       * A SHARED LIST IS A LIST, AND SHOULD READ AS ONE: header actions, big
       * title, a three-up poster grid, a count at the bottom — `/lists/[id]`'s
       * layout. What differs is what makes it shared: the people, by name, with
       * how far each has got; who added each title; who has seen it.
       *
       * The "Sort by: added" line is gone (item 19). It was blue and did
       * nothing; the server keeps newest first and there is nothing to choose.
       */}
      <NavHeader
        right={
          member ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              {editing ? (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setEditing(false)}>
                  <Text style={styles.action}>{t('common.done')}</Text>
                </Pressable>
              ) : (
                <>
                  {/* A together holds one show; there is nothing to edit out of it. */}
                  {!together && list.items.length > 0 && (
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setEditing(true)}>
                      <Text style={styles.action}>{t('profile.edit')}</Text>
                    </Pressable>
                  )}
                  <Pressable accessibilityRole="button" accessibilityLabel={t('a11y.more')} hitSlop={10} onPress={() => setSheet(true)}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
                  </Pressable>
                </>
              )}
            </View>
          ) : undefined
        }
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        key={cols}
        data={together ? [] : list.items}
        keyExtractor={(i) => i.id}
        numColumns={cols}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ paddingHorizontal: space.md, gap: 10, paddingBottom: 40 }}
        ListHeaderComponent={<View style={{ marginHorizontal: -space.md }}>{header}</View>}
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
          together ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t('shared.noItemsTitle')}</Text>
              <Text style={styles.blurb}>{t('shared.noItemsBody')}</Text>
            </View>
          )
        }
        ListFooterComponent={
          !together && list.items.length > 0 ? (
            <Text style={styles.note}>{t('listDetail.itemsCountFull', { count: list.items.length })}</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const ticked = me != null && item.watched_by.includes(me.id);
          // Everybody who has seen it, not only you — yours is the tick.
          const seers = list.members.filter((m) => item.watched_by.includes(m.id));
          const added = addedByText(item);
          return (
            <Pressable
              style={{ flex: 1 / cols }}
              onPress={() => (editing ? undefined : openItem(item))}
              accessibilityRole="button"
              accessibilityLabel={[
                posterSpeech(item.title ?? ''),
                added,
                seers.length > 0 ? t('shared.seenByCount', { count: seers.length }) : null,
                ticked ? t('a11y.watched') : null,
              ]
                .filter(Boolean)
                .join(', ')}
              // A long press has no screen-reader gesture; the menu is offered as an action instead.
              {...(member ? a11yAction('menu', t('a11y.more'), () => setMenu(item)) : null)}
              onLongPress={() => {
                if (!member) return;
                tapLight();
                setMenu(item);
              }}
              delayLongPress={300}>
              <View>
                <Poster name={item.title ?? ''} uri={item.poster} />

                {/* WHO HAS SEEN IT, bottom-leading over the poster's darkest corner. */}
                {seers.length > 0 && (
                  <View style={styles.seers}>
                    {seers.slice(0, 3).map((m, k) => (
                      <View key={m.id} style={[styles.seer, k > 0 && { marginStart: -6 }]}>
                        <MemberDot member={m} size={18} />
                      </View>
                    ))}
                    {seers.length > 3 && <Text style={styles.seerMore}>+{seers.length - 3}</Text>}
                  </View>
                )}

                {member && (
                  <Pressable accessibilityRole="checkbox" accessibilityLabel={t('a11y.watched')} accessibilityState={{ checked: ticked }}
                    style={[styles.gridTick, ticked && styles.gridTickOn]}
                    hitSlop={6}
                    disabled={busy === item.id}
                    onPress={() => toggleWatched(item)}>
                    <Ionicons name="checkmark" size={13} color={ticked ? colors.onYellow : '#FFF'} />
                  </Pressable>
                )}

                {editing && (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('common.remove')} style={styles.remove} hitSlop={8} onPress={() => setMenu(item)}>
                    <Ionicons name="close" size={13} color="#000" />
                  </Pressable>
                )}
              </View>
              <Text style={styles.addedBy} numberOfLines={1}>
                {added}
              </Text>
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
            <Pressable accessibilityRole="button" accessibilityLabel={t('a11y.close')} hitSlop={12} onPress={() => setPicking(false)}>
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
  action: { color: colors.blue, fontSize: 15.5, fontWeight: '600' },
  bigTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  kicker: { color: colors.yellow, fontSize: 11.5, fontWeight: '800', letterSpacing: ls(0.8), textTransform: 'uppercase' },
  showHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  summary: { color: colors.text, fontSize: 15, fontWeight: '600' },
  dim: { color: colors.faint, fontSize: 12.5 },
  hint: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: ls(1) },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 14 },
  inviteCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 8, alignItems: 'center' },
  inviteTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  inviteBody: { color: colors.dim, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  code: { color: colors.yellow, fontSize: 24, fontWeight: '800', letterSpacing: ls(4), marginVertical: 4 },
  addedBy: { color: colors.faint, fontSize: 11, marginTop: 4 },
  seers: { position: 'absolute', bottom: 5, start: 5, flexDirection: 'row', alignItems: 'center' },
  seer: { borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.55)' },
  seerMore: { color: '#FFF', fontSize: 10, fontWeight: '800', marginStart: 3, textShadowColor: '#000', textShadowRadius: 4 },
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
});
