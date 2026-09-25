/**
 * The screen that answers "what should I watch tonight?".
 *
 * THREE QUESTIONS, THREE ANSWERS. The problem is somebody standing in front of
 * a library they own and not choosing, so the cure cannot be a longer list. It
 * asks how long they have, what sort of thing they want, and what mood they
 * are in, then names three things and stops.
 *
 * IT ANSWERS BEFORE IT IS ASKED. Every question defaults to "doesn't matter"
 * and three picks are on screen the moment it opens. A screen that shows an
 * empty state until three questions are answered is a form, and nobody fills
 * in a form to decide what to watch.
 *
 * NOTHING HERE DECIDES ANYTHING — `tonight.ts` ranks and `catch-up.ts` paces,
 * both pure and both tested. This file asks, draws, and routes.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { plans, type Plan } from '@/catch-up';
import { NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { usePlus } from '@/plus';
import { colors, radius, space } from '@/theme';
import { behind, candidates, today } from '@/tonight-data';
import { pickTonight, type Ask, type Candidate, type Mood, type Time, type Want } from '@/tonight';

const TIMES: Time[] = ['short', 'medium', 'long', 'any'];
const WANTS: Want[] = ['continue', 'new', 'movie', 'any'];
const MOODS: Mood[] = ['light', 'funny', 'dark', 'exciting', 'any'];

export default function TonightScreen() {
  const plus = usePlus();
  const [ask, setAsk] = useState<Ask>({ time: 'any', want: 'any', mood: 'any' });
  const [lib, setLib] = useState<{ cands: Candidate[]; plans: Plan[] }>({ cands: [], plans: [] });

  /*
   * READ ON FOCUS, not in render. The React Compiler memoises a render-time
   * read against its arguments, and this one has none — it would answer with
   * the library as it was when the screen first mounted, for ever.
   */
  useFocusEffect(
    useCallback(() => {
      setLib({ cands: candidates(), plans: plans(behind(), today()) });
    }, []),
  );

  const picks = useMemo(() => pickTonight(lib.cands, ask), [lib.cands, ask]);

  return (
    <Screen>
      <NavHeader title={t('tonight.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Chips label={t('tonight.howLong')} options={TIMES} value={ask.time} keyOf={(k) => `tonight.time.${k}` as const}
          onPick={(time) => setAsk((a) => ({ ...a, time }))} />
        <Chips label={t('tonight.what')} options={WANTS} value={ask.want} keyOf={(k) => `tonight.want.${k}` as const}
          onPick={(want) => setAsk((a) => ({ ...a, want }))} />
        <Chips label={t('tonight.moodLabel')} options={MOODS} value={ask.mood} keyOf={(k) => `tonight.mood.${k}` as const}
          onPick={(mood) => setAsk((a) => ({ ...a, mood }))} />

        {picks.length === 0 ? (
          <Text style={s.none}>{t('tonight.nothingFits')}</Text>
        ) : (
          picks.map((c) => <Pick key={c.key} c={c} />)
        )}

        {/* THE PLAN SITS UNDER THE PICKS, not above them. Somebody who opened
            this screen asked about tonight; a premiere five weeks out is worth
            knowing and is not what they came for. */}
        {plus && lib.plans.length > 0 && (
          <>
            <Text style={s.section}>{t('tonight.catchUpSection')}</Text>
            {lib.plans.slice(0, 3).map((p) => <PlanCard key={p.showId} p={p} />)}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Chips<T extends string>({ label, options, value, keyOf, onPick }: {
  label: string;
  options: readonly T[];
  value: T;
  keyOf: (k: T) => Parameters<typeof t>[0];
  onPick: (v: T) => void;
}) {
  return (
    <View style={s.group}>
      <Text style={s.label}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipScroller}
        contentContainerStyle={s.chips}>
        {options.map((o) => (
          <Pressable
            key={o}
            style={[s.chip, value === o && s.chipOn]}
            onPress={() => {
              tapLight();
              onPick(o);
            }}>
            <Text style={[s.chipText, value === o && s.chipTextOn]}>{t(keyOf(o))}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Pick({ c }: { c: Candidate }) {
  const open = () => {
    tapLight();
    const [kind, rest] = [c.key.slice(0, c.key.indexOf(':')), c.key.slice(c.key.indexOf(':') + 1)];
    router.push(kind === 'show' ? `/show/${rest}` : `/movie/${encodeURIComponent(rest)}`);
  };
  return (
    <Pressable style={s.pick} onPress={open}>
      {c.poster ? (
        <Image source={{ uri: c.poster }} style={s.poster} contentFit="cover" />
      ) : (
        <View style={[s.poster, s.posterEmpty]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.why}>{t(`tonight.kind.${c.kind}` as const)}</Text>
        <Text style={s.pickTitle} numberOfLines={2}>{c.title}</Text>
        <Text style={s.pickSub}>
          {[
            c.remaining != null && c.remaining > 0 ? t('tonight.left', { count: c.remaining }) : null,
            c.minutes != null ? t('tonight.minutes', { count: c.minutes }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

function PlanCard({ p }: { p: Plan }) {
  return (
    <Pressable style={s.plan} onPress={() => router.push(`/show/${p.showId}`)}>
      <Text style={s.planTitle}>{t('tonight.returns', { name: p.showName, season: p.season, days: p.daysLeft })}</Text>
      <Text style={s.planBody}>
        {p.tight
          ? t('tonight.planTight', { count: p.remaining, days: p.daysLeft })
          : t('tonight.planPace', { count: p.remaining, perWeek: p.perWeek, spare: p.spareDays })}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  group: { paddingTop: 14 },
  label: { color: colors.faint, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: space.lg },
  // `flexGrow: 0` for the reason spelled out in `gif-search.tsx`: a horizontal
  // ScrollView in a column fills the space left over until its children have
  // been measured, and draws one frame far too tall.
  chipScroller: { flexGrow: 0 },
  chips: { gap: 8, paddingHorizontal: space.lg, paddingTop: 8, paddingBottom: 2 },
  chip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  chipText: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  chipTextOn: { color: colors.onYellow },
  none: { color: colors.dim, fontSize: 14, textAlign: 'center', paddingHorizontal: 30, paddingTop: 34 },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 12,
    marginHorizontal: space.lg,
    marginTop: 12,
  },
  poster: { width: 56, height: 84, borderRadius: 7, backgroundColor: colors.panel },
  posterEmpty: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  why: { color: colors.yellow, fontSize: 10.5, fontWeight: '900', letterSpacing: 1 },
  pickTitle: { color: colors.text, fontSize: 16.5, fontWeight: '800', marginTop: 3 },
  pickSub: { color: colors.dim, fontSize: 12.5, marginTop: 3 },
  section: { color: colors.text, fontSize: 17, fontWeight: '900', paddingHorizontal: space.lg, paddingTop: 26 },
  plan: {
    backgroundColor: colors.panel,
    borderRadius: radius.card,
    padding: 14,
    marginHorizontal: space.lg,
    marginTop: 10,
  },
  planTitle: { color: colors.text, fontSize: 14.5, fontWeight: '800' },
  planBody: { color: colors.dim, fontSize: 13, lineHeight: 18, marginTop: 5 },
});
