import React, { useRef, useState, useEffect, useCallback, useMemo, useImperativeHandle } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/videoEditor';
import VideoTimeline from '../../components/videoEditor/VideoTimeline';
import type { TimelineSegment } from '../../components/videoEditor/VideoTimeline';
import { isFullVideo, filterSegments } from '../../utils/videoEditor/videoProcessor';
import { parseSrt, segmentsToSrt } from '../../lib/videoEditor/srt';
import type { Segment as SubtitleSegment } from '../../lib/videoEditor/srt';
import { getSubtitles } from '../../lib/videoEditor/subtitles';
import { transcribeVideo } from '../../lib/videoEditor/whisper';
import { getOpenAIKey } from '../../lib/openaiKey';
import { loadSession, saveSession, clearSession } from '../../lib/videoEditor/editSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Trim'>;

const MIN_SPLIT_GAP = 0.5;
const SCREEN_W = Dimensions.get('window').width;
const PX_PER_SEC = 80;
const CHIP_H = 36;
const CHIP_ROW_H = 52;

const CHIP_RENDER_BUFFER = 300;

interface ChipRowHandle {
  scrollTo: (x: number, animated?: boolean) => void;
}

interface ChipRowProps {
  subtitleSegments: SubtitleSegment[];
  activeSubtitleId: number | null;
  editingId: number | null;
  chipContentW: number;
  onChipPress: (seg: SubtitleSegment) => void;
}

const SubtitleChipRow = React.memo(
  React.forwardRef<ChipRowHandle, ChipRowProps>(
    ({ subtitleSegments, activeSubtitleId, editingId, chipContentW, onChipPress }, ref) => {
      const scrollViewRef = useRef<ScrollView>(null);
      const [scrollX, setScrollX] = useState(0);

      useImperativeHandle(ref, () => ({
        scrollTo: (x: number, animated = false) => {
          scrollViewRef.current?.scrollTo({ x, animated });
        },
      }));

      const visibleChips = useMemo(() => {
        const l = scrollX - CHIP_RENDER_BUFFER;
        const r = scrollX + SCREEN_W + CHIP_RENDER_BUFFER;
        return subtitleSegments.filter(
          seg => seg.end * PX_PER_SEC >= l && seg.start * PX_PER_SEC <= r,
        );
      }, [subtitleSegments, scrollX]);

      return (
        <View style={chipRowStyles.wrapper}>
          <ScrollView
            ref={scrollViewRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingHorizontal: SCREEN_W / 2 }}
            onScroll={e => setScrollX(e.nativeEvent.contentOffset.x)}
          >
            <View style={{ width: chipContentW, height: CHIP_ROW_H, position: 'relative' }}>
              {visibleChips.map(seg => {
                const left = seg.start * PX_PER_SEC;
                const chipWidth = Math.max((seg.end - seg.start) * PX_PER_SEC - 2, 28);
                return (
                  <TouchableOpacity
                    key={seg.id}
                    onPress={() => onChipPress(seg)}
                    activeOpacity={0.75}
                    style={[
                      chipRowStyles.chip,
                      { left, width: chipWidth },
                      activeSubtitleId === seg.id && chipRowStyles.chipActive,
                      editingId === seg.id && chipRowStyles.chipSelected,
                    ]}
                  >
                    <Text style={chipRowStyles.chipText} numberOfLines={1}>
                      {seg.text || '…'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      );
    },
  ),
);

const chipRowStyles = StyleSheet.create({
  wrapper: {
    height: CHIP_ROW_H,
    backgroundColor: '#111',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
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
});

interface VideoWithSubtitleProps {
  videoUri: string;
  subtitleText: string | null;
  onPlaybackStatusUpdate: (status: AVPlaybackStatus) => void;
}

const VideoWithSubtitle = React.memo(
  React.forwardRef<Video, VideoWithSubtitleProps>(
    ({ videoUri, subtitleText, onPlaybackStatusUpdate }, ref) => (
      <View style={videoStyles.container}>
        <Video
          ref={ref}
          source={{ uri: videoUri }}
          style={videoStyles.video}
          resizeMode={ResizeMode.CONTAIN}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          shouldPlay={false}
          isLooping={false}
          useNativeControls={false}
        />
        {subtitleText ? (
          <View style={videoStyles.subtitleOverlay} pointerEvents="none">
            <Text style={videoStyles.subtitleText}>{subtitleText}</Text>
          </View>
        ) : null}
      </View>
    ),
  ),
);

const videoStyles = StyleSheet.create({
  container: {
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
});

function fmtCompact(secs: number): string {
  const safe = Math.max(0, secs);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export default function TrimScreen({ navigation, route }: Props) {
  const { videoUri, duration: paramDuration } = route.params;

  const videoRef = useRef<Video>(null);
  const [duration, setDuration] = useState(paramDuration > 0 ? paramDuration : 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [subtitleSegments, setSubtitleSegments] = useState<SubtitleSegment[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // Split-based editing state
  const [splitPoints, setSplitPoints] = useState<number[]>([]);
  const [deletedSegments, setDeletedSegments] = useState<Set<number>>(new Set());
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);
  const sessionReady = useRef(false);
  const chipRowRef = useRef<ChipRowHandle>(null);
  const lastScrolledTime = useRef(-1);

  const durationRef = useRef(paramDuration > 0 ? paramDuration : 0);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // ─── Restore session on mount ────────────────────────────────────────────────

  useEffect(() => {
    loadSession(videoUri).then(session => {
      if (session && (session.splitPoints.length > 0 || session.deletedSegments.length > 0)) {
        setSplitPoints(session.splitPoints);
        setDeletedSegments(new Set(session.deletedSegments));
        setSessionRestored(true);
      }
      if (session?.subtitleSegments && session.subtitleSegments.length > 0) {
        setSubtitleSegments(session.subtitleSegments);
      }
      sessionReady.current = true;
    });
  }, [videoUri]);

  // ─── Auto-save session on changes (debounced) ────────────────────────────────

  useEffect(() => {
    if (!sessionReady.current) return;
    const t = setTimeout(() => {
      saveSession({
        videoUri,
        splitPoints,
        deletedSegments: [...deletedSegments],
        subtitleSegments: subtitleSegments.length > 0 ? subtitleSegments : undefined,
        updatedAt: Date.now(),
      });
    }, 600);
    return () => clearTimeout(t);
  }, [splitPoints, deletedSegments, subtitleSegments, videoUri]);

  // ─── Derive segments from split points ──────────────────────────────────────

  const sortedSplits = useMemo(
    () => [...splitPoints].sort((a, b) => a - b),
    [splitPoints],
  );

  const segments: TimelineSegment[] = useMemo(() => {
    const bounds = [0, ...sortedSplits, 1];
    const segs: TimelineSegment[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      segs.push({
        startFrac: bounds[i],
        endFrac: bounds[i + 1],
        kept: !deletedSegments.has(i),
      });
    }
    return segs;
  }, [sortedSplits, deletedSegments]);

  // Ref for playback callback (avoids stale closure)
  const segmentsRef = useRef(segments);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  // ─── Auto-select segment based on playhead position ─────────────────────────

  useEffect(() => {
    if (duration <= 0 || segments.length === 0) return;
    const frac = currentTime / duration;
    for (let i = 0; i < segments.length; i++) {
      if (frac >= segments[i].startFrac && frac < segments[i].endFrac) {
        setSelectedSegment(i);
        return;
      }
    }
    setSelectedSegment(segments.length - 1);
  }, [currentTime, duration, segments]);

  // ─── Playback ───────────────────────────────────────────────────────────────

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;

    if (status.durationMillis && status.durationMillis > 0) {
      const realDur = status.durationMillis / 1000;
      if (Math.abs(realDur - durationRef.current) > 0.5) {
        setDuration(realDur);
      }
    }

    const posSecs = (status.positionMillis ?? 0) / 1000;
    if (status.isPlaying) {
      setCurrentTime(posSecs);
    }
    setIsPlaying(status.isPlaying ?? false);

    // During playback: skip deleted segments, stop at end of last kept segment
    if (status.isPlaying && durationRef.current > 0) {
      const frac = posSecs / durationRef.current;
      const segs = segmentsRef.current;

      // Find current segment
      const curSeg = segs.find(
        (s) => frac >= s.startFrac && frac < s.endFrac,
      );

      if (curSeg && !curSeg.kept) {
        // In a deleted segment — jump to next kept one
        const curIdx = segs.indexOf(curSeg);
        const nextKept = segs.slice(curIdx + 1).find((s) => s.kept);
        if (nextKept) {
          videoRef.current?.setPositionAsync(
            nextKept.startFrac * durationRef.current * 1000,
          );
        } else {
          // No more kept segments — stop
          videoRef.current?.pauseAsync();
          const firstKept = segs.find((s) => s.kept);
          if (firstKept) {
            videoRef.current?.setPositionAsync(
              firstKept.startFrac * durationRef.current * 1000,
            );
          }
        }
        return;
      }

      // Stop at end of the last kept segment
      const lastKept = [...segs].reverse().find((s) => s.kept);
      if (lastKept && frac >= lastKept.endFrac - 0.005) {
        videoRef.current?.pauseAsync();
        const firstKept = segs.find((s) => s.kept);
        if (firstKept) {
          videoRef.current?.setPositionAsync(
            firstKept.startFrac * durationRef.current * 1000,
          );
        }
      }
    }
  }, []);

  const togglePlay = async () => {
    if (isPlaying) {
      await videoRef.current?.pauseAsync();
    } else {
      // Start from the first kept segment if current position is in a deleted one
      const dur = durationRef.current;
      const frac = currentTime / dur;
      const segs = segmentsRef.current;
      const curSeg = segs.find(
        (s) => frac >= s.startFrac && frac < s.endFrac,
      );
      if (curSeg && !curSeg.kept) {
        const nextKept = segs.find(
          (s) => s.startFrac >= curSeg.startFrac && s.kept,
        );
        if (nextKept) {
          await videoRef.current?.setPositionAsync(
            nextKept.startFrac * dur * 1000,
          );
        }
      }
      await videoRef.current?.playAsync();
    }
  };

  // ─── Seek from timeline ─────────────────────────────────────────────────────

  const handleSeek = useCallback(async (seconds: number) => {
    setCurrentTime(seconds);
    chipRowRef.current?.scrollTo(seconds * PX_PER_SEC, false);
    lastScrolledTime.current = seconds;
    await videoRef.current?.setPositionAsync(seconds * 1000);
  }, []);

  // ─── Split at playhead ──────────────────────────────────────────────────────

  const handleSplit = () => {
    const dur = durationRef.current;
    if (dur <= 0) return;

    const frac = currentTime / dur;
    if (frac <= 0.01 || frac >= 0.99) {
      Alert.alert('Cannot Split', 'Move the playhead away from the edges.');
      return;
    }

    // Check not too close to existing splits
    const tooClose = splitPoints.some(
      (sp) => Math.abs(sp - frac) < MIN_SPLIT_GAP / dur,
    );
    if (tooClose) {
      Alert.alert('Too Close', 'Move the playhead further from an existing split.');
      return;
    }

    setSplitPoints((prev) => [...prev, frac]);
  };

  // ─── Delete / restore selected segment ──────────────────────────────────────

  const handleDeleteSegment = () => {
    if (selectedSegment === null) return;

    // Don't allow deleting ALL segments
    const newDeleted = new Set(deletedSegments);
    if (newDeleted.has(selectedSegment)) {
      newDeleted.delete(selectedSegment); // restore
    } else {
      // Check we'd still have at least one kept segment
      const wouldKeep = segments.filter(
        (s, i) => i !== selectedSegment && s.kept,
      );
      if (wouldKeep.length === 0) {
        Alert.alert('Cannot Delete', 'You must keep at least one section.');
        return;
      }
      newDeleted.add(selectedSegment);
    }
    setDeletedSegments(newDeleted);
  };

  // ─── Reset ──────────────────────────────────────────────────────────────────

  const handleReset = async () => {
    setSplitPoints([]);
    setDeletedSegments(new Set());
    setSelectedSegment(null);
    setSessionRestored(false);
    await clearSession(videoUri);
  };

  // ─── Subtitle editing ────────────────────────────────────────────────────────

  const currentSubtitle = useMemo(
    () => subtitleSegments.find(s => currentTime >= s.start && currentTime < s.end) ?? null,
    [subtitleSegments, currentTime],
  );

  useEffect(() => {
    if (subtitleSegments.length === 0) return;
    if (Math.abs(currentTime - lastScrolledTime.current) < 0.05) return;
    lastScrolledTime.current = currentTime;
    chipRowRef.current?.scrollTo(currentTime * PX_PER_SEC, false);
  }, [currentTime, subtitleSegments.length]);

  const handleChipPress = useCallback(async (seg: SubtitleSegment) => {
    setEditingId(seg.id);
    setEditDraft(seg.text);
    await videoRef.current?.pauseAsync();
    await videoRef.current?.setPositionAsync(seg.start * 1000);
    chipRowRef.current?.scrollTo(seg.start * PX_PER_SEC, true);
  }, []);

  const handleEditDone = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleTextChange = useCallback((text: string) => {
    setEditDraft(text);
    setSubtitleSegments(prev => prev.map(s => (s.id === editingId ? { ...s, text } : s)));
  }, [editingId]);

  // ─── Export ──────────────────────────────────────────────────────────────────

  const handleExport = () => {
    navigation.navigate('Export', {
      videoUri,
      timelineSegments: segments,
      duration: durationRef.current,
      ...(subtitleSegments.length > 0
        ? { segments: subtitleSegments, srt: segmentsToSrt(subtitleSegments) }
        : {}),
    });
  };

  // ─── Process locally & continue ─────────────────────────────────────────────

  const handleContinue = async () => {
    setLoading(true);
    try {
      const dur = durationRef.current;

      // Already have subtitles — nothing to do (they're shown inline)
      if (subtitleSegments.length > 0) return;

      // No saved subtitles — extract fresh
      setStatusMsg('Looking for subtitles…');
      let rawSrt = await getSubtitles(videoUri);

      if (!rawSrt) {
        const apiKey = await getOpenAIKey();
        if (!apiKey) {
          Alert.alert(
            'No subtitles found',
            'This video has no embedded or sidecar subtitle file.\n\nAdd your OpenAI API key in Settings → AI Subtitles to enable automatic transcription.',
          );
          return;
        }
        setStatusMsg('Transcribing with Whisper AI…');
        const result = await transcribeVideo(videoUri);
        rawSrt = result.srt;
      }

      let allSrtSegments = parseSrt(rawSrt);
      let finalSegments = allSrtSegments;

      if (!isFullVideo(segments)) {
        setStatusMsg('Filtering subtitles…');
        const filtered = filterSegments(allSrtSegments, segments, dur);
        finalSegments = filtered.segments;
      }

      setSubtitleSegments(finalSegments);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Processing failed';
      Alert.alert('Error', msg);
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  };

  // ─── Derived ────────────────────────────────────────────────────────────────

  const playheadFrac = duration > 0 ? currentTime / duration : 0;
  const keptDuration = segments
    .filter((s) => s.kept)
    .reduce((sum, s) => sum + (s.endFrac - s.startFrac) * duration, 0);
  const hasSplits = splitPoints.length > 0;
  const hasDeleted = deletedSegments.size > 0;
  const selSeg = selectedSegment !== null ? segments[selectedSegment] : null;
  const selIsDeleted = selSeg ? !selSeg.kept : false;

  // ─── Render ─────────────────────────────────────────────────────────────────

  const chipContentW = Math.max(duration * PX_PER_SEC, SCREEN_W);
  const editingSeg = editingId !== null ? subtitleSegments.find(s => s.id === editingId) : null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ── Resume banner ── */}
      {sessionRestored && (
        <View style={styles.resumeBanner}>
          <Text style={styles.resumeText}>Continuing previous edit</Text>
          <TouchableOpacity onPress={handleReset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.resumeDismiss}>Reset ×</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Video + subtitle overlay ── */}
      <VideoWithSubtitle
        ref={videoRef}
        videoUri={videoUri}
        subtitleText={currentSubtitle?.text ?? null}
        onPlaybackStatusUpdate={onPlaybackStatusUpdate}
      />

      {/* ── Controls bar ── */}
      <View style={styles.controlsBar}>
        <View style={styles.controlsSide}>
          <Text style={styles.timeText}>
            {fmtCompact(currentTime)}
            <Text style={styles.timeDim}> / {fmtCompact(duration)}</Text>
          </Text>
        </View>

        <TouchableOpacity
          style={styles.playBtn}
          onPress={togglePlay}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
        </TouchableOpacity>

        <View style={[styles.controlsSide, styles.controlsSideRight]}>
          <Text style={styles.keptBadge}>
            {hasDeleted ? `Kept: ${fmtCompact(keptDuration)}` : fmtCompact(duration)}
          </Text>
        </View>
      </View>

      {/* ── Timeline + subtitle chip row ── */}
      <View style={styles.timelineStack}>
        <VideoTimeline
          videoUri={videoUri}
          duration={duration}
          segments={segments}
          selectedSegment={selectedSegment}
          playheadFrac={playheadFrac}
          onSeek={handleSeek}
        />

        {subtitleSegments.length > 0 && (
          <SubtitleChipRow
            ref={chipRowRef}
            subtitleSegments={subtitleSegments}
            activeSubtitleId={currentSubtitle?.id ?? null}
            editingId={editingId}
            chipContentW={chipContentW}
            onChipPress={handleChipPress}
          />
        )}

        <View style={styles.extendedLine} pointerEvents="none" />
      </View>

      {/* ── Segment info ── */}
      <View style={styles.infoRow}>
        {hasSplits && selectedSegment !== null && selSeg ? (
          <Text style={styles.infoText}>
            Section {selectedSegment + 1}/{segments.length}
            {'  •  '}
            {fmtCompact(selSeg.startFrac * duration)} → {fmtCompact(selSeg.endFrac * duration)}
            {'  •  '}
            <Text style={{ color: selIsDeleted ? '#ff5252' : '#4caf50' }}>
              {selIsDeleted ? 'Deleted' : 'Kept'}
            </Text>
          </Text>
        ) : (
          <Text style={styles.hintText}>
            Scroll to position the line, then press Split
          </Text>
        )}
      </View>

      {/* ── Inline subtitle edit bar ── */}
      {editingSeg ? (
        <View style={styles.editBar}>
          <Text style={styles.editTimestamp}>
            {fmtCompact(editingSeg.start)} → {fmtCompact(editingSeg.end)}
          </Text>
          <TextInput
            style={styles.editInput}
            value={editDraft}
            onChangeText={handleTextChange}
            autoFocus
            multiline
            selectionColor="#a89fff"
            placeholderTextColor="#555"
            placeholder="Type subtitle text…"
          />
          <TouchableOpacity style={styles.editDoneBtn} onPress={handleEditDone}>
            <Text style={styles.editDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Status / loading ── */}
      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#fff" size="small" />
          <Text style={styles.statusText}>{statusMsg}</Text>
        </View>
      )}

      {/* ── Bottom toolbar ── */}
      <View style={styles.bottomToolbar}>
        <View style={styles.toolbarDivider} />
        <View style={styles.toolbarRow}>
          {/* Reset */}
          <TouchableOpacity
            style={[styles.toolbarItem, loading && styles.disabled]}
            onPress={handleReset}
            disabled={loading || !hasSplits}
          >
            <Text style={[styles.toolbarIcon, !hasSplits && styles.iconDim]}>↺</Text>
            <Text style={[styles.toolbarLabel, !hasSplits && styles.labelDim]}>Reset</Text>
          </TouchableOpacity>

          {/* Split */}
          <TouchableOpacity
            style={[styles.toolbarItem, loading && styles.disabled]}
            onPress={handleSplit}
            disabled={loading}
          >
            <Text style={styles.toolbarIcon}>✂️</Text>
            <Text style={[styles.toolbarLabel, styles.toolbarLabelActive]}>Split</Text>
          </TouchableOpacity>

          {/* Delete / Restore */}
          <TouchableOpacity
            style={[styles.toolbarItem, loading && styles.disabled]}
            onPress={handleDeleteSegment}
            disabled={loading || selectedSegment === null || !hasSplits}
          >
            <Text style={[styles.toolbarIcon, (!hasSplits) && styles.iconDim]}>
              {selIsDeleted ? '↩' : '🗑️'}
            </Text>
            <Text style={[styles.toolbarLabel, (!hasSplits) && styles.labelDim]}>
              {selIsDeleted ? 'Restore' : 'Delete'}
            </Text>
          </TouchableOpacity>

          {/* Subtitles → Whisper → SubtitleEditor */}
          <TouchableOpacity
            style={[styles.toolbarItem, loading && styles.disabled]}
            onPress={handleContinue}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" style={{ height: 26 }} />
            ) : (
              <Text style={styles.toolbarIcon}>💬</Text>
            )}
            <Text style={styles.toolbarLabel}>Subtitles</Text>
          </TouchableOpacity>

          {/* Export → ExportScreen (no subtitles) */}
          <TouchableOpacity
            style={[styles.toolbarItem, loading && styles.disabled]}
            onPress={handleExport}
            disabled={loading}
          >
            <Text style={styles.toolbarIcon}>⬇️</Text>
            <Text style={[styles.toolbarLabel, styles.toolbarLabelActive]}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  // Controls bar
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  controlsSide: {
    flex: 1,
  },
  controlsSideRight: {
    alignItems: 'flex-end',
  },
  timeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  timeDim: {
    color: '#666',
    fontWeight: '400',
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    fontSize: 20,
    color: '#fff',
  },
  keptBadge: {
    color: '#888',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },

  // Info row
  infoRow: {
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  infoText: {
    color: '#bbb',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  hintText: {
    color: '#555',
    fontSize: 12,
  },

  // Loading
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  statusText: {
    color: '#aaa',
    fontSize: 12,
    fontStyle: 'italic',
  },

  // Bottom toolbar
  bottomToolbar: {
    marginTop: 'auto',
    paddingBottom: 16,
  },
  toolbarDivider: {
    height: 0.5,
    backgroundColor: '#2a2a2a',
    marginBottom: 8,
  },
  toolbarRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toolbarItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 56,
  },
  toolbarIcon: {
    fontSize: 22,
    color: '#fff',
    marginBottom: 4,
  },
  toolbarLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  toolbarLabelActive: {
    color: '#fff',
  },
  iconDim: {
    opacity: 0.3,
  },
  labelDim: {
    opacity: 0.3,
  },
  disabled: {
    opacity: 0.4,
  },
  resumeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1a3a',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  resumeText: {
    color: '#a89fff',
    fontSize: 12,
  },
  resumeDismiss: {
    color: '#6c63ff',
    fontSize: 12,
    fontWeight: '600',
  },

  // Timeline stack
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

  // Inline edit bar
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
});
