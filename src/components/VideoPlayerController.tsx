import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Animated,
  GestureResponderEvent,
} from 'react-native';

function formatTime(secs: number): string {
  if (!isFinite(secs) || isNaN(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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
  onDownload?: () => void;
}

const DOUBLE_TAP_MS = 300;
const SEEK_SECS = 10;

// Stepped pseudo-gradients (top: dark→clear, bottom: clear→dark)
const TOP_SCRIM    = [0.72];
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
  onDownload,
}: Props) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const opacity   = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seekBarWidth, setSeekBarWidth] = useState(0);

  const lastLeftTap  = useRef(0);
  const lastRightTap = useRef(0);
  const leftOpacity  = useRef(new Animated.Value(0)).current;
  const rightOpacity = useRef(new Animated.Value(0)).current;
  const leftScale    = useRef(new Animated.Value(0.75)).current;
  const rightScale   = useRef(new Animated.Value(0.75)).current;

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
        () => setControlsVisible(false),
      );
    }, 3000);
  }, [opacity, cancelHide]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
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
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else {
      scheduleHide();
    }
  }, [isPaused]);

  const flashSeekIndicator = (opacityAnim: Animated.Value, scaleAnim: Animated.Value) => {
    opacityAnim.stopAnimation();
    scaleAnim.stopAnimation();
    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacityAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.delay(650),
        Animated.timing(opacityAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.spring(scaleAnim, { toValue: 1, speed: 24, bounciness: 6, useNativeDriver: true }),
        Animated.delay(750),
        Animated.timing(scaleAnim, { toValue: 0.75, duration: 200, useNativeDriver: true }),
      ]),
    ]).start();
  };

  const handleCenterPress = () => {
    if (controlsVisible) {
      cancelHide();
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        () => setControlsVisible(false),
      );
    } else {
      showControls();
    }
  };

  const handleLeftPress = () => {
    const now = Date.now();
    if (now - lastLeftTap.current < DOUBLE_TAP_MS) {
      onSkipBack();
      flashSeekIndicator(leftOpacity, leftScale);
      showControls();
      lastLeftTap.current = 0;
    } else {
      handleCenterPress();
      lastLeftTap.current = now;
    }
  };

  const handleRightPress = () => {
    const now = Date.now();
    if (now - lastRightTap.current < DOUBLE_TAP_MS) {
      onSkipForward();
      flashSeekIndicator(rightOpacity, rightScale);
      showControls();
      lastRightTap.current = 0;
    } else {
      handleCenterPress();
      lastRightTap.current = now;
    }
  };

  const progress  = duration > 0 ? Math.min(Math.max(currentTime / duration, 0), 1) : 0;
  const fillWidth = seekBarWidth * progress;
  // 18 px thumb — keep center on fill position
  const thumbLeft = Math.max(0, Math.min(fillWidth - 9, seekBarWidth - 18));

  const handleSeekPress = (e: GestureResponderEvent) => {
    if (seekBarWidth <= 0 || duration <= 0) return;
    const ratio = e.nativeEvent.locationX / seekBarWidth;
    onSeek(Math.max(0, Math.min(duration, ratio * duration)));
    showControls();
  };

  const showTopBar = headerTitle !== undefined || onDownload !== undefined;

  return (
    <View style={StyleSheet.absoluteFill}>

      {/* ── Layer 1: Tap zones ── */}
      <View style={styles.backdropRow}>
        <Pressable style={styles.sideZone}   onPress={handleLeftPress} />
        <Pressable style={styles.centerZone} onPress={handleCenterPress} />
        <Pressable style={styles.sideZone}   onPress={handleRightPress} />
      </View>

      {/* ── Layer 2: Seek flash indicators ── */}
      <View style={[StyleSheet.absoluteFill, styles.seekIndicatorLayer]} pointerEvents="none">
        <View style={styles.seekSlot}>
          <Animated.View style={[styles.seekBubble, { opacity: leftOpacity, transform: [{ scale: leftScale }] }]}>
            <Text style={styles.seekBubbleIcon}>{'◀◀'}</Text>
            <Text style={styles.seekBubbleLabel}>-{SEEK_SECS}s</Text>
          </Animated.View>
        </View>
        <View style={styles.seekSlotMid} />
        <View style={styles.seekSlot}>
          <Animated.View style={[styles.seekBubble, { opacity: rightOpacity, transform: [{ scale: rightScale }] }]}>
            <Text style={styles.seekBubbleIcon}>{'▶▶'}</Text>
            <Text style={styles.seekBubbleLabel}>+{SEEK_SECS}s</Text>
          </Animated.View>
        </View>
      </View>

      {/* ── Layer 3: Player controls ── */}
      {controlsVisible && (
        <Animated.View style={[styles.controlsOverlay, { opacity }]} pointerEvents="box-none">

          {/* Cinematic top scrim (dark → transparent) */}
          <View style={styles.topScrim} pointerEvents="none">
            {TOP_SCRIM.map((a, i) => (
              <View key={i} style={[styles.scrimStep, { backgroundColor: `rgba(0,0,0,${a})` }]} />
            ))}
          </View>

          {/* Cinematic bottom scrim (transparent → dark) */}
          <View style={styles.bottomScrim} pointerEvents="none">
            {BOTTOM_SCRIM.map((a, i) => (
              <View key={i} style={[styles.scrimStep, { backgroundColor: `rgba(0,0,0,${a})` }]} />
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
                {headerTitle ?? ''}
              </Text>

              {onDownload ? (
                <TouchableOpacity
                  style={styles.downloadBtn}
                  onPress={() => { onDownload(); showControls(); }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.downloadIcon}>↓</Text>
                  <Text style={styles.downloadLabel}>Save</Text>
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
              onPress={() => { onSkipBack(); showControls(); }}
            >
              <View style={styles.skipCircle}>
                <Text style={styles.skipIcon}>⏮</Text>
              </View>
              <Text style={styles.skipLabel}>{SEEK_SECS}s</Text>
            </TouchableOpacity>

            {/* Play / Pause — teal glow ring */}
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => { onTogglePlay(); showControls(); }}
            >
              <Text style={styles.playIcon}>{isPaused ? '▶' : '⏸'}</Text>
            </TouchableOpacity>

            {/* Skip forward */}
            <TouchableOpacity
              style={styles.skipWrap}
              onPress={() => { onSkipForward(); showControls(); }}
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
            <Pressable
              style={styles.seekArea}
              onPress={handleSeekPress}
              onLayout={e => setSeekBarWidth(e.nativeEvent.layout.width)}
            >
              <View style={styles.seekTrack}>
                <View style={[styles.seekFill, { width: fillWidth }]} />
              </View>
              <View style={[styles.seekThumb, { left: thumbLeft }]} />
            </Pressable>

            {/* Time + mute */}
            <View style={styles.timeRow}>
              <Text style={styles.timeCurrent}>{formatTime(currentTime)}</Text>
              <Text style={styles.timeSep}> / </Text>
              <Text style={styles.timeDuration}>{formatTime(duration)}</Text>
              <View style={styles.timeFlex} />
              {onDownload && (
                <TouchableOpacity
                  style={styles.dlBtn}
                  onPress={() => { onDownload(); showControls(); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.dlBtnIcon}>↓</Text>
                  <Text style={styles.dlBtnLabel}>Save</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.muteBtn}
                onPress={() => { onToggleMute(); showControls(); }}
              >
                <Text style={styles.muteIcon}>{isMuted ? '🔇' : '🔊'}</Text>
              </TouchableOpacity>
            </View>

          </View>
        </Animated.View>
      )}
    </View>
  );
}

const TEAL = '#4ECDC4';

const styles = StyleSheet.create({

  /* ── Tap zones ── */
  backdropRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  sideZone:   { flex: 3 },
  centerZone: { flex: 4 },

  /* ── Seek flash indicators ── */
  seekIndicatorLayer: { flexDirection: 'row', alignItems: 'center' },
  seekSlot:    { flex: 3, alignItems: 'center' },
  seekSlotMid: { flex: 4 },
  seekBubble: {
    backgroundColor: 'rgba(8,8,20,0.78)',
    borderRadius: 44,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(78,205,196,0.4)',
  },
  seekBubbleIcon:  { color: '#FFF', fontSize: 20, lineHeight: 24 },
  seekBubbleLabel: { color: TEAL, fontSize: 13, fontWeight: '700', marginTop: 5, letterSpacing: 0.3 },

  /* ── Controls overlay ── */
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Scrims */
  topScrim:    { position: 'absolute', top: 0, left: 0, right: 0, height: 110 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 180 },
  scrimStep:   { flex: 1 },

  /* ── Top bar ── */
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  topIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  topIconText: { color: '#FFF', fontSize: 20, lineHeight: 22 },
  topTitle: {
    flex: 1, color: '#FFF', fontSize: 15,
    fontWeight: '600', marginHorizontal: 12,
  },
  topSpacer: { width: 38 },
  downloadBtn: {
    flexDirection: 'row', height: 36, paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,160,50,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,160,50,0.55)',
    alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  downloadIcon:  { color: '#FFA032', fontSize: 16, fontWeight: '700', lineHeight: 18 },
  downloadLabel: { color: '#FFA032', fontSize: 13, fontWeight: '700' },

  /* ── Center controls ── */
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 36 },

  skipWrap: { alignItems: 'center', gap: 6 },
  skipCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  skipIcon:  { fontSize: 24, color: '#FFF' },
  skipLabel: { color: '#9A9A9A', fontSize: 11, fontWeight: '600' },

  playBtn: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(78,205,196,0.16)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: TEAL,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 18,
    elevation: 10,
  },
  playIcon: { fontSize: 32, color: '#FFF' },

  /* ── Bottom bar ── */
  bottomBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16,
    paddingBottom: 20,
    paddingTop: 6,
  },

  /* Seek bar */
  seekArea: { height: 32, justifyContent: 'center', marginBottom: 8 },
  seekTrack: {
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  seekFill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: TEAL,
    borderRadius: 3,
  },
  seekThumb: {
    position: 'absolute',
    top: 7,          // (32 - 18) / 2
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: TEAL,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },

  /* Time + mute */
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeCurrent:  { color: '#FFF', fontSize: 13, fontWeight: '600' },
  timeSep:      { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  timeDuration: { color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  timeFlex:     { flex: 1 },
  dlBtn: {
    flexDirection: 'row',
    height: 36, paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: 'rgba(255,160,50,0.16)',
    borderWidth: 1, borderColor: 'rgba(255,160,50,0.5)',
    alignItems: 'center', justifyContent: 'center',
    gap: 4, marginRight: 8,
  },
  dlBtnIcon:  { color: '#FFA032', fontSize: 15, fontWeight: '700', lineHeight: 17 },
  dlBtnLabel: { color: '#FFA032', fontSize: 12, fontWeight: '700' },
  muteBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  muteIcon: { fontSize: 18 },
});
