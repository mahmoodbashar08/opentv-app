/**
 * The OpenTV Plus paywall — a sheet, like `join`, because it is an offer that
 * slides up over what you were doing and swipes away again.
 *
 * PRICES ARE NEVER WRITTEN DOWN HERE. Every figure on this screen comes from
 * the RevenueCat package, already formatted for the storefront's currency, and
 * the annual saving is computed from the two real prices — a hardcoded "SAVE
 * 37%" is a lie the first time a price moves in one country, and App Review
 * rejects a paywall whose numbers do not match the products.
 *
 * WHEN THERE ARE NO PACKAGES — no keys yet, no products yet, or no network —
 * the screen still explains what Plus is and puts the buttons in an
 * unavailable state. A paywall that renders nothing teaches the user nothing.
 *
 * `paywall_shown` is fired by `requirePlus()` in `@/plus`, not here: the gate
 * knows which feature was asked for and this screen would only be guessing.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import type { PurchasesPackage } from 'react-native-purchases';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
import { FREE_PUBLISHED_FAVOURITES, FREE_PUBLISHED_LISTS, setPlusEntitled, usePlus } from '@/plus';
import { annualSaving, buy, getOffering, hasFreeTrial, plusStatus, restore, type Plans, type PlusStatus } from '@/purchases';
import { colors, radius, space } from '@/theme';

/**
 * What the tier actually is, in the order it is worth reading.
 *
 * THE PROFILE COMES FIRST because it is the only thing here that a subscriber
 * MAKES and other people see. Deep Stats, the filters and the heatmap are each
 * bought by one person and looked at by that same person; an arranged profile
 * is looked at by everybody who visits, almost all of them on the free tier.
 *
 * SHARED LISTS ARE SECOND, and they are the other outward-facing one: starting
 * one is the paid act and JOINING is free for ever, so a subscription pulls
 * other people into the app rather than walling one person in.
 *
 * This list ran to five for a long time and named none of the above — the
 * widgets, the filters, the heatmap and shared lists had all shipped without
 * ever appearing on the screen whose whole job is to say what Plus is.
 */
const BENEFITS = [
  { icon: 'grid-outline', key: 'plus.benefit.profile' },
  { icon: 'people-outline', key: 'plus.benefit.shared' },
  { icon: 'color-palette-outline', key: 'plus.benefit.themes' },
  { icon: 'stats-chart-outline', key: 'plus.benefit.stats' },
  { icon: 'funnel-outline', key: 'plus.benefit.filters' },
  { icon: 'flame-outline', key: 'plus.benefit.heatmap' },
  { icon: 'list-outline', key: 'plus.benefit.lists' },
  { icon: 'heart-outline', key: 'plus.benefit.badge' },
] as const;

/**
 * The comparison, and the reason its first row exists.
 *
 * `free`/`plus` are null for "—" and true for a tick. The leading row is the
 * whole tracker, ticked on BOTH sides: without it a table of things the free
 * tier does not get reads as a list of things that have just been taken away,
 * and nothing about the tracker changed.
 */
const COMPARE: { key: Parameters<typeof t>[0]; free: string | null | true; plus: string | true }[] = [
  { key: 'plus.compare.everything', free: true, plus: true },
  /*
   * THE PROFILE COMES FIRST BECAUSE IT IS THE ONE OTHER PEOPLE SEE.
   *
   * Deep Stats, the filters and the heatmap are all bought by one person and
   * looked at by that same person. An arranged profile is the only thing on
   * this list a subscriber makes and everybody else enjoys — and it was
   * missing from this table entirely, which meant the tier's largest feature
   * was invisible on the one screen that exists to explain the tier.
   */
  { key: 'plus.compare.widgets', free: null, plus: true },
  /*
   * THE NUMBER IS THE POINT, not a tick. Starting a shared list past the first
   * is the paid act; JOINING one is free at every tier, for ever. A row reading
   * "—/✓" would say the opposite of the design and put people off inviting the
   * friends the feature exists for.
   */
  { key: 'plus.compare.shared', free: '1', plus: '∞' },
  { key: 'plus.compare.themes', free: null, plus: true },
  { key: 'plus.compare.lists', free: String(FREE_PUBLISHED_LISTS), plus: '∞' },
  { key: 'plus.compare.favourites', free: String(FREE_PUBLISHED_FAVOURITES), plus: '∞' },
  { key: 'plus.compare.stats', free: null, plus: true },
  { key: 'plus.compare.filters', free: null, plus: true },
  { key: 'plus.compare.heatmap', free: null, plus: true },
  { key: 'plus.compare.crowd', free: null, plus: true },
  { key: 'plus.compare.badge', free: null, plus: true },
];

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const plus = usePlus();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [plans, setPlans] = useState<Plans | null>(null);
  const [selected, setSelected] = useState<'annual' | 'monthly'>('annual');
  /*
   * WHAT A SUBSCRIBER IS ACTUALLY PAYING FOR, and when it happens again.
   *
   * This screen said "thank you" and stopped. Somebody paying could not see
   * their renewal date, could not tell whether it WOULD renew, and had no route
   * to Apple's cancel page — which Apple requires to exist and which, hidden,
   * turns into a refund request instead of a cancellation.
   *
   * Fetched rather than derived: the date lives with the store, not on this
   * phone, and `isPlus()` knows only yes or no.
   */
  const [status, setStatus] = useState<PlusStatus | null>(null);
  useEffect(() => {
    if (!plus) return;
    let alive = true;
    void plusStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [plus]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void getOffering().then((r) => {
      if (!live || !r.ok) return;
      setPlans(r.value);
      // Whichever exists wins when only one does, so the selection can never
      // point at a package the CTA cannot buy.
      if (!r.value.annual && r.value.monthly) setSelected('monthly');
    });
    return () => {
      live = false;
    };
  }, []);

  const chosen: PurchasesPackage | null = plans ? (selected === 'annual' ? plans.annual : plans.monthly) : null;
  const trial = hasFreeTrial(chosen);
  const saving = plans ? annualSaving(plans) : null;

  const go = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    tapLight();
    const r = await buy(chosen);
    setBusy(false);
    if (r.ok && r.value) {
      // The package TYPE, never a price or a product id — shape, not content.
      track('plus_purchased', { plan: selected, from: from ?? 'unknown' });
      return;
    }
    if (!r.ok && r.reason === 'cancelled') return;
    Alert.alert(t('plus.failedTitle'), t('plus.failedBody'));
  };

  const doRestore = async () => {
    if (busy) return;
    setBusy(true);
    tapLight();
    const r = await restore();
    setBusy(false);
    if (r.ok && r.value) {
      track('plus_restored');
      Alert.alert(t('plus.restoredTitle'), t('plus.restoredBody'));
    } else if (r.ok) {
      Alert.alert(t('plus.nothingTitle'), t('plus.nothingBody'));
    } else if (r.reason !== 'cancelled') {
      Alert.alert(t('plus.failedTitle'), t('plus.failedBody'));
    }
  };

  return (
    <Screen>
      <NavHeader title={t('plus.title')} close />
      <ContentColumn style={{ flex: 1, paddingHorizontal: space.xl }}>
        {/*
          `flex: 1` FOR THE SAME REASON AS THE JOIN SCREEN, and here it is worse.

          The buy button lives in the `actions` View below this, not inside it.
          A ScrollView without a flex of its own takes the full height of its
          content, and this screen carries a seven-row comparison table, the
          plan options and the trial line — in six languages, one of which
          reverses the layout. On a small phone with large accessibility text it
          overflows, and what gets pushed past the bottom edge is the only
          control that takes money.

          Found by sweeping for the shape after the join screen was reported.
          Nobody reported this one, because the tier is not on sale yet — it
          would have been discovered by a customer who could not pay.
        */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Long-press flips the entitlement in dev builds, so every Plus
              feature can be built and reviewed before a store product exists.
              __DEV__ only — it is compiled out of a release bundle. */}
          <Pressable
            onLongPress={__DEV__ ? () => { tapLight(); setPlusEntitled(!plus); } : undefined}
            delayLongPress={800}>
            <Image source={require('@/assets/images/icon.png')} style={styles.mark} contentFit="contain" />
            <Text style={styles.title}>{t('plus.title')}</Text>
          </Pressable>

          {plus ? (
            <>
              <Text style={styles.thanksTitle}>{t('plus.thanksTitle')}</Text>
              <Text style={styles.sub}>{t('plus.thanksBody')}</Text>
              {/*
                THE DATE MEANS THE OPPOSITE THING DEPENDING ON `willRenew`.
                "Renews on the 12th" and "ends on the 12th" are the same date
                and opposite sentences, and telling a cancelled subscriber the
                first is a lie they find out about at the worst moment.
              */}
              {status?.expires != null && (
                <Text style={styles.renewal}>
                  {t(
                    status.trial
                      ? 'plus.trialUntil'
                      : status.willRenew
                        ? 'plus.renewsOn'
                        : 'plus.endsOn',
                    {
                      date: new Date(status.expires).toLocaleDateString(currentLocale(), {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      }),
                    },
                  )}
                </Text>
              )}
              {/* CANCELLING IS NEVER HIDDEN. Apple requires the route and a
                  tier that buries it collects refunds rather than renewals. */}
              {status?.managementUrl != null && (
                <Pressable onPress={() => void Linking.openURL(status.managementUrl!).catch(() => {})}>
                  <Text style={styles.manage}>{t('plus.manage')}</Text>
                </Pressable>
              )}
            </>
          ) : (
            <Text style={styles.sub}>{t('plus.tagline')}</Text>
          )}

          <View style={styles.benefits}>
            {BENEFITS.map((b) => (
              <View key={b.key} style={styles.benefit}>
                <Ionicons name={b.icon} size={20} color={colors.yellow} style={styles.benefitIcon} />
                <Text style={styles.benefitText}>{t(b.key)}</Text>
              </View>
            ))}
          </View>

          {plus ? null : plans && (plans.annual || plans.monthly) ? (
            <View style={styles.plans}>
              {plans.annual && (
                <PlanCard
                  label={t('plus.annual')}
                  price={plans.annual.product.priceString}
                  period={t('plus.perYear')}
                  badge={saving != null ? t('plus.save', { percent: formatCount(saving, currentLocale()) }) : null}
                  trial={hasFreeTrial(plans.annual) ? t('plus.trial') : null}
                  active={selected === 'annual'}
                  onPress={() => {
                    tapLight();
                    setSelected('annual');
                  }}
                />
              )}
              {plans.monthly && (
                <PlanCard
                  label={t('plus.monthly')}
                  price={plans.monthly.product.priceString}
                  period={t('plus.perMonth')}
                  badge={null}
                  trial={hasFreeTrial(plans.monthly) ? t('plus.trial') : null}
                  active={selected === 'monthly'}
                  onPress={() => {
                    tapLight();
                    setSelected('monthly');
                  }}
                />
              )}
            </View>
          ) : (
            <View style={styles.unavailableBox}>
              <Text style={styles.unavailableTitle}>{t('plus.unavailable')}</Text>
              <Text style={styles.unavailableBody}>{t('plus.unavailableBody')}</Text>
            </View>
          )}

          {/* The table, under the plans, so the price is read first and the
              detail second — and so the free tier is stated in full rather
              than implied by what Plus adds. */}
          <View style={styles.table}>
            <View style={styles.tableHead}>
              <Text style={[styles.cellLabel, styles.headLabel]}>{t('plus.compare.title')}</Text>
              <Text style={styles.headCell}>{t('plus.compare.free')}</Text>
              <Text style={[styles.headCell, styles.headPlus]}>{t('plus.compare.plus')}</Text>
            </View>
            {COMPARE.map((row) => (
              <View key={row.key} style={styles.tableRow}>
                <Text style={styles.cellLabel}>{t(row.key)}</Text>
                <Cell value={row.free} />
                <Cell value={row.plus} plus />
              </View>
            ))}
          </View>

          <Text style={styles.footer}>
            {t('plus.footer')}{' '}
            <Text style={styles.link} onPress={() => void Linking.openURL('https://theopentv.com/terms')}>
              {t('plus.terms')}
            </Text>
            {' · '}
            <Text style={styles.link} onPress={() => void Linking.openURL('https://theopentv.com/privacy')}>
              {t('plus.privacy')}
            </Text>
          </Text>
        </ScrollView>

        {plus ? null : (
          <View style={[styles.actions, { paddingBottom: space.sm + insets.bottom }]}>
            {/* Only where a trial actually applies — promising "no payment
                today" over a product that charges today is the kind of claim
                that gets an app pulled, not just rejected. */}
            {trial && <Text style={styles.noPayment}>{t('plus.noPaymentToday')}</Text>}
            <Pressable
              style={[styles.cta, (!chosen || busy) && styles.dim]}
              disabled={!chosen || busy}
              onPress={() => void go()}>
              {busy ? (
                <ActivityIndicator color={colors.onYellow} />
              ) : (
                <Text style={styles.ctaText}>{trial ? t('plus.ctaTrial') : t('plus.ctaBuy')}</Text>
              )}
            </Pressable>
            <Pressable style={styles.restore} hitSlop={12} disabled={busy} onPress={() => void doRestore()}>
              <Text style={styles.restoreText}>{t('plus.restore')}</Text>
            </Pressable>
          </View>
        )}
      </ContentColumn>
    </Screen>
  );
}

function Cell({ value, plus }: { value: string | null | true; plus?: boolean }) {
  if (value === true) {
    return (
      <View style={styles.cellBox}>
        <Ionicons name="checkmark" size={17} color={plus ? colors.yellow : colors.green} />
      </View>
    );
  }
  return <Text style={[styles.cell, value == null && styles.cellDash]}>{value ?? '—'}</Text>;
}

function PlanCard({
  label,
  price,
  period,
  badge,
  trial,
  active,
  onPress,
}: {
  label: string;
  price: string;
  period: string;
  badge: string | null;
  trial: string | null;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.plan, active && styles.planActive]} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.planLabel}>{label}</Text>
        {trial != null && <Text style={styles.planTrial}>{trial}</Text>}
      </View>
      {badge != null && (
        <View style={styles.saveBadge}>
          <Text style={styles.saveText}>{badge}</Text>
        </View>
      )}
      <Text style={styles.planPrice}>
        {price}
        <Text style={styles.planPeriod}>{period}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  renewal: { color: colors.dim, fontSize: 13, textAlign: 'center', paddingTop: 10 },
  manage: { color: colors.blue, fontSize: 14, fontWeight: '700', textAlign: 'center', paddingTop: 12 },
  body: { gap: 14, paddingVertical: space.lg, paddingBottom: space.xxl },
  mark: { width: 64, height: 64, borderRadius: 14, alignSelf: 'center' },
  title: { color: colors.text, fontSize: 27, fontWeight: '800', textAlign: 'center', marginTop: 10 },
  sub: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  thanksTitle: { color: colors.yellow, fontSize: 18, fontWeight: '800', textAlign: 'center' },

  benefits: { gap: 12, marginTop: 6 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // width + centring keeps the icons in a column whatever glyph is used, and
  // flips with the row under RTL because `flexDirection: 'row'` is mirrored.
  benefitIcon: { width: 26, textAlign: 'center' },
  benefitText: { color: colors.text, fontSize: 15.5, flex: 1, lineHeight: 21 },

  plans: { gap: 10, marginTop: 8 },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  planActive: { borderColor: colors.yellow },
  planLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  planTrial: { color: colors.green, fontSize: 12.5, marginTop: 2 },
  planPrice: { color: colors.text, fontSize: 16, fontWeight: '800' },
  planPeriod: { color: colors.dim, fontSize: 13, fontWeight: '600' },
  saveBadge: { backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  saveText: { color: colors.onYellow, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  unavailableBox: { backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 4, marginTop: 8 },
  unavailableTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  unavailableBody: { color: colors.dim, fontSize: 13.5, lineHeight: 19 },

  table: { marginTop: 18, borderRadius: 14, backgroundColor: colors.card, paddingVertical: 4 },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  cellLabel: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 19 },
  headLabel: { color: colors.faint, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  headCell: { width: 56, textAlign: 'center', color: colors.faint, fontSize: 12.5, fontWeight: '800' },
  headPlus: { color: colors.yellow },
  cellBox: { width: 56, alignItems: 'center' },
  cell: { width: 56, textAlign: 'center', color: colors.text, fontSize: 14, fontWeight: '700' },
  cellDash: { color: colors.faint },

  footer: { color: colors.faint, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 16 },
  link: { color: colors.blue, fontWeight: '700' },

  actions: { gap: 8, paddingTop: space.sm },
  noPayment: { color: colors.dim, fontSize: 13, textAlign: 'center' },
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 16,
  },
  ctaText: { color: colors.onYellow, fontWeight: '800', fontSize: 15.5, letterSpacing: 0.5 },
  dim: { opacity: 0.5 },
  restore: { paddingVertical: 12, alignItems: 'center' },
  restoreText: { color: colors.dim, fontSize: 14.5, fontWeight: '600' },
});
