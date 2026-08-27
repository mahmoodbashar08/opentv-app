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
import { attachCommentImage, deleteComment } from '@/community-comments';
import { useJoined } from '@/community-session';
import { communityErrorText } from '@/community-error-text';
import { t } from '@/i18n';
import { tapLight } from '@/haptics';
import { isPlus, requirePlus, usePlusUi } from '@/plus';
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
  /* BOTH CALLED, unconditionally, before either is used. Written as
     `useJoined() && usePlusUi()` the second one is skipped whenever the first
     is false — a conditional hook, and the exact mistake `usePlusUi` itself
     was carrying until today. */
  const joined = useJoined();
  const plusUi = usePlusUi();

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
      /*
       * `Compatible` IS WHAT MAKES AN IPHONE PHOTO UPLOADABLE.
       *
       * iPhones store photographs as HEIC, and the picker hands back the
       * original representation by default -- so every photo arrived as
       * `image/heic` and the server refused it: "Type image/heic is not an
       * image". This mode asks iOS for the most COMPATIBLE representation
       * instead, which transcodes to JPEG on the way out.
       *
       * Done here rather than by widening what the server accepts, deliberately.
       * HEIC is an Apple format: an Android reader could not display it, the
       * moderation dashboard could not preview it in most browsers, and the
       * picture would have been stored in a format half the audience cannot
       * open. One transcode on one phone is cheaper than that, for ever.
       */
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      // The picker already knows the type; asking the filesystem again is work
      // that can only go wrong. The extension is the fallback for older pickers.
      const guessed = a.uri.toLowerCase().endsWith('.png')
        ? 'image/png'
        : a.uri.toLowerCase().endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg';
      // A type the server cannot take is not worth sending. `Compatible` above
      // should mean this never fires; it is here because "should" is what the
      // last three attempts at this were built on.
      const type = a.mimeType ?? guessed;
      const usable = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type);
      if (!usable) {
        Alert.alert(t('community.comments.uploadFailed'), t('community.comments.tooBig'));
        return;
      }
      setPicked({ uri: a.uri, mimeType: type, width: a.width, height: a.height });
    } catch {
      Alert.alert(t('community.comments.uploadFailed'));
    }
  };

  return {
    attachment: picked,
    clear: () => setPicked(null),

    /**
     * SHOULD THE BUTTON BE ON SCREEN AT ALL? Two answers have to agree.
     *
     * JOINED, because a picture on a comment is a COMMUNITY feature end to
     * end: it is uploaded, waits for a person to approve it, and is served to
     * other people. Somebody who declined the community can still write
     * comments — those are private notes on their own phone and always have
     * been — but the camera on that composer offered them a paid upgrade to a
     * feature that would have nowhere to go even if they bought it. Reported
     * exactly that way: the button was there before joining, and joining is
     * what produced "you are not Plus".
     *
     * AND PLUS-VISIBLE (`usePlusUi`), because `open()` refuses a
     * non-subscriber by sending them to the paywall — and on a platform where
     * Plus cannot be BOUGHT there is no paywall to send them to, so
     * `requirePlus` correctly does nothing and the button answers a tap with
     * silence.
     *
     * Each rule covers a case the other does not: a member without Plus should
     * see it (and be sold to), a non-member with Plus should not.
     */
    canAttach: joined && plusUi,

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
     * Send it, once the comment has an id.
     *
     * A COMMENT MEANT TO HAVE A PICTURE IS WRONG WITHOUT ONE. The upload has to
     * happen second -- the picture needs a comment to belong to -- but if it
     * fails, leaving the words up alone publishes something nobody wrote:
     * "look at this" with nothing to look at. So the comment is taken back
     * down and the picture is KEPT, ready to send again.
     *
     * The rollback is best-effort. If it fails too, the comment stays up
     * without its picture, which is the old behaviour and still better than
     * telling somebody their words are gone when they are not.
     *
     * SAY WHAT WENT WRONG. "The picture did not upload" alone is a dead end for
     * the reader and for anybody debugging it: a lapsed subscription, a file
     * too large, an unsupported type and a dead connection all looked
     * identical, and finding out which cost a rebuild.
     */
    upload: async (commentId: string): Promise<{ sent: boolean; image: string | null }> => {
      if (picked == null) return { sent: false, image: null };
      try {
        await attachCommentImage(commentId, picked);
        /*
         * AND A COPY FOR THE ARCHIVE, kept as a file in Documents exactly as
         * every rescued TV Time photograph is.
         *
         * The archive is somebody's own copy of what they wrote, and it showed
         * their words without the picture they had chosen. A server URL would
         * not do: nothing is served until a person approves it, so the archive
         * would go blank for as long as the wait -- and stay blank for ever if
         * the picture were refused. The file is the only copy that survives
         * both.
         *
         * Best-effort. Failing to keep a copy must not fail a comment that has
         * already been posted and whose picture has already gone up.
         */
        let saved: string | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
          const ext = picked.mimeType === 'image/gif' ? 'gif' : picked.mimeType === 'image/png' ? 'png' : 'jpg';
          const name = `comment-${commentId}.${ext}`;
          new File(picked.uri).copy(new File(Paths.document, name));
          saved = name;
        } catch {
          // No local copy. The picture is on the server either way.
        }
        setPicked(null);
        return { sent: true, image: saved };
      } catch (e) {
        await deleteComment(commentId).catch(() => {
          // Taking it back down failed as well. The comment stays up without
          // its picture rather than the words being lost.
        });
        Alert.alert(t('community.comments.uploadFailed'), communityErrorText(e));
        // The picture stays attached: the next tap of Send tries the whole
        // thing again rather than making somebody choose it a second time.
        return { sent: false, image: null };
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
            {/* A reaction is not about the show being commented on, so this
                searches everything rather than making somebody pick a title
                first. */}
            <GifSearch
              mode="search"
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
