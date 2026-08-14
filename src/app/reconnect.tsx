/**
 * The people you knew on TV Time, and which of them are here.
 *
 * THE MATCHING ALREADY EXISTED; THE SCREEN DID NOT. `reconcileFriends` has been
 * running since accounts shipped, but its only surface was the seed sheet —
 * a screen most people see once, during joining, before anyone they know has an
 * account. So the answer was computed, stored, and shown to nobody. Two people
 * who were friends in 2019 had no way to find each other.
 *
 * NOTHING NEW IS SENT FROM HERE. Pull-to-refresh calls the same
 * `reconcileFriends` the app already calls: numeric ids from the user's own
 * export, and nothing else. It is the unconditional one rather than
 * `maybeReconcileFriends` because the fingerprint asks "has MY list changed",
 * and the reason to open this screen is usually that somebody ELSE's account
 * changed — a friend said they joined. Refusing to look because our own library
 * is unchanged would be answering a different question.
 *
 * THE EMPTY STATE IS THE MAIN STATE, not an edge case. With 22 accounts on the
 * server, almost everybody who opens this has nobody here yet, and they deserve
 * a sentence that says which of three things is true rather than a blank list
 * or "0 friends found".
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';

import {
  canReconcile,
  lastFriendMatches,
  reconcileFriends,
  type FriendMatch,
} from '@/community-seed';
import { useJoined } from '@/community-session';
import { FollowChip, PersonRow } from '@/components/person-row';
import { NavHeader, Screen } from '@/components/ui';
import { getMeta, setMeta } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { RECONNECT_SEEN_KEY, unmatchedArchiveFriends } from '@/pure';
import { colors, radius, space } from '@/theme';

/** A friend as the importer stored them: an id, and whatever name the export had. */
type ArchiveFriend = { id: string; name: string | null };

function archiveFriends(): ArchiveFriend[] {
  try {
    const raw = JSON.parse(getMeta('tvtimeFollowingNames') ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as ArchiveFriend[]) : [];
  } catch {
    return [];
  }
}

/** Section header, match row, or a name that has not arrived. One FlatList. */
type Row =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'match'; key: string; match: FriendMatch }
  | { kind: 'absent'; key: string; name: string };

/** Somebody with no account: a letter, their name, and a way to ask them along. */
function AbsentRow({ name, onInvite }: { name: string; onInvite: () => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarLetter}>{(name[0] ?? '?').toUpperCase()}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Pressable style={styles.invite} onPress={onInvite} hitSlop={6}>
        <Text style={styles.inviteText}>{t('following.invite')}</Text>
      </Pressable>
    </View>
  );
}

export default function ReconnectScreen() {
  const joined = useJoined();
  // Read on focus into state, never in render: the Compiler memoises a bare
  // getMeta against its arguments, and the matches change under this screen —
  // a reconcile finishing, or the seed sheet running one. See CLAUDE.md.
  const [matches, setMatches] = useState<FriendMatch[]>(lastFriendMatches);
  const [archive, setArchive] = useState<ArchiveFriend[]>(archiveFriends);
  const [hasExport, setHasExport] = useState(canReconcile);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const found = lastFriendMatches();
      setMatches(found);
      setArchive(archiveFriends());
      setHasExport(canReconcile());
      // Opening the list IS seeing them, so the profile banner for this set is
      // spent. Stamped with the count, not a flag: a friend who joins next
      // month is a new thing to say.
      if (found.length > 0) setMeta(RECONNECT_SEEN_KEY, String(found.length));
    }, []),
  );

  const refresh = () => {
    setRefreshing(true);
    void reconcileFriends()
      .then(setMatches)
      .finally(() => setRefreshing(false));
  };

  /** Ask somebody along. Nothing is sent on their behalf — the user picks the
   *  app and the words; the app only knows a name from the export. */
  const invite = (name?: string) => {
    tapLight();
    void Share.share({
      message: name == null ? t('community.reconnect.inviteMessage') : t('following.inviteMessage', { name }),
    }).catch(() => {});
  };

  const absent = unmatchedArchiveFriends(archive, matches);
  const rows: Row[] = [];
  if (matches.length > 0) {
    rows.push({ kind: 'header', key: 'h-here', title: t('community.reconnect.hereSection') });
    for (const m of matches) rows.push({ kind: 'match', key: `m-${m.handle}`, match: m });
  }
  if (absent.length > 0) {
    rows.push({ kind: 'header', key: 'h-absent', title: t('community.reconnect.notHereSection') });
    for (const f of absent) {
      rows.push({ kind: 'absent', key: `a-${f.id}`, name: f.name || t('following.defaultMemberName') });
    }
  }

  /**
   * THREE SITUATIONS, THREE SENTENCES — never a blank screen, and never
   * "0 friends found", which is a headline that blames the reader for arriving
   * early.
   *
   *  noExport  — there is no friend list to search at all. The only useful
   *              thing to say is where one comes from, with the way to get it.
   *  noneYet   — the common case today: a list, and nobody on it has joined.
   *              It ends in a promise (they are found automatically) so that
   *              nobody feels they must come back and check.
   *  allHere   — everybody arrived. Said once, under the list, rather than as
   *              an empty section that looks like a bug.
   */
  const empty =
    !hasExport && archive.length === 0
      ? ('noExport' as const)
      : matches.length === 0
        ? ('noneYet' as const)
        : absent.length === 0
          ? ('allHere' as const)
          : null;

  return (
    <Screen>
      <NavHeader title={t('community.reconnect.title')} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingBottom: space.xl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.dim} />
        }
        ListHeaderComponent={
          <View>
            {/* Reachable without an account on purpose — this is a reason to
                join, not a reward for having joined. The same string the public
                profile uses, so the two cannot drift. */}
            {!joined && (
              <Pressable style={styles.card} onPress={() => router.push('/join')}>
                <Text style={styles.cardText}>{t('community.profile.joinToFollow')}</Text>
              </Pressable>
            )}

            {empty === 'noExport' && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>{t('community.reconnect.noExportTitle')}</Text>
                <Text style={styles.emptyBody}>{t('community.reconnect.noExportBody')}</Text>
                <Pressable
                  style={styles.cta}
                  onPress={() => {
                    tapLight();
                    router.push('/import');
                  }}>
                  <Text style={styles.ctaText}>{t('community.reconnect.importCta')}</Text>
                </Pressable>
              </View>
            )}

            {empty === 'noneYet' && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>{t('community.reconnect.noneYetTitle')}</Text>
                <Text style={styles.emptyBody}>{t('community.reconnect.noneYetBody')}</Text>
                <Pressable style={styles.cta} onPress={() => invite()}>
                  <Text style={styles.ctaText}>{t('community.reconnect.inviteCta')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        }
        ListFooterComponent={
          empty === 'allHere' ? <Text style={styles.note}>{t('community.reconnect.allHere')}</Text> : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'header') return <Text style={styles.section}>{item.title}</Text>;
          if (item.kind === 'absent') {
            return <AbsentRow name={item.name} onInvite={() => invite(item.name)} />;
          }
          const m = item.match;
          return (
            <PersonRow
              person={{ handle: m.handle, display_name: m.display_name, avatar_key: m.avatar_key }}
              onPress={() => router.push(`/profile/${encodeURIComponent(m.handle)}`)}
              // A row stored by a build older than the id field has no button
              // rather than a dead one — the same rule the seed sheet follows.
              right={m.id ? <FollowChip id={m.id} /> : undefined}
            />
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.lg,
    marginTop: 6,
    backgroundColor: '#26220E',
    borderRadius: radius.card,
    padding: 14,
  },
  cardText: { color: '#E3E3E8', fontSize: 13.5, lineHeight: 19 },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  emptyBox: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  emptyBody: { color: colors.dim, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  ctaText: { color: colors.onYellow, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  note: { color: colors.dim, fontSize: 13.5, lineHeight: 19, paddingHorizontal: space.lg, marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: colors.yellow, fontWeight: '800' },
  name: { color: colors.text, fontSize: 15.5, fontWeight: '600', flex: 1 },
  invite: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  inviteText: { color: colors.onYellow, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5 },
});
