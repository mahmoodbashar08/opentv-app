/**
 * Wrapped, as a video file, made on the phone.
 *
 * WHY THIS IS POSSIBLE AT ALL. Every React Native video library used to be
 * built on FFmpegKit, which was retired in January 2025 with its binaries
 * pulled. `react-native-view-recorder` does not use it: it drives the
 * platform's own encoders — AVAssetWriter on iOS, MediaCodec on Android — so
 * there is no ffmpeg, no GPL, and about 90KB of native code.
 *
 * WHY ON THE PHONE AND NOT A SERVER. Rendering Wrapped in the cloud would mean
 * sending somebody's watch figures off their device to be drawn, which is the
 * one thing this app promises not to do. On-device, the video is made from data
 * that never moves and the file goes straight to the share sheet.
 */
import { Directory, File, Paths } from 'expo-file-system';

/** What every social network re-encodes to anyway. */
export const VIDEO_FPS = 30;
/** How long each slide holds — the tap-through's own pace, roughly. */
export const SLIDE_FRAMES = Math.round(2.6 * VIDEO_FPS);

/**
 * Where a rendered Wrapped goes: the cache, not documents. It is a shareable
 * artefact rather than a possession, so the OS may reclaim it whenever it
 * likes, and re-rendering the same period replaces its file instead of piling
 * up copies.
 */
export function videoPath(period: string): string {
  const dir = new Directory(Paths.cache, 'wrapped');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, `opentv-${period.replace(/[^0-9a-zA-Z-]/g, '-')}.mp4`);
  if (file.exists) file.delete();
  return file.uri.replace('file://', '');
}

/** Which slide a frame belongs to, and how far through that slide it is. */
export function frameToSlide(frameIndex: number, slideCount: number): { slide: number; progress: number } {
  if (slideCount <= 0) return { slide: 0, progress: 0 };
  const slide = Math.min(slideCount - 1, Math.floor(frameIndex / SLIDE_FRAMES));
  const progress = (frameIndex - slide * SLIDE_FRAMES) / SLIDE_FRAMES;
  return { slide, progress: Math.min(1, Math.max(0, progress)) };
}

/** Total frames for a recap of this many slides. */
export function totalFrames(slideCount: number): number {
  return Math.max(1, slideCount) * SLIDE_FRAMES;
}
