/**
 * Watching together on a show page: the faces, where each one is, and one
 * line saying who is ahead (DESIGN-community §2.2). Tap → the together itself.
 *
 * DRAWN ONLY WHEN THERE IS ONE. Everybody else — not joined, joined but in no
 * together, or in one about another show — gets nothing at all, and nothing is
 * fetched for them (`useTogethersFor` returns before any I/O).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import type { SharedListDetail } from '@/community-shared-lists';
import { useTogethersFor } from '@/community-together';
import { MemberDot, memberName } from '@/components/shared-members';
import { t } from '@/i18n';
import { showMeta } from '@/metadata';
import { colors, radius, space, ls } from '@/theme';
import { comparePositions, positionLabel, togetherSummary, type Position } from '@/together-pure';

/** Each member with their cursor, furthest first, from one together's detail. */
export function togetherMembers(d: SharedListDetail) {
  const positions = d.items[0]?.positions ?? [];
  return d.members
    .map((m) => {
      const p = positions.find((x) => x.member_id === m.id);
      return { member: m, position: p ? ({ season: p.season, episode: p.episode } as Position) : null };
    })
    .sort((a, b) => comparePositions(a.position, b.position));
}

/** "S2E4" or "Not started". */
export const positionText = (p: Position | null): string => positionLabel(p) ?? t('together.notStarted');

/** The one sentence under the faces. */
export function togetherSummaryText(d: SharedListDetail): string {
  const seasons = showMeta(Number(d.items[0]?.target_key))?.seasons ?? {};
  const counts: Record<number, number | undefined> = {};
  for (const [n, s] of Object.entries(seasons)) counts[Number(n)] = s?.count;
  const s = togetherSummary(
    togetherMembers(d).map(({ member, position }) => ({ name: memberName(member), isMe: member.is_me, position })),
    counts,
  );
  switch (s.kind) {
    case 'ahead':
      return t('together.ahead', { name: s.name, count: s.count });
    case 'behind':
      return t('together.behind', { name: s.name, count: s.count });
    case 'level':
      return t('together.level', { name: s.name });
    case 'labels':
      return t('together.labels', { name: s.name, theirs: positionText(s.theirs), mine: positionText(s.mine) });
    default:
      return t('together.alone');
  }
}

export function TogetherStrip({ tvdbId }: { tvdbId: number }) {
  const lists = useTogethersFor(tvdbId);
  if (lists.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {lists.map((d) => {
        const rows = togetherMembers(d);
        const summary = togetherSummaryText(d);
        return (
          <Pressable
            key={d.id}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={[
              t('together.title'),
              summary,
              ...rows.map((r) => `${memberName(r.member)}, ${positionText(r.position)}`),
            ].join('. ')}
            onPress={() => router.push(`/shared/${encodeURIComponent(d.id)}`)}>
            <View style={styles.faces}>
              {rows.slice(0, 5).map(({ member, position }) => (
                <View key={member.id} style={styles.face}>
                  <MemberDot member={member} size={30} ring={member.is_me} />
                  <Text style={[styles.pos, member.is_me && styles.posMe]} numberOfLines={1}>
                    {positionText(position)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.kicker}>{t('together.title')}</Text>
              <Text style={styles.summary} numberOfLines={2}>
                {summary}
              </Text>
            </View>
            <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.faint} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: 10, gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  faces: { flexDirection: 'row', gap: 6 },
  face: { alignItems: 'center', gap: 3, minWidth: 34 },
  pos: { color: colors.dim, fontSize: 10.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  posMe: { color: colors.yellow },
  kicker: { color: colors.faint, fontSize: 11, fontWeight: '700', letterSpacing: ls(0.6), textTransform: 'uppercase' },
  summary: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
