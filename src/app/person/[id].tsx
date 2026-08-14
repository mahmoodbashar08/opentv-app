/**
 * An actor: who they are, and everything they are in.
 *
 * REPORTED, NOT INVENTED. "When I click on the actors' names or photos, it
 * doesn't work — usually it displays a brief bio and all the movies and TV
 * shows associated with them." The Cast row on a show has been a row of plain
 * Views since it was built, so every tap on it did nothing, and the thing a
 * tap should open did not exist. This is it.
 *
 * WHY THETVDB AND NOT TMDB. The cast shown on a show page comes from TheTVDB —
 * that is what made anime credit the character's actual performer instead of a
 * voice actor — so the ids in hand are TheTVDB's, and following them keeps one
 * source answering one question. `/people/{id}/extended` carries the biography
 * and the credits in a single request.
 *
 * NOT EVERY CARD CAN OPEN. Cast cached before `personId` existed has no id to
 * follow. Those cards stay flat rather than opening a screen that would have
 * nothing to fetch — and `showMetaIsStale` forces one refetch per show, so they
 * heal on their own.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { artworkUrl, personCredits, personLife, pickBiography, type PersonCredit } from '@/pure';
import { colors, radius, space } from '@/theme';
import { tvdbPerson, type TvdbPerson } from '@/tvdb';

export default function PersonScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const personId = Number(id);

  const [person, setPerson] = useState<TvdbPerson | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await tvdbPerson(personId);
      if (!alive) return;
      setPerson(p);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [personId]);

  // The name from the card we came from, shown while the request is in flight
  // so the header is never a spinner over an empty title.
  const title = person?.name ?? name ?? '';
  const bio = pickBiography(person?.biographies ?? []);
  const life = personLife(person ?? {});
  const credits = personCredits(person?.characters ?? []);

  return (
    <Screen>
      <NavHeader title={title} />
      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.yellow} />
        </View>
      ) : !person ? (
        <View style={styles.centre}>
          <Ionicons name="person-outline" size={34} color={colors.faint} />
          <Text style={styles.empty}>{t('person.unavailable')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={styles.head}>
            <View style={styles.photo}>
              {person.image ? (
                <Image source={{ uri: artworkUrl(person.image) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
              ) : (
                <Ionicons name="person" size={40} color="#5A5A60" />
              )}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.name}>{title}</Text>
              {life ? <Text style={styles.life}>{life}</Text> : null}
              {person.birthPlace ? <Text style={styles.place}>{person.birthPlace}</Text> : null}
            </View>
          </View>

          {bio ? (
            <View style={styles.section}>
              <Text style={styles.h2}>{t('person.biography')}</Text>
              <Text style={styles.body}>{bio}</Text>
            </View>
          ) : null}

          {credits.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.h2}>{t('person.knownFor', { count: credits.length })}</Text>
              <View style={{ gap: 2 }}>
                {credits.map((c) => (
                  <CreditRow key={`${c.kind}-${c.id}-${c.role ?? ''}`} credit={c} />
                ))}
              </View>
            </View>
          ) : (
            <Text style={[styles.empty, { marginTop: 30 }]}>{t('person.noCredits')}</Text>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

/** One credit. Series open in the app; films have no TheTVDB-keyed screen to
 *  open, so they are listed and not pressable rather than pressable and dead. */
function CreditRow({ credit }: { credit: PersonCredit }) {
  const openable = credit.kind === 'series';
  return (
    <Pressable
      style={styles.row}
      disabled={!openable}
      onPress={() => router.push(`/show/${credit.id}`)}>
      <View style={styles.thumb}>
        {credit.image ? (
          <Image source={{ uri: artworkUrl(credit.image) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
        ) : (
          <Ionicons name={credit.kind === 'movie' ? 'film-outline' : 'tv-outline'} size={18} color={colors.faint} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {credit.name}
        </Text>
        {credit.role ? (
          <Text style={styles.rowRole} numberOfLines={1}>
            {credit.role}
          </Text>
        ) : null}
      </View>
      {credit.year ? <Text style={styles.rowYear}>{credit.year}</Text> : null}
      {openable ? <Ionicons name="chevron-forward" size={16} color={colors.faint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  empty: { color: colors.dim, fontSize: 14, textAlign: 'center', paddingHorizontal: space.lg },
  head: { flexDirection: 'row', gap: 14, paddingHorizontal: space.lg, paddingTop: 6, alignItems: 'center' },
  photo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  name: { color: colors.text, fontSize: 22, fontWeight: '800' },
  life: { color: colors.dim, fontSize: 13.5 },
  place: { color: colors.faint, fontSize: 13 },
  section: { paddingHorizontal: space.lg, marginTop: 24, gap: 10 },
  h2: { color: colors.text, fontSize: 16, fontWeight: '800' },
  body: { color: colors.dim, fontSize: 14.5, lineHeight: 21 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  thumb: {
    width: 40,
    height: 58,
    borderRadius: 6,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowRole: { color: colors.faint, fontSize: 12.5, marginTop: 2 },
  rowYear: { color: colors.dim, fontSize: 13, fontVariant: ['tabular-nums'] },
});
