import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tapLight, tapSelection } from '@/haptics';
import { colors, radius, space } from '@/theme';

/** Black full-height screen with safe top inset. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {children}
    </SafeAreaView>
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
        <Ionicons name={close ? 'chevron-down' : 'chevron-back'} size={24} color={colors.text} />
      </Pressable>
      <Text style={s.navTitle} numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View style={s.iconBtn}>{right}</View>
    </View>
  );
}

/** TV Time's underline text tabs — WATCH LIST | UPCOMING. */
export function TopTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly T[];
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
            onChange(t);
          }}>
          <Text style={[s.topTabText, t === active && { color: colors.text }]}>{t}</Text>
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

/** Yellow uppercase pill CTA (variants: yellow | white | outline | blue). */
export function PillButton({
  label,
  onPress,
  variant = 'yellow',
  small,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'yellow' | 'white' | 'outline' | 'blue';
  small?: boolean;
}) {
  const bg =
    variant === 'yellow' ? colors.yellow : variant === 'white' ? '#FFF' : variant === 'blue' ? colors.blue : 'transparent';
  const fg = variant === 'outline' ? colors.text : variant === 'blue' ? '#FFF' : colors.onYellow;
  return (
    <Pressable
      onPress={onPress}
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
}: {
  title: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Pressable style={s.menuRow} onPress={onPress}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={[s.menuTitle, danger && { color: colors.danger }]}>{title}</Text>
        {sub != null && <Text style={s.menuSub}>{sub}</Text>}
      </View>
      {value != null && <Text style={s.menuValue}>{value}</Text>}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.faint} /> : null)}
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
          <Text style={s.errorAction}>DISMISS</Text>
        </Pressable>
        <Pressable onPress={onRefresh}>
          <Text style={s.errorAction}>REFRESH</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Blue text link — "Sort by Most relevant". */
export function BlueLink({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6}>
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
