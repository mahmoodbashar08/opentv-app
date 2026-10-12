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
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, I18nManager, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { track } from '@/analytics';
import { pushWidgets } from '@/community-profiles';
import { widgetValue } from '@/components/profile-widgets';
import { ContentColumn, MenuRow, NavHeader, Screen } from '@/components/ui';
import { Poster } from '@/components/poster';
import { GoalCellView } from '@/components/yearly-goal';
import { filmsOfYear, getProfileLayout, showsOfYear } from '@/db';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { enableEpisodeNotifications, notificationsEnabled, syncEpisodeNotifications } from '@/notifications';
import { defaultLayout, parseLayout, publishableWidgets, withGoalBlock } from '@/profile-layout';
import { colors, radius, space } from '@/theme';
import {
  GOAL_KINDS,
  goalFor,
  goalNudgeOn,
  goalOn,
  goalOnProfile,
  goalShownOnProfile,
  goalStatus,
  goalYears,
  hasGoal,
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
  const items = saved?.items ?? defaultLayout(['shows', 'fav-shows', 'movies', 'fav-movies']);
  // Shown on the profile means shown to visitors too: the placed-by-itself
  // block has to be in what is published, not only in what is drawn.
  const placed = goalShownOnProfile() ? withGoalBlock(items) : items;
  void pushWidgets(JSON.stringify(publishableWidgets(placed, (id, span, data) => widgetValue(id, span, data)))).catch(() => {});
}

const digits = (s: string): string => s.replace(/[^0-9]/g, '').slice(0, 5);
const asDraft = (g: GoalTargets): Record<GoalKind, string> => ({
  films: g.films != null ? String(g.films) : '',
  episodes: g.episodes != null ? String(g.episodes) : '',
});

export default function YearlyGoalScreen() {
  const thisYear = new Date().getFullYear();
  // OPEN ON THE YEAR THAT HAS A GOAL. A goal set for next year in October
  // looked wiped on reopening, because the screen always opened on this year
  // (12 Oct). This year still wins when it has one.
  const [year, setYear] = useState(() => (!hasGoal(goalFor(thisYear)) && hasGoal(goalFor(thisYear + 1)) ? thisYear + 1 : thisYear));
  // NO SAVE BUTTON, SO SAY IT SAVED. Every keystroke is already written; this
  // only tells the reader so, for the year they typed in.
  const [savedFor, setSavedFor] = useState<number | null>(null);
  // A PAST YEAR IS A RECORD, NOT A FORM. Opened from "Past years", it shows its
  // rings and what counted, and no fields: the year is over (12 Oct).
  const pastYear = year < thisYear;
  const scroller = useRef<ScrollView>(null);
  // Lazy initial reads, like every switch in Settings: the React Compiler
  // memoises a render-time store read and would freeze these at first paint.
  const [on, setOn] = useState(() => goalOn());
  const [nudge, setNudge] = useState(() => goalNudgeOn());
  const [onProfile, setOnProfile] = useState(() => goalOnProfile());
  const [draft, setDraft] = useState<Record<GoalKind, string>>(() => asDraft(goalFor(year)));
  const [cells, setCells] = useState<GoalCell[]>([]);
  // WHAT COUNTED — Goodreads' "books read in 2026" under the progress, so the
  // number is a shelf you can look along rather than a figure to trust.
  type Tile = { key: string; name: string; uri: string | null; n?: number; open: () => void };
  const [films, setFilms] = useState<Tile[]>([]);
  const [shows, setShows] = useState<Tile[]>([]);
  const [past, setPast] = useState<{ year: number; cells: GoalCell[] }[]>([]);

  // Read in a callback, not in render — see the note on `data` in wrapped.tsx.
  const reload = useCallback((y: number) => {
    setDraft(asDraft(goalFor(y)));
    setCells(goalStatus(y));
    setFilms(filmsOfYear(y).map((f) => ({ key: f.name, name: f.name, uri: f.poster, open: () => router.push(`/movie/${encodeURIComponent(f.name)}`) })));
    setShows(showsOfYear(y).map((sh) => ({ key: String(sh.tvdbId), name: sh.name, uri: sh.posterUrl, n: sh.n, open: () => router.push(`/show/${sh.tvdbId}`) })));
    const now = new Date().getFullYear();
    setPast(goalYears().filter((py) => py < now).map((py) => ({ year: py, cells: goalStatus(py) })));
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
    setSavedFor(year);
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
      <ScrollView ref={scroller} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
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
                {(pastYear ? [year, thisYear, thisYear + 1] : [thisYear, thisYear + 1]).map((y) => (
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

              {!pastYear && GOAL_KINDS.map((kind) => (
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
              {savedFor === year && <Text style={s.saved}>{t('yearlyGoal.saved')}</Text>}
              {[
                ['films', films, 'yearlyGoal.countedFilms'] as const,
                ['shows', shows, 'yearlyGoal.countedShows'] as const,
              ].map(([k, tiles, label]) =>
                tiles.length === 0 ? null : (
                  <View key={k}>
                    <Text style={s.shelfTitle}>
                      {t(label, { year: String(year) })} · {tiles.length}
                    </Text>
                    <FlatList
                      horizontal
                      data={tiles}
                      keyExtractor={(x) => x.key}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 8, paddingHorizontal: space.lg }}
                      initialNumToRender={6}
                      renderItem={({ item }) => (
                        <Pressable style={s.tile} onPress={item.open} accessibilityRole="button" accessibilityLabel={item.name}>
                          <Poster name={item.name} uri={item.uri} />
                          {item.n != null && (
                            <View style={s.badge}>
                              <Text style={s.badgeText}>{item.n}</Text>
                            </View>
                          )}
                        </Pressable>
                      )}
                    />
                  </View>
                ),
              )}
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
              {past.length > 0 && (
                <View>
                  <Text style={s.shelfTitle}>{t('yearlyGoal.pastTitle')}</Text>
                  {past.map((py) => (
                    <Pressable
                      key={py.year}
                      style={s.pastRow}
                      accessibilityRole="button"
                      accessibilityLabel={t('yearlyGoal.block', { year: String(py.year) })}
                      onPress={() => {
                        pickYear(py.year);
                        scroller.current?.scrollTo({ y: 0, animated: true });
                      }}>
                      <Text style={s.pastYear}>{py.year}</Text>
                      <Text style={s.pastText}>
                        {py.cells
                          .map((c) => `${t(c.kind === 'films' ? 'yearlyGoal.films' : 'yearlyGoal.episodes')} ${t('yearlyGoal.progress', { done: String(c.done), target: String(c.target) })}${c.reached ? ' ✅' : ''}`)
                          .join('  ·  ')}
                      </Text>
                      <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.dim} />
                    </Pressable>
                  ))}
                </View>
              )}
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
  saved: { color: colors.green, fontSize: 13, fontWeight: '700', paddingHorizontal: space.lg, paddingTop: 10 },
  shelfTitle: { color: colors.text, fontSize: 15, fontWeight: '800', paddingHorizontal: space.lg, paddingTop: 18, paddingBottom: 8 },
  tile: { width: 78 },
  badge: { position: 'absolute', top: 4, right: 4, backgroundColor: colors.yellow, borderRadius: 9, minWidth: 18, paddingHorizontal: 5, alignItems: 'center' },
  badgeText: { color: colors.onYellow, fontSize: 11, fontWeight: '800' },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.lg, paddingVertical: 8 },
  pastYear: { color: colors.text, fontSize: 15, fontWeight: '800', width: 48 },
  pastText: { color: colors.dim, fontSize: 13.5, flex: 1 },
  note: { color: colors.faint, fontSize: 12.5, lineHeight: 17, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 6 },
});
