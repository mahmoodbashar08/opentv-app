/**
 * The live room for one episode-night (2.0.0, DESIGN-community §3.2).
 *
 *   header      show · SxEy, and how many are here
 *   faces       up to twelve people, "+N" for the rest
 *   stream      the reactions, newest at the bottom (an inverted FlatList)
 *   control     the twelve feelings — one tap, one reaction, the face floats up
 *
 * NOTHING TO READ, NOTHING TO TYPE. A reaction here is ephemeral (D18): it is
 * not the episode's own feeling, it is never written to SQLite, and it is gone
 * when this sheet closes. The server forgets it when the night ends.
 *
 * STATE COMES FROM THE SOCKET, THROUGH `useReducer`. Every event is a real
 * React update folded by `foldRoom` (pure.ts, tested) — never a render-time
 * read of something outside React plus a counter, which the React Compiler
 * would memoise away (CLAUDE.md).
 *
 * Long-press a person — in the faces row or the stream — for Report and Block.
 * A block hides them here at once and rejoins, because the server applies
 * blocks at the door (API.md).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api';
import { track } from '@/analytics';
import { blockProfile, reportProfile } from '@/community-comments';
import { openRoom, type RoomHandle, type RoomPhase } from '@/community-room';
import { getProfileId } from '@/community-session';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { CommunityAvatar } from '@/components/person-row';
import { useSwipeDown } from '@/components/swipe-down';
import { BlueLink, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import type { LocaleKey } from '@/locales/keys';
import { usePlus } from '@/plus';
import {
  EMOTION_FACES,
  EMOTION_NAMES,
  EMPTY_ROOM,
  REPORT_REASONS,
  commentErrorKey,
  foldRoom,
  parseRoomKey,
  relativeTime,
  reportReasonKey,
  roomWithout,
  type EmotionName,
  type RoomMessage,
  type RoomReaction,
  type RoomShell,
  type RoomView,
} from '@/pure';
import { colors, radius, space } from '@/theme';

const FACES_SHOWN = 12;

type Action = { type: 'msg'; msg: RoomMessage } | { type: 'without'; id: string };

function reducer(view: RoomView, a: Action): RoomView {
  return a.type === 'msg' ? foldRoom(view, a.msg) : roomWithout(view, a.id);
}

const feeling = (e: EmotionName) => t(`media.emotions.${e}` as LocaleKey);
const faceOf = (e: EmotionName) => EMOTION_FACES[EMOTION_NAMES.indexOf(e)] ?? '';

function errorText(e: unknown): string {
  return t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown'));
}

/**
 * Long-press, offered to a screen reader as a named action too. VoiceOver's
 * double-tap-and-hold reaches `onLongPress`, but nothing announces that it is
 * there; the action is listed in the rotor and in TalkBack's actions menu.
 */
function personActions(run: () => void) {
  return {
    accessibilityActions: [{ name: 'longpress', label: t('a11y.roomPersonActions') }],
    onAccessibilityAction: (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'longpress') run();
    },
  };
}

/** A face that rises and fades over the stream — the tap, made visible. */
function Floater({ face, offset, onDone }: { face: string; offset: number; onDone: () => void }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(1);
  useEffect(() => {
    y.value = withTiming(-240, { duration: 1300 });
    opacity.value = withTiming(0, { duration: 1300 }, (done) => {
      if (done) runOnJS(onDone)();
    });
    // Once, on mount: each floater lives one flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: opacity.value }));
  return (
    <Animated.Text
      style={[styles.floater, { start: offset }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no">
      {face}
    </Animated.Text>
  );
}

export default function RoomScreen() {
  const params = useLocalSearchParams<{ key?: string; name?: string }>();
  const key = params.key ?? '';
  const parsed = useMemo(() => parseRoomKey(key), [key]);
  const showName = params.name ?? '';
  const plus = usePlus();
  const insets = useSafeAreaInsets();
  const { headerGesture, animatedStyle } = useSwipeDown();

  const [view, dispatch] = useReducer(reducer, EMPTY_ROOM);
  const [phase, setPhase] = useState<RoomPhase>('connecting');
  const [menuFor, setMenuFor] = useState<RoomShell | null>(null);
  const [reportFor, setReportFor] = useState<RoomShell | null>(null);
  const [floaters, setFloaters] = useState<{ id: number; face: string; offset: number }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const room = useRef<RoomHandle | null>(null);
  const floatId = useRef(0);
  const me = getProfileId();

  // Plus is checked before the socket as well as at the door: React Native
  // cannot read a refused upgrade, so a free member would otherwise sit in the
  // backoff loop. The tap that got here already ran `requirePlus`; this covers
  // a deep link, or a subscription that lapsed while the page was open.
  useEffect(() => {
    if (!plus || !parsed) return;
    track('room_open');
    const handle = openRoom(key, {
      message: (msg) => dispatch({ type: 'msg', msg }),
      phase: setPhase,
    });
    room.current = handle;
    return () => {
      handle.close();
      room.current = null;
    };
  }, [plus, parsed, key]);

  // "just now", "2 minutes ago" move on while the sheet stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Newest first for the inverted list, built once per change rather than per render.
  const rows = useMemo(() => view.stream.slice().reverse(), [view.stream]);

  const openMenu = useCallback(
    (who: RoomShell) => {
      if (who.id === me) return;
      tapLight();
      setMenuFor(who);
    },
    [me],
  );

  const react = (i: number) => {
    const name = EMOTION_NAMES[i];
    if (!name || !room.current?.react(name)) return;
    tapLight();
    const id = ++floatId.current;
    // Spread across the width so a burst of taps does not stack into one glyph.
    setFloaters((f) => [...f, { id, face: EMOTION_FACES[i] ?? '', offset: 24 + ((id * 53) % 240) }]);
  };
  const landed = useCallback((id: number) => setFloaters((f) => f.filter((x) => x.id !== id)), []);

  const renderItem = useCallback(
    ({ item }: { item: RoomReaction }) => {
      const age = relativeTime(item.at, now);
      const ageText = age ? t(age.key as LocaleKey, { count: age.count }) : '';
      return (
        <Pressable
          style={styles.row}
          onLongPress={() => openMenu(item.who)}
          accessible
          accessibilityLabel={t('a11y.roomReaction', { handle: item.who.handle, feeling: feeling(item.emotion), time: ageText })}
          {...(item.who.id === me ? {} : personActions(() => openMenu(item.who)))}>
          <Text style={styles.rowFace}>{faceOf(item.emotion)}</Text>
          <Text style={styles.rowHandle} numberOfLines={1}>
            {item.who.handle}
          </Text>
          <Text style={styles.rowFeeling} numberOfLines={1}>
            {feeling(item.emotion)}
          </Text>
          <Text style={styles.rowAge}>{ageText}</Text>
        </Pressable>
      );
    },
    [now, me, openMenu],
  );

  const menuActions = useMemo((): SheetAction[] => {
    if (!menuFor) return [];
    const who = menuFor;
    return [
      { text: t('room.report', { handle: who.handle }), icon: 'flag-outline', onPress: () => setReportFor(who) },
      {
        text: t('room.block', { handle: who.handle }),
        icon: 'ban-outline',
        destructive: true,
        onPress: () =>
          // Confirmed first, as everywhere else: it is not undone from here and
          // it drops any follow both ways.
          Alert.alert(t('community.block.title', { handle: who.handle }), t('community.block.body'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('community.block.confirm'),
              style: 'destructive',
              onPress: () => {
                void blockProfile(who.id)
                  .then(() => {
                    dispatch({ type: 'without', id: who.id });
                    room.current?.rejoin();
                  })
                  .catch((e: unknown) => Alert.alert(t('community.block.failedTitle'), errorText(e)));
              },
            },
          ]),
      },
    ];
  }, [menuFor]);

  const reportActions = useMemo(
    (): SheetAction[] =>
      reportFor == null
        ? []
        : REPORT_REASONS.map((reason) => ({
            text: t(reportReasonKey(reason)),
            icon: 'alert-circle-outline' as const,
            onPress: () => {
              void reportProfile(reportFor.id, reason)
                // 202 — filed, not judged. The words say so.
                .then(() => Alert.alert(t('community.report.sentTitle'), t('community.report.sentBody')))
                .catch((e: unknown) => Alert.alert(t('community.report.failedTitle'), errorText(e)));
            },
          })),
    [reportFor],
  );

  const code = parsed ? `S${parsed.season}E${parsed.episode}` : '';
  const title = showName ? `${showName} · ${code}` : code;
  const live = phase === 'live';
  const extra = Math.max(0, view.watching - Math.min(view.faces.length, FACES_SHOWN));

  const openThread = () => {
    if (!parsed) return;
    router.replace(
      `/thread?source=tvdb&key=${parsed.tvdbId}&season=${parsed.season}&episode=${parsed.episode}&title=${encodeURIComponent(title)}&name=${encodeURIComponent(showName)}`,
    );
  };

  /** Everything that is not the live room, said in one line. */
  const notice = !parsed ? (
    <Text style={styles.noticeText}>{t('room.failed')}</Text>
  ) : !plus ? (
    <>
      <Text style={styles.noticeText}>{t('room.needsPlus')}</Text>
      <PillButton label={t('room.seePlus')} trackId="room.seePlus" onPress={() => router.replace('/paywall?from=room')} />
    </>
  ) : phase === 'closed' ? (
    <>
      <Text style={styles.noticeTitle} accessibilityRole="header">
        {t('room.closedTitle')}
      </Text>
      <Text style={styles.noticeText}>{t('room.closedBody')}</Text>
      <BlueLink label={t('room.toComments')} trackId="room.toComments" onPress={openThread} />
    </>
  ) : phase === 'unavailable' ? (
    <Text style={styles.noticeText}>{t('room.unavailable')}</Text>
  ) : phase === 'unwatched' ? (
    <Text style={styles.noticeText}>{t('room.unwatched')}</Text>
  ) : phase === 'failed' ? (
    <Text style={styles.noticeText}>{t('room.failed')}</Text>
  ) : null;

  return (
    <Screen>
      <Animated.View style={[{ flex: 1 }, animatedStyle]}>
        <GestureDetector gesture={headerGesture}>
          <View>
            <NavHeader
              title={title}
              close
              right={
                live ? (
                  <Text style={styles.count} accessibilityLabel={t('room.watching', { count: view.watching })}>
                    {`${view.watching} 👁`}
                  </Text>
                ) : null
              }
            />
            {live && view.faces.length > 0 && (
              <View style={styles.faces}>
                {view.faces.slice(0, FACES_SHOWN).map((f) => (
                  <Pressable
                    key={f.id}
                    onLongPress={() => openMenu(f)}
                    accessible
                    accessibilityLabel={`@${f.handle}`}
                    {...(f.id === me ? {} : personActions(() => openMenu(f)))}>
                    <CommunityAvatar person={f} size={34} />
                  </Pressable>
                ))}
                {extra > 0 && (
                  <Text style={styles.more} accessibilityLabel={t('a11y.roomMore', { count: extra })}>
                    {`+${extra}`}
                  </Text>
                )}
              </View>
            )}
          </View>
        </GestureDetector>

        {notice != null ? (
          <View style={styles.notice}>{notice}</View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              {!live && (
                <View style={styles.connecting} accessible accessibilityLiveRegion="polite" accessibilityLabel={t('room.connecting')}>
                  <ActivityIndicator color={colors.yellow} />
                  <Text style={styles.connectingText}>{t('room.connecting')}</Text>
                </View>
              )}
              <FlatList
                inverted
                data={rows}
                keyExtractor={(r, i) => `${r.at}|${r.who.id}|${r.emotion}|${i}`}
                renderItem={renderItem}
                extraData={now}
                contentContainerStyle={{ paddingVertical: space.sm }}
                ListEmptyComponent={
                  // The list flips this back the right way up itself (VirtualizedList's inversionStyle).
                  live ? <Text style={styles.empty}>{t('room.empty')}</Text> : null
                }
              />
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {floaters.map((f) => (
                  <Floater key={f.id} face={f.face} offset={f.offset} onDone={() => landed(f.id)} />
                ))}
              </View>
            </View>

            <View style={[styles.control, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
              {EMOTION_NAMES.map((name, i) => (
                <Pressable
                  key={name}
                  style={({ pressed }) => [styles.face, pressed && { opacity: 0.6 }, !live && { opacity: 0.4 }]}
                  onPress={() => react(i)}
                  disabled={!live}
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y.roomReact', { feeling: feeling(name) })}
                  accessibilityState={{ disabled: !live }}>
                  <Text style={styles.faceGlyph}>{EMOTION_FACES[i]}</Text>
                  <Text style={styles.faceLabel} numberOfLines={1}>
                    {feeling(name)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </Animated.View>

      <ActionSheet
        visible={menuFor != null}
        title={menuFor ? `@${menuFor.handle}` : undefined}
        actions={menuActions}
        onClose={() => setMenuFor(null)}
      />
      <ActionSheet
        visible={reportFor != null}
        title={reportFor ? t('room.report', { handle: reportFor.handle }) : undefined}
        actions={reportActions}
        onClose={() => setReportFor(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  count: { color: colors.text, fontSize: 15, fontWeight: '700' },
  faces: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingBottom: space.md },
  more: { color: colors.dim, fontSize: 14, fontWeight: '700', marginStart: 4 },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: space.xxl },
  noticeTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  noticeText: { color: colors.dim, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  connecting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: space.md },
  connectingText: { color: colors.dim, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.lg, paddingVertical: 8 },
  rowFace: { fontSize: 22 },
  rowHandle: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  rowFeeling: { color: colors.dim, fontSize: 14, flex: 1 },
  rowAge: { color: colors.faint, fontSize: 12 },
  empty: { color: colors.faint, fontSize: 14, textAlign: 'center', paddingVertical: space.xxl, paddingHorizontal: space.xxl },
  floater: { position: 'absolute', bottom: 8, fontSize: 34 },
  control: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    paddingTop: space.md,
    paddingHorizontal: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.card,
    backgroundColor: colors.panel,
  },
  face: { width: '15%', minWidth: 52, alignItems: 'center', paddingVertical: 6, borderRadius: radius.card },
  faceGlyph: { fontSize: 26 },
  faceLabel: { color: colors.dim, fontSize: 10, marginTop: 2 },
});
