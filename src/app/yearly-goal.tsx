/**
 * THE YEARLY GOAL — set it, see it, and the three switches the CHANGELOG
 * names: the goal on or off, the nudge when behind (off by default), and
 * whether the public profile shows it. Reached from Settings and from the
 * profile block.
 *
 * TWO NUMBERS, NO SAVE BUTTON. Each keystroke is written straight to `meta`:
 * a number typed and then abandoned by swiping back must still be the goal,
 * and one row per keystroke costs nothing. The things that are not free —
 * the republish and the notification re-plan — wait for the field to be left.
 *
 * THIS YEAR AND NEXT. The ask was "how many films in 2027?", posted in
 * October 2026, so next year is always on offer; Goodreads opens its challenge
 * in December for the same reason. A future year has no pace yet, and says so.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { track } from '@/analytics';
import { pushWidgets } from '@/community-profiles';
import { widgetValue } from '@/components/profile-widgets';
import { ContentColumn, MenuRow, NavHeader, Screen } from '@/components/ui';
import { GoalCellView } from '@/components/yearly-goal';
import { getProfileLayout } from '@/db';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { enableEpisodeNotifications, notificationsEnabled, syncEpisodeNotifications } from '@/notifications';
import { parseLayout, publishableWidgets } from '@/profile-layout';
import { colors, radius, space } from '@/theme';
import {
  GOAL_KINDS,
  goalFor,
  goalNudgeOn,
  goalOn,
  goalOnProfile,
  goalStatus,
  setGoalFor,
  setGoalNudgeOn,
  setGoalOn,
  setGoalOnProfile,
  type GoalCell,
  type GoalKind,
  type GoalTargets,
} from '@/yearly-goal';

/**
 * The server's copy of the block, after a change here. The arrangement is
 * what it was; only the goal's value moved — or vanished, when the profile
 * switch went off, which is the case this exists for: a privacy switch that
 * takes effect at the next rearrangement is not a switch. Nothing is sent for
 * a profile that was never arranged, because the block cannot be on it.
 */
function republishGoal(): void {
  const saved = parseLayout(getProfileLayout());
  if (!saved) return;
  void pushWidgets(JSON.stringify(publishableWidgets(saved.items, (id, span, data) => widgetValue(id, span, data)))).catch(() => {});
}

const digits = (s: string): string => s.replace(/[^0-9]/g, '').slice(0, 5);
const asDraft = (g: GoalTargets): Record<GoalKind, string> => ({
  films: g.films != null ? String(g.films) : '',
  episodes: g.episodes != null ? String(g.episodes) : '',
});

export default function YearlyGoalScreen() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  // Lazy initial reads, like every switch in Settings: the React Compiler
  // memoises a render-time store read and would freeze these at first paint.
  const [on, setOn] = useState(() => goalOn());
  const [nudge, setNudge] = useState(() => goalNudgeOn());
  const [onProfile, setOnProfile] = useState(() => goalOnProfile());
  const [draft, setDraft] = useState<Record<GoalKind, string>>(() => asDraft(goalFor(thisYear)));
  const [cells, setCells] = useState<GoalCell[]>([]);

  // Read in a callback, not in render — see the note on `data` in wrapped.tsx.
  const reload = useCallback((y: number) => {
    setDraft(asDraft(goalFor(y)));
    setCells(goalStatus(y));
  }, []);
  useFocusEffect(useCallback(() => reload(year), [year, reload]));

  const pickYear = (y: number) => {
    if (y === year) return;
    tapSelection();
    setYear(y);
    reload(y);
  };

  const type = (kind: GoalKind, text: string) => {
    const next = { ...draft, [kind]: digits(text) };
    setDraft(next);
    setGoalFor(year, { films: Number(next.films) || undefined, episodes: Number(next.episodes) || undefined });
    setCells(goalStatus(year));
  };

  /** The field was left: the one event per edit worth a republish and a
   *  re-plan. Shape only to analytics — which kind, set or cleared. */
  const done = (kind: GoalKind) => {
    track('goal_set', { kind, on: Number(draft[kind]) > 0 ? 1 : 0 });
    republishGoal();
    void syncEpisodeNotifications(true);
  };

  const toggleOn = (v: boolean) => {
    setOn(v);
    setGoalOn(v);
    if (v) tapLight();
    republishGoal();
    void syncEpisodeNotifications(true);
  };

  /**
   * The nudge rides on the notification category the app already has: the
   * scheduler plans nothing while the master switch is off, so turning this
   * on with it off asks for permission the way the Notifications screen does
   * — and if that is refused, the switch goes back where it was and says why.
   */
  const toggleNudge = (v: boolean) => {
    setNudge(v);
    setGoalNudgeOn(v);
    if (v && !notificationsEnabled()) {
      void enableEpisodeNotifications().then((ok) => {
        if (ok) return;
        setNudge(false);
        setGoalNudgeOn(false);
        Alert.alert(t('settings.app.notificationsOffTitle'), t('settings.app.notificationsOffBody'));
      });
      return;
    }
    void syncEpisodeNotifications(true);
  };

  const toggleProfile = (v: boolean) => {
    setOnProfile(v);
    setGoalOnProfile(v);
    republishGoal();
  };

  const future = year > thisYear;

  return (
    <Screen>
      <NavHeader title={t('yearlyGoal.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <ContentColumn>
          <MenuRow
            trackId="yearlyGoal.switch"
            title={t('yearlyGoal.switch')}
            sub={t('yearlyGoal.switchSub')}
            right={<Switch value={on} onValueChange={toggleOn} trackColor={{ true: colors.green }} />}
          />

          {on && (
            <>
              <View style={s.years} accessibilityRole="tablist">
                {[thisYear, thisYear + 1].map((y) => (
                  <Pressable
                    key={y}
                    style={[s.chip, y === year && s.chipOn]}
                    onPress={() => pickYear(y)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: y === year }}
                    accessibilityLabel={t('yearlyGoal.block', { year: String(y) })}>
                    <Text style={[s.chipText, y === year && s.chipTextOn]}>{String(y)}</Text>
                  </Pressable>
                ))}
              </View>

              {cells.length > 0 && (
                <View style={s.rings}>
                  {cells.map((c) => (
                    <GoalCellView key={c.kind} c={c} size={96} future={future} big />
                  ))}
                </View>
              )}

              {GOAL_KINDS.map((kind) => (
                <View key={kind} style={s.field}>
                  <Text style={s.fieldLabel}>{kind === 'films' ? t('yearlyGoal.films') : t('yearlyGoal.episodes')}</Text>
                  <TextInput
                    style={s.input}
                    value={draft[kind]}
                    onChangeText={(text) => type(kind, text)}
                    onEndEditing={() => done(kind)}
                    placeholder={t('yearlyGoal.none')}
                    placeholderTextColor={colors.faint}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    maxLength={5}
                    accessibilityLabel={kind === 'films' ? t('yearlyGoal.films') : t('yearlyGoal.episodes')}
                  />
                </View>
              ))}
              <Text style={s.note}>{t('yearlyGoal.note', { year: String(year) })}</Text>

              <MenuRow
                trackId="yearlyGoal.nudge"
                title={t('yearlyGoal.nudge')}
                sub={t('yearlyGoal.nudgeSub')}
                right={<Switch value={nudge} onValueChange={toggleNudge} trackColor={{ true: colors.green }} />}
              />
              <MenuRow
                trackId="yearlyGoal.onProfile"
                title={t('yearlyGoal.onProfile')}
                sub={t('yearlyGoal.onProfileSub')}
                right={<Switch value={onProfile} onValueChange={toggleProfile} trackColor={{ true: colors.green }} />}
              />
              {/* The recap carries the result on its share card — one door to
                  it from here, so "how did my year go" has an answer. */}
              <MenuRow
                trackId="yearlyGoal.wrapped"
                title={t('plus.wrapped.entry')}
                sub={t('plus.wrapped.entrySub')}
                onPress={() => router.push(`/wrapped?year=${year}`)}
              />
            </>
          )}
        </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  years: { flexDirection: 'row', gap: 8, paddingHorizontal: space.lg, paddingTop: 14 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 7 },
  chipOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  chipText: { color: colors.dim, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: colors.onYellow },
  rings: { paddingHorizontal: space.lg, paddingTop: 18, gap: 16 },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, marginTop: 14, gap: 12 },
  fieldLabel: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
  input: {
    width: 110,
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  note: { color: colors.faint, fontSize: 12.5, lineHeight: 17, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 6 },
});
