/**
 * The video recorder, if this build has one.
 *
 * WHY GUARDED. `react-native-view-recorder` is a native module, so a JS bundle
 * that references it while running against an older binary renders the red
 * "Unimplemented component: <RecordingView>" box across the screen — the whole
 * feature broken, and the screen it lives on ruined, because a button nobody
 * pressed is missing its encoder.
 *
 * Metro serves new JS to old binaries constantly during development, and users
 * update the app on their own schedule, so this is the normal case rather than
 * an edge one. Everything Wrapped does WITHOUT video — the slides, the cards,
 * the share — must keep working, and does: `RecordingView` falls back to a
 * plain `View`, and `available` tells the screen not to offer what it cannot
 * do. Same guarded-require idiom as `app-icon.ts` and the analytics module.
 */
import { View, type ViewProps } from 'react-native';
import type { ComponentType } from 'react';

/** What the real component takes, and what the fallback must tolerate. */
type RecordingViewProps = ViewProps & { sessionId: string };

type Recorder = {
  sessionId: string;
  record: (options: Record<string, unknown>) => Promise<string>;
};

let mod: {
  RecordingView: ComponentType<RecordingViewProps>;
  useViewRecorder: () => Recorder;
} | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('react-native-view-recorder');
} catch {
  mod = null;
}

/** True when this binary can actually encode a video. */
export const videoAvailable = mod != null;

/**
 * The real recording surface, or a plain View that draws its children and
 * ignores the session id — so the screen's markup is identical either way.
 */
export const RecordingView: ComponentType<RecordingViewProps> =
  mod?.RecordingView ?? (({ sessionId: _sessionId, ...rest }: RecordingViewProps) => <View {...rest} />);

/** The recorder handle, or a stand-in whose `record` rejects. */
export function useRecorder(): Recorder {
  if (mod != null) return mod.useViewRecorder();
  return {
    sessionId: 'unavailable',
    record: () => Promise.reject(new Error('no-recorder')),
  };
}
