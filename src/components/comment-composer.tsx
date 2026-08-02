/**
 * The box you type a comment into — the thread's and the permalink's.
 *
 * PRESENTATION ONLY. Posting is deliberately NOT in here: the thread inserts an
 * optimistic row into one of two collections depending on whether it is a reply,
 * expands the parent, and reconciles against the saved row; the permalink screen
 * only ever appends to one list. Those are genuinely different, and a shared
 * `send` would have to know which screen was asking — which is the shape that
 * made the two comment lists drift apart before they were unified.
 *
 * So this owns the look and the rules that belong to the look: the length cap
 * with headroom, the spoiler toggle, the disabled Send, the RTL arrow. Each
 * screen owns what happens when it fires.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { RefObject } from 'react';
import { ActivityIndicator, I18nManager, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { COMMENT_BODY_MAX, commentBodyError } from '@/pure';
import { colors, radius, space } from '@/theme';

export type CommentComposerProps = {
  value: string;
  onChangeText: (v: string) => void;
  spoiler: boolean;
  onToggleSpoiler: () => void;
  sending: boolean;
  onSend: () => void;
  /** Shows the "Replying to @x" bar. Omit on a screen where every post is a
   *  reply to the same thing — the bar would state the obvious on every row. */
  replyingTo?: string | null;
  onCancelReply?: () => void;
  /** Not joined: the composer is replaced by the prompt to join. */
  joined: boolean;
  placeholder?: string;
  /** So a Reply tap can put the caret straight in the box. */
  inputRef?: RefObject<TextInput | null>;
};

export function CommentComposer({
  value,
  onChangeText,
  spoiler,
  onToggleSpoiler,
  sending,
  onSend,
  replyingTo,
  onCancelReply,
  joined,
  placeholder,
  inputRef,
}: CommentComposerProps) {
  if (!joined) {
    return (
      <Pressable style={styles.joinRow} onPress={() => router.push('/join')}>
        <Ionicons name="chatbubbles-outline" size={18} color={colors.yellow} />
        <Text style={styles.joinText}>{t('community.comments.joinToComment')}</Text>
      </Pressable>
    );
  }

  const bodyFailure = commentBodyError(value);
  const overLength = value.trim().length > COMMENT_BODY_MAX;

  return (
    <View style={styles.composer}>
      {replyingTo != null && replyingTo !== '' && (
        <View style={styles.replyBar}>
          <Text style={styles.replyBarText} numberOfLines={1}>
            {t('community.comments.replyingTo', { handle: replyingTo })}
          </Text>
          {onCancelReply != null && (
            <Pressable hitSlop={10} onPress={onCancelReply}>
              <Ionicons name="close" size={18} color={colors.dim} />
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.composerRow}>
        <Pressable
          hitSlop={8}
          style={[styles.spoilerToggle, spoiler && styles.spoilerToggleOn]}
          onPress={() => {
            tapSelection();
            onToggleSpoiler();
          }}>
          <Ionicons
            name={spoiler ? 'eye-off' : 'eye-off-outline'}
            size={16}
            color={spoiler ? colors.onYellow : colors.dim}
          />
          <Text style={[styles.spoilerToggleText, spoiler && { color: colors.onYellow }]}>
            {t('community.comments.spoilerToggle')}
          </Text>
        </Pressable>

        <TextInput
          ref={inputRef}
          style={[styles.input, overLength && styles.inputBad]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? t('community.comments.placeholder')}
          placeholderTextColor={colors.faint}
          multiline
          // A hard cap at the limit itself would let a paste be silently
          // truncated mid-sentence; a little headroom lets the counter and the
          // disabled Send explain what happened instead.
          maxLength={COMMENT_BODY_MAX + 200}
          editable={!sending}
        />

        <Pressable
          hitSlop={8}
          disabled={bodyFailure !== null || sending}
          style={[styles.send, (bodyFailure !== null || sending) && styles.sendOff]}
          onPress={onSend}>
          {sending ? (
            <ActivityIndicator size="small" color={colors.onYellow} />
          ) : (
            <Ionicons name={I18nManager.isRTL ? 'arrow-back' : 'arrow-forward'} size={18} color={colors.onYellow} />
          )}
        </Pressable>
      </View>
      {overLength && <Text style={styles.overLength}>{t('community.comments.errTooLong')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A2A2E',
    paddingHorizontal: space.md,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: colors.bg,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6 },
  replyBarText: { color: colors.dim, fontSize: 12.5, flex: 1 },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.panel,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 9,
  },
  inputBad: { borderWidth: 1, borderColor: colors.danger },
  overLength: { color: colors.danger, fontSize: 12, marginTop: 6 },
  spoilerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.panel,
  },
  spoilerToggleOn: { backgroundColor: colors.yellow },
  spoilerToggleText: { color: colors.dim, fontSize: 12, fontWeight: '700' },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.4 },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A2A2E',
  },
  joinText: { color: colors.yellow, fontSize: 15, fontWeight: '700' },
});
