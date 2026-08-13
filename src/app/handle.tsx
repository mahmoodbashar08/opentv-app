/**
 * Picking a handle — the last step of joining, and the only thing the server
 * needs that the phone cannot supply.
 *
 * The field is PRE-FILLED from the imported TV Time name (`meta.username`,
 * written by the importer from the export's `user.csv`), run through
 * `suggestedHandle()`. That is a courtesy, not a claim: the server owns
 * uniqueness and refuses a taken handle whatever was typed. A name with no
 * honest ASCII form leaves the field empty rather than inventing "user4821".
 *
 * Validation is mirrored from `backend/src/pure.ts` and runs as they type, so
 * the rule is learned in the field instead of after a round trip. The server
 * re-validates everything; this is a courtesy too.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, I18nManager, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '@/api';
import { afterJoin } from '@/community-prompt';
import { getToken, setHandle } from '@/community-session';
import { ContentColumn, Screen } from '@/components/ui';
import { getMeta } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorText } from '@/community-error-text';
import { HANDLE_MAX, handleFailureKey, isHandleValid, normaliseHandle, suggestedHandle } from '@/pure';
import { colors, radius, space } from '@/theme';

/** Long enough that a fast typist makes one request, short enough to feel live. */
const DEBOUNCE_MS = 400;

/**
 * What the server last said, and about WHICH handle.
 *
 * `about` is the load-bearing half. A reply for "ab" can land after the user
 * has typed "abc"; keeping the handle it was about means a stale answer is
 * simply not displayed, with no sequence counters and no cancellation. The
 * screen shows a remote verdict only while it still describes what is in the
 * field.
 */
type Remote =
  | { kind: 'none'; about: string }
  | { kind: 'checking'; about: string }
  | { kind: 'available'; about: string }
  | { kind: 'taken'; about: string }
  | { kind: 'error'; about: string; message: string };

/** What the inline line under the field is currently saying. */
type Status =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'error'; message: string };

export default function HandleScreen() {
  const insets = useSafeAreaInsets();
  // Seeded once, lazily: re-reading `meta` on every render would overwrite
  // what the user is typing.
  const [value, setValue] = useState(() => suggestedHandle(getMeta('username')) ?? '');
  const [remote, setRemote] = useState<Remote>({ kind: 'none', about: '' });
  const [saving, setSaving] = useState(false);

  const check = isHandleValid(value);

  // The local verdict is DERIVED, never stored: it is a pure function of what
  // is in the field, so putting it in state would only create a second copy
  // that can disagree with the first. The effect below therefore has no
  // synchronous setState in it at all — it starts a timer and nothing else.
  const status: Status =
    value.trim().length === 0
      ? { kind: 'idle' }
      : !check.ok
        ? // Never a request for something the server would refuse anyway, and
          // the reason appears immediately rather than after a round trip.
          { kind: 'invalid', message: t(handleFailureKey(check.reason)) }
        : remote.about !== check.handle
          ? { kind: 'idle' }
          : remote.kind === 'none'
            ? { kind: 'idle' }
            : remote.kind === 'error'
              ? { kind: 'error', message: remote.message }
              : { kind: remote.kind };

  useEffect(() => {
    const handle = isHandleValid(value);
    if (!handle.ok) return;
    const about = handle.handle;
    const timer = setTimeout(() => {
      // Inside the timer, so the spinner appears when the request actually
      // starts rather than flickering on every keystroke.
      setRemote({ kind: 'checking', about });
      void (async () => {
        try {
          const token = await getToken();
          await api('/v1/me/handle', {
            method: 'POST',
            body: { handle: about, check_only: true },
            token,
          });
          setRemote({ kind: 'available', about });
        } catch (e) {
          if (e instanceof ApiError && e.code === 'handle_taken') setRemote({ kind: 'taken', about });
          else if (e instanceof ApiError) setRemote({ kind: 'error', about, message: communityErrorText(e) });
          else setRemote({ kind: 'error', about, message: t('community.error.generic') });
        }
      })();
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const claim = async () => {
    if (saving || !check.ok) return;
    setSaving(true);
    tapLight();
    Keyboard.dismiss();
    try {
      const token = await getToken();
      await api('/v1/me/handle', { method: 'POST', body: { handle: check.handle }, token });
      // The stored handle is the NORMALISED one the server kept, not the raw
      // input — showing a user a handle nobody else would see is how a
      // homograph gap opens up.
      setHandle(check.handle);
      // The same landing as a join that needed no handle: the seed offer when
      // there is an archive to bring, otherwise straight back to the app.
      afterJoin();
    } catch (e) {
      // Losing the race between the availability check and the claim is the
      // expected failure here, and it belongs inline under the field, not in
      // an alert the user has to dismiss before they can retype.
      if (e instanceof ApiError && e.code === 'handle_taken') setRemote({ kind: 'taken', about: check.handle });
      else if (e instanceof ApiError) Alert.alert(t('community.handle.failedTitle'), communityErrorText(e));
      else Alert.alert(t('community.handle.failedTitle'), t('community.error.generic'));
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = check.ok && status.kind !== 'taken' && !saving;

  return (
    <Screen>
      <ContentColumn style={{ flex: 1, paddingHorizontal: space.xl }}>
        <View style={styles.body}>
          <Text style={styles.title}>{t('community.handle.title')}</Text>
          <Text style={styles.sub}>{t('community.handle.sub')}</Text>

          {/* The one row on this screen that must NOT mirror. "@mahmood" is a
              single left-to-right token; under RTL a plain `row` would put the
              "@" on the right of its own handle and read as "mahmood@". Asking
              for row-reverse in an RTL layout cancels the automatic flip and
              leaves the field visually left-to-right, which is what the text
              inside it already is. */}
          <View style={[styles.field, I18nManager.isRTL && styles.fieldLtr]}>
            <Text style={styles.at}>@</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={(v) => setValue(normaliseHandle(v))}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={HANDLE_MAX}
              returnKeyType="done"
              onSubmitEditing={() => void claim()}
              placeholder={t('community.handle.placeholder')}
              placeholderTextColor={colors.faint}
              // A handle is always `[a-z0-9_]`, so the field stays
              // left-to-right even in Arabic — mirroring it would put the
              // caret and the leading "@" on opposite sides of the text.
              // (`writingDirection` is a STYLE, not a prop; it lives in
              // `styles.input` alongside this.)
              textAlign="left"
            />
            {status.kind === 'checking' && <ActivityIndicator size="small" color={colors.dim} />}
            {status.kind === 'available' && <Ionicons name="checkmark-circle" size={20} color={colors.green} />}
            {(status.kind === 'taken' || status.kind === 'invalid') && (
              <Ionicons name="close-circle" size={20} color={colors.danger} />
            )}
          </View>

          <Text style={styles.hint}>
            {status.kind === 'invalid'
              ? status.message
              : status.kind === 'taken'
                ? t('community.handle.taken')
                : status.kind === 'available'
                  ? t('community.handle.available')
                  : status.kind === 'error'
                    ? status.message
                    : t('community.handle.rule')}
          </Text>
        </View>

        <Pressable
          style={[styles.cta, !canSubmit && styles.dim]}
          disabled={!canSubmit}
          onPress={() => void claim()}>
          {saving ? (
            <ActivityIndicator color={colors.onYellow} />
          ) : (
            <Text style={styles.ctaText}>{t('community.handle.claim')}</Text>
          )}
        </Pressable>
        <Text style={[styles.note, { marginBottom: space.md + insets.bottom }]}>{t('community.handle.note')}</Text>
      </ContentColumn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 27, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: 4,
  },
  fieldLtr: { flexDirection: 'row-reverse' },
  at: { color: colors.faint, fontSize: 19, fontWeight: '700' },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
    paddingVertical: 14,
    writingDirection: 'ltr',
  },
  hint: { color: colors.dim, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: { color: colors.onYellow, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  dim: { opacity: 0.4 },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', lineHeight: 18, marginTop: 12 },
});
