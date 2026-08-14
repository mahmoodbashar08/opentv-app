/**
 * The music a Wrapped video is scored with.
 *
 * LICENSING, WRITTEN DOWN HERE because it is the kind of thing nobody can
 * reconstruct later. These are Mixkit tracks under the Mixkit Free License:
 * free to use in social media and online advertising, attribution NOT required
 * — but they are copyrighted works under a licence, not public domain. They may
 * not be redistributed as audio files or sold on their own, which is exactly
 * what shipping them inside an app that only ever muxes them into a user's own
 * video does not do. Do not add a track here without checking its licence
 * covers the same two uses.
 *
 * THREE, BECAUSE A RECAP IS NOT ALWAYS THE SAME MOOD. A quiet month scored
 * like a trailer is a joke at the user's expense; a big year deserves more
 * than a piano. The default is the one that suits a dark UI.
 */
export type TrackId = 'hazy' | 'hiphop' | 'ambition';

export type Track = {
  id: TrackId;
  /** The require() the bundler resolves; the recorder needs a real file path. */
  asset: number;
  /** Seconds, so a video never runs past the end of its own music. */
  seconds: number;
  /** The locale key naming it in the picker. */
  labelKey: 'plus.wrapped.trackHazy' | 'plus.wrapped.trackHipHop' | 'plus.wrapped.trackAmbition';
};

export const TRACKS: readonly Track[] = [
  {
    id: 'hazy',
    asset: require('@/assets/audio/mixkit-hazy-after-hours-132.mp3'),
    seconds: 127,
    labelKey: 'plus.wrapped.trackHazy',
  },
  {
    id: 'hiphop',
    asset: require('@/assets/audio/mixkit-hip-hop-02-738.mp3'),
    seconds: 115,
    labelKey: 'plus.wrapped.trackHipHop',
  },
  {
    id: 'ambition',
    asset: require('@/assets/audio/mixkit-driving-ambition-32.mp3'),
    seconds: 102,
    labelKey: 'plus.wrapped.trackAmbition',
  },
];

/** Which track this phone last chose. */
export const TRACK_KEY = 'wrappedTrack';

/** Electronic, modern, and made for a dark interface. */
export const DEFAULT_TRACK: TrackId = 'hazy';

export function trackById(id: string | null | undefined): Track {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0]!;
}

/**
 * A bundled asset's path on disk, which is what the encoder needs — it muxes
 * the file natively rather than reading it through JS, so a `require()` handle
 * is no use to it. On a dev build the asset is served by Metro over http and
 * has to be downloaded once; in a release build it is already local.
 */
export async function trackPath(track: Track): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Asset } = require('expo-asset') as typeof import('expo-asset');
    const asset = Asset.fromModule(track.asset);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    return uri.startsWith('file://') ? uri.replace('file://', '') : uri;
  } catch {
    // No audio is better than no video: the caller renders silently.
    return null;
  }
}
