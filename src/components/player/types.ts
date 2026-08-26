import type { DetectedVideo } from "../../types";

/**
 * The single playback interface `VideoControls` talks to. Both engines — the
 * WebView/HTML5 one (remote streams, and the video playing inside a browser
 * tab) and the expo-video one (downloaded files) — implement this, so the
 * controls UI never needs to know which is behind it.
 *
 * All times are in SECONDS. expo-video reports seconds and the HTML5
 * `currentTime` is in seconds too, so nothing has to be converted at the edges.
 */
export interface VideoController {
  currentTime: number;
  duration: number;
  isPaused: boolean;
  isMuted: boolean;
  isBuffering: boolean;
  togglePlay: () => void;
  toggleMute: () => void;
  seek: (seconds: number) => void;
  skipBack: () => void;
  skipForward: () => void;
}

/** Which engine `MediaPlayerModal` mounts, and what it needs to play. */
export type PlayerSource =
  | { kind: "remote"; video: DetectedVideo }
  | {
      kind: "local";
      uri: string;
      title?: string;
      mediaType: "video" | "audio";
    };

export const SEEK_SECS = 10;
