/** biome-ignore-all lint/correctness/useExhaustiveDependencies: <explanation> */
/** biome-ignore-all lint/suspicious/noArrayIndexKey: <explanation> */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  FlatList,
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useTranslation } from "../i18n";
import { DetectedVideo, HlsVariant } from "../types";
import { isPlayingVideo, isPlayingVideoM4S } from "./VideoDetectedBanner";

function formatTime(secs: number): string {
  if (!isFinite(secs) || isNaN(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  currentTime: number;
  duration: number;
  isPaused: boolean;
  isMuted: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onSeek: (time: number) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  headerTitle?: string;
  onMinimize?: () => void;
  playingUrl?: string;
  playingUrlM4S?: string;
  segmentBlob?: Record<string, string>;
  videos?: DetectedVideo[];
  onDownloadVariant?: (video: DetectedVideo, variant?: HlsVariant) => void;
}

const SEEK_SECS = 10;
const SEEK_THROTTLE_MS = 300;

// Stepped pseudo-gradients (top: dark→clear, bottom: clear→dark)
const TOP_SCRIM = [0.02];
const BOTTOM_SCRIM = [0.02];

export default function VideoPlayerController({
  currentTime,
  duration,
  isPaused,
  isMuted,
  onTogglePlay,
  onToggleMute,
  onSeek,
  onSkipBack,
  onSkipForward,
  headerTitle,
  onMinimize,
  playingUrl,
  segmentBlob,
  videos,
  onDownloadVariant,
}: Props) {
  const { t } = useTranslation();
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isVariantPickerVisible, setIsVariantPickerVisible] = useState(false);
  const [filteredVideos, setFilteredVideos] = React.useState<DetectedVideo[]>(
    [],
  );
  const opacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seekBarWidth, setSeekBarWidth] = useState(0);

  const lastSeekAt = useRef(0);
  const [seekingTime, setSeekingTime] = useState<number | null>(null);
  const seekingSetAtRef = useRef(0);
  const seekBarRef = useRef<View>(null);
  const seekBarPageXRef = useRef(0);
  const isDraggingSeekRef = useRef(false);
  const leftOpacity = useRef(new Animated.Value(0)).current;
  const rightOpacity = useRef(new Animated.Value(0)).current;
  const leftScale = useRef(new Animated.Value(0.75)).current;
  const rightScale = useRef(new Animated.Value(0.75)).current;

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setControlsVisible(false));
    }, 3000);
  }, [opacity, cancelHide]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    scheduleHide();
  }, [opacity, scheduleHide]);

  useEffect(() => {
    showControls();
    return () => cancelHide();
  }, []);

  useEffect(() => {
    if (isPaused) {
      cancelHide();
      setControlsVisible(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      scheduleHide();
    }
  }, [isPaused]);

  useEffect(() => {
    if (!videos) return;
    if (!playingUrl) return;
    let playingUrlM4S = "";
    if (playingUrl.includes("blob") && segmentBlob) {
      playingUrlM4S = segmentBlob[playingUrl];
    }
    if (playingUrlM4S) {
      const playingVideo = isPlayingVideoM4S(videos, playingUrlM4S);
      if (playingVideo) {
        setFilteredVideos([playingVideo]);
        return;
      }
    }
    const hslCount = videos.filter((v) => v.type === "hls").length;
    const masterCount = videos.filter(
      (v) => v.hlsInfo?.isMaster === true,
    ).length;
    if (hslCount === 1) {
      setFilteredVideos(videos.filter((v) => v.type === "hls"));
    } else if (masterCount === 1) {
      setFilteredVideos(videos.filter((v) => v.hlsInfo?.isMaster === true));
    } else {
      setFilteredVideos(videos.filter((v) => isPlayingVideo(v, playingUrl)));
    }
  }, [videos, playingUrl]);

  const flashSeekIndicator = (
    opacityAnim: Animated.Value,
    scaleAnim: Animated.Value,
  ) => {
    opacityAnim.stopAnimation();
    scaleAnim.stopAnimation();
    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.delay(650),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1,
          speed: 24,
          bounciness: 6,
          useNativeDriver: true,
        }),
        Animated.delay(750),
        Animated.timing(scaleAnim, {
          toValue: 0.75,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  };

  const hideControls = useCallback(() => {
    cancelHide();
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setControlsVisible(false));
  }, [opacity, cancelHide]);

  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      cancelHide();
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setControlsVisible(false));
    } else {
      showControls();
    }
  }, [controlsVisible, opacity, cancelHide, showControls]);

  // Stable refs so the gesture recognizers (memoized once) always call the
  // latest closures without rebuilding the gestures every render.
  const toggleControlsRef = useRef(toggleControls);
  toggleControlsRef.current = toggleControls;
  const onSkipBackRef = useRef(onSkipBack);
  onSkipBackRef.current = onSkipBack;
  const onSkipForwardRef = useRef(onSkipForward);
  onSkipForwardRef.current = onSkipForward;
  const hideControlsRef = useRef(hideControls);
  hideControlsRef.current = hideControls;

  const leftTapGesture = useMemo(() => {
    const dbl = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(50)
      .runOnJS(true)
      .onEnd(() => {
        onSkipBackRef.current();
        flashSeekIndicator(leftOpacity, leftScale);
        hideControlsRef.current();
      });
    const single = Gesture.Tap()
      .numberOfTaps(1)
      .maxDistance(50)
      .runOnJS(true)
      .onEnd(() => {
        toggleControlsRef.current();
      });
    return Gesture.Exclusive(dbl, single);
  }, [leftOpacity, leftScale]);

  const rightTapGesture = useMemo(() => {
    const dbl = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(50)
      .runOnJS(true)
      .onEnd(() => {
        onSkipForwardRef.current();
        flashSeekIndicator(rightOpacity, rightScale);
        hideControlsRef.current();
      });
    const single = Gesture.Tap()
      .numberOfTaps(1)
      .maxDistance(50)
      .runOnJS(true)
      .onEnd(() => {
        toggleControlsRef.current();
      });
    return Gesture.Exclusive(dbl, single);
  }, [rightOpacity, rightScale]);

  const centerTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDistance(50)
        .runOnJS(true)
        .onEnd(() => {
          toggleControlsRef.current();
        }),
    [],
  );

  // Clear the optimistic seek override once the polled currentTime converges.
  // Require at least 500ms after seeking before accepting convergence — this
  // avoids clearing on the optimistic value the parent set immediately.
  useEffect(() => {
    if (seekingTime !== null) {
      const elapsed = Date.now() - seekingSetAtRef.current;
      if (elapsed > 500 && Math.abs(currentTime - seekingTime) < 2) {
        setSeekingTime(null);
      }
    }
  }, [currentTime, seekingTime]);

  const effectiveTime = seekingTime !== null ? seekingTime : currentTime;

  const progress =
    duration > 0 ? Math.min(Math.max(effectiveTime / duration, 0), 1) : 0;
  const fillWidth = seekBarWidth * progress;
  // 18 px thumb — keep center on fill position
  const thumbLeft = Math.max(0, Math.min(fillWidth - 9, seekBarWidth - 18));

  // Touch/drag-to-seek using the responder system. The previous tap-on-press
  // implementation reported the *release* position, so any tiny finger slide
  // during a tap would commit to wherever the finger lifted (e.g. tap middle
  // → slide a few pixels → release near the left edge → jump to start).
  // This version updates seekingTime continuously so the thumb visually
  // follows the finger, and only fires onSeek once on release with the final
  // position the user actually sees.

  const measureSeekBar = useCallback(() => {
    seekBarRef.current?.measure((_x, _y, w, _h, pageX) => {
      if (w > 0) setSeekBarWidth(w);
      if (pageX != null) seekBarPageXRef.current = pageX;
    });
  }, []);

  const onSeekBarLayout = useCallback(
    (e: LayoutChangeEvent) => {
      setSeekBarWidth(e.nativeEvent.layout.width);
      measureSeekBar();
    },
    [measureSeekBar],
  );

  const computeSeekTimeFromPageX = useCallback(
    (pageX: number): number | null => {
      if (seekBarWidth <= 0 || duration <= 0) return null;
      const x = pageX - seekBarPageXRef.current;
      const ratio = Math.max(0, Math.min(1, x / seekBarWidth));
      return ratio * duration;
    },
    [seekBarWidth, duration],
  );

  const onSeekGrant = (e: GestureResponderEvent) => {
    if (seekBarWidth <= 0 || duration <= 0) return;
    isDraggingSeekRef.current = true;
    cancelHide();
    measureSeekBar();
    const t = computeSeekTimeFromPageX(e.nativeEvent.pageX);
    if (t !== null) setSeekingTime(t);
  };

  const onSeekMove = (e: GestureResponderEvent) => {
    if (!isDraggingSeekRef.current) return;
    const t = computeSeekTimeFromPageX(e.nativeEvent.pageX);
    if (t !== null) setSeekingTime(t);
  };

  const onSeekRelease = (e: GestureResponderEvent) => {
    if (!isDraggingSeekRef.current) return;
    isDraggingSeekRef.current = false;
    const t = computeSeekTimeFromPageX(e.nativeEvent.pageX);
    if (t === null) return;
    const now = Date.now();
    if (now - lastSeekAt.current < SEEK_THROTTLE_MS) return;
    lastSeekAt.current = now;
    setSeekingTime(t);
    seekingSetAtRef.current = Date.now();
    onSeek(t);
    showControls();
  };

  const hasDownload =
    (videos?.length ?? 0) > 0 && onDownloadVariant !== undefined;
  const showTopBar = headerTitle !== undefined || hasDownload;

  const handleDownloadPress = () => {
    setIsVariantPickerVisible(true);
    cancelHide();
  };

  const handlePickVariant = (video: DetectedVideo, variant?: HlsVariant) => {
    setIsVariantPickerVisible(false);
    onDownloadVariant?.(video, variant);
  };

  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <View style={StyleSheet.absoluteFill}>
        {/* ── Layer 1: Tap zones ── */}
        <View style={styles.backdropRow}>
          <GestureDetector gesture={leftTapGesture}>
            <View style={styles.sideZone} />
          </GestureDetector>
          <GestureDetector gesture={centerTapGesture}>
            <View style={styles.centerZone} />
          </GestureDetector>
          <GestureDetector gesture={rightTapGesture}>
            <View style={styles.sideZone} />
          </GestureDetector>
        </View>

        {/* ── Layer 2: Seek flash indicators ── */}
        <View
          style={[StyleSheet.absoluteFill, styles.seekIndicatorLayer]}
          pointerEvents="none"
        >
          <View style={styles.seekSlot}>
            <Animated.View
              style={[
                styles.seekBubble,
                { opacity: leftOpacity, transform: [{ scale: leftScale }] },
              ]}
            >
              <Text style={styles.seekBubbleIcon}>{"◀◀"}</Text>
              <Text style={styles.seekBubbleLabel}>-{SEEK_SECS}s</Text>
            </Animated.View>
          </View>
          <View style={styles.seekSlotMid} />
          <View style={styles.seekSlot}>
            <Animated.View
              style={[
                styles.seekBubble,
                { opacity: rightOpacity, transform: [{ scale: rightScale }] },
              ]}
            >
              <Text style={styles.seekBubbleIcon}>{"▶▶"}</Text>
              <Text style={styles.seekBubbleLabel}>+{SEEK_SECS}s</Text>
            </Animated.View>
          </View>
        </View>

        {/* ── Layer 3: Player controls ── */}
        {controlsVisible && (
          <Animated.View
            style={[styles.controlsOverlay, { opacity }]}
            pointerEvents="box-none"
          >
            {/* Cinematic top scrim (dark → transparent) */}
            <View style={styles.topScrim} pointerEvents="none">
              {TOP_SCRIM.map((a, i) => (
                <View
                  key={i}
                  style={[
                    styles.scrimStep,
                    { backgroundColor: `rgba(0,0,0,${a})` },
                  ]}
                />
              ))}
            </View>

            {/* Cinematic bottom scrim (transparent → dark) */}
            <View style={styles.bottomScrim} pointerEvents="none">
              {BOTTOM_SCRIM.map((a, i) => (
                <View
                  key={i}
                  style={[
                    styles.scrimStep,
                    { backgroundColor: `rgba(0,0,0,${a})` },
                  ]}
                />
              ))}
            </View>

            {/* ── Top bar ── */}
            {showTopBar && (
              <View style={styles.topBar}>
                {onMinimize ? (
                  <TouchableOpacity
                    style={styles.topIconBtn}
                    onPress={onMinimize}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={styles.topIconText}>←</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.topSpacer} />
                )}

                <Text style={styles.topTitle} numberOfLines={1}>
                  {headerTitle ?? ""}
                </Text>

                {hasDownload ? (
                  <TouchableOpacity
                    style={styles.downloadBtn}
                    onPress={handleDownloadPress}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={styles.downloadIcon}>↓</Text>
                    <Text style={styles.downloadLabel}>{t("save")}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.topSpacer} />
                )}
              </View>
            )}

            {/* ── Center: skip · play · skip ── */}
            <View style={styles.centerRow}>
              {/* Skip back */}
              <TouchableOpacity
                style={styles.skipWrap}
                onPress={() => {
                  onSkipBack();
                  showControls();
                }}
              >
                <View style={styles.skipCircle}>
                  <Text style={styles.skipIcon}>⏮</Text>
                </View>
                <Text style={styles.skipLabel}>{SEEK_SECS}s</Text>
              </TouchableOpacity>

              {/* Play / Pause — teal glow ring */}
              <TouchableOpacity
                style={styles.playBtn}
                onPress={() => {
                  onTogglePlay();
                  showControls();
                }}
              >
                <Text style={styles.playIcon}>{isPaused ? "▶" : "⏸"}</Text>
              </TouchableOpacity>

              {/* Skip forward */}
              <TouchableOpacity
                style={styles.skipWrap}
                onPress={() => {
                  onSkipForward();
                  showControls();
                }}
              >
                <View style={styles.skipCircle}>
                  <Text style={styles.skipIcon}>⏭</Text>
                </View>
                <Text style={styles.skipLabel}>{SEEK_SECS}s</Text>
              </TouchableOpacity>
            </View>

            {/* ── Bottom: seek bar + time/mute row ── */}
            <View style={styles.bottomBar}>
              {/* Seek bar */}
              <View
                ref={seekBarRef}
                collapsable={false}
                style={styles.seekArea}
                onLayout={onSeekBarLayout}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={onSeekGrant}
                onResponderMove={onSeekMove}
                onResponderRelease={onSeekRelease}
                onResponderTerminate={onSeekRelease}
              >
                <View style={styles.seekTrack}>
                  <View style={[styles.seekFill, { width: fillWidth }]} />
                </View>
                <View style={[styles.seekThumb, { left: thumbLeft }]} />
              </View>

              {/* Time + mute */}
              <View style={styles.timeRow}>
                <Text style={styles.timeCurrent}>
                  {formatTime(effectiveTime)}
                </Text>
                <Text style={styles.timeSep}> / </Text>
                <Text style={styles.timeDuration}>{formatTime(duration)}</Text>
                <View style={styles.timeFlex} />
                {hasDownload && (
                  <TouchableOpacity
                    style={styles.dlBtn}
                    onPress={handleDownloadPress}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.dlBtnIcon}>↓</Text>
                    <Text style={styles.dlBtnLabel}>{t("save")}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.muteBtn}
                  onPress={() => {
                    onToggleMute();
                    showControls();
                  }}
                >
                  <Text style={styles.muteIcon}>{isMuted ? "🔇" : "🔊"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        )}

        {/* ── Variant picker modal ── */}
        {/* ── Details modal ── */}
        <Modal
          visible={isVariantPickerVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setIsVariantPickerVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t("detectedVideos")}</Text>
                <TouchableOpacity
                  onPress={() => setIsVariantPickerVisible(false)}
                  style={styles.closeBtn}
                >
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              {filteredVideos.length > 0 ? (
                <FlatList
                  data={filteredVideos}
                  keyExtractor={(item, index) => `${item.url}-${index}`}
                  style={styles.list}
                  renderItem={({ item }) => {
                    const hasVariants =
                      item.type === "hls" &&
                      item.hlsInfo &&
                      item.hlsInfo.variants.length > 0;
                    return (
                      <View
                        style={[
                          styles.videoCard,
                          isPlayingVideo(item, playingUrl!) &&
                            styles.videoCardPlaying,
                        ]}
                      >
                        <View style={styles.videoInfo}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.videoUrl} numberOfLines={1}>
                              {item.type === "hls"
                                ? item.pageTitle || t("hlsStream")
                                : item.type === "dash"
                                  ? item.pageTitle || t("dashStream")
                                  : item.videoWidth ||
                                    item.pageTitle ||
                                    t("video")}
                            </Text>
                          </View>
                        </View>

                        {hasVariants ? (
                          <View style={styles.variantList}>
                            {item.hlsInfo!.variants.map((variant, vi) => (
                              <View key={vi} style={styles.variantRow}>
                                <View style={styles.variantInfo}>
                                  <Text style={styles.variantResolution}>
                                    {variant.resolution ||
                                      t("unknownResolution")}
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  style={styles.downloadVariantBtn}
                                  onPress={() =>
                                    handlePickVariant(item, variant)
                                  }
                                >
                                  <Text style={styles.downloadVariantBtnText}>
                                    {t("downloadBtn")}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <View />
                        )}
                      </View>
                    );
                  }}
                />
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>
                    {t("noDownloadableVideos")}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
      </View>
    </GestureHandlerRootView>
  );
}

const TEAL = "#4ECDC4";

const styles = StyleSheet.create({
  /* ── Tap zones ──
     Mirror PreviewModal: leave the top bar (60px) and bottom bar (~140px)
     clear so a tap on the seek bar / buttons can never be captured by a side
     tap zone and misread as a double-tap-to-skip. */
  backdropRow: {
    position: "absolute",
    top: 60,
    bottom: 140,
    left: 0,
    right: 0,
    flexDirection: "row",
  },
  sideZone: { flex: 3 },
  centerZone: { flex: 4 },

  /* ── Seek flash indicators ── */
  seekIndicatorLayer: { flexDirection: "row", alignItems: "center" },
  seekSlot: { flex: 3, alignItems: "center" },
  seekSlotMid: { flex: 4 },
  seekBubble: {
    backgroundColor: "rgba(8,8,20,0.78)",
    borderRadius: 44,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(78,205,196,0.4)",
  },
  seekBubbleIcon: { color: "#FFF", fontSize: 20, lineHeight: 24 },
  seekBubbleLabel: {
    color: TEAL,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 5,
    letterSpacing: 0.3,
  },

  /* ── Controls overlay ── */
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },

  /* Scrims */
  topScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 110 },
  bottomScrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  scrimStep: { flex: 1 },

  /* ── Top bar ── */
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  topIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  topIconText: { color: "#FFF", fontSize: 20, lineHeight: 22 },
  topTitle: {
    flex: 1,
    color: "#FFF",
    fontSize: 15,
    fontWeight: "600",
    marginHorizontal: 12,
  },
  topSpacer: { width: 38 },
  downloadBtn: {
    flexDirection: "row",
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,160,50,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,160,50,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  downloadIcon: {
    color: "#FFA032",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 18,
  },
  downloadLabel: { color: "#FFA032", fontSize: 13, fontWeight: "700" },

  /* ── Center controls ── */
  centerRow: { flexDirection: "row", alignItems: "center", gap: 36 },

  skipWrap: { alignItems: "center", gap: 6 },
  skipCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  skipIcon: { fontSize: 24, color: "#FFF" },
  skipLabel: { color: "#9A9A9A", fontSize: 11, fontWeight: "600" },

  playBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(78,205,196,0.16)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: TEAL,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 18,
    elevation: 10,
  },
  playIcon: { fontSize: 32, color: "#FFF" },

  /* ── Bottom bar ── */
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 20,
    paddingTop: 6,
  },

  /* Seek bar */
  seekArea: { height: 32, justifyContent: "center", marginBottom: 8 },
  seekTrack: {
    height: 5,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 3,
    overflow: "hidden",
  },
  seekFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: TEAL,
    borderRadius: 3,
  },
  seekThumb: {
    position: "absolute",
    top: 7, // (32 - 18) / 2
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: TEAL,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },

  /* Time + mute */
  timeRow: { flexDirection: "row", alignItems: "center" },
  timeCurrent: { color: "#FFF", fontSize: 13, fontWeight: "600" },
  timeSep: { color: "rgba(255,255,255,0.4)", fontSize: 12 },
  timeDuration: { color: "rgba(255,255,255,0.55)", fontSize: 13 },
  timeFlex: { flex: 1 },
  dlBtn: {
    flexDirection: "row",
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: "rgba(255,160,50,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,160,50,0.5)",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginRight: 8,
  },
  dlBtnIcon: {
    color: "#FFA032",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 17,
  },
  dlBtnLabel: { color: "#FFA032", fontSize: 12, fontWeight: "700" },
  muteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  muteIcon: { fontSize: 18 },

  /* ── Variant picker modal ── */
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: "#1A1A2E",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: "#2A2A45",
    maxHeight: "70%",
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2A2A45",
  },
  pickerTitle: { color: TEAL, fontSize: 15, fontWeight: "700" },
  pickerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerCloseText: { color: "#888", fontSize: 13 },
  pickerList: { maxHeight: 420 },
  pickerCard: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2A2A45",
  },
  pickerVideoTitle: { color: "#BBBBBB", fontSize: 12, marginBottom: 6 },
  pickerVariantRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2A2A3E",
  },
  pickerVariantInfo: { flexDirection: "row", alignItems: "center", gap: 10 },
  pickerResolution: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
    minWidth: 80,
  },
  pickerBandwidth: { color: "#8AB4F8", fontSize: 12 },
  pickerDlBtn: {
    backgroundColor: TEAL,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7,
  },
  pickerDlBtnText: { color: "#1A1A2E", fontWeight: "700", fontSize: 12 },

  /* ── Details modal ── */
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    color: "#888",
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  modalContent: {
    backgroundColor: "#1A1A2E",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A2A45",
    overflow: "hidden",
    maxHeight: "75%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#2A2A45",
  },
  modalTitle: {
    color: "#4ECDC4",
    fontSize: 14,
    fontWeight: "700",
  },
  list: {
    maxHeight: 420,
  },
  videoCard: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2A2A45",
  },
  videoCardPlaying: {
    backgroundColor: "rgba(99,179,237,0.12)",
    borderLeftWidth: 3,
    borderLeftColor: "#63b3ed",
  },
  videoInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  videoUrl: {
    flex: 1,
    color: "#BBBBBB",
    fontSize: 12,
  },
  variantList: {
    marginTop: 2,
  },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2A2A3E",
  },
  variantInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  variantResolution: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
    minWidth: 80,
  },
  variantBandwidth: {
    color: "#8AB4F8",
    fontSize: 11,
  },
  downloadVariantBtn: {
    backgroundColor: "#4ECDC4",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  downloadVariantBtnText: {
    color: "#1A1A2E",
    fontWeight: "700",
    fontSize: 12,
  },
  previewBtnRow: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#4ECDC4",
  },
  previewBtnRowText: {
    color: "#4ECDC4",
    fontSize: 12,
    fontWeight: "700",
  },
  emptyState: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyStateText: {
    color: "#888",
    fontSize: 13,
  },
});
