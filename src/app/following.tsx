import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Image, type ImageSourcePropType, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { social } from '@/bundled-data';
import { getMeta } from '@/db';
import { documentFileUri, isSeedLibrary } from '@/library';
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
const personUri = (p: Person): string | null => documentFileUri(p.image) ?? p.imageUrl ?? null;

// legacy seed libraries only — public builds always read the imported lists
const FOLLOWING: string[] = [];

// avatars rescued from TV Time's CDN before shutdown — static require map
const AVATARS: Record<string, ImageSourcePropType> = {
  '52613783.jpg': require('../../assets/social/52613783.jpg'),
  '54345991.jpg': require('../../assets/social/54345991.jpg'),
};

function Row({ name, avatar, avatarUri }: { name: string; avatar?: string | null; avatarUri?: string | null }) {
  return (
    <View style={styles.row}>
      {avatar && AVATARS[avatar] ? (
        <Image source={AVATARS[avatar]} style={styles.avatarImg} />
      ) : avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
      ) : (
        <View style={styles.avatar}>
          <Text style={{ color: colors.yellow, fontWeight: '800' }}>{name[0].toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.name}>{name}</Text>
    </View>
  );
}

export default function FollowingScreen() {
  // opened from the profile stats: "following" or "followers" — one list only
  const { type } = useLocalSearchParams<{ type?: string }>();
  const showFollowers = type === 'followers';
  const seedLib = isSeedLibrary();
  const importedFollowing = metaPeople('tvtimeFollowingNames');
  const importedFollowers = metaPeople('tvtimeFollowers');
  const following: { key: string; name: string; avatarUri?: string | null }[] = seedLib
    ? FOLLOWING.map((name) => ({ key: name, name }))
    : importedFollowing.map((p) => ({ key: p.id, name: p.name ?? t('following.defaultMemberName'), avatarUri: personUri(p) }));
  const followers: { key: string; name: string; avatar?: string | null; avatarUri?: string | null }[] = seedLib
    ? social.followers.map((f) => ({ key: f.id, name: f.name, avatar: f.avatar }))
    : importedFollowers.map((p) => ({ key: p.id, name: p.name ?? t('following.defaultMemberName'), avatarUri: personUri(p) }));
  const followersTotal = seedLib ? social.followersTotal : importedFollowers.length;
  const unnamed = followersTotal - followers.length;

  return (
    <Screen>
      <NavHeader
        title={showFollowers ? t('following.followersTitle') : t('following.followingTitle')}
        right={
          <Ionicons name="person-add-outline" size={20} color={colors.text} onPress={() => router.push('/find-people')} />
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* social isn't live yet — say it up front */}
        <View style={styles.soonCard}>
          <Text style={styles.soonBadge}>{t('following.comingSoonBadge')}</Text>
          <Text style={styles.soonText}>{t('following.comingSoonText')}</Text>
        </View>

        {showFollowers ? (
          <>
            <Text style={styles.sectionTitle}>{t('following.followersSection', { count: followersTotal })}</Text>
            {followers.map((f) => (
              <Row key={f.key} name={f.name} avatar={f.avatar} avatarUri={f.avatarUri} />
            ))}
            {unnamed > 0 && (
              <Text style={styles.note}>{t('following.unnamedNote', { count: unnamed })}</Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('following.followingSection', { count: following.length })}</Text>
            {following.map((f) => (
              <Row key={f.key} name={f.name} avatarUri={f.avatarUri} />
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  soonCard: {
    marginHorizontal: space.lg,
    marginTop: 6,
    backgroundColor: '#26220E',
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  soonBadge: { color: colors.yellow, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  soonText: { color: '#E3E3E8', fontSize: 13.5, lineHeight: 19 },
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
