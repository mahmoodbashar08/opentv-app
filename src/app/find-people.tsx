import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useJoined } from '@/community-session';
import { MenuRow, NavHeader, Screen } from '@/components/ui';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

export default function FindPeopleScreen() {
  const joined = useJoined();
  return (
    <Screen>
      <NavHeader title={t('findPeople.title')} />
      {/*
        Same rule as the following screen: "finding friends goes live when
        accounts arrive" is only true for somebody who has not joined. The rows
        under it are X and Contacts, which really are still unbuilt — their own
        "soon" values say so — so a member is told what is coming without being
        told the whole feature has not shipped.
      */}
      {!joined && (
        <View style={styles.soonCard}>
          <Text style={styles.soonBadge}>{t('findPeople.comingSoonBadge')}</Text>
          <Text style={styles.soonText}>{t('findPeople.comingSoonText')}</Text>
        </View>
      )}
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
    backgroundColor: '#26220E',
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  soonBadge: { color: colors.yellow, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  soonText: { color: '#E3E3E8', fontSize: 13.5, lineHeight: 19 },
});
