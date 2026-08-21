/**
 * Choosing a picture for a comment, and sending it after the comment exists.
 *
 * ONE HOOK BECAUSE THERE ARE TWO COMPOSERS. The thread on a show or episode
 * draws its own text row inline; `/comment/[id]` uses `CommentComposer`. They
 * were duplicated long before this, and duplicating the picker, the Plus gate
 * and the upload across both is how the two would drift into disagreeing about
 * what may be attached. The UI stays where it is; the RULES live here.
 *
 * WHY THE UPLOAD IS A SECOND STEP. `attachCommentImage` explains it in full,
 * but the short version is that the words are posted first and the picture
 * follows, so the failure that actually happens -- a slow upload on a bad
 * connection -- costs a photograph and never a sentence.
 *
 * NOTHING IT SENDS IS VISIBLE YET. Every image lands `pending` and is served
 * only once it has been approved, so the composer says so while the picture is
 * still attached, and again after it is sent. An author whose picture simply
 * vanished would report it as a bug, and they would be right to.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { ActionSheet } from '@/components/action-sheet';
import { GifSearch, type GifHit } from '@/components/gif-search';
import { attachCommentImage } from '@/community-comments';
import { communityErrorText } from '@/community-error-text';
import { t } from '@/i18n';
import { tapLight } from '@/haptics';
import { isPlus, requirePlus } from '@/plus';
import { colors, space } from '@/theme';

export type PickedImage = {
  /** ALWAYS a local file. A GIPHY url is downloaded before it lands here — see
   *  `attachCommentImage` for why a remote address cannot be uploaded. */
  uri: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
};

export function useCommentAttachment() {
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);

  const fromLibrary = async () => {
    // The same guard `edit-profile` uses: in a build without the native module
    // the picker is absent rather than broken, and saying so beats a crash.
    if (!requireOptionalNativeModule('ExponentImagePicker')) {
      Alert.alert(t('import.buildNeededTitle'), t('editProfile.photoBuildNeededBody'));
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      // The picker already knows the type; asking the filesystem again is work
      // that can only go wrong. The extension is the fallback for older pickers.
      const guessed = a.uri.toLowerCase().endsWith('.png')
        ? 'image/png'
        : a.uri.toLowerCase().endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg';
      setPicked({ uri: a.uri, mimeType: a.mimeType ?? guessed, width: a.width, height: a.height });
    } catch {
      Alert.alert(t('community.comments.uploadFailed'));
    }
  };

  return {
    attachment: picked,
    clear: () => setPicked(null),

    /**
     * The composer's button. Refuses before the picker rather than after it --
     * being shown a photo library and then told you cannot use one is a worse
     * introduction to a paid feature than being told the price up front.
     */
    open: () => {
      if (!isPlus()) {
        requirePlus('comment_image');
        return;
      }
      tapLight();
      setChoosing(true);
    },

    /**
     * Send it, once the comment has an id. Returns whether a picture went up,
     * so the caller can say "in review" only when there is something to review.
     *
     * NEVER THROWS INTO THE SEND PATH. The comment is already posted by the
     * time this runs, so a failure here must not roll anything back or look
     * like the comment failed -- it is one alert about the picture, and the
     * words stay where they are.
     */
    upload: async (commentId: string): Promise<boolean> => {
      if (picked == null) return false;
      try {
        await attachCommentImage(commentId, picked);
        setPicked(null);
        return true;
      } catch (e) {
        /*
         * SAY WHAT WENT WRONG. "The picture did not upload" on its own is a
         * dead end for the person reading it and for anybody trying to fix it:
         * a lapsed subscription, a file too large, an unsupported type and a
         * dead connection all looked identical, and the first attempt to debug
         * this cost a rebuild to find out which.
         */
        Alert.alert(t('community.comments.uploadFailed'), communityErrorText(e));
        setPicked(null);
        return false;
      }
    },

    /** Render once inside the screen, like `moderation.sheets`. */
    ui: (
      <>
        <ActionSheet
          visible={choosing}
          title={t('community.comments.attach')}
          actions={[
            {
              text: t('community.comments.pickPhoto'),
              icon: 'image-outline' as const,
              onPress: () => {
                setChoosing(false);
                void fromLibrary();
              },
            },
            {
              text: t('community.comments.pickGif'),
              icon: 'happy-outline' as const,
              onPress: () => {
                setChoosing(false);
                setGifOpen(true);
              },
            },
          ]}
          onClose={() => setChoosing(false)}
        />
        <Modal visible={gifOpen} animationType="slide" onRequestClose={() => setGifOpen(false)}>
          <View style={s.gifScreen}>
            <View style={s.gifHead}>
              <Text style={s.gifTitle}>{t('pickGif.title')}</Text>
              <Pressable hitSlop={12} onPress={() => setGifOpen(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <GifSearch
              onPick={(hit: GifHit) => {
                /*
                 * DOWNLOADED FIRST, because FormData uploads a file from disk
                 * and a GIPHY address is a remote URL -- handed one directly it
                 * sends the string and the server receives no file. This was
                 * the whole of "the picture did not upload".
                 *
                 * The FULL url, not the preview: the preview is a downscaled
                 * strip meant for a grid, and our copy is the one that survives
                 * the CDN reorganising or the service disappearing.
                 */
                setGifOpen(false);
                void (async () => {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
                    const res = await fetch(hit.full);
                    const bytes = new Uint8Array(await res.arrayBuffer());
                    // Cache, not Documents: this copy exists only until it is
                    // uploaded, and the server keeps the one that matters.
                    const f = new File(Paths.cache, `comment-gif-${hit.id}.gif`);
                    f.write(bytes);
                    setPicked({ uri: f.uri, mimeType: 'image/gif' });
                  } catch {
                    Alert.alert(t('community.comments.uploadFailed'));
                  }
                })();
              }}
            />
          </View>
        </Modal>
      </>
    ),
  };
}

const s = StyleSheet.create({
  gifScreen: { flex: 1, backgroundColor: colors.bg, paddingTop: 60 },
  gifHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: 12,
  },
  gifTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
});
