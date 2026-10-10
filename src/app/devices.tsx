/**
 * Your devices — every phone and tablet that syncs with this account.
 *
 * WHY A LIST AT ALL. Sync had no registry: a device was a random id on each
 * op, so a lost phone kept receiving what you watched until you thought to
 * turn backup off everywhere, and nothing stopped one Plus being handed round
 * a group chat. The list answers both — Remove, and a cap the server keeps
 * (`DEVICE_LIMIT` there, `limit` here, so this screen never carries its own
 * copy of the number).
 *
 * THIS PHONE HAS NO REMOVE. Removing the phone in your hand is turning backup
 * off, which that screen already does with a clearer name; a Remove that
 * turned the current screen against itself would be a trap.
 *
 * THE WAY BACK IN IS HERE TOO. A phone the server turned away (removed, or one
 * too many — see `tellRefused` in device-sync.ts) says so at the top with one
 * button, because the alert that told it once has long since been dismissed
 * and nothing else on the phone would admit sync is off.
 *
 * OPTIMISTIC, like follow requests: the row leaves on Remove and comes back if
 * the server refuses. A 404 is "already gone" and the row stays gone.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { communityErrorText } from '@/community-error-text';
import { ContentColumn, ErrorBar, NavHeader, PillButton, Screen } from '@/components/ui';
import { deviceId, fetchDevices, removeDevice, setSyncEnabled, syncDevices, syncRefused } from '@/device-sync';
import { orderDevices, type Device } from '@/devices';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { colors, radius, space } from '@/theme';

export default function DevicesScreen() {
  const [items, setItems] = useState<Device[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(syncRefused);
  const [busy, setBusy] = useState(false);
  const me = deviceId();

  const refresh = useCallback(() => {
    setRefused(syncRefused());
    setError(null);
    void fetchDevices()
      .then((r) => {
        setItems(orderDevices(r.devices, me));
        setLimit(r.limit);
      })
      .catch((e: unknown) => {
        setItems((prev) => prev ?? []);
        setError(communityErrorText(e));
      });
  }, [me]);
  // ON FOCUS, not on mount: a device removed from another phone should be gone
  // when this list is looked at again, not when the app restarts.
  useFocusEffect(refresh);

  /** Back in: the refusal is cleared by turning sync on, and the next sync
   *  either registers this phone or is told no again (and says so itself). */
  const turnOn = async () => {
    if (busy) return;
    tapLight();
    setBusy(true);
    try {
      setSyncEnabled(true);
      const out = await syncDevices();
      setRefused(syncRefused());
      if (out === 'done') refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = (d: Device) => {
    const name = d.name ?? t('devices.unnamed');
    Alert.alert(t('devices.removeTitle', { name }), t('devices.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.remove'), style: 'destructive', onPress: () => void doRemove(d) },
    ]);
  };

  const doRemove = async (d: Device) => {
    tapLight();
    setItems((prev) => (prev ?? []).filter((x) => x.device !== d.device));
    try {
      await removeDevice(d.device);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') return;
      refresh();
      Alert.alert(t('cloudBackup.failedTitle'), communityErrorText(e));
      return;
    }
    // ROOM MADE, SO TRY NOW: somebody turned away for being one too many came
    // here to remove one, and that was the whole fix.
    if (refused === 'device_limit') void turnOn();
  };

  return (
    <Screen>
      <NavHeader title={t('devices.title')} />
      {items === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(d) => d.device}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            <ContentColumn>
              <Text style={styles.intro}>{t('devices.intro')}</Text>
              {refused && (
                <View style={styles.offCard}>
                  <View accessible accessibilityRole="text">
                    <Text style={styles.offTitle}>{t('devices.offTitle')}</Text>
                    <Text style={styles.offBody}>
                      {t(refused === 'device_removed' ? 'devices.offRemoved' : 'devices.offLimit')}
                    </Text>
                  </View>
                  <PillButton
                    label={t('devices.turnOn')}
                    trackId="devices.turnOn"
                    small
                    onPress={busy ? undefined : () => void turnOn()}
                  />
                </View>
              )}
              {error != null && <ErrorBar message={error} onDismiss={() => setError(null)} onRefresh={refresh} />}
            </ContentColumn>
          }
          ListEmptyComponent={<Text style={styles.empty}>{t('devices.empty')}</Text>}
          ListFooterComponent={
            limit > 0 ? (
              <ContentColumn>
                <Text style={styles.footer}>{t('devices.limitNote', { count: limit })}</Text>
              </ContentColumn>
            ) : null
          }
          renderItem={({ item }) => <DeviceRow d={item} mine={item.device === me} onRemove={() => remove(item)} />}
        />
      )}
    </Screen>
  );
}

function DeviceRow({ d, mine, onRemove }: { d: Device; mine: boolean; onRemove: () => void }) {
  const name = d.name ?? t('devices.unnamed');
  const seen = t('devices.lastSeen', {
    date: new Date(d.last_seen).toLocaleDateString(currentLocale(), { dateStyle: 'medium' }),
  });
  const icon = d.platform === 'android' ? 'logo-android' : d.platform === 'ios' ? 'logo-apple' : 'phone-portrait-outline';
  return (
    <ContentColumn>
      <View style={styles.row}>
        {/* THE WORDS ARE ONE ELEMENT, THE BUTTON ANOTHER. Grouping the whole
            row would swallow Remove for a screen reader. */}
        <View
          style={styles.info}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${name}. ${seen}${mine ? `. ${t('devices.thisPhone')}` : ''}`}>
          <View style={styles.iconWrap}>
            <Ionicons name={icon} size={22} color={colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              {/* GREEN CONFIRMS: "this phone" is a fact about where you are, not a thing to tap. */}
              {mine && (
                <View style={styles.mine}>
                  <Text style={styles.mineText}>{t('devices.thisPhone')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.sub}>{seen}</Text>
          </View>
        </View>
        {!mine && (
          <Pressable
            hitSlop={8}
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={t('devices.removeA11y', { name })}>
            <Text style={styles.remove}>{t('common.remove')}</Text>
          </Pressable>
        )}
      </View>
    </ContentColumn>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 60 },
  intro: { color: colors.dim, fontSize: 14, lineHeight: 20, paddingHorizontal: space.lg, paddingTop: 12, paddingBottom: 10 },
  offCard: {
    marginHorizontal: space.lg,
    marginBottom: 8,
    padding: 14,
    gap: 12,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    alignItems: 'flex-start',
  },
  offTitle: { color: colors.text, fontSize: 15.5, fontWeight: '800', marginBottom: 4 },
  offBody: { color: colors.dim, fontSize: 13.5, lineHeight: 19 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  mine: { backgroundColor: colors.green, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  mineText: { color: colors.bg, fontSize: 11, fontWeight: '800' },
  sub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  remove: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  empty: { color: colors.dim, fontSize: 14.5, textAlign: 'center', marginTop: 40, paddingHorizontal: 40, lineHeight: 20 },
  footer: { color: colors.faint, fontSize: 12.5, lineHeight: 17, paddingHorizontal: space.lg, paddingTop: 14 },
});
