/** biome-ignore-all lint/correctness/useExhaustiveDependencies: effects intentionally re-run only on source change */
import * as ScreenOrientation from "expo-screen-orientation";
import { VideoView } from "expo-video";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Modal, StatusBar, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useTranslation } from "../../i18n";
import type { DetectedVideo, HlsVariant } from "../../types";
import { buildDashPlayerHtml, buildHlsPlayerHtml, buildProgressivePlayerHtml } from "./playerHtml";
import type { PlayerSource } from "./types";
import { useNativeController } from "./useNativeController";
import { useWebViewController } from "./useWebViewController";
import VideoControls from "./VideoControls";

const TAG = "[MediaPlayer]";

/** Props forwarded to `VideoControls` by whichever engine is mounted. */
type SharedControlProps = {
  headerTitle?: string;
  onClose: () => void;
  onDownload?: () => void;
  topAction?: React.ReactNode;
  isLandscape: boolean;
  onToggleOrientation: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  videos?: DetectedVideo[];
  playingUrl?: string;
  onDownloadVariant?: (video: DetectedVideo, variant?: HlsVariant) => void;
};

type Props = {
  source: PlayerSource | null;
  onClose: () => void;
  /** Adds the ↓ Save button to the top bar (detected-video preview). */
  onDownload?: () => void;
  /** Extra top-bar button, e.g. Edit on a downloaded video. */
  topAction?: React.ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  videos?: DetectedVideo[];
  onDownloadVariant?: (video: DetectedVideo, variant?: HlsVariant) => void;
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Engine: remote streams — WebView + HTML5 video                            */
/* ────────────────────────────────────────────────────────────────────────── */

function RemoteEngine({ video, controls }: { video: DetectedVideo; controls: SharedControlProps }) {
  const webViewRef = useRef<WebView>(null);
  const { controller, onMessage, hasError } = useWebViewController(webViewRef);

  // Blob videos are played from the extracted cache copy (file://…); the
  // original blob: URL is scoped to the page that created it.
  const playbackUrl = video.localUri ? video.localUri : video.url;
  const playbackType = video.localUri ? (video.type === "webm" ? "webm" : "mp4") : video.type;
  const startTime = video.startTime ?? 0;

  const html =
    playbackType === "hls"
      ? buildHlsPlayerHtml(playbackUrl, startTime)
      : playbackType === "dash"
        ? buildDashPlayerHtml(playbackUrl, startTime)
        : buildProgressivePlayerHtml(playbackUrl, playbackType);

  return (
    <>
      <WebView
        ref={webViewRef}
        source={{
          html,
          // For locally-extracted blob previews the HTML must share the
          // file:// origin with the video file, or the <video> tag is not
          // allowed to load it. For remote URLs keep the original page origin
          // so cookies/CORS continue to work.
          baseUrl: video.localUri ? video.localUri.replace(/[^/]+$/, "") : video.pageUrl,
        }}
        style={styles.webview}
        onMessage={onMessage}
        onError={({ nativeEvent }) => {
          console.error(`${TAG} WebView onError:`, nativeEvent);
        }}
        onHttpError={({ nativeEvent }) => {
          console.error(
            `${TAG} WebView HTTP error: status=${nativeEvent.statusCode} url=${nativeEvent.url}`,
          );
        }}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        mixedContentMode="always"
        allowsFullscreenVideo
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        originWhitelist={["*"]}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowsProtectedMedia
        userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
      />
      {/* On error the page renders its own message — controls would be
          meaningless on top of it. */}
      {!hasError && <VideoControls controller={controller} {...controls} />}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Engine: downloaded files — expo-video                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function LocalEngine({
  uri,
  mediaType,
  controls,
}: {
  uri: string;
  mediaType: "video" | "audio";
  controls: SharedControlProps;
}) {
  const { controller, player } = useNativeController(uri);
  const isAudio = mediaType === "audio";

  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
      {isAudio && (
        <View style={styles.audioPlaceholder} pointerEvents="none">
          <Text style={styles.audioIcon}>♪</Text>
        </View>
      )}
      <VideoControls controller={controller} audioOnly={isAudio} {...controls} />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Shell                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The single player surface for the whole app. Picks a playback engine from
 * the source and owns everything that is the same either way: the modal, the
 * landscape lock, and the back-button behaviour.
 */
export default function MediaPlayerModal({
  source,
  onClose,
  onDownload,
  topAction,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  videos,
  onDownloadVariant,
}: Props) {
  const { t } = useTranslation();
  const [isLandscape, setIsLandscape] = useState(false);

  const sourceKey =
    source === null
      ? null
      : source.kind === "remote"
        ? source.video.localUri || source.video.url
        : source.uri;

  useEffect(() => {
    setIsLandscape(false);
  }, [sourceKey]);

  useEffect(() => {
    if (!source) return;
    if (isLandscape) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else {
      ScreenOrientation.unlockAsync();
    }
  }, [source, isLandscape]);

  const handleClose = useCallback(() => {
    ScreenOrientation.unlockAsync();
    onClose();
  }, [onClose]);

  // Back leaves landscape first, and only closes on the second press.
  useEffect(() => {
    if (!source) return;
    const onBack = () => {
      if (isLandscape) {
        setIsLandscape(false);
        ScreenOrientation.unlockAsync();
        return true;
      }
      handleClose();
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [source, isLandscape, handleClose]);

  if (!source) return null;

  const controls: SharedControlProps = {
    onClose: handleClose,
    onDownload,
    topAction,
    isLandscape,
    onToggleOrientation: () => setIsLandscape((l) => !l),
    onPrev,
    onNext,
    hasPrev,
    hasNext,
    ...(source.kind === "remote"
      ? {
          headerTitle: source.video.pageTitle || t("videoPreview"),
          videos,
          playingUrl: source.video.url,
          onDownloadVariant,
        }
      : {
          headerTitle: source.title || t("preview"),
        }),
  };

  return (
    <Modal
      visible
      animationType="fade"
      supportedOrientations={["portrait", "landscape"]}
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <StatusBar hidden />
        {source.kind === "remote" ? (
          <RemoteEngine video={source.video} controls={controls} />
        ) : (
          <LocalEngine uri={source.uri} mediaType={source.mediaType} controls={controls} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  webview: { flex: 1, backgroundColor: "#000" },
  audioPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  audioIcon: { color: "#333", fontSize: 140 },
});
