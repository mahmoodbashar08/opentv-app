/**
 * Seasonal look — a whole look at once, or every part of it on its own: what
 * sits on the avatar, the two at its foot, the ring and its glow, and what
 * crosses the banner. Free keeps or removes the event's own look while the
 * event lasts; changing any part is Plus (see `season.ts`).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { GlowRing, SeasonEffect } from '@/components/season-effect';
import { ContentColumn, MenuRow, NavHeader, Screen } from '@/components/ui';
import { getMeta } from '@/db';
import { tapSelection } from '@/haptics';
import { t } from '@/i18n';
import type { LocaleKey } from '@/locales/keys';
import { profileImageUri } from '@/library';
import { usePlus } from '@/plus';
import {
  activeEvent,
  applyPreset,
  availableSeasons,
  chosenTheme,
  currentDecoration,
  lookFor,
  seasonalOn,
  setDecoration,
  setPart,
  setSeasonalOn,
  setTheme,
  type Preset,
  type SeasonId,
  type SeasonLook,
} from '@/season';
import { colors, radius, space } from '@/theme';

const toPaywall = () => router.push('/paywall?from=seasonal');

export default function SeasonalScreen() {
  const plus = usePlus();
  const seasons = availableSeasons(plus);
  const event = activeEvent();
  const [on, setOn] = useState(() => seasonalOn());
  const [deco, setDeco] = useState(() => currentDecoration(plus));
  const [theme, setThemeState] = useState<SeasonId | null>(() => chosenTheme());
  const [rev, setRev] = useState(0);
  const [editing, setEditing] = useState<SeasonId | undefined>(() => chosenTheme() ?? event?.id ?? seasons[0]?.id);
  const season = seasons.find((x) => x.id === editing) ?? seasons[0];

  const refresh = () => {
    setDeco(currentDecoration(plus));
    setThemeState(chosenTheme());
    setRev((r) => r + 1);
  };
  // Every change puts the look on the profile — choosing part of a look you
  // cannot see would be choosing blind.
  const change = (fn: () => void) => {
    tapSelection();
    fn();
    if (season) setTheme(season.id);
    refresh();
  };
  const lockedPart = !plus;

  const avatarUri = profileImageUri('avatar');
  const initial = (getMeta('username') ?? '?')[0]?.toUpperCase() ?? '?';
  // `rev` is state React sets, so the compiler re-reads the stored parts after a change.
  const preview: SeasonLook | null = season ? lookFor(season, plus, rev) : null;
  const showing = theme === season?.id;

  return (
    <Screen>
      <NavHeader title={t('seasonal.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
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

          {on && !season && (
            <View style={s.empty}>
              <Text style={s.emptyText}>{t('seasonal.nothingNow')}</Text>
              <Pressable onPress={toPaywall}>
                <Text style={s.link}>{t('seasonal.plusKeeps')}</Text>
              </Pressable>
            </View>
          )}

          {on && season && preview && (
            <>
              {/* THE PREVIEW: your own picture wearing the look, the effect
                  crossing behind it — what the profile will show. */}
              <View style={[s.stage, { borderColor: showing ? preview.ring : colors.line }]}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: preview.tint, opacity: showing ? 0.35 : 0.15 }]} />
                <SeasonEffect key={preview.effect} emoji={preview.effect} width={340} height={190} playing repeatMs={7000} count={6} />
                <Avatar size={96} look={preview} deco={deco} uri={avatarUri} initial={initial} />
              </View>

              {seasons.length > 1 && (
                <View style={s.chipRow}>
                  {seasons.map((x) => (
                    <Pressable key={x.id} style={[s.tab, x.id === season.id && s.tabOn]} onPress={() => setEditing(x.id)}>
                      <Text style={[s.tabText, x.id === season.id && { color: colors.bg }]}>
                        {t(`seasonal.${x.id}`)}
                        {event?.id === x.id ? ` · ${t('seasonal.now')}` : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* KEEP OR REMOVE — the one choice a free user has. */}
              <Pressable
                style={[s.themeCard, showing && { borderColor: colors.yellow }]}
                onPress={() => {
                  tapSelection();
                  setTheme(showing ? null : season.id);
                  refresh();
                }}
                accessibilityRole="switch"
                accessibilityState={{ checked: showing }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.themeTitle}>{t('seasonal.themeTitle', { name: t(`seasonal.${season.id}`) })}</Text>
                  <Text style={s.themeSub}>{t('seasonal.themeSub')}</Text>
                </View>
                <Text style={[s.themeState, showing && { color: colors.green }]}>{showing ? t('seasonal.on') : t('seasonal.off')}</Text>
              </Pressable>

              <Section title={t('seasonal.looks')}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hRow}>
                  {season.presets.map((p, i) => (
                    <PresetCard
                      key={p.id}
                      preset={p}
                      locked={!plus && i > 0}
                      uri={avatarUri}
                      initial={initial}
                      onPress={() => change(() => applyPreset(season, p))}
                    />
                  ))}
                </ScrollView>
              </Section>

              <Section title={t('seasonal.decoration')}>
                <View style={s.chipRow}>
                  <Chip on={deco == null} onPress={() => change(() => setDecoration(''))}>
                    <Ionicons name="close" size={20} color={colors.dim} />
                  </Chip>
                  {season.decorations.map((e) => {
                    const locked = !plus && e !== season.presets[0]!.deco;
                    return (
                      <Chip key={e} on={deco === e} locked={locked} onPress={() => (locked ? toPaywall() : change(() => setDecoration(e)))}>
                        <Text style={[s.emoji, locked && s.dim]}>{e}</Text>
                      </Chip>
                    );
                  })}
                </View>
              </Section>

              <Section title={t('seasonal.companions')} sub={t('seasonal.companionsSub')}>
                <View style={s.chipRow}>
                  {season.companions.map((e) => {
                    const picked = preview.companions.includes(e);
                    return (
                      <Chip
                        key={e}
                        on={picked}
                        locked={lockedPart}
                        onPress={() =>
                          lockedPart
                            ? toPaywall()
                            : change(() =>
                                // Up to two: a third pushes out the oldest.
                                setPart({ companions: picked ? preview.companions.filter((c) => c !== e) : [...preview.companions, e].slice(-2) }),
                              )
                        }>
                        <Text style={[s.emoji, lockedPart && s.dim]}>{e}</Text>
                      </Chip>
                    );
                  })}
                </View>
              </Section>

              <Section title={t('seasonal.ring')}>
                <View style={s.chipRow}>
                  {season.rings.map((c) => (
                    <Chip key={c} on={preview.ring === c} locked={lockedPart} onPress={() => (lockedPart ? toPaywall() : change(() => setPart({ ring: c })))}>
                      <View style={[s.swatch, { backgroundColor: c }, lockedPart && s.dim]} />
                    </Chip>
                  ))}
                  <Pressable
                    style={[s.glowChip, preview.glow && { borderColor: colors.yellow }]}
                    onPress={() => (lockedPart ? toPaywall() : change(() => setPart({ glow: !preview.glow })))}>
                    <Ionicons name="sparkles" size={16} color={preview.glow ? colors.yellow : colors.dim} />
                    <Text style={[s.glowText, preview.glow && { color: colors.text }]}>{t('seasonal.glow')}</Text>
                    {lockedPart && <Ionicons name="lock-closed" size={11} color={colors.dim} />}
                  </Pressable>
                </View>
              </Section>

              <Section title={t('seasonal.effect')}>
                <View style={s.chipRow}>
                  {season.effects.map((e) => (
                    <Chip key={e} on={preview.effect === e} locked={lockedPart} onPress={() => (lockedPart ? toPaywall() : change(() => setPart({ effect: e })))}>
                      <Text style={[s.emoji, lockedPart && s.dim]}>{e}</Text>
                    </Chip>
                  ))}
                </View>
              </Section>

              {!plus && (
                <Pressable onPress={toPaywall} style={{ marginTop: space.lg }}>
                  <Text style={s.link}>{t('seasonal.plusLocked')}</Text>
                </Pressable>
              )}
              {!plus && <Text style={s.note}>{t('seasonal.freeNote')}</Text>}
            </>
          )}
        </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: space.lg }}>
      <Text style={s.label}>
        {title}
        {sub ? <Text style={s.labelSub}>{`  ${sub}`}</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Chip({ on, locked, onPress, children }: { on: boolean; locked?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable style={[s.chip, on && s.chipOn]} onPress={onPress}>
      {children}
      {locked && <Ionicons name="lock-closed" size={11} color={colors.dim} style={s.lock} />}
    </Pressable>
  );
}

function Avatar({ size, look, deco, uri, initial }: { size: number; look: SeasonLook; deco: string | null; uri: string | null; initial: string }) {
  return (
    <View style={{ width: size, height: size }}>
      {look.glow && <GlowRing color={look.ring} size={size} playing />}
      <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, borderColor: look.ring, borderWidth: size > 60 ? 4 : 2.5 }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={{ color: colors.yellow, fontWeight: '800', fontSize: size * 0.38 }}>{initial}</Text>
        )}
      </View>
      {deco != null && <Text style={[s.top, { fontSize: size * 0.36, top: -size * 0.16, right: -size * 0.12 }]}>{deco}</Text>}
      {look.companions.map((c, i) => (
        <Text
          key={c + i}
          style={[
            s.foot,
            { fontSize: size * 0.24, bottom: -size * 0.06 },
            i === 0 ? { left: -size * 0.1, transform: [{ rotate: '-12deg' }] } : { right: -size * 0.06, transform: [{ rotate: '10deg' }] },
          ]}>
          {c}
        </Text>
      ))}
    </View>
  );
}

function PresetCard({ preset, locked, uri, initial, onPress }: { preset: Preset; locked: boolean; uri: string | null; initial: string; onPress: () => void }) {
  const look: SeasonLook = { ring: preset.ring, glow: preset.glow, tint: preset.ring + '73', effect: preset.effect, companions: preset.companions };
  return (
    <Pressable style={s.preset} onPress={locked ? toPaywall : onPress}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.tint, opacity: 0.25, borderRadius: radius.card }]} />
      <View style={{ paddingTop: 14 }}>
        <Avatar size={54} look={look} deco={preset.deco} uri={uri} initial={initial} />
      </View>
      <Text style={s.presetName} numberOfLines={1}>
        {t(`seasonal.preset.${preset.id}` as LocaleKey)}
      </Text>
      <Text style={{ fontSize: 13 }}>{preset.effect}</Text>
      {locked && <Ionicons name="lock-closed" size={12} color={colors.dim} style={{ position: 'absolute', top: 8, end: 8 }} />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  stage: {
    height: 190,
    marginHorizontal: space.lg,
    marginTop: space.md,
    borderRadius: radius.card,
    borderWidth: 1.5,
    backgroundColor: colors.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { backgroundColor: colors.raise, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  top: { position: 'absolute', transform: [{ rotate: '14deg' }] },
  foot: { position: 'absolute' },
  label: { color: colors.dim, fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginHorizontal: space.lg },
  labelSub: { color: colors.faint, fontSize: 12, fontWeight: '600', letterSpacing: 0, textTransform: 'none' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: space.lg, marginTop: space.md },
  hRow: { gap: 10, paddingHorizontal: space.lg, paddingTop: space.md },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card },
  tabOn: { backgroundColor: colors.text },
  tabText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  chip: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  chipOn: { borderColor: colors.yellow },
  emoji: { fontSize: 24 },
  dim: { opacity: 0.35 },
  lock: { position: 'absolute', bottom: 2, end: 2 },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  glowChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 50, borderRadius: 25, backgroundColor: colors.card, borderWidth: 2, borderColor: 'transparent' },
  glowText: { color: colors.dim, fontSize: 14, fontWeight: '700' },
  themeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeTitle: { color: colors.text, fontSize: 15.5, fontWeight: '800' },
  themeSub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  themeState: { color: colors.dim, fontSize: 13, fontWeight: '800' },
  preset: { width: 104, alignItems: 'center', gap: 6, paddingBottom: 10, borderRadius: radius.card, backgroundColor: colors.card },
  presetName: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 6 },
  link: { color: colors.blue, fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: space.md, marginHorizontal: space.xl },
  empty: { alignItems: 'center', gap: 10, marginTop: space.xl, paddingHorizontal: space.xl },
  emptyText: { color: colors.dim, fontSize: 14.5, textAlign: 'center' },
});
