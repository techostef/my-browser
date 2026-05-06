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
  // Optional top-bar (replaces VideoPlayingNavbar when provided)
  headerTitle?: string;
  onMinimize?: () => void;
}

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
}: Props) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seekBarWidth, setSeekBarWidth] = useState(0);

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

  const handleBackdropPress = useCallback(() => {
    if (controlsVisible) {
      cancelHide();
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        () => setControlsVisible(false),
      );
    } else {
      showControls();
    }
  }, [controlsVisible, opacity, cancelHide, showControls]);

  useEffect(() => {
    showControls();
    return () => cancelHide();
  }, []);

  // Stay visible while paused; resume auto-hide on play
  useEffect(() => {
    if (isPaused) {
      cancelHide();
      setControlsVisible(true);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else {
      scheduleHide();
    }
  }, [isPaused]);

  const progress = duration > 0 ? Math.min(Math.max(currentTime / duration, 0), 1) : 0;
  const fillWidth = seekBarWidth * progress;
  const thumbLeft = Math.max(0, Math.min(fillWidth - 7, seekBarWidth - 14));

  const handleSeekPress = (e: GestureResponderEvent) => {
    if (seekBarWidth <= 0 || duration <= 0) return;
    const ratio = e.nativeEvent.locationX / seekBarWidth;
    onSeek(Math.max(0, Math.min(duration, ratio * duration)));
    showControls();
  };

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={handleBackdropPress}>
      {controlsVisible && (
        <Animated.View style={[styles.overlay, { opacity }]}>
          {/* Optional top bar (replaces VideoPlayingNavbar) */}
          {headerTitle !== undefined && (
            <View style={styles.topBar}>
              <TouchableOpacity
                style={styles.minimizeBtn}
                onPress={onMinimize}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.minimizeIcon}>←</Text>
              </TouchableOpacity>
              <Text style={styles.topBarTitle} numberOfLines={1}>{headerTitle}</Text>
              <View style={styles.topBarSpacer} />
            </View>
          )}

          {/* Center: skip-back, play/pause, skip-forward */}
          <View style={styles.centerRow}>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => { onSkipBack(); showControls(); }}
            >
              <Text style={styles.skipIcon}>⏮</Text>
              <Text style={styles.skipLabel}>10s</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => { onTogglePlay(); showControls(); }}
            >
              <Text style={styles.playIcon}>{isPaused ? '▶' : '⏸'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => { onSkipForward(); showControls(); }}
            >
              <Text style={styles.skipIcon}>⏭</Text>
              <Text style={styles.skipLabel}>10s</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom: current time | seek bar | duration | mute */}
          <View style={styles.bottomBar}>
            <Text style={styles.timeText}>{formatTime(currentTime)}</Text>

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

            <Text style={styles.timeText}>{formatTime(duration)}</Text>

            <TouchableOpacity
              style={styles.muteBtn}
              onPress={() => { onToggleMute(); showControls(); }}
            >
              <Text style={styles.muteIcon}>{isMuted ? '🔇' : '🔊'}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
  },
  skipBtn: {
    alignItems: 'center',
    padding: 8,
  },
  skipIcon: {
    fontSize: 30,
    color: '#FFF',
  },
  skipLabel: {
    color: '#CCC',
    fontSize: 11,
    marginTop: 2,
  },
  playBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  playIcon: {
    fontSize: 30,
    color: '#FFF',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    gap: 8,
  },
  timeText: {
    color: '#FFF',
    fontSize: 12,
    minWidth: 36,
  },
  seekArea: {
    flex: 1,
    height: 20,
    justifyContent: 'center',
  },
  seekTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  seekFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#4ECDC4',
    borderRadius: 2,
  },
  seekThumb: {
    position: 'absolute',
    top: 3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
  },
  muteBtn: {
    padding: 4,
  },
  muteIcon: {
    fontSize: 20,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  minimizeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  minimizeIcon: {
    color: '#FFF',
    fontSize: 20,
    lineHeight: 22,
  },
  topBarTitle: {
    flex: 1,
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  topBarSpacer: {
    width: 36,
  },
});
