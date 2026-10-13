/**
 * The people in a shared list, drawn the same way everywhere they appear: an
 * ordinary list, a together, and the strip on a show page. One family, so a
 * together reads as a shared list that happens to hold one show.
 *
 * NAMES, NOT JUST FACES (CHANGELOG 2.0.0 item 19). The row used to be 24px
 * circles and "3 members" — the part that makes a shared list worth having,
 * reduced to a count. Each person now carries their name and the one number
 * that matters to the others: how much of the list they have seen, or, in a
 * together, which episode they are on.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { avatarUri } from '@/community-comments';
import type { SharedMember } from '@/community-shared-lists';
import { t } from '@/i18n';
import { colors } from '@/theme';

/** "You", or the name they chose, or their handle. */
export function memberName(m: Pick<SharedMember, 'is_me' | 'display_name' | 'handle'>): string {
  return m.is_me ? t('shared.you') : m.display_name?.trim() || `@${m.handle}`;
}

/**
 * One member, as a circle. Their picture when there is one and their initial
 * when there is not — avatars are not always served, and a letter is the true
 * state of the world rather than a spinner that never resolves.
 */
export function MemberDot({ member, size = 24, ring }: { member: SharedMember; size?: number; ring?: boolean }) {
  const uri = avatarUri(member.avatar_key);
  const box = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: colors.card,
    // Yours, outlined in the colour that acts, so you find yourself at a glance.
    ...(ring ? { borderWidth: 2, borderColor: colors.yellow } : null),
  };
  if (uri) return <Image source={{ uri }} style={box} contentFit="cover" cachePolicy="disk" />;
  return (
    <View style={[box, styles.letter]}>
      <Text style={[styles.letterText, { fontSize: Math.max(9, size * 0.42) }]}>
        {(member.display_name?.[0] ?? member.handle[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * A row of people with a line under each name. Horizontal and short: a shared
 * list holds at most twenty people and a together five, and the list itself
 * must stay above the fold.
 */
export function MembersStrip({
  rows,
  onInvite,
}: {
  rows: { member: SharedMember; label: string }[];
  /** The owner's "+" at the end of the row: inviting is where a shared list starts. */
  onInvite?: () => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {rows.map(({ member, label }) => (
        <View
          key={member.id}
          style={styles.chip}
          // One stop per person, said as one sentence.
          accessible
          accessibilityLabel={`${memberName(member)}, ${label}`}>
          <MemberDot member={member} size={44} ring={member.is_me} />
          <Text style={[styles.name, member.is_me && styles.nameMe]} numberOfLines={1}>
            {memberName(member)}
          </Text>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ))}
      {onInvite != null && (
        <Pressable style={styles.chip} accessibilityRole="button" accessibilityLabel={t('sharedLists.inviteAction')} onPress={onInvite}>
          <View style={styles.invite}>
            <Ionicons name="person-add" size={18} color={colors.yellow} />
          </View>
          <Text style={[styles.name, styles.nameMe]} numberOfLines={1}>
            {t('sharedLists.invite')}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 14, paddingVertical: 2 },
  chip: { alignItems: 'center', width: 68, gap: 3 },
  name: { color: colors.text, fontSize: 12.5, fontWeight: '700', marginTop: 3, maxWidth: 68 },
  nameMe: { color: colors.yellow },
  label: { color: colors.dim, fontSize: 11.5, fontVariant: ['tabular-nums'] },
  invite: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { alignItems: 'center', justifyContent: 'center' },
  letterText: { color: colors.text, fontWeight: '800' },
});
