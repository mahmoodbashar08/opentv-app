/**
 * Profile templates — ones made from the reader's own shows and films, then ten
 * ready-made profiles, each previewed as a little
 * phone: its banner, its colours running into the page, its layout and its
 * blocks. One tap puts it on your profile (see `profile-templates.ts`).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { communityErrorText } from '@/community-error-text';
import { NavHeader, Screen } from '@/components/ui';
import { ApiError } from '@/api';
import { tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { profileImageUri } from '@/library';
import type { LocaleKey } from '@/locales/keys';
import { requirePlus, usePlus } from '@/plus';
import { applyTemplate, cachedTitleTemplates, templateItems, TEMPLATES, titleTemplates, type Template } from '@/profile-templates';
import { colors, radius, space } from '@/theme';

/** `a` toward `b` by `k` — the same blend the profile paints its page with. */
function mix(a: string, b: string, k: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - k) + p(b, i) * k).toString(16).padStart(2, '0'));
  return `#${c.join('')}`;
}

export default function ProfileTemplatesScreen() {
  const plus = usePlus();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState<string | null>(null);
  const cardW = (Math.min(width, 700) - space.lg * 2 - 12) / 2;
  const avatar = profileImageUri('avatar');
  // From the reader's own shows and films — fetched, so they arrive a moment after the made ones.
  // Saved ones draw at once; only a changed library waits for the fetch.
  const [fromTitles, setFromTitles] = useState<Template[] | null>(cachedTitleTemplates);
  useEffect(() => {
    if (fromTitles) return;
    let live = true;
    void titleTemplates()
      .catch(() => [])
      .then((x) => live && setFromTitles(x));
    return () => {
      live = false;
    };
  }, [fromTitles]);
  const nameOf = (tpl: Template) => tpl.title ?? t(`templates.name.${tpl.id}` as LocaleKey);

  const use = (tpl: Template) => {
    if (busy) return;
    if (!requirePlus('profile_template')) return;
    tapSelection();
    const name = nameOf(tpl);
    Alert.alert(t('templates.applyTitle', { name }), t('templates.applyBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('templates.apply'),
        onPress: () => {
          setBusy(tpl.id);
          applyTemplate(tpl)
            .then(() => router.back())
            .catch((e: unknown) =>
              Alert.alert(t('templates.failed'), e instanceof ApiError ? communityErrorText(e) : t('community.error.network')),
            )
            .finally(() => setBusy(null));
        },
      },
    ]);
  };

  const card = (item: Template) => (
    <Pressable key={item.id} onPress={() => use(item)} style={{ width: cardW }} accessibilityLabel={nameOf(item)}>
      <Preview tpl={item} width={cardW} avatar={avatar} />
      <View style={s.nameRow}>
        <View style={[s.dot, { backgroundColor: item.primary }]} />
        <View style={[s.dot, { backgroundColor: item.secondary, marginStart: -6 }]} />
        <Text style={s.name} numberOfLines={1}>
          {nameOf(item)}
        </Text>
        {busy === item.id ? (
          <ActivityIndicator size="small" color={colors.dim} />
        ) : (
          !plus && <Ionicons name="lock-closed" size={13} color={colors.dim} />
        )}
      </View>
      <Text style={s.layout}>{t(`templates.layout.${item.layout}` as LocaleKey)}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <NavHeader title={t('templates.title')} />
      {/* Twenty at most, so a plain wrapped grid rather than a virtualised list. */}
      <ScrollView contentContainerStyle={{ paddingBottom: 48, paddingTop: space.sm }}>
        <Text style={s.intro}>{t('templates.intro')}</Text>
        {fromTitles == null ? (
          <View style={s.loading}>
            <ActivityIndicator color={colors.dim} />
            <Text style={s.layout}>{t('templates.fromTitlesLoading')}</Text>
          </View>
        ) : (
          fromTitles.length > 0 && (
            <>
              <Text style={s.section}>{t('templates.fromTitles')}</Text>
              <View style={s.grid2}>{fromTitles.map(card)}</View>
            </>
          )
        )}
        <Text style={s.section}>{t('templates.made')}</Text>
        <View style={s.grid2}>{TEMPLATES.map(card)}</View>
      </ScrollView>
    </Screen>
  );
}

/** A small phone showing the template — drawn from the same data it applies. */
function Preview({ tpl, width, avatar }: { tpl: Template; width: number; avatar: string | null }) {
  const h = width * 1.9;
  const bannerH = h * 0.3;
  const pad = width * 0.07;
  const col = (width - pad * 2 - 6) / 2;
  const unit = col * 0.55;
  const top = mix('#000000', tpl.primary, 0.45);
  const page = mix('#000000', tpl.primary, 0.14);
  const block = tpl.layout === 'classic' ? mix('#000000', tpl.primary, 0.22) : mix('#141416', tpl.primary, 0.3);
  const centred = tpl.layout !== 'classic';
  const av = width * (centred ? 0.26 : 0.2);
  const items = templateItems(tpl).filter((i) => i.id !== 'banners' && i.id !== 'intro');

  return (
    <View style={[s.phone, { height: h, backgroundColor: page }]}>
      <LinearGradient colors={[top, page]} style={[StyleSheet.absoluteFill, { top: bannerH }]} locations={[0, 0.5]} />
      <Image source={typeof tpl.banner === 'string' ? { uri: tpl.banner } : tpl.banner} style={{ width: '100%', height: bannerH }} contentFit="cover" />
      <LinearGradient colors={['transparent', top]} style={{ position: 'absolute', top: bannerH * 0.55, left: 0, right: 0, height: bannerH * 0.46 }} />
      <View style={[s.identity, { marginTop: -av * 0.5, paddingHorizontal: pad }, centred && { alignItems: 'center' }]}>
        <View style={[s.avatar, { width: av, height: av, borderRadius: av / 2, borderColor: tpl.primary }]}>
          {avatar ? <Image source={{ uri: avatar }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        </View>
        <View style={[s.bar, { width: width * 0.42, marginTop: 6 }]} />
        <View style={[s.bar, { width: width * 0.26, opacity: 0.5, backgroundColor: tpl.secondary }]} />
      </View>
      <View style={[s.grid, { paddingHorizontal: pad }]}>
        {items.map((it) => (
          <View
            key={it.uid}
            style={{
              width: it.span === '1x1' ? col : col * 2 + 6,
              height: it.span === '2x2' ? unit * 2 : unit,
              borderRadius: tpl.layout === 'classic' ? 3 : 6,
              backgroundColor: it.id.startsWith('shelf:') ? mix(block, tpl.secondary, 0.25) : block,
              borderWidth: tpl.layout === 'cards' ? StyleSheet.hairlineWidth : 0,
              borderColor: tpl.primary,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  section: { color: colors.dim, fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginHorizontal: space.lg, marginTop: space.lg, marginBottom: space.md },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 18, paddingHorizontal: space.lg },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: space.lg, marginTop: space.lg },
  intro: { color: colors.dim, fontSize: 14, lineHeight: 20, marginHorizontal: space.lg, marginBottom: space.sm },
  phone: { borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  identity: { gap: 4 },
  avatar: { borderWidth: 2, backgroundColor: colors.raise, overflow: 'hidden' },
  bar: { height: 5, borderRadius: 3, backgroundColor: '#FFFFFF' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.bg },
  name: { color: colors.text, fontSize: 15, fontWeight: '800', flex: 1 },
  layout: { color: colors.dim, fontSize: 12.5, marginTop: 1 },
});
