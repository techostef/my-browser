/** biome-ignore-all lint/correctness/useExhaustiveDependencies: <explanation> */
/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: <explanation> */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ScreenOrientation from "expo-screen-orientation";
import { VideoView, useVideoPlayer } from "expo-video";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  StatusBar,
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
import {
  AdEventType,
  RewardedAdEventType,
  RewardedInterstitialAd,
} from "react-native-google-mobile-ads";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { REWARDED_INTERSTITIAL_AD_UNIT_ID } from "../../config/admob";
import { useTranslation } from "../../i18n";
import { DownloadTask } from "../../types";
import { DownloadMediaType } from "../DownloadItem";

type Props = {
  task: DownloadTask | null;
  mediaType: DownloadMediaType;
  onClose: () => void;
  onEditVideo?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const SEEK_SECS = 10;
const CONTROLS_HIDE_MS = 3000;
const SEEK_THROTTLE_MS = 300;

function formatTime(ms: number): string {
  const safe = !ms || ms < 0 ? 0 : ms;
  const totalSec = Math.floor(safe / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export default function PreviewModal({
  task,
  mediaType,
  onClose,
  onEditVideo,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: Props) {
  const { t } = useTranslation();
  const player = useVideoPlayer(task?.filePath ? { uri: task.filePath } : null);

  const seekHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seekBarRef = useRef<View>(null);
  const seekBarWRef = useRef(0);
  const seekBarPageXRef = useRef(0);
  const seekingRef = useRef(false);
  const durationRef = useRef(0);
  const seekTargetMsRef = useRef<number | null>(null);
  const seekStartTimeRef = useRef(0);
  const lastSeekAtRef = useRef(0);
  const pendingSeekSecRef = useRef<number | null>(null);
  const pendingSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [isPlaying, setIsPlaying] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [seekHint, setSeekHint] = useState<"left" | "right" | null>(null);
  const [landscape, setLandscape] = useState(false);

  // Image zoom/pan
  const imgScale = useSharedValue(1);
  const imgSavedScale = useSharedValue(1);
  const imgTransX = useSharedValue(0);
  const imgTransY = useSharedValue(0);
  const imgSavedTransX = useSharedValue(0);
  const imgSavedTransY = useSharedValue(0);

  const clampImg = (tx: number, ty: number, s: number) => {
    "worklet";
    const maxX = ((s - 1) * SCREEN_WIDTH) / 2;
    const maxY = ((s - 1) * SCREEN_HEIGHT) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, tx)),
      y: Math.min(maxY, Math.max(-maxY, ty)),
    };
  };

  const imgPinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      imgScale.value = Math.min(4, Math.max(1, imgSavedScale.value * e.scale));
    })
    .onEnd(() => {
      if (imgScale.value <= 1) {
        imgScale.value = withTiming(1);
        imgTransX.value = withTiming(0);
        imgTransY.value = withTiming(0);
        imgSavedScale.value = 1;
        imgSavedTransX.value = 0;
        imgSavedTransY.value = 0;
      } else {
        imgSavedScale.value = imgScale.value;
        const clamped = clampImg(
          imgTransX.value,
          imgTransY.value,
          imgScale.value,
        );
        imgTransX.value = clamped.x;
        imgTransY.value = clamped.y;
        imgSavedTransX.value = clamped.x;
        imgSavedTransY.value = clamped.y;
      }
    });

  const imgPanGesture = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      if (imgScale.value <= 1) return;
      const clamped = clampImg(
        imgSavedTransX.value + e.translationX,
        imgSavedTransY.value + e.translationY,
        imgScale.value,
      );
      imgTransX.value = clamped.x;
      imgTransY.value = clamped.y;
    })
    .onEnd(() => {
      imgSavedTransX.value = imgTransX.value;
      imgSavedTransY.value = imgTransY.value;
    });

  const imgDoubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (imgScale.value > 1) {
        imgScale.value = withTiming(1);
        imgTransX.value = withTiming(0);
        imgTransY.value = withTiming(0);
        imgSavedScale.value = 1;
        imgSavedTransX.value = 0;
        imgSavedTransY.value = 0;
      } else {
        const s = 2.5;
        const clamped = clampImg(
          (SCREEN_WIDTH / 2 - e.x) * (s - 1),
          (SCREEN_HEIGHT / 2 - e.y) * (s - 1),
          s,
        );
        imgScale.value = withTiming(s);
        imgTransX.value = withTiming(clamped.x);
        imgTransY.value = withTiming(clamped.y);
        imgSavedScale.value = s;
        imgSavedTransX.value = clamped.x;
        imgSavedTransY.value = clamped.y;
      }
    });

  const imgGesture = useMemo(
    () =>
      Gesture.Simultaneous(imgPinchGesture, imgPanGesture, imgDoubleTapGesture),
    [],
  );

  const imgAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: imgTransX.value },
      { translateY: imgTransY.value },
      { scale: imgScale.value },
    ],
  }));

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    setSeekHint(null);
    setIsPlaying(true);
    setPosition(0);
    setDuration(0);
    setIsBuffering(true);
    setShowControls(true);
    setLandscape(false);
    ScreenOrientation.unlockAsync();
    imgScale.value = 1;
    imgSavedScale.value = 1;
    imgTransX.value = 0;
    imgTransY.value = 0;
    imgSavedTransX.value = 0;
    imgSavedTransY.value = 0;
    if (task?.filePath) {
      player.replace({ uri: task.filePath });
      player.play();
    }
  }, [task?.id]);

  useEffect(() => {
    let active = true;

    const statusSub = player.addListener("statusChange", ({ status }) => {
      if (!active) return;
      setIsBuffering(status === "loading");
      if (status === "readyToPlay") {
        try {
          setDuration(player.duration * 1000);
        } catch {}
      }
    });
    const playingSub = player.addListener(
      "playingChange",
      ({ isPlaying: playing }) => {
        if (!active) return;
        setIsPlaying(playing);
        if (!playing) setShowControls(true);
      },
    );
    const interval = setInterval(() => {
      if (!active || seekingRef.current) return;
      try {
        const playerPosMs = player.currentTime * 1000;
        if (seekTargetMsRef.current !== null) {
          const elapsed = Date.now() - seekStartTimeRef.current;
          const diff = Math.abs(playerPosMs - seekTargetMsRef.current);
          if (diff < 500 || elapsed >= 3000) {
            seekTargetMsRef.current = null;
            setPosition(playerPosMs);
          }
          return;
        }
        setPosition(playerPosMs);
        if (player.duration > 0) setDuration(player.duration * 1000);
      } catch {}
    }, 250);

    return () => {
      active = false;
      statusSub.remove();
      playingSub.remove();
      clearInterval(interval);
    };
  }, [player]);

  useEffect(() => {
    return () => {
      if (seekHintTimer.current) clearTimeout(seekHintTimer.current);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      if (pendingSeekTimerRef.current)
        clearTimeout(pendingSeekTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!task) return;
    if (landscape) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else {
      ScreenOrientation.unlockAsync();
    }
  }, [task, landscape]);

  useEffect(() => {
    if (!task) return;
    const onBack = () => {
      if (landscape) {
        setLandscape(false);
        ScreenOrientation.unlockAsync();
        return true;
      }
      onClose();
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [task, landscape, onClose]);

  const armHideControls = () => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      setShowControls(false);
    }, CONTROLS_HIDE_MS);
  };

  useEffect(() => {
    if (showControls && isPlaying) {
      armHideControls();
    } else if (hideControlsTimer.current) {
      clearTimeout(hideControlsTimer.current);
    }
  }, [showControls, isPlaying]);

  const handleEditPress = useCallback(() => {
    const ad = RewardedInterstitialAd.createForAdRequest(
      REWARDED_INTERSTITIAL_AD_UNIT_ID,
    );
    const unsubs: Array<() => void> = [];
    let rewardEarned = false;
    const cleanup = () => {
      unsubs.forEach((fn) => fn());
      unsubs.length = 0;
    };

    unsubs.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show()),
    );
    unsubs.push(
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        rewardEarned = true;
      }),
    );
    unsubs.push(
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        cleanup();
        if (rewardEarned) onEditVideo?.();
      }),
    );
    unsubs.push(
      ad.addAdEventListener(AdEventType.ERROR, () => {
        cleanup();
        onEditVideo?.();
      }),
    );

    ad.load();
  }, [onEditVideo]);

  const togglePlay = () => {
    if (player.playing) {
      player.pause();
    } else {
      const dur = player.duration;
      const cur = player.currentTime;
      if (dur > 0 && cur >= dur - 0.05) {
        player.currentTime = 0;
      }
      player.play();
    }
  };

  const seekBy = (deltaSec: number) => {
    try {
      const curRaw = player.currentTime;
      const curSec =
        typeof curRaw === "number" && !Number.isNaN(curRaw)
          ? curRaw
          : position / 1000;
      const durRaw = player.duration;
      const durSec =
        typeof durRaw === "number" && durRaw > 0
          ? durRaw
          : durationRef.current / 1000;
      const newPosSec =
        durSec > 0
          ? Math.max(0, Math.min(durSec, curSec + deltaSec))
          : Math.max(0, curSec + deltaSec);
      seekTargetMsRef.current = newPosSec * 1000;
      seekStartTimeRef.current = Date.now();
      player.currentTime = newPosSec;
      setPosition(newPosSec * 1000);
    } catch {}
  };

  const flashHint = (side: "left" | "right") => {
    setSeekHint(side);
    if (seekHintTimer.current) clearTimeout(seekHintTimer.current);
    seekHintTimer.current = setTimeout(() => setSeekHint(null), 500);
  };

  const seekByRef = useRef(seekBy);
  seekByRef.current = seekBy;
  const flashHintRef = useRef(flashHint);
  flashHintRef.current = flashHint;

  const leftTapGesture = useMemo(() => {
    const dbl = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(50)
      .runOnJS(true)
      .onEnd(() => {
        seekByRef.current(-SEEK_SECS);
        flashHintRef.current("left");
      });
    const single = Gesture.Tap()
      .numberOfTaps(1)
      .maxDistance(50)
      .runOnJS(true)
      .onEnd(() => {
        setShowControls((s) => !s);
      });
    return Gesture.Exclusive(dbl, single);
  }, []);

  const rightTapGesture = useMemo(() => {
    const dbl = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(50)
      .runOnJS(true)
      .onEnd(() => {
        seekByRef.current(SEEK_SECS);
        flashHintRef.current("right");
      });
    const single = Gesture.Tap()
      .numberOfTaps(1)
      .maxDistance(50)
      .runOnJS(true)
      .onEnd(() => {
        setShowControls((s) => !s);
      });
    return Gesture.Exclusive(dbl, single);
  }, []);

  const centerTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDistance(50)
        .runOnJS(true)
        .onEnd(() => {
          setShowControls((s) => !s);
        }),
    [],
  );

  const measureSeekBar = () => {
    seekBarRef.current?.measure(
      (_x: number, _y: number, w: number, _h: number, pageX: number) => {
        if (w > 0) seekBarWRef.current = w;
        if (pageX != null) seekBarPageXRef.current = pageX;
      },
    );
  };

  const onSeekBarLayout = (e: LayoutChangeEvent) => {
    seekBarWRef.current = e.nativeEvent.layout.width;
    measureSeekBar();
  };

  const flushSeek = (newPosSec: number) => {
    lastSeekAtRef.current = Date.now();
    seekTargetMsRef.current = newPosSec * 1000;
    seekStartTimeRef.current = Date.now();
    player.currentTime = newPosSec;
    pendingSeekSecRef.current = null;
    if (pendingSeekTimerRef.current) {
      clearTimeout(pendingSeekTimerRef.current);
      pendingSeekTimerRef.current = null;
    }
  };

  const seekToX = (pageX: number) => {
    const w = seekBarWRef.current;
    const dur = durationRef.current;
    if (w <= 0 || dur <= 0) return;
    const x = pageX - seekBarPageXRef.current;
    const ratio = Math.max(0, Math.min(1, x / w));
    const newPosSec = (ratio * dur) / 1000;
    setPosition(newPosSec * 1000);

    const elapsed = Date.now() - lastSeekAtRef.current;
    if (elapsed >= SEEK_THROTTLE_MS) {
      flushSeek(newPosSec);
    } else {
      pendingSeekSecRef.current = newPosSec;
      if (!pendingSeekTimerRef.current) {
        pendingSeekTimerRef.current = setTimeout(() => {
          pendingSeekTimerRef.current = null;
          if (pendingSeekSecRef.current !== null) {
            flushSeek(pendingSeekSecRef.current);
          }
        }, SEEK_THROTTLE_MS - elapsed);
      }
    }
  };

  const onSeekGrant = (e: GestureResponderEvent) => {
    seekingRef.current = true;
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    // Re-measure in case of orientation/layout change
    measureSeekBar();
    seekToX(e.nativeEvent.pageX);
  };
  const onSeekMove = (e: GestureResponderEvent) => {
    seekToX(e.nativeEvent.pageX);
  };
  const onSeekRelease = () => {
    if (pendingSeekSecRef.current !== null) {
      flushSeek(pendingSeekSecRef.current);
    }
    seekingRef.current = false;
    if (isPlaying) armHideControls();
  };

  const progressPct = duration > 0 ? (position / duration) * 100 : 0;
  const isMedia = mediaType === "video" || mediaType === "audio";

  return (
    <Modal
      visible={!!task}
      animationType="fade"
      onRequestClose={() => {
        ScreenOrientation.unlockAsync();
        onClose();
      }}
      statusBarTranslucent
      transparent={false}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar hidden />
        <View style={styles.root}>
          {/* ── Image preview ── */}
          {task?.filePath && mediaType === "image" && (
            <>
              <GestureDetector gesture={imgGesture}>
                <Animated.View style={[StyleSheet.absoluteFill, imgAnimStyle]}>
                  <Image
                    source={{ uri: task.filePath }}
                    style={StyleSheet.absoluteFill}
                    contentFit="contain"
                  />
                </Animated.View>
              </GestureDetector>
              <SafeAreaView
                style={StyleSheet.absoluteFill}
                edges={["top"]}
                pointerEvents="box-none"
              >
                <View style={styles.topBar} pointerEvents="box-none">
                  <Text style={styles.titleText} numberOfLines={1}>
                    {task?.fileName || t("preview")}
                  </Text>
                  <TouchableOpacity
                    style={[styles.iconBtn, styles.modeBtn]}
                    onPress={() => setLandscape((l) => !l)}
                    hitSlop={8}
                  >
                    <Text style={styles.modeBtnText}>
                      {landscape
                        ? `▯ ${t("portrait")}`
                        : `▭ ${t("landscapeMode")}`}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => {
                      ScreenOrientation.unlockAsync();
                      onClose();
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.iconBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>
            </>
          )}

          {/* ── Video / audio preview ── */}
          {task?.filePath && isMedia && (
            <>
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                nativeControls={false}
              />

              {mediaType === "audio" && (
                <View style={styles.audioPlaceholder} pointerEvents="none">
                  <Text style={styles.audioIcon}>♪</Text>
                </View>
              )}

              {/* Tap zones (always present) */}
              <View style={StyleSheet.absoluteFill}>
                {mediaType === "video" && (
                  <GestureDetector gesture={leftTapGesture}>
                    <View style={[styles.tapZone, styles.tapZoneLeft]}>
                      {seekHint === "left" && (
                        <View style={styles.seekHint}>
                          <Text style={styles.seekHintText}>
                            « {SEEK_SECS}s
                          </Text>
                        </View>
                      )}
                    </View>
                  </GestureDetector>
                )}
                <GestureDetector gesture={centerTapGesture}>
                  <View style={styles.tapZoneCenter} />
                </GestureDetector>
                {mediaType === "video" && (
                  <GestureDetector gesture={rightTapGesture}>
                    <View style={[styles.tapZone, styles.tapZoneRight]}>
                      {seekHint === "right" && (
                        <View style={styles.seekHint}>
                          <Text style={styles.seekHintText}>
                            {SEEK_SECS}s »
                          </Text>
                        </View>
                      )}
                    </View>
                  </GestureDetector>
                )}
              </View>

              {/* Buffering spinner */}
              {isBuffering && (
                <View style={styles.bufferOverlay} pointerEvents="none">
                  <ActivityIndicator size="large" color="#fff" />
                </View>
              )}

              {/* Controls overlay */}
              {showControls && (
                <SafeAreaView
                  style={StyleSheet.absoluteFill}
                  edges={["top", "bottom"]}
                  pointerEvents="box-none"
                >
                  <View style={styles.dimOverlay} pointerEvents="none" />

                  {/* Top bar — title + edit + rotate + close */}
                  <View style={styles.topBar} pointerEvents="box-none">
                    <Text style={styles.titleText} numberOfLines={1}>
                      {task?.fileName || t("preview")}
                    </Text>
                    {mediaType === "video" && onEditVideo && (
                      <TouchableOpacity
                        style={[styles.iconBtn, styles.editBtn]}
                        onPress={handleEditPress}
                      >
                        <Text style={styles.editBtnText}>✂️ {t("edit")}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => {
                        ScreenOrientation.unlockAsync();
                        onClose();
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.iconBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Center play/pause */}
                  <View style={styles.centerControls} pointerEvents="box-none">
                    <TouchableOpacity
                      style={styles.playBtn}
                      onPress={togglePlay}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.playIcon}>
                        {isPlaying ? "❚❚" : "▶"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Bottom bar — prev | time | seek | time | next */}
                  <View style={styles.bottomBar} pointerEvents="box-none">
                    <View style={styles.seekRow}>
                      <Text style={styles.timeText}>
                        {formatTime(position)}
                      </Text>
                      <View
                        ref={seekBarRef}
                        collapsable={false}
                        style={styles.seekBarTouchable}
                        onLayout={onSeekBarLayout}
                        onStartShouldSetResponder={() => true}
                        onMoveShouldSetResponder={() => true}
                        onResponderGrant={onSeekGrant}
                        onResponderMove={onSeekMove}
                        onResponderRelease={onSeekRelease}
                        onResponderTerminate={onSeekRelease}
                      >
                        <View style={styles.seekBarTrack}>
                          <View
                            style={[
                              styles.seekBarFill,
                              { width: `${progressPct}%` },
                            ]}
                          />
                          <View
                            style={[
                              styles.seekBarThumb,
                              { left: `${progressPct}%` },
                            ]}
                          />
                        </View>
                      </View>
                      <Text style={styles.timeText}>
                        {formatTime(duration)}
                      </Text>
                    </View>

                    <View style={styles.navRow}>
                      <TouchableOpacity
                        style={styles.orientationBtn}
                        onPress={() => setLandscape((l) => !l)}
                        hitSlop={8}
                      >
                        <Ionicons
                          name={
                            landscape
                              ? "phone-portrait-outline"
                              : "phone-landscape-outline"
                          }
                          size={22}
                          color="#FFF"
                        />
                      </TouchableOpacity>
                      {onPrev && (
                        <TouchableOpacity
                          style={[
                            styles.navBtn,
                            !hasPrev && styles.navBtnDisabled,
                          ]}
                          onPress={onPrev}
                          disabled={!hasPrev}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.navBtnText,
                              !hasPrev && styles.navBtnTextDisabled,
                            ]}
                          >
                            ⏮ {t("previous")}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {onNext && (
                        <TouchableOpacity
                          style={[
                            styles.navBtn,
                            !hasNext && styles.navBtnDisabled,
                          ]}
                          onPress={onNext}
                          disabled={!hasNext}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.navBtnText,
                              !hasNext && styles.navBtnTextDisabled,
                            ]}
                          >
                            {t("next")} ⏭
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </SafeAreaView>
              )}
            </>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },

  // Top bar (overlays the video)
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  titleText: {
    flex: 1,
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
  },
  editBtn: {
    width: undefined,
    paddingHorizontal: 12,
    backgroundColor: "#6c63ff",
  },
  editBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },
  modeBtn: {
    width: undefined,
    paddingHorizontal: 12,
  },
  modeBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },

  // Audio backdrop
  audioPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  audioIcon: {
    color: "#333",
    fontSize: 140,
  },

  // Tap zones
  tapZone: {
    position: "absolute",
    top: 60,
    bottom: 140, // leave bottom bar clear
    width: "30%",
    alignItems: "center",
    justifyContent: "center",
  },
  tapZoneLeft: {
    left: 0,
  },
  tapZoneRight: {
    right: 0,
  },
  tapZoneCenter: {
    position: "absolute",
    top: 60,
    bottom: 140,
    left: "30%",
    right: "30%",
  },

  // Double-tap hint
  seekHint: {
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
  },
  seekHintText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },

  // Buffering
  bufferOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },

  // Controls
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  centerControls: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    color: "#FFF",
    fontSize: 28,
    fontWeight: "700",
    marginLeft: 3, // optical centering for the play triangle
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  seekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timeText: {
    color: "#FFF",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 44,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 3,
  },
  seekBarTouchable: {
    flex: 1,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  seekBarTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
    position: "relative",
  },
  seekBarFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#4ECDC4",
    borderRadius: 2,
  },
  seekBarThumb: {
    position: "absolute",
    top: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#4ECDC4",
    marginLeft: -7,
  },

  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    gap: 12,
  },
  navBtn: {
    flex: 1,
    backgroundColor: "rgba(43,43,43,0.85)",
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
  },
  navBtnDisabled: {
    backgroundColor: "rgba(26,26,26,0.7)",
  },
  navBtnText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
  },
  navBtnTextDisabled: {
    color: "#555",
  },
  orientationBtn: {
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
