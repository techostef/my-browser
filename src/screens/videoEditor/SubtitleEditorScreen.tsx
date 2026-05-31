import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withErrorBoundary } from '../../components/ErrorBoundary';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, Segment, SubtitleStyle } from '../../types/videoEditor';
import { DEFAULT_SUBTITLE_STYLE } from '../../types/videoEditor';
import VideoTimeline from '../../components/videoEditor/VideoTimeline';
import { segmentsToSrt } from '../../lib/videoEditor/srt';
import { loadSession, saveSession } from '../../lib/videoEditor/editSession';
import { rgbaFromStyle, resolveFontFamily } from '../../components/videoEditor/SubtitleStyleControls';
import { SUBTITLE_FONT_SCALE } from '../../types/videoEditor';
import { useTranslation } from '../../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'SubtitleEditor'>;

const SCREEN_W = Dimensions.get('window').width;
const PX_PER_SEC = 60;   // pixels per second on the subtitle timeline
const CHIP_H = 36;
const CHIP_ROW_H = 52;   // row height including vertical padding

function fmtTime(secs: number): string {
  const safe = Math.max(0, secs);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

function SubtitleEditorScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { videoUri, segments: initial, timelineSegments, duration, subtitleStyle: initialStyle } = route.params;

  const [segments, setSegments] = useState<Segment[]>(initial);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(
    initialStyle ?? DEFAULT_SUBTITLE_STYLE,
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const player = useVideoPlayer({ uri: videoUri }, p => { p.loop = false; });
  const subtitleScrollRef = useRef<ScrollView>(null);
  const sessionReady = useRef(false);
  const lastScrolledTime = useRef(-1);

  // ─── Session restore ───────────────────────────────────────────────────────

  useEffect(() => {
    loadSession(videoUri).then(session => {
      if (session?.subtitleSegments && session.subtitleSegments.length > 0) {
        setSegments(session.subtitleSegments);
      }
      if (session?.subtitleStyle) {
        setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...session.subtitleStyle });
      }
      sessionReady.current = true;
    });
  }, [videoUri]);

  // ─── Auto-save ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionReady.current) return;
    const timer = setTimeout(() => {
      loadSession(videoUri).then(existing => {
        saveSession({
          videoUri,
          splitPoints: existing?.splitPoints ?? [],
          deletedSegments: existing?.deletedSegments ?? [],
          subtitleSegments: segments,
          subtitleStyle,
          updatedAt: Date.now(),
        });
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [segments, subtitleStyle, videoUri]);

  // ─── Current subtitle ──────────────────────────────────────────────────────

  const currentSubtitle = useMemo(
    () => segments.find(s => currentTime >= s.start && currentTime < s.end) ?? null,
    [segments, currentTime],
  );

  // ─── Auto-scroll subtitle row with playhead ────────────────────────────────

  useEffect(() => {
    const threshold = isPlaying ? 0.25 : 0.05;
    if (Math.abs(currentTime - lastScrolledTime.current) < threshold) return;
    lastScrolledTime.current = currentTime;
    const targetX = Math.max(0, currentTime * PX_PER_SEC - SCREEN_W / 2);
    subtitleScrollRef.current?.scrollTo({ x: targetX, animated: !isPlaying });
  }, [currentTime, isPlaying]);

  // ─── Playback ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      setCurrentTime(currentTime);
    });
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => {
      setIsPlaying(isPlaying);
    });
    return () => {
      timeSub.remove();
      playingSub.remove();
    };
  }, [player]);

  const togglePlay = useCallback(() => {
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  }, [player]);

  const handleSeek = useCallback((seconds: number) => {
    player.currentTime = seconds;
  }, [player]);

  // ─── Chip press ────────────────────────────────────────────────────────────

  const handleChipPress = useCallback((seg: Segment) => {
    setEditingId(seg.id);
    setEditDraft(seg.text);
    player.pause();
    player.currentTime = seg.start;
    const targetX = Math.max(0, seg.start * PX_PER_SEC - SCREEN_W / 3);
    subtitleScrollRef.current?.scrollTo({ x: targetX, animated: true });
  }, [player]);

  const handleEditDone = useCallback(() => {
    setEditingId(null);
  }, []);

  // ─── Text update ───────────────────────────────────────────────────────────

  const handleTextChange = useCallback((text: string) => {
    setEditDraft(text);
    setSegments(prev =>
      prev.map(s => (s.id === editingId ? { ...s, text } : s)),
    );
  }, [editingId]);

  // ─── Export ────────────────────────────────────────────────────────────────

  const handleExport = () => {
    navigation.navigate('Export', {
      videoUri,
      timelineSegments,
      duration,
      segments,
      srt: segmentsToSrt(segments),
      subtitleStyle,
    });
  };

  // ─── Derived ───────────────────────────────────────────────────────────────

  const playheadFrac = duration > 0 ? currentTime / duration : 0;
  const timelineWidth = Math.max(duration * PX_PER_SEC + SCREEN_W, SCREEN_W);
  const editingSeg = editingId !== null ? segments.find(s => s.id === editingId) : null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ── Video + subtitle overlay ── */}
        <View style={styles.videoContainer}>
          <VideoView
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
          />
          {currentSubtitle ? (
            <View style={styles.subtitleOverlay} pointerEvents="none">
              <Text
                style={[
                  styles.subtitleText,
                  {
                    backgroundColor: rgbaFromStyle(subtitleStyle),
                    color: subtitleStyle.textColor,
                    fontFamily: resolveFontFamily(subtitleStyle.fontFamily),
                    fontSize: Math.round(16 * SUBTITLE_FONT_SCALE[subtitleStyle.fontSize]),
                  },
                ]}
              >
                {currentSubtitle.text}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Playback controls ── */}
        <View style={styles.controls}>
          <Text style={styles.timeCode}>
            {fmtTime(currentTime)}
            <Text style={styles.timeCodeDim}> / {fmtTime(duration)}</Text>
          </Text>
          <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
            <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <Text style={styles.captionCount}>{t('captionsCount', { count: String(segments.length) })}</Text>
        </View>

        {/* ── Video frame timeline + subtitle chip row with shared playhead ── */}
        <View style={styles.timelineStack}>
          <VideoTimeline
            videoUri={videoUri}
            duration={duration}
            segments={timelineSegments}
            selectedSegment={null}
            playheadFrac={playheadFrac}
            onSeek={handleSeek}
          />

          {/* Subtitle chip row */}
          <View style={styles.chipRowWrapper}>
            <ScrollView
              ref={subtitleScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={[styles.chipScrollContent, { width: timelineWidth }]}
              scrollEventThrottle={16}
            >
              {segments.map(seg => {
                const left = seg.start * PX_PER_SEC;
                const chipWidth = Math.max((seg.end - seg.start) * PX_PER_SEC - 2, 28);
                const isActive = currentSubtitle?.id === seg.id;
                const isSelected = editingId === seg.id;
                return (
                  <TouchableOpacity
                    key={seg.id}
                    onPress={() => handleChipPress(seg)}
                    activeOpacity={0.75}
                    style={[
                      styles.chip,
                      { left, width: chipWidth },
                      isActive && styles.chipActive,
                      isSelected && styles.chipSelected,
                    ]}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>
                      {seg.text || '…'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Extended playhead line spanning both timeline and chip row */}
          <View style={styles.extendedLine} pointerEvents="none" />
        </View>

        {/* ── Inline edit bar (appears when a chip is selected) ── */}
        {editingSeg ? (
          <View style={styles.editBar}>
            <Text style={styles.editTimestamp}>
              {fmtTime(editingSeg.start)} → {fmtTime(editingSeg.end)}
            </Text>
            <TextInput
              style={styles.editInput}
              value={editDraft}
              onChangeText={handleTextChange}
              autoFocus
              multiline
              selectionColor="#a89fff"
              placeholderTextColor="#555"
              placeholder={t('typeSubtitlePlaceholder')}
            />
            <TouchableOpacity style={styles.editDoneBtn} onPress={handleEditDone}>
              <Text style={styles.editDoneText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.editBarPlaceholder}>
            <Text style={styles.editBarHint}>{t('tapCaptionToEdit')}</Text>
          </View>
        )}

        {/* ── Export button ── */}
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
          <Text style={styles.exportBtnText}>{t('exportWithSubtitles')}</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },

  // Video
  videoContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  subtitleOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  subtitleText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },

  // Controls
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  timeCode: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  timeCodeDim: {
    color: '#555',
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    color: '#fff',
    fontSize: 18,
  },
  captionCount: {
    flex: 1,
    color: '#555',
    fontSize: 12,
    textAlign: 'right',
  },

  // Chip row
  timelineStack: {
    position: 'relative',
  },
  extendedLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: SCREEN_W / 2 - 1,
    width: 2,
    backgroundColor: '#fff',
    zIndex: 10,
  },

  chipRowWrapper: {
    height: CHIP_ROW_H,
    backgroundColor: '#111',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  chipScroll: {
    flex: 1,
  },
  chipScrollContent: {
    height: CHIP_ROW_H,
    position: 'relative',
  },
  chip: {
    position: 'absolute',
    top: (CHIP_ROW_H - CHIP_H) / 2,
    height: CHIP_H,
    backgroundColor: '#4a3f28',
    borderRadius: 6,
    paddingHorizontal: 8,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#6b5a38',
  },
  chipActive: {
    backgroundColor: '#5c4e32',
    borderColor: '#c89b4e',
  },
  chipSelected: {
    backgroundColor: '#2a2060',
    borderColor: '#6c63ff',
  },
  chipText: {
    color: '#f0d9a0',
    fontSize: 12,
    fontWeight: '500',
  },
  // Edit bar
  editBar: {
    backgroundColor: '#1a1a2e',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2250',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 60,
  },
  editTimestamp: {
    color: '#a89fff',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    width: 80,
  },
  editInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: '#6c63ff',
    paddingVertical: 4,
    maxHeight: 80,
  },
  editDoneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#6c63ff',
    borderRadius: 8,
  },
  editDoneText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  editBarPlaceholder: {
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e1e1e',
  },
  editBarHint: {
    color: '#333',
    fontSize: 12,
  },

  // Export
  exportBtn: {
    backgroundColor: '#6c63ff',
    margin: 12,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  exportBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default withErrorBoundary(SubtitleEditorScreen);
