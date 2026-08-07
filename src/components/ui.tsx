import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Dimensions, I18nManager, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { tapLight, tapSelection } from '@/haptics';
import { detailPaneLayout } from '@/pure';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

/**
 * The status bar's height, even inside a modal.
 *
 * WHY NOT JUST `useSafeAreaInsets()`. A screen presented as `transparentModal`
 * is its own native window on iOS, and the root `SafeAreaProvider`'s context
 * does not cross that boundary — every inset inside it reads ZERO. That is
 * what drew the community profile's close chevron on top of the status bar
 * clock: the control sat exactly where a 0pt inset says the screen begins, the
 * clock is not tappable, and the screen had no way out.
 *
 * `initialWindowMetrics` is filled by the native side at launch and is not
 * context, so it survives the crossing. The hook is still preferred when it has
 * a real value: it is the one that responds to rotation and to a window being
 * resized on iPad.
 */
function useTopInset(): number {
  const insets = useSafeAreaInsets();
  return insets.top || initialWindowMetrics?.insets.top || 0;
}

/** Black full-height screen with a safe top inset. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: useTopInset() }}>{children}</View>
  );
}

/** The readable content width every capped screen shares. Exported so screens
 *  whose own geometry must agree with the cap (paging widths, card sizes) read
 *  the same number rather than keeping their own copy.
 *
 *  Equal by design to pure.ts's TABLET_MIN_W (also 700) — that equality is
 *  what guarantees this cap never binds below the tablet breakpoint. They are
 *  kept as two separate constants (a layout cap vs. a device-width test) and
 *  must not be merged into one. */
export const CONTENT_MAX_WIDTH = 700;

/** Caps a screen's BODY at a readable width and centres it, so a 1366pt iPad
 *  does not render a description as one enormous line.
 *
 *  Deliberately not applied to NavHeader: capping the header too would drag the
 *  back button into the middle of the screen. Header spans, content centres.
 *
 *  On a phone the maxWidth never binds, so phone layouts are unchanged. */
export function ContentColumn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' }, style]}>{children}</View>;
}

/** Pushed/modal page header: back or close, centered title, optional right slot. */
/** Clearance for the iPadOS window controls, which are drawn by the system at
 *  the top-left of a windowed app — directly on top of our back button. iOS
 *  reports no safe-area inset for them, so the app has to make the room. */
const WINDOW_CONTROLS_W = 76;

export function NavHeader({
  title,
  close,
  right,
}: {
  title?: string;
  close?: boolean;
  right?: ReactNode;
}) {
  // windowed (Split View, Stage Manager, a tiled window) when the app's own
  // width is narrower than the physical screen. Full screen on any device —
  // including every phone — leaves this at 0 and the header untouched.
  const appW = useWindowDimensions().width;
  const windowed = appW < Dimensions.get('screen').width - 1;
  return (
    <View style={[s.navHead, windowed && { paddingLeft: WINDOW_CONTROLS_W }]}>
      <Pressable style={s.iconBtn} onPress={() => router.back()} hitSlop={8}>
        <Ionicons
          name={close ? 'chevron-down' : I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'}
          size={24}
          color={colors.text}
        />
      </Pressable>
      <Text style={s.navTitle} numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View style={s.iconBtn}>{right}</View>
    </View>
  );
}

/**
 * Style for a detail screen (show, movie, episode) so it sits BESIDE the list
 * on a wide screen instead of covering it.
 *
 * These screens are already presented with the screen beneath still rendered —
 * that is what lets you drag one down and see the list behind it. So this is
 * not a navigation change: the same screen simply gets a narrower container
 * pinned to the right edge, and the list shows through on the left.
 *
 * Returns nothing below the breakpoint, so phones and narrow windows keep
 * exactly the full-screen behaviour they have today.
 */
export function useDetailPaneStyle(): ViewStyle | null {
  const { paned, width } = detailPaneLayout(useWindowDimensions().width);
  if (!paned) return null;
  return {
    width,
    alignSelf: 'flex-end',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.line,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: -6, height: 0 },
  };
}

/**
 * The width a detail screen actually occupies — the pane's width when it is
 * beside the list, the window's width otherwise.
 *
 * Any geometry inside a detail screen must measure against THIS, not the
 * window. The episode pager sizes each page and computes its scroll offsets
 * from it: given the window width while sitting in a 60% pane, every page was
 * wider than its container, so the content spilled out and slid sideways as
 * you scrolled.
 */
export function useDetailWidth(): number {
  const w = useWindowDimensions().width;
  const { paned, width } = detailPaneLayout(w);
  return paned ? width : w;
}

/** TV Time's underline text tabs — WATCH LIST | UPCOMING.
 *
 * `tabs` are stable English identifiers — compared in code, sometimes stored
 * or used as route params — and must never change value or order. `labels`
 * is a `Record<T, string>` keyed by those same identifiers: TypeScript
 * requires every key of T to be present, so a caller that forgets to supply
 * a translated label for one of its tabs is a compile error, not a silent
 * fallback to the English id. */
export function TopTabs<T extends string>({
  tabs,
  labels,
  active,
  onChange,
}: {
  tabs: readonly T[];
  labels: Record<T, string>;
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <View style={s.topTabs}>
      {/* grey hairline across the whole bar; the white bar covers the active half */}
      <View style={s.tabHairline} />
      {tabs.map((t) => (
        <Pressable
          key={t}
          style={s.topTab}
          onPress={() => {
            tapSelection();
            // The tab KEY, not its label: keys are constants chosen in code, so
            // they read the same in every language.
            track('tap', { control: 'top_tab', id: t });
            onChange(t);
          }}>
          <Text style={[s.topTabText, t === active && { color: colors.text }]}>{labels[t]}</Text>
          {t === active && <View style={s.underline} />}
        </Pressable>
      ))}
    </View>
  );
}

/** Grey centered section pill — WATCH NEXT / HAVEN'T STARTED. */
export function SectionPill({ label }: { label: string }) {
  return (
    <View style={s.sectionPillWrap}>
      <Text style={s.sectionPill}>{label}</Text>
    </View>
  );
}

/**
 * Yellow uppercase pill CTA (variants: yellow | white | outline | blue).
 *
 * `trackId` NAMES THIS BUTTON IN ANALYTICS, and is the reason the label is not
 * used for it: the label is translated, so counting it would split one button
 * across six locales and leak nothing useful. An id is a constant chosen in
 * code. Omitted, the press still counts — as a generic `pill` on whatever
 * screen it was — which is the honest floor rather than silence.
 */
export function PillButton({
  label,
  onPress,
  variant = 'yellow',
  small,
  trackId,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'yellow' | 'white' | 'outline' | 'blue';
  small?: boolean;
  trackId?: string;
}) {
  const bg =
    variant === 'yellow' ? colors.yellow : variant === 'white' ? '#FFF' : variant === 'blue' ? colors.blue : 'transparent';
  const fg = variant === 'outline' ? colors.text : variant === 'blue' ? '#FFF' : colors.onYellow;
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              track('tap', { control: 'pill', id: trackId ?? 'unnamed' });
              onPress();
            }
          : undefined
      }
      style={[
        s.pill,
        { backgroundColor: bg },
        variant === 'outline' && { borderWidth: 1.5, borderColor: colors.text },
        small && { paddingVertical: 9, paddingHorizontal: 18 },
      ]}>
      <Text style={[s.pillText, { color: fg }, small && { fontSize: 12 }]}>{label}</Text>
    </Pressable>
  );
}

/** The mark-seen circle. Light grey → green when watched. */
export function CheckCircle({
  watched,
  onPress,
  size = 44,
  iconSize,
}: {
  watched?: boolean;
  onPress?: () => void;
  size?: number;
  iconSize?: number;
}) {
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              tapLight();
              // The mark-seen circle: the single most-pressed control in the
              // app, and the one whose rate says whether tracking still works
              // for people. WHICH episode is never sent — see `analytics.ts`.
              track('tap', { control: 'check', id: watched ? 'unmark' : 'mark' });
              onPress();
            }
          : undefined
      }
      hitSlop={8}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: watched ? colors.green : colors.checkIdle,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Ionicons name="checkmark" size={iconSize ?? size * 0.45} color={watched ? '#FFF' : colors.checkIdleGlyph} />
    </Pressable>
  );
}

/** Settings/menu row: title, optional sub/value, chevron. */
export function MenuRow({
  title,
  sub,
  value,
  onPress,
  danger,
  right,
  icon,
  trackId,
}: {
  title: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
  icon?: ReactNode;
  trackId?: string;
}) {
  return (
    <Pressable
      style={s.menuRow}
      onPress={
        onPress
          ? () => {
              track('tap', { control: 'menu_row', id: trackId ?? 'unnamed' });
              onPress();
            }
          : undefined
      }>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={[s.menuTitle, danger && { color: colors.danger }]}>{title}</Text>
        {sub != null && <Text style={s.menuSub}>{sub}</Text>}
      </View>
      {value != null && <Text style={s.menuValue}>{value}</Text>}
      {right ?? (onPress ? <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.faint} /> : null)}
    </Pressable>
  );
}

/** Popcorn empty state with optional yellow CTA. */
export function EmptyState({
  title,
  caption,
  cta,
  onPress,
}: {
  title: string;
  caption?: string;
  cta?: string;
  onPress?: () => void;
}) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      <View style={s.emptyIllo}>
        <Text style={{ fontSize: 48 }}>🍿</Text>
      </View>
      {caption != null && <Text style={s.emptySub}>{caption}</Text>}
      {cta != null && <PillButton label={cta} onPress={onPress} />}
    </View>
  );
}

/** Pink error bar with DISMISS / REFRESH. */
export function ErrorBar({ message, onDismiss, onRefresh }: { message: string; onDismiss?: () => void; onRefresh?: () => void }) {
  return (
    <View style={s.errorBar}>
      <Text style={{ color: '#201014', fontSize: 15 }}>{message}</Text>
      <View style={s.errorActions}>
        <Pressable onPress={onDismiss}>
          <Text style={s.errorAction}>{t('ui.dismiss')}</Text>
        </Pressable>
        <Pressable onPress={onRefresh}>
          <Text style={s.errorAction}>{t('ui.refresh')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Blue text link — "Sort by Most relevant". */
export function BlueLink({ label, onPress, trackId }: { label: string; onPress?: () => void; trackId?: string }) {
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              track('tap', { control: 'link', id: trackId ?? 'unnamed' });
              onPress();
            }
          : undefined
      }
      hitSlop={6}>
      <Text style={{ color: colors.blue, fontWeight: '600', fontSize: 14.5 }}>{label}</Text>
    </Pressable>
  );
}

/** Big stat card used across the Stats page. */
export function StatCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statCardTitle}>{title}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  navHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  navTitle: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  iconBtn: { width: 40, height: 34, alignItems: 'center', justifyContent: 'center' },

  topTabs: { flexDirection: 'row' },
  tabHairline: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: '#2E2E33' },
  topTab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  topTabText: {
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.faint,
  },
  // full-width bar under the active tab, flush to the cell edges like the real app
  underline: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: colors.text },

  sectionPillWrap: { alignItems: 'center', marginVertical: 10 },
  sectionPill: {
    backgroundColor: colors.pillGrey,
    color: colors.text,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },

  pill: {
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },

  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  menuTitle: { color: colors.text, fontSize: 15.5 },
  menuSub: { color: colors.faint, fontSize: 12.5, marginTop: 1 },
  menuValue: { color: colors.blue, fontSize: 14.5, fontWeight: '500' },

  empty: {
    flex: 1,
    margin: space.md,
    borderRadius: radius.card,
    backgroundColor: '#1B1B1D',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  emptyTitle: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptyIllo: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#7BB34C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySub: { color: colors.dim, fontSize: 15, textAlign: 'center' },

  errorBar: {
    backgroundColor: '#F6CFD3',
    borderRadius: 6,
    marginHorizontal: space.md,
    marginBottom: 10,
    padding: 14,
  },
  errorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 26, marginTop: 8 },
  errorAction: { fontWeight: '700', fontSize: 13.5, letterSpacing: 0.5, color: '#201014' },

  statCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    marginHorizontal: space.lg,
    marginBottom: space.md,
  },
  statCardTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
});
