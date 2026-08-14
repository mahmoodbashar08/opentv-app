/**
 * The library filter sheet -- one component, two routes (`/filters` for shows,
 * `/movie-filters` for films), because the two sheets drifting apart is exactly
 * how "network" ends up offered on a films screen.
 *
 * WHAT THE USER SEES, top to bottom: their saved presets, then one section per
 * axis, then the actions. Every section is derived from THEIR library -- a
 * genre nobody has watched has no chip, an axis with no data at all has no
 * heading. The counts beside the chips are faceted (see `filterOptions`), so
 * the number promises what tapping it will actually leave.
 *
 * The result line and the actions sit BELOW the scroller, not inside it: on a
 * phone the thumb reaches the bottom of the screen and nothing else, and the
 * one thing a persistent filter needs is a RESET that is always visible.
 *
 * FREE vs PLUS: every axis is free. Hiding somebody's own library behind a
 * paywall is indefensible. What Plus buys is naming a combination and getting
 * it back in one tap.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PromptModal } from '@/components/prompt-modal';
import { getMovies, getShowProgress } from '@/db';
import { movieFacts, showFacts } from '@/filter-facts';
import {
  deletePreset,
  getFilters,
  newPresetId,
  renamePreset,
  savePreset,
  setFilters,
  useFilters,
  usePresets,
} from '@/filters-store';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { PLUS_AVAILABLE, requirePlus, usePlus } from '@/plus';
import {
  DEFAULT_FILTERS,
  filterOptions,
  matchesFilters,
  sameFilters,
  toggleAxis,
  type FilterAxis,
  type FilterKind,
  type FilterOption,
  type FilterPreset,
  type FilterSet,
  type FilterSort,
} from '@/pure';
import { colors, radius, space } from '@/theme';

const SORTS: { value: FilterSort; key: 'filters.sortLastWatched' | 'filters.sortLastAdded' | 'filters.sortAlpha' }[] = [
  { value: 'lastWatched', key: 'filters.sortLastWatched' },
  { value: 'lastAdded', key: 'filters.sortLastAdded' },
  { value: 'alpha', key: 'filters.sortAlpha' },
];

/** Values that have a translation; genres and networks are data, not copy. */
function labelOf(axis: FilterAxis, value: string, kind: FilterKind): string {
  if (axis === 'progress') {
    if (kind === 'movie') return value === 'watched' ? t('movieFilters.progressWatched') : t('movieFilters.progressNotWatched');
    if (value === 'watching') return t('filters.progressWatching');
    if (value === 'notStarted') return t('filters.progressNotStarted');
    if (value === 'upToDate') return t('filters.progressUpToDate');
    if (value === 'finished') return t('filters.progressFinished');
    if (value === 'stopped') return t('filters.progressStopped');
  }
  if (axis === 'runtimes') {
    if (value === 'short') return t('filters.runtimeShort');
    if (value === 'standard') return t('filters.runtimeStandard');
    if (value === 'long') return t('filters.runtimeLong');
  }
  return value;
}

/** Long axes (genres on a big library) collapse to a first screenful. */
const COLLAPSED = 12;

function Chip({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
      onPress={() => {
        tapLight();
        onPress();
      }}>
      <Text style={[styles.chipText, on ? styles.chipTextOn : styles.chipTextOff]}>{label}</Text>
      <Text style={[styles.chipCount, on ? styles.chipTextOn : styles.chipCountOff]}>{count}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

/** One multi-select axis. Renders nothing at all when the library has no data
 *  for it -- an empty heading is a promise the library cannot keep. */
function AxisSection({
  axis,
  title,
  options,
  selected,
  kind,
  onToggle,
}: {
  axis: FilterAxis;
  title: string;
  options: FilterOption[];
  selected: readonly string[];
  kind: FilterKind;
  onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (options.length === 0) return null;
  // a selected chip always stays visible, even if the collapse would hide it
  const visible = expanded ? options : options.filter((o, i) => i < COLLAPSED || selected.includes(o.value));
  return (
    <Section title={title}>
      {visible.map((o) => (
        <Chip
          key={o.value}
          label={labelOf(axis, o.value, kind)}
          count={o.count}
          on={selected.includes(o.value)}
          onPress={() => onToggle(o.value)}
        />
      ))}
      {options.length > visible.length || expanded ? (
        <Pressable style={styles.moreBtn} onPress={() => setExpanded((e) => !e)}>
          <Text style={styles.moreText}>{expanded ? t('filters.showLess') : t('filters.showMore')}</Text>
        </Pressable>
      ) : null}
    </Section>
  );
}

export function FiltersSheet({ kind }: { kind: FilterKind }) {
  const plus = usePlus();
  const presets = usePresets(kind);
  /**
   * NO DRAFT. THE SHEET EDITS THE REAL THING.
   *
   * A local draft committed by one button meant every other way out of a sheet
   * — the backdrop, a swipe, the grabber, the hardware back button — silently
   * threw the work away, and the library looked unchanged for reasons nobody
   * could see. Every one of those is a way people actually close a sheet.
   *
   * Writing straight through removes the entire class of bug: the counts, the
   * "N of M" line and the grid underneath are then always describing the same
   * filters, and there is no state that can be lost by leaving.
   */
  const draft = useFilters(kind);
  const setDraft = (next: FilterSet | ((d: FilterSet) => FilterSet)) =>
    setFilters(kind, typeof next === 'function' ? next(getFilters(kind)) : next);
  const [prompt, setPrompt] = useState<{ id: string | null; initial: string } | null>(null);

  // the library, resolved once per open. showMeta() caches per show, so this is
  // a couple of grouped queries plus a map lookup per title -- cheap enough to
  // do on mount, far too expensive to repeat per chip tap, hence the memo.
  const facts = useMemo(() => (kind === 'show' ? showFacts(getShowProgress()) : movieFacts(getMovies())), [kind]);
  const options = useMemo(() => filterOptions(facts, draft, kind), [facts, draft, kind]);
  const shown = useMemo(() => facts.filter((f) => matchesFilters(f, draft)).length, [facts, draft]);

  // backdrop fades via the route; the sheet slides up on its own
  const slide = useRef(new Animated.Value(420)).current;
  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slide]);

  const toggle = (axis: FilterAxis) => (value: string) => setDraft((d) => toggleAxis(d, axis, value));

  const applyPreset = (p: FilterPreset) => {
    tapLight();
    setDraft(p.filters);
  };

  const managePreset = (p: FilterPreset) => {
    Alert.alert(p.name, undefined, [
      { text: t('filters.presetRename'), onPress: () => setPrompt({ id: p.id, initial: p.name }) },
      { text: t('filters.presetDelete'), style: 'destructive', onPress: () => deletePreset(p.id) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const startSave = () => {
    // the axes are free; naming a combination is the paid half
    if (!requirePlus('filter_presets')) return;
    setPrompt({ id: null, initial: '' });
  };

  const submitPrompt = (value: string): boolean => {
    const name = value.trim();
    if (!name || !prompt) return false;
    if (prompt.id) renamePreset(prompt.id, name);
    else savePreset({ id: newPresetId(), kind, name, filters: draft });
    setPrompt(null);
    return true;
  };

  const resultLine =
    kind === 'show'
      ? t('filters.resultShows', { n: shown, count: facts.length })
      : t('filters.resultMovies', { n: shown, count: facts.length });

  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <Animated.View style={[styles.wrap, { transform: [{ translateY: slide }] }]}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {PLUS_AVAILABLE && (
            <Section title={t('filters.presetsTitle')}>
              {presets.map((p) => (
                <Pressable
                  key={p.id}
                  style={[styles.chip, sameFilters(p.filters, draft) ? styles.chipOn : styles.chipOff]}
                  onPress={() => applyPreset(p)}
                  onLongPress={() => managePreset(p)}
                  delayLongPress={300}>
                  <Text
                    style={[styles.chipText, sameFilters(p.filters, draft) ? styles.chipTextOn : styles.chipTextOff]}
                    numberOfLines={1}>
                    {p.name}
                  </Text>
                </Pressable>
              ))}
              <Pressable style={styles.savePresetBtn} onPress={startSave}>
                <Ionicons name={plus ? 'bookmark-outline' : 'lock-closed'} size={13} color={colors.yellow} />
                <Text style={styles.savePresetText}>{t('filters.savePreset')}</Text>
              </Pressable>
              {presets.length === 0 ? <Text style={styles.hint}>{t('filters.presetsHint')}</Text> : null}
            </Section>
            )}

            <Section title={t('filters.sortByTitle')}>
              {SORTS.map((s) => (
                <Pressable
                  key={s.value}
                  style={[styles.chip, draft.sort === s.value ? styles.chipOn : styles.chipOff]}
                  onPress={() => {
                    tapLight();
                    setDraft((d) => ({ ...d, sort: s.value }));
                  }}>
                  <Text style={[styles.chipText, draft.sort === s.value ? styles.chipTextOn : styles.chipTextOff]}>
                    {t(s.key)}
                  </Text>
                </Pressable>
              ))}
            </Section>

            <AxisSection
              axis="progress"
              title={t('filters.progressTitle')}
              options={options.progress}
              selected={draft.progress}
              kind={kind}
              onToggle={toggle('progress')}
            />
            <AxisSection
              axis="genres"
              title={t('filters.genreTitle')}
              options={options.genres}
              selected={draft.genres}
              kind={kind}
              onToggle={toggle('genres')}
            />
            {kind === 'show' ? (
              <AxisSection
                axis="networks"
                title={t('filters.networkTitle')}
                options={options.networks}
                selected={draft.networks}
                kind={kind}
                onToggle={toggle('networks')}
              />
            ) : null}
            <AxisSection
              axis="decades"
              title={t('filters.decadeTitle')}
              options={options.decades}
              selected={draft.decades}
              kind={kind}
              onToggle={toggle('decades')}
            />
            <AxisSection
              axis="runtimes"
              title={kind === 'show' ? t('filters.runtimeTitleShow') : t('filters.runtimeTitleMovie')}
              options={options.runtimes}
              selected={draft.runtimes}
              kind={kind}
              onToggle={toggle('runtimes')}
            />
            <AxisSection
              axis="years"
              title={t('filters.watchedYearTitle')}
              options={options.years}
              selected={draft.years}
              kind={kind}
              onToggle={toggle('years')}
            />

            {options.ratings.length > 0 ? (
              <Section title={t('filters.ratingTitle')}>
                {options.ratings.map((o) => {
                  const value = o.value === 'unrated' ? 0 : Number(o.value);
                  const on = draft.rating === value;
                  return (
                    <Chip
                      key={o.value}
                      label={o.value === 'unrated' ? t('filters.ratingUnrated') : t('filters.ratingMin', { stars: o.value })}
                      count={o.count}
                      on={on}
                      onPress={() => setDraft((d) => ({ ...d, rating: on ? null : value }))}
                    />
                  );
                })}
              </Section>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.result}>{resultLine}</Text>
            <View style={styles.actions}>
              <Pressable
                style={styles.resetBtn}
                onPress={() => {
                  tapLight();
                  setDraft({ ...DEFAULT_FILTERS });
                }}>
                <Text style={styles.resetText}>{t('filters.reset')}</Text>
              </Pressable>
              <Pressable
                style={styles.applyBtn}
                onPress={() => router.back()}>
                <Text style={styles.applyText}>{t('filters.apply')}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Animated.View>
      <PromptModal
        visible={prompt != null}
        title={prompt?.id ? t('filters.presetRename') : t('filters.presetNameTitle')}
        initial={prompt?.initial ?? ''}
        onCancel={() => setPrompt(null)}
        onSubmit={submitPrompt}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  wrap: { maxHeight: '88%' },
  /**
   * THE SHEET HAS TO BE ABLE TO SHRINK, and the scroller with it.
   *
   * `wrap` caps the sheet at 88% of the screen, but nothing under it could
   * give: the ScrollView was `flexGrow: 0` with no `flexShrink`, so it sized to
   * its FULL content height — taller than the cap — and the footer holding
   * Reset and Apply was pushed outside the clipped area. Worse, a ScrollView
   * exactly as tall as its content has nothing to scroll, so the sections could
   * not be reached either: the sheet looked frozen and had no way to commit.
   *
   * `flexShrink: 1` on both is the whole fix. The footer then keeps its natural
   * height and the scroller takes what is left.
   */
  sheet: {
    backgroundColor: '#232326',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: 26,
    flexShrink: 1,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: '#4A4A50', marginBottom: 8 },
  scroll: { flexShrink: 1 },
  scrollBody: { paddingHorizontal: space.xl, paddingBottom: 8 },
  section: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#333338' },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 10 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    maxWidth: '100%',
  },
  chipOn: { backgroundColor: colors.yellow },
  chipOff: { backgroundColor: '#35353A' },
  chipText: { fontWeight: '600', fontSize: 14, flexShrink: 1 },
  chipTextOn: { color: colors.onYellow },
  chipTextOff: { color: colors.text },
  chipCount: { fontSize: 12, fontWeight: '700' },
  chipCountOff: { color: colors.dim },
  moreBtn: { paddingVertical: 8, paddingHorizontal: 6 },
  moreText: { color: colors.yellow, fontSize: 13, fontWeight: '700' },
  savePresetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.yellow,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  savePresetText: { color: colors.yellow, fontSize: 13, fontWeight: '700' },
  hint: { color: colors.dim, fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  footer: { paddingHorizontal: space.xl, paddingTop: 12 },
  result: { color: colors.dim, fontSize: 13, fontWeight: '600', marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 12 },
  resetBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.faint,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: 13,
  },
  resetText: { color: colors.text, fontWeight: '700', letterSpacing: 1, fontSize: 13 },
  applyBtn: { flex: 1, backgroundColor: colors.yellow, borderRadius: radius.pill, alignItems: 'center', paddingVertical: 14 },
  applyText: { color: colors.onYellow, fontWeight: '700', letterSpacing: 1, fontSize: 13 },
});
