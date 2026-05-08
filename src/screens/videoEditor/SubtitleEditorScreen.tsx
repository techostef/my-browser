import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, Segment } from '../../types/videoEditor';
import VideoTimeline from '../../components/videoEditor/VideoTimeline';
import { segmentsToSrt } from '../../lib/videoEditor/srt';
import { loadSession, saveSession } from '../../lib/videoEditor/editSession';

type Props = NativeStackScreenProps<RootStackParamList, 'SubtitleEditor'>;

const CARD_HEIGHT = 68;

function fmtTime(secs: number): string {
  const safe = Math.max(0, secs);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

// ─── Subtitle card ────────────────────────────────────────────────────────────

type CardProps = {
  segment: Segment;
  isActive: boolean;
  isEditing: boolean;
  onPress: () => void;
  onChangeText: (id: number, text: string) => void;
  onBlur: () => void;
};

function SubtitleCard({ segment, isActive, isEditing, onPress, onChangeText, onBlur }: CardProps) {
  const [draft, setDraft] = useState(segment.text);

  useEffect(() => {
    setDraft(segment.text);
  }, [segment.text]);

  return (
    <TouchableOpacity
      style={[styles.card, isActive && styles.cardActive, isEditing && styles.cardEditing]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={[styles.cardTimestamp, isActive && styles.cardTimestampActive]}>
        {fmtTime(segment.start)} → {fmtTime(segment.end)}
      </Text>
      {isEditing ? (
        <TextInput
          style={styles.cardInput}
          value={draft}
          onChangeText={t => { setDraft(t); onChangeText(segment.id, t); }}
          onBlur={onBlur}
          autoFocus
          multiline
          selectionColor="#a89fff"
          placeholderTextColor="#555"
          placeholder="Type subtitle text…"
        />
      ) : (
        <Text style={[styles.cardText, !segment.text && styles.cardEmpty]} numberOfLines={2}>
          {segment.text || 'Empty — tap to edit'}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SubtitleEditorScreen({ navigation, route }: Props) {
  const { videoUri, segments: initial, timelineSegments, duration } = route.params;

  const [segments, setSegments] = useState<Segment[]>(initial);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const videoRef = useRef<Video>(null);
  const listRef = useRef<FlatList>(null);
  const sessionReady = useRef(false);
  const prevActiveIdx = useRef(-1);

  // ─── Session restore ───────────────────────────────────────────────────────

  useEffect(() => {
    loadSession(videoUri).then(session => {
      if (session?.subtitleSegments && session.subtitleSegments.length > 0) {
        setSegments(session.subtitleSegments);
      }
      sessionReady.current = true;
    });
  }, [videoUri]);

  // ─── Auto-save ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionReady.current) return;
    const t = setTimeout(() => {
      loadSession(videoUri).then(existing => {
        saveSession({
          videoUri,
          splitPoints: existing?.splitPoints ?? [],
          deletedSegments: existing?.deletedSegments ?? [],
          subtitleSegments: segments,
          updatedAt: Date.now(),
        });
      });
    }, 600);
    return () => clearTimeout(t);
  }, [segments, videoUri]);

  // ─── Current subtitle based on playhead ───────────────────────────────────

  const currentSubtitle = useMemo(
    () => segments.find(s => currentTime >= s.start && currentTime < s.end) ?? null,
    [segments, currentTime],
  );

  const currentActiveIdx = useMemo(
    () => (currentSubtitle ? segments.findIndex(s => s.id === currentSubtitle.id) : -1),
    [currentSubtitle, segments],
  );

  // Auto-scroll list to active subtitle during playback
  useEffect(() => {
    if (!isPlaying) return;
    if (currentActiveIdx < 0 || currentActiveIdx === prevActiveIdx.current) return;
    prevActiveIdx.current = currentActiveIdx;
    listRef.current?.scrollToIndex({
      index: currentActiveIdx,
      animated: true,
      viewPosition: 0.4,
    });
  }, [currentActiveIdx, isPlaying]);

  // ─── Playback ──────────────────────────────────────────────────────────────

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setCurrentTime((status.positionMillis ?? 0) / 1000);
    setIsPlaying(status.isPlaying ?? false);
  }, []);

  const togglePlay = async () => {
    if (isPlaying) {
      await videoRef.current?.pauseAsync();
    } else {
      await videoRef.current?.playAsync();
    }
  };

  const handleSeek = useCallback(async (seconds: number) => {
    await videoRef.current?.setPositionAsync(seconds * 1000);
  }, []);

  // ─── Subtitle editing ──────────────────────────────────────────────────────

  const updateSegment = useCallback((id: number, text: string) => {
    setSegments(prev => prev.map(s => (s.id === id ? { ...s, text } : s)));
  }, []);

  const handleCardPress = useCallback(async (segment: Segment) => {
    setEditingId(segment.id);
    await videoRef.current?.pauseAsync();
    await videoRef.current?.setPositionAsync(segment.start * 1000);
  }, []);

  // ─── Export ────────────────────────────────────────────────────────────────

  const handleExport = () => {
    navigation.navigate('Export', {
      videoUri,
      timelineSegments,
      duration,
      srt: segmentsToSrt(segments),
    });
  };

  // ─── Derived ───────────────────────────────────────────────────────────────

  const playheadFrac = duration > 0 ? currentTime / duration : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ── Video + subtitle overlay ── */}
        <View style={styles.videoContainer}>
          <Video
            ref={videoRef}
            source={{ uri: videoUri }}
            style={styles.video}
            resizeMode={ResizeMode.CONTAIN}
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
            shouldPlay={false}
            isLooping={false}
            useNativeControls={false}
          />
          {currentSubtitle ? (
            <View style={styles.subtitleOverlay} pointerEvents="none">
              <Text style={styles.subtitleText}>{currentSubtitle.text}</Text>
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
          <Text style={styles.segmentCount}>{segments.length} captions</Text>
        </View>

        {/* ── Timeline ── */}
        <VideoTimeline
          videoUri={videoUri}
          duration={duration}
          segments={timelineSegments}
          selectedSegment={null}
          playheadFrac={playheadFrac}
          onSeek={handleSeek}
        />

        {/* ── Subtitle caption markers ── */}
        <View style={styles.captionTrack}>
          {segments.map(seg => {
            const left = (seg.start / duration) * 100;
            const width = Math.max(((seg.end - seg.start) / duration) * 100, 0.5);
            const isActive = currentSubtitle?.id === seg.id;
            return (
              <TouchableOpacity
                key={seg.id}
                onPress={() => handleCardPress(seg)}
                style={[
                  styles.captionChip,
                  { left: `${left}%` as any, width: `${width}%` as any },
                  isActive && styles.captionChipActive,
                ]}
              />
            );
          })}
        </View>

        {/* ── Subtitle list ── */}
        <FlatList
          ref={listRef}
          data={segments}
          keyExtractor={item => String(item.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          getItemLayout={(_, index) => ({
            length: CARD_HEIGHT,
            offset: CARD_HEIGHT * index,
            index,
          })}
          onScrollToIndexFailed={({ index }) => {
            listRef.current?.scrollToOffset({ offset: index * CARD_HEIGHT, animated: true });
          }}
          renderItem={({ item }) => (
            <SubtitleCard
              segment={item}
              isActive={currentSubtitle?.id === item.id}
              isEditing={editingId === item.id}
              onPress={() => handleCardPress(item)}
              onChangeText={updateSegment}
              onBlur={() => setEditingId(null)}
            />
          )}
        />

        {/* ── Export button ── */}
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
          <Text style={styles.exportBtnText}>Export with Subtitles →</Text>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
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
  segmentCount: {
    flex: 1,
    color: '#555',
    fontSize: 12,
    textAlign: 'right',
  },

  // Caption track (mini markers above list)
  captionTrack: {
    height: 20,
    backgroundColor: '#111',
    marginHorizontal: 0,
    position: 'relative',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  captionChip: {
    position: 'absolute',
    height: 12,
    top: 4,
    backgroundColor: '#3d3670',
    borderRadius: 2,
    minWidth: 4,
  },
  captionChipActive: {
    backgroundColor: '#6c63ff',
  },

  // Subtitle list
  list: {
    flex: 1,
    backgroundColor: '#111',
  },
  listContent: {
    paddingVertical: 4,
  },

  // Subtitle card
  card: {
    height: CARD_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e1e',
    justifyContent: 'center',
  },
  cardActive: {
    backgroundColor: '#1a1630',
    borderLeftWidth: 3,
    borderLeftColor: '#6c63ff',
  },
  cardEditing: {
    backgroundColor: '#1e1a3a',
    height: 'auto' as any,
    minHeight: CARD_HEIGHT,
  },
  cardTimestamp: {
    color: '#555',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  cardTimestampActive: {
    color: '#a89fff',
  },
  cardText: {
    color: '#ddd',
    fontSize: 14,
    lineHeight: 19,
  },
  cardEmpty: {
    color: '#444',
    fontStyle: 'italic',
  },
  cardInput: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 2,
    borderBottomWidth: 1.5,
    borderBottomColor: '#6c63ff',
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
