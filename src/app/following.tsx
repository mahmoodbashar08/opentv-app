import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, type ImageSourcePropType, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { avatarUri } from '@/community-comments';
import { fetchFollowers, fetchFollowing, type ProfileEdge } from '@/community-profiles';
import { lastFriendMatches } from '@/community-seed';
import { getProfileId, useJoined } from '@/community-session';
import { NavHeader, Screen } from '@/components/ui';
import { social } from '@/bundled-data';
import { getMeta } from '@/db';
import { documentFileUri, isSeedLibrary } from '@/library';
import { mixHex, mergeFollowList } from '@/pure';
import { tapLight } from '@/haptics';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

// imported libraries: names + avatars mined from the export's notifications;
// image = downloaded local copy, imageUrl = original CDN link
type Person = { id: string; name: string | null; image: string | null; imageUrl?: string | null };
function metaPeople(key: string): Person[] {
  try {
    return JSON.parse(getMeta(key) ?? '[]') as Person[];
  } catch {
    return [];
  }
}

// legacy seed libraries only — public builds always read the imported lists
const FOLLOWING: string[] = [];

// avatars rescued from TV Time's CDN before shutdown — static require map
const AVATARS: Record<string, ImageSourcePropType> = {
  '52613783.jpg': require('../../assets/social/52613783.jpg'),
  '54345991.jpg': require('../../assets/social/54345991.jpg'),
};

function Row({
  name,
  avatar,
  uri,
  handle,
  onInvite,
}: {
  name: string;
  avatar?: string | null;
  uri?: string | null;
  /** Present when this person is on OpenTV — the row opens their profile. */
  handle?: string | null;
  /** Present otherwise — the row offers to ask them along. */
  onInvite?: () => void;
}) {
  const body = (
    <>
      {avatar && AVATARS[avatar] ? (
        <Image source={AVATARS[avatar]} style={styles.avatarImg} />
      ) : uri ? (
        <Image source={{ uri }} style={styles.avatarImg} />
      ) : (
        <View style={styles.avatar}>
          <Text style={{ color: colors.yellow, fontWeight: '800' }}>{(name[0] ?? '?').toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {/* The invite is the point of showing somebody who is not here: these are
          the people the user actually wants to find, and the app knows their
          name and face from the export but has no way to reach them. So it
          hands the user the share sheet and gets out of the way — nothing is
          sent on anyone's behalf, and no address is needed, because the user
          knows how to reach their own friend. */}
      {!handle && onInvite && (
        <Pressable style={styles.invite} onPress={onInvite} hitSlop={6}>
          <Text style={styles.inviteText}>{t('following.invite')}</Text>
        </Pressable>
      )}
    </>
  );
  return handle ? (
    <Pressable style={styles.row} onPress={() => router.push(`/profile/${encodeURIComponent(handle)}`)}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.row}>{body}</View>
  );
}

export default function FollowingScreen() {
  // opened from the profile stats: "following" or "followers" — one list only
  const { type } = useLocalSearchParams<{ type?: string }>();
  const showFollowers = type === 'followers';
  const seedLib = isSeedLibrary();
  const joined = useJoined();
  const importedFollowing = metaPeople('tvtimeFollowingNames');
  const importedFollowers = metaPeople('tvtimeFollowers');

  /**
   * The OpenTV side of the same list.
   *
   * Empty for somebody who has not joined, and that is the whole behaviour:
   * their screen keeps showing their TV Time people and makes no request. The
   * merge below then reduces to the archive alone.
   */
  const [community, setCommunity] = useState<{ handle: string; display_name: string | null; avatar_key: string | null }[]>([]);
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    const mine = getProfileId();
    void (async () => {
      const page = showFollowers
        ? await fetchFollowers(getMeta('communityHandle') ?? '').catch(() => null)
        : await fetchFollowing().catch(() => null);
      if (cancelled || !page) return;
      setCommunity(
        page.items
          .filter((p: ProfileEdge) => p.id !== mine)
          .map((p: ProfileEdge) => ({ handle: p.handle, display_name: p.display_name, avatar_key: p.avatar_key })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, showFollowers]);


  // The demo library's people, in the same shape the imported ones arrive in,
  // so the merge below has one input and not two.
  const seedArchive = showFollowers
    ? social.followers.map((f) => ({ id: f.id, name: f.name, image: null as string | null }))
    : FOLLOWING.map((name) => ({ id: name, name, image: null as string | null }));
  const archive = seedLib ? seedArchive : showFollowers ? importedFollowers : importedFollowing;
  // TV Time reported a follower count larger than the names it exported. The
  // difference is real people whose names are nowhere in the file, so they are
  // counted honestly rather than invented.
  const unnamed = seedLib && showFollowers ? social.followersTotal - social.followers.length : 0;

  /**
   * ONE list. A user's TV Time friends and their OpenTV follows are not two
   * audiences — they are one set of people, some of whom have arrived. Kept
   * separate (which is what this screen did) the count under a profile reads
   * "0 following" to somebody with ten friends, and the people they came here
   * to find look like they do not exist. See `mergeFollowList`.
   */
  const rows = mergeFollowList(
    archive,
    community,
    lastFriendMatches(),
    t('following.defaultMemberName'),
  );

  /** Ask somebody who is not here yet. Nothing is sent on their behalf — this
   *  opens the share sheet and the user chooses the app and the words. */
  const invite = (name: string) => {
    tapLight();
    void Share.share({ message: t('following.inviteMessage', { name }) }).catch(() => {});
  };

  return (
    <Screen>
      <NavHeader
        title={showFollowers ? t('following.followersTitle') : t('following.followingTitle')}
        right={
          <Ionicons name="person-add-outline" size={20} color={colors.text} onPress={() => router.push('/find-people')} />
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/*
          NOT "COMING SOON". It said "follows go live when accounts arrive",
          which was written before they arrived and is now false for everyone:
          a member is already following people, and a non-member is not waiting
          for a launch — they are one tap from joining. Telling them to wait for
          something that shipped is how a working feature goes unused.

          `joinToFollow` is the string the public profile already uses for this
          exact situation, so it needs no new translation and the two screens
          cannot drift. Tappable, because naming the way in and not offering it
          is its own kind of dead end.
        */}
        {!joined && (
          <Pressable style={styles.soonCard} onPress={() => router.push('/join')}>
            <Text style={styles.soonText}>{t('community.profile.joinToFollow')}</Text>
          </Pressable>
        )}

        <Text style={styles.sectionTitle}>
          {showFollowers
            ? t('following.followersSection', { count: rows.length })
            : t('following.followingSection', { count: rows.length })}
        </Text>
        {rows.map((r) => (
          <Row
            key={r.key}
            name={r.name}
            uri={r.avatarKey ? avatarUri(r.avatarKey) : (documentFileUri(r.image) ?? r.imageUrl)}
            handle={r.handle}
            onInvite={() => invite(r.name)}
          />
        ))}
        {unnamed > 0 && <Text style={styles.note}>{t('following.unnamedNote', { count: unnamed })}</Text>}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  invite: {
    marginLeft: 'auto',
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  inviteText: { color: colors.onYellow, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5 },
  soonCard: {
    marginHorizontal: space.lg,
    marginTop: 6,
    backgroundColor: mixHex(colors.bg, colors.brand, 0.14),
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  soonBadge: { color: colors.yellow, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  soonText: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: space.lg, paddingVertical: 12 },
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
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.raise },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  note: { color: colors.dim, fontSize: 13.5, lineHeight: 19, paddingHorizontal: space.lg, marginTop: 8 },
});
