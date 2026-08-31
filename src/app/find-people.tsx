import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useJoined } from '@/community-session';
import { MenuRow, NavHeader, Screen } from '@/components/ui';
import { mixHex } from '@/pure';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

export default function FindPeopleScreen() {
  const joined = useJoined();
  return (
    <Screen>
      <NavHeader title={t('findPeople.title')} />
      {/*
        Same correction as the following screen: "finding friends goes live when
        accounts arrive" describes a launch that has already happened. A member
        can search for people right now; a non-member is one tap from being able
        to. Reuses the string the public profile shows in the same situation, so
        there is nothing new to translate and the screens cannot drift.

        The X and Contacts rows below keep their own per-row "soon" values —
        those really are unbuilt, and saying so there is honest.
      */}
      {!joined && (
        <Pressable style={styles.soonCard} onPress={() => router.push('/join')}>
          <Text style={styles.soonText}>{t('community.profile.joinToFollow')}</Text>
        </Pressable>
      )}
      {/* ABOVE the two "soon" rows, because this one is not soon — it has been
          working since accounts shipped and had no way in. */}
      <MenuRow trackId="findPeople.reconnect"
        title={t('community.reconnect.title')}
        sub={t('community.reconnect.findRowSub')}
        onPress={() => router.push('/reconnect')}
        icon={
          <View style={[styles.icon, { backgroundColor: colors.yellow }]}>
            <Ionicons name="people" size={16} color={colors.onYellow} />
          </View>
        }
      />
      <MenuRow trackId="findPeople.findX"
        title={t('findPeople.findX')}
        value={t('findPeople.soonValue')}
        icon={
          <View style={[styles.icon, { backgroundColor: '#FFF' }]}>
            <Text style={{ fontWeight: '800', color: '#000' }}>X</Text>
          </View>
        }
      />
      <MenuRow trackId="findPeople.findContacts"
        title={t('findPeople.findContacts')}
        value={t('findPeople.soonValue')}
        icon={
          <View style={[styles.icon, { backgroundColor: colors.yellow }]}>
            <Ionicons name="person" size={16} color={colors.onYellow} />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  soonCard: {
    marginHorizontal: space.lg,
    marginTop: 6,
    marginBottom: 10,
    backgroundColor: mixHex(colors.bg, colors.brand, 0.14),
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  soonBadge: { color: colors.yellow, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  soonText: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
});
