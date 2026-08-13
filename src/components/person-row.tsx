/**
 * A person, as a circle and a line of text. Shared by the profile screen, the
 * Users tab in search, and the notification inbox, so the three cannot drift
 * into three different ideas of what somebody looks like.
 *
 * THE LETTER IS THE REAL STATE OF THE WORLD, not a loading placeholder. The
 * Worker has no R2 binding yet, so `avatar_key` is an object key with no base
 * URL to join it to and there is nothing to fetch. `avatarUri` (Phase 4) passes
 * an absolute URL through and returns null for everything else, so the day
 * avatars go live this file needs no change at all.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { avatarUri } from '@/community-comments';
import { communityErrorText } from '@/community-error-text';
import { follow, unfollow } from '@/community-profiles';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, space } from '@/theme';

export type AvatarPerson = { handle: string; avatar_key: string | null };

/**
 * The circle. `size` is the diameter — the profile header wants a big one, a
 * row wants a small one, and the letter scales with it rather than floating in
 * the middle of an oversized disc.
 */
export function CommunityAvatar({ person, size = 40 }: { person: AvatarPerson; size?: number }) {
  const uri = avatarUri(person.avatar_key);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[styles.avatar, box]} contentFit="cover" cachePolicy="disk" />;
  }
  return (
    <View style={[styles.avatar, styles.letter, box]}>
      <Text style={[styles.letterText, { fontSize: size * 0.44 }]}>
        {(person.handle[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * One tappable person: avatar, display name (falling back to the handle), the
 * handle underneath, and an optional trailing slot for a Follow button.
 *
 * `flexDirection: 'row'` mirrors under `I18nManager.isRTL` on its own, so this
 * reads right-to-left in Arabic with no per-language branch; the chevron is the
 * one thing that has to be chosen by hand.
 */
export function PersonRow({
  person,
  sub,
  right,
  onPress,
}: {
  person: AvatarPerson & { display_name: string | null };
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <CommunityAvatar person={person} size={44} />
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {person.display_name || `@${person.handle}`}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub ?? `@${person.handle}`}
        </Text>
      </View>
      {right ?? (
        onPress ? (
          <Ionicons
            name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'}
            size={18}
            color={colors.faint}
          />
        ) : null
      )}
    </Pressable>
  );
}

/**
 * Follow, from a list, without opening the profile first.
 *
 * OPTIMISTIC AND REVERSIBLE. The chip flips under the finger and rolls back if
 * the server refuses, which is the same contract the profile header's button
 * has — the two must not behave differently for the same act.
 *
 * NO INITIAL STATE FETCHED. The lists this appears in do not know whether you
 * already follow somebody, and asking per row would be a request per row. A
 * second follow is harmless server-side (the row already exists), so the worst
 * case is a chip that says Follow for somebody you already follow, and pressing
 * it changes nothing. Cheaper than N requests to be right about a rare case.
 */
export function FollowChip({ id }: { id: string }) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  const press = async () => {
    if (busy) return;
    tapLight();
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      if (next) await follow(id);
      else await unfollow(id);
    } catch (e) {
      setFollowing(!next);
      Alert.alert(t('community.profile.followFailedTitle'), communityErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={() => void press()}
      hitSlop={8}
      style={[styles.chip, following && styles.chipOn]}
      accessibilityRole="button">
      <Text style={[styles.chipText, following && styles.chipTextOn]}>
        {t(following ? 'community.profile.following' : 'community.profile.follow')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.raise },
  letter: { alignItems: 'center', justifyContent: 'center' },
  letterText: { color: colors.yellow, fontWeight: '800' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  rowText: { flex: 1 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.yellow,
  },
  // Followed is a state, not an action, so it stops shouting: the yellow is
  // spent on the thing still worth tapping.
  chipOn: { backgroundColor: colors.raise },
  chipText: { color: '#000', fontWeight: '800', fontSize: 12.5 },
  chipTextOn: { color: colors.dim },
  name: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  sub: { color: colors.faint, fontSize: 12.5, marginTop: 2 },
});
