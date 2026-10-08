/**
 * Seasonal look — pick the avatar decoration and the season's theme template.
 * Everybody while the event is on; Plus at any time (see `season.ts`).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ContentColumn, MenuRow, NavHeader, Screen } from '@/components/ui';
import { tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { usePlus } from '@/plus';
import {
  activeEvent,
  availableSeasons,
  chosenTheme,
  currentDecoration,
  seasonalOn,
  setDecoration,
  setSeasonalOn,
  setTheme,
  type SeasonId,
} from '@/season';
import { colors, radius, space } from '@/theme';

export default function SeasonalScreen() {
  const plus = usePlus();
  const [on, setOn] = useState(() => seasonalOn());
  const [deco, setDeco] = useState(() => currentDecoration(plus));
  const [theme, setThemeState] = useState<SeasonId | null>(() => chosenTheme());
  const seasons = availableSeasons(plus);
  const event = activeEvent();

  const pickDeco = (e: string) => {
    tapSelection();
    setDecoration(e);
    setDeco(e || null);
  };
  const pickTheme = (id: SeasonId | null) => {
    tapSelection();
    setTheme(id);
    setThemeState(id);
  };

  return (
    <Screen>
      <NavHeader title={t('seasonal.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <ContentColumn>
          <MenuRow
            trackId="seasonal.switch"
            title={t('settings.app.seasonal')}
            sub={t('seasonal.switchSub')}
            right={
              <Switch
                value={on}
                onValueChange={(v) => {
                  setOn(v);
                  setSeasonalOn(v);
                }}
                trackColor={{ true: colors.green }}
              />
            }
          />

          {on && seasons.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyText}>{t('seasonal.nothingNow')}</Text>
              <Pressable onPress={() => router.push('/paywall?from=seasonal')}>
                <Text style={s.link}>{t('seasonal.plusKeeps')}</Text>
              </Pressable>
            </View>
          )}

          {on &&
            seasons.map((season) => (
              <View key={season.id} style={{ gap: space.sm }}>
                <Text style={s.label}>
                  {t(`seasonal.${season.id}`)}
                  {event?.id === season.id ? `  ·  ${t('seasonal.now')}` : ''}
                </Text>
                <View style={s.decoRow}>
                  {season.decorations.map((e) => (
                    <Pressable key={e} style={[s.deco, deco === e && s.decoOn]} onPress={() => pickDeco(e)} accessibilityLabel={e}>
                      <Text style={s.decoText}>{e}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  style={[s.themeCard, theme === season.id && s.themeOn]}
                  onPress={() => pickTheme(theme === season.id ? null : season.id)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: theme === season.id }}>
                  <View style={[s.swatch, { borderColor: season.ring }]}>
                    <Text style={{ fontSize: 22 }}>{season.effect}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.themeTitle}>{t('seasonal.themeTitle', { name: t(`seasonal.${season.id}`) })}</Text>
                    <Text style={s.themeSub}>{t('seasonal.themeSub')}</Text>
                  </View>
                  <Text style={[s.themeState, theme === season.id && { color: colors.green }]}>
                    {theme === season.id ? t('seasonal.on') : t('seasonal.off')}
                  </Text>
                </Pressable>
              </View>
            ))}

          {on && seasons.length > 0 && (
            <Pressable style={s.none} onPress={() => pickDeco('')}>
              <Text style={s.link}>{t('seasonal.noDecoration')}</Text>
            </Pressable>
          )}
          {on && !plus && seasons.length > 0 && <Text style={s.note}>{t('seasonal.freeNote')}</Text>}
        </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  label: { color: colors.dim, fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginHorizontal: space.lg, marginTop: space.lg },
  decoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: space.lg },
  deco: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  decoOn: { borderColor: colors.yellow },
  decoText: { fontSize: 26 },
  themeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: space.lg, padding: 12, borderRadius: radius.card, backgroundColor: colors.card, borderWidth: 2, borderColor: 'transparent' },
  themeOn: { borderColor: colors.yellow },
  swatch: { width: 54, height: 54, borderRadius: 27, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  themeTitle: { color: colors.text, fontSize: 15.5, fontWeight: '800' },
  themeSub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  themeState: { color: colors.dim, fontSize: 13, fontWeight: '800' },
  none: { alignSelf: 'center', marginTop: space.lg },
  link: { color: colors.blue, fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: space.md, marginHorizontal: space.xl },
  empty: { alignItems: 'center', gap: 10, marginTop: space.xl, paddingHorizontal: space.xl },
  emptyText: { color: colors.dim, fontSize: 14.5, textAlign: 'center' },
});
