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
  Keyboard,
  Platform,
  Dimensions,
  Modal,
  Pressable,
} from 'react-native';
import { VideoView, useVideoPlayer, VideoPlayer } from 'expo-video';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, SubtitleStyle } from '../../types/videoEditor';
import { DEFAULT_SUBTITLE_STYLE } from '../../types/videoEditor';
import SubtitleStyleControls, { rgbaFromStyle, resolveFontFamily } from '../../components/videoEditor/SubtitleStyleControls';
import { SUBTITLE_FONT_SCALE } from '../../types/videoEditor';
import VideoTimeline from '../../components/videoEditor/VideoTimeline';
import type { TimelineSegment } from '../../components/videoEditor/VideoTimeline';
import { isFullVideo, filterSegments } from '../../utils/videoEditor/videoProcessor';
import { parseSrt, segmentsToSrt } from '../../lib/videoEditor/srt';
import type { Segment as SubtitleSegment } from '../../lib/videoEditor/srt';
import { getSubtitles } from '../../lib/videoEditor/subtitles';
import { transcribeVideo } from '../../lib/videoEditor/whisper';
import { translateSegments } from '../../lib/videoEditor/translate';
import { loadSubtitles, saveSubtitles, clearSubtitles } from '../../lib/videoEditor/subtitleCache';
import { getOpenAIKey } from '../../lib/openaiKey';
import {
  loadSession,
  saveSession,
  clearSession,
  loadLastSubtitleStyle,
  saveLastSubtitleStyle,
} from '../../lib/videoEditor/editSession';
import { ENABLE_AI_CAPTIONS } from '../../config';
import {
  RewardedInterstitialAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { REWARDED_INTERSTITIAL_AD_UNIT_ID } from '../../config/admob';

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
  onChipDelete: (seg: SubtitleSegment) => void;
}

const SubtitleChipRow = React.memo(
  React.forwardRef<ChipRowHandle, ChipRowProps>(
    ({ subtitleSegments, activeSubtitleId, editingId, chipContentW, onChipPress, onChipDelete }, ref) => {
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
                    <TouchableOpacity
                      onPress={() => onChipDelete(seg)}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      style={chipRowStyles.chipDeleteBtn}
                    >
                      <Text style={chipRowStyles.chipDeleteText}>×</Text>
                    </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
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
    flex: 1,
  },
  chipDeleteBtn: {
    marginLeft: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,82,82,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipDeleteText: {
    color: '#ff5252',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
});

interface VideoWithSubtitleProps {
  player: VideoPlayer;
  subtitleText: string | null;
  subtitleBg: string;
  subtitleColor: string;
  subtitleFontFamily: string | undefined;
  subtitleFontSize: number;
}

const VideoWithSubtitle = React.memo((
  { player, subtitleText, subtitleBg, subtitleColor, subtitleFontFamily, subtitleFontSize }: VideoWithSubtitleProps,
) => (
  <View style={videoStyles.container}>
    <VideoView
      player={player}
      style={videoStyles.video}
      contentFit="contain"
      nativeControls={false}
    />
    {subtitleText ? (
      <View style={videoStyles.subtitleOverlay} pointerEvents="none">
        <Text
          style={[
            videoStyles.subtitleText,
            {
              backgroundColor: subtitleBg,
              color: subtitleColor,
              fontFamily: subtitleFontFamily,
              fontSize: subtitleFontSize,
            },
          ]}
        >
          {subtitleText}
        </Text>
      </View>
    ) : null}
  </View>
));

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

// Accepts "M:SS", "M:SS.ms", or plain seconds
function parseTimeSec(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const colonIdx = s.indexOf(':');
  if (colonIdx !== -1) {
    const minutes = parseInt(s.slice(0, colonIdx), 10);
    const seconds = parseFloat(s.slice(colonIdx + 1));
    if (isNaN(minutes) || isNaN(seconds)) return null;
    return minutes * 60 + seconds;
  }
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

export default function TrimScreen({ navigation, route }: Props) {
  const { videoUri, duration: paramDuration } = route.params;

  const player = useVideoPlayer({ uri: videoUri }, p => {
    p.loop = false;
    // expo-video default is 0 (disabled); without this the timeUpdate event
    // never fires and the playhead time stays stuck at 0:00.
    p.timeUpdateEventInterval = 0.1;
  });
  const [duration, setDuration] = useState(paramDuration > 0 ? paramDuration : 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [subtitleSegments, setSubtitleSegments] = useState<SubtitleSegment[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editStartDraft, setEditStartDraft] = useState('');
  const [editEndDraft, setEditEndDraft] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [captionMenuOpen, setCaptionMenuOpen] = useState(false);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [manualCaptionOpen, setManualCaptionOpen] = useState(false);
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [manualText, setManualText] = useState('');
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [setupSource, setSetupSource] = useState<'ai' | 'local' | 'edit' | null>(null);

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

  // ─── Track keyboard height so the inline edit bar can float above it ────────
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, e => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // ─── Restore session on mount ────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const session = await loadSession(videoUri);
      if (session && (session.splitPoints.length > 0 || session.deletedSegments.length > 0)) {
        setSplitPoints(session.splitPoints);
        setDeletedSegments(new Set(session.deletedSegments));
        setSessionRestored(true);
      }
      if (session?.subtitleSegments && session.subtitleSegments.length > 0) {
        setSubtitleSegments(session.subtitleSegments);
      } else {
        // No subtitles in session — fall back to the persistent cache so a
        // previous transcription/translation isn't lost when the edit
        // session is reset or cleared after export.
        const cached = await loadSubtitles(videoUri);
        if (cached) setSubtitleSegments(cached);
      }
      if (session?.subtitleStyle) {
        setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...session.subtitleStyle });
      } else {
        // No per-video style yet — fall back to the last-used global default so
        // the user's preferred styling persists across export/session-clear and
        // across new videos.
        const last = await loadLastSubtitleStyle();
        if (last) setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...last });
      }
      sessionReady.current = true;
    })();
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
        subtitleStyle,
        updatedAt: Date.now(),
      });
      saveLastSubtitleStyle(subtitleStyle);
    }, 600);
    return () => clearTimeout(t);
  }, [splitPoints, deletedSegments, subtitleSegments, subtitleStyle, videoUri]);

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

  useEffect(() => {
    // Handle the case where the player was already ready before listeners
    // attached — statusChange won't re-fire, so seed duration directly.
    if (player.duration > 0 && Math.abs(player.duration - durationRef.current) > 0.5) {
      setDuration(player.duration);
    }
    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' && player.duration > 0) {
        const realDur = player.duration;
        if (Math.abs(realDur - durationRef.current) > 0.5) {
          setDuration(realDur);
        }
      }
    });
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => {
      setIsPlaying(isPlaying);
    });
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (!player.playing) return;
      setCurrentTime(currentTime);

      if (durationRef.current <= 0) return;
      const frac = currentTime / durationRef.current;
      const segs = segmentsRef.current;

      const curSeg = segs.find(s => frac >= s.startFrac && frac < s.endFrac);
      if (curSeg && !curSeg.kept) {
        const curIdx = segs.indexOf(curSeg);
        const nextKept = segs.slice(curIdx + 1).find(s => s.kept);
        if (nextKept) {
          player.currentTime = nextKept.startFrac * durationRef.current;
        } else {
          player.pause();
          const firstKept = segs.find(s => s.kept);
          if (firstKept) {
            player.currentTime = firstKept.startFrac * durationRef.current;
          }
        }
        return;
      }

      const lastKept = [...segs].reverse().find(s => s.kept);
      if (lastKept && frac >= lastKept.endFrac - 0.005) {
        player.pause();
        const firstKept = segs.find(s => s.kept);
        if (firstKept) {
          player.currentTime = firstKept.startFrac * durationRef.current;
        }
      }
    });
    return () => {
      statusSub.remove();
      playingSub.remove();
      timeSub.remove();
    };
  }, [player]);

  const togglePlay = () => {
    if (player.playing) {
      player.pause();
    } else {
      const dur = durationRef.current;
      const frac = currentTime / dur;
      const segs = segmentsRef.current;
      const curSeg = segs.find(s => frac >= s.startFrac && frac < s.endFrac);
      if (curSeg && !curSeg.kept) {
        const nextKept = segs.find(s => s.startFrac >= curSeg.startFrac && s.kept);
        if (nextKept) {
          player.currentTime = nextKept.startFrac * dur;
        }
      }
      player.play();
    }
  };

  // ─── Seek from timeline ─────────────────────────────────────────────────────

  const handleSeek = useCallback((seconds: number) => {
    setCurrentTime(seconds);
    chipRowRef.current?.scrollTo(seconds * PX_PER_SEC, false);
    lastScrolledTime.current = seconds;
    player.currentTime = seconds;
  }, [player]);

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

  const handleChipPress = useCallback((seg: SubtitleSegment) => {
    setEditingId(seg.id);
    setEditDraft(seg.text);
    setEditStartDraft(fmtCompact(seg.start));
    setEditEndDraft(fmtCompact(seg.end));
    player.pause();
    player.currentTime = seg.start;
    chipRowRef.current?.scrollTo(seg.start * PX_PER_SEC, true);
  }, [player]);

  const commitStartTime = useCallback(() => {
    if (editingId === null) return;
    const seg = subtitleSegments.find(s => s.id === editingId);
    if (!seg) return;
    const parsed = parseTimeSec(editStartDraft);
    if (parsed === null || parsed < 0 || parsed >= seg.end) {
      setEditStartDraft(fmtCompact(seg.start));
      return;
    }
    if (Math.abs(parsed - seg.start) < 0.001) return;
    setSubtitleSegments(prev =>
      prev
        .map(s => (s.id === editingId ? { ...s, start: parsed } : s))
        .sort((a, b) => a.start - b.start),
    );
  }, [editingId, editStartDraft, subtitleSegments]);

  const commitEndTime = useCallback(() => {
    if (editingId === null) return;
    const seg = subtitleSegments.find(s => s.id === editingId);
    if (!seg) return;
    const parsed = parseTimeSec(editEndDraft);
    if (parsed === null || parsed <= seg.start) {
      setEditEndDraft(fmtCompact(seg.end));
      return;
    }
    if (Math.abs(parsed - seg.end) < 0.001) return;
    setSubtitleSegments(prev =>
      prev.map(s => (s.id === editingId ? { ...s, end: parsed } : s)),
    );
  }, [editingId, editEndDraft, subtitleSegments]);

  const handleChipDelete = useCallback((seg: SubtitleSegment) => {
    Alert.alert('Delete subtitle', `Remove "${seg.text}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setSubtitleSegments(prev => prev.filter(s => s.id !== seg.id));
          if (editingId === seg.id) setEditingId(null);
        },
      },
    ]);
  }, [editingId]);

  const handleEditDone = useCallback(() => {
    commitStartTime();
    commitEndTime();
    setEditingId(null);
  }, [commitStartTime, commitEndTime]);

  const handleDeleteSubtitle = useCallback(() => {
    if (editingId === null) return;
    Alert.alert('Delete subtitle', 'Remove this subtitle segment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setSubtitleSegments(prev => prev.filter(s => s.id !== editingId));
          setEditingId(null);
        },
      },
    ]);
  }, [editingId]);

  const handleTextChange = useCallback((text: string) => {
    setEditDraft(text);
    setSubtitleSegments(prev => prev.map(s => (s.id === editingId ? { ...s, text } : s)));
  }, [editingId]);

  const handleAddManualCaption = useCallback(() => {
    const start = parseTimeSec(manualStart);
    const end = parseTimeSec(manualEnd);
    if (start === null || end === null) {
      Alert.alert('Invalid time', 'Enter times as M:SS or seconds (e.g. 1:30 or 90).');
      return;
    }
    if (end <= start) {
      Alert.alert('Invalid range', 'End time must be after start time.');
      return;
    }
    if (!manualText.trim()) {
      Alert.alert('Empty caption', 'Please enter caption text.');
      return;
    }
    const newSeg: SubtitleSegment = {
      id: Date.now(),
      start,
      end,
      text: manualText.trim(),
    };
    setSubtitleSegments(prev => {
      const updated = [...prev, newSeg].sort((a, b) => a.start - b.start);
      saveSubtitles(videoUri, updated);
      return updated;
    });
    setManualStart('');
    setManualEnd('');
    setManualText('');
    setManualCaptionOpen(false);
  }, [manualStart, manualEnd, manualText, videoUri]);

  // ─── Export ──────────────────────────────────────────────────────────────────

  const handleExport = () => {
    navigation.navigate('Export', {
      videoUri,
      timelineSegments: segments,
      duration: durationRef.current,
      subtitleStyle,
      ...(subtitleSegments.length > 0
        ? { segments: subtitleSegments, srt: segmentsToSrt(subtitleSegments) }
        : {}),
    });
  };

  const handleExportWithAd = useCallback(() => {
    const ad = RewardedInterstitialAd.createForAdRequest(REWARDED_INTERSTITIAL_AD_UNIT_ID);
    const unsubs: Array<() => void> = [];
    let rewardEarned = false;
    const cleanup = () => { unsubs.forEach(fn => fn()); unsubs.length = 0; };

    unsubs.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show()));
    unsubs.push(ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { rewardEarned = true; }));
    unsubs.push(ad.addAdEventListener(AdEventType.CLOSED, () => { cleanup(); if (rewardEarned) handleExport(); }));
    unsubs.push(ad.addAdEventListener(AdEventType.ERROR, () => { cleanup(); handleExport(); }));

    ad.load();
  }, [handleExport]);

  // ─── Process locally & continue ─────────────────────────────────────────────

  const handleTranslate = async (targetLanguage: string) => {
    if (subtitleSegments.length === 0) return;
    setLoading(true);
    try {
      setStatusMsg(`Translating to ${targetLanguage}…`);
      const translated = await translateSegments(
        subtitleSegments,
        targetLanguage,
        setStatusMsg,
      );
      // Persist before updating editor state so an interrupted UI render
      // doesn't lose the paid translation result.
      await saveSubtitles(videoUri, translated);
      setSubtitleSegments(translated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Translation failed';
      Alert.alert('Translation failed', msg);
    } finally {
      setStatusMsg('');
      setLoading(false);
    }
  };

  const handleContinue = async (source: 'ai' | 'local' = 'ai') => {
    setLoading(true);
    try {
      const dur = durationRef.current;

      // Already have subtitles — nothing to do (they're shown inline)
      if (subtitleSegments.length > 0) return;

      // No saved subtitles — extract fresh
      setStatusMsg('Looking for subtitles…');
      let rawSrt = await getSubtitles(videoUri);

      if (!rawSrt) {
        if (source === 'ai') {
          const apiKey = await getOpenAIKey();
          if (!apiKey) {
            Alert.alert(
              'No subtitles found',
              'This video has no embedded or sidecar subtitle file.\n\nAdd your OpenAI API key in Settings → AI Subtitles to enable automatic transcription.',
            );
            return;
          }
        }
        setStatusMsg(source === 'local' ? 'Transcribing on-device…' : 'Transcribing with Whisper AI…');
        const result = await transcribeVideo(videoUri, setStatusMsg, source);
        rawSrt = result.srt;
      }

      let allSrtSegments = parseSrt(rawSrt);

      // Save the full untrimmed transcription to the persistent cache first.
      // Filtering for the current trim is a view-time concern; caching the
      // full set means a different trim later still reuses the same Whisper
      // result without paying for a re-transcription.
      await saveSubtitles(videoUri, allSrtSegments);

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
        player={player}
        subtitleText={currentSubtitle?.text ?? null}
        subtitleBg={rgbaFromStyle(subtitleStyle)}
        subtitleColor={subtitleStyle.textColor}
        subtitleFontFamily={resolveFontFamily(subtitleStyle.fontFamily)}
        subtitleFontSize={Math.round(16 * SUBTITLE_FONT_SCALE[subtitleStyle.fontSize])}
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
            onChipDelete={handleChipDelete}
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
        <View style={[styles.editBar, { bottom: keyboardHeight }]}>
          <View style={styles.editTimeRow}>
            <TextInput
              style={styles.editTimeInput}
              value={editStartDraft}
              onChangeText={setEditStartDraft}
              onBlur={commitStartTime}
              onSubmitEditing={commitStartTime}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              selectionColor="#a89fff"
              placeholder="0:00.00"
              placeholderTextColor="#555"
            />
            <Text style={styles.editTimeArrow}>→</Text>
            <TextInput
              style={styles.editTimeInput}
              value={editEndDraft}
              onChangeText={setEditEndDraft}
              onBlur={commitEndTime}
              onSubmitEditing={commitEndTime}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              selectionColor="#a89fff"
              placeholder="0:00.00"
              placeholderTextColor="#555"
            />
            <View style={styles.editTimeSpacer} />
            <TouchableOpacity style={styles.editDeleteBtn} onPress={handleDeleteSubtitle}>
              <Text style={styles.editDeleteText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editDoneBtn} onPress={handleEditDone}>
              <Text style={styles.editDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
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

          {/* Caption → menu (Generate / Translate) */}
          <TouchableOpacity
            style={[styles.toolbarItem, loading && styles.disabled]}
            onPress={() => setCaptionMenuOpen(true)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" style={{ height: 26 }} />
            ) : (
              <Text style={styles.toolbarIcon}>💬</Text>
            )}
            <Text style={styles.toolbarLabel}>Caption</Text>
          </TouchableOpacity>

          {/* Export → ExportScreen (no subtitles) */}
          <TouchableOpacity
            style={[styles.toolbarItem, loading && styles.disabled]}
            onPress={handleExportWithAd}
            disabled={loading}
          >
            <Text style={styles.toolbarIcon}>⬇️</Text>
            <Text style={[styles.toolbarLabel, styles.toolbarLabelActive]}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Caption menu ── */}
      <Modal
        visible={captionMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCaptionMenuOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setCaptionMenuOpen(false)}>
          <Pressable style={styles.menuCard} onPress={() => {}}>
            <Text style={styles.menuTitle}>Caption</Text>
            {ENABLE_AI_CAPTIONS && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setCaptionMenuOpen(false);
                  setSetupSource('ai');
                }}
              >
                <Text style={styles.menuItemIcon}>📝</Text>
                <View style={styles.menuItemBody}>
                  <Text style={styles.menuItemLabel}>Generate caption (AI)</Text>
                  <Text style={styles.menuItemDetail}>Transcribe audio with Whisper AI</Text>
                </View>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setCaptionMenuOpen(false);
                setSetupSource('local');
              }}
            >
              <Text style={styles.menuItemIcon}>📱</Text>
              <View style={styles.menuItemBody}>
                <Text style={styles.menuItemLabel}>Generate caption (on-device)</Text>
                <Text style={styles.menuItemDetail}>Transcribe using local Whisper model, no internet needed</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setCaptionMenuOpen(false);
                setManualCaptionOpen(true);
              }}
            >
              <Text style={styles.menuItemIcon}>✏️</Text>
              <View style={styles.menuItemBody}>
                <Text style={styles.menuItemLabel}>Add manual caption</Text>
                <Text style={styles.menuItemDetail}>Type a caption with custom start and end time</Text>
              </View>
            </TouchableOpacity>
            {subtitleSegments.length > 0 && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setCaptionMenuOpen(false);
                  setSetupSource('edit');
                }}
              >
                <Text style={styles.menuItemIcon}>🎨</Text>
                <View style={styles.menuItemBody}>
                  <Text style={styles.menuItemLabel}>Change subtitle style</Text>
                  <Text style={styles.menuItemDetail}>Update font, color, and background for all captions</Text>
                </View>
              </TouchableOpacity>
            )}
            {subtitleSegments.length > 0 && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setCaptionMenuOpen(false);
                  Alert.alert(
                    'Delete subtitles',
                    'Remove subtitles for this video?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete', style: 'destructive', onPress: async () => {
                          await clearSubtitles(videoUri);
                          setSubtitleSegments([]);
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={styles.menuItemIcon}>🗑️</Text>
                <View style={styles.menuItemBody}>
                  <Text style={styles.menuItemLabel}>Delete subtitles</Text>
                  <Text style={styles.menuItemDetail}>Remove subtitles for this video</Text>
                </View>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.menuItem, subtitleSegments.length === 0 && styles.menuItemDisabled]}
              disabled={subtitleSegments.length === 0}
              onPress={() => {
                setCaptionMenuOpen(false);
                setLangPickerOpen(true);
              }}
            >
              <Text style={[
                styles.menuItemIcon,
                subtitleSegments.length === 0 && styles.menuItemIconDisabled,
              ]}>🌐</Text>
              <View style={styles.menuItemBody}>
                <Text style={[
                  styles.menuItemLabel,
                  subtitleSegments.length === 0 && styles.menuItemLabelDisabled,
                ]}>Translate caption</Text>
                <Text style={styles.menuItemDetail}>
                  {subtitleSegments.length === 0
                    ? 'Generate captions first'
                    : 'Translate existing captions to another language'}
                </Text>
              </View>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Subtitle setup (style + generate) ── */}
      <Modal
        visible={setupSource !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSetupSource(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSetupSource(null)}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Subtitle style</Text>
              <TouchableOpacity onPress={() => setSetupSource(null)} hitSlop={10}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <SubtitleStyleControls value={subtitleStyle} onChange={setSubtitleStyle} />
            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.generateBtn}
                onPress={() => {
                  const src = setupSource;
                  setSetupSource(null);
                  if (src === 'ai' || src === 'local') handleContinue(src);
                }}
              >
                <Text style={styles.generateBtnText}>
                  {setupSource === 'edit' ? 'Done' : 'Generate'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Manual caption entry ── */}
      <Modal
        visible={manualCaptionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setManualCaptionOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setManualCaptionOpen(false)}>
          <Pressable style={styles.menuCard} onPress={() => {}}>
            <Text style={styles.menuTitle}>Add Manual Caption</Text>
            <View style={styles.manualRow}>
              <View style={styles.manualTimeField}>
                <Text style={styles.manualLabel}>Start</Text>
                <TextInput
                  style={styles.manualInput}
                  value={manualStart}
                  onChangeText={setManualStart}
                  placeholder="0:00"
                  placeholderTextColor="#bbb"
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="next"
                />
              </View>
              <Text style={styles.manualArrow}>→</Text>
              <View style={styles.manualTimeField}>
                <Text style={styles.manualLabel}>End</Text>
                <TextInput
                  style={styles.manualInput}
                  value={manualEnd}
                  onChangeText={setManualEnd}
                  placeholder="0:05"
                  placeholderTextColor="#bbb"
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="next"
                />
              </View>
            </View>
            <Text style={styles.manualLabel}>Caption text</Text>
            <TextInput
              style={[styles.manualInput, styles.manualTextInput]}
              value={manualText}
              onChangeText={setManualText}
              placeholder="Type caption here…"
              placeholderTextColor="#bbb"
              multiline
              returnKeyType="done"
            />
            <View style={styles.manualBtnRow}>
              <TouchableOpacity
                style={styles.manualCancelBtn}
                onPress={() => setManualCaptionOpen(false)}
              >
                <Text style={styles.manualCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.manualAddBtn}
                onPress={handleAddManualCaption}
              >
                <Text style={styles.manualAddText}>Add</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Translate target language picker ── */}
      <Modal
        visible={langPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLangPickerOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setLangPickerOpen(false)}>
          <Pressable style={styles.menuCard} onPress={() => {}}>
            <Text style={styles.menuTitle}>Translate to…</Text>
            <ScrollView style={styles.langScroll}>
              {TRANSLATION_LANGUAGES.map(lang => (
                <TouchableOpacity
                  key={lang}
                  style={styles.langRow}
                  onPress={() => {
                    setLangPickerOpen(false);
                    handleTranslate(lang);
                  }}
                >
                  <Text style={styles.langText}>{lang}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const TRANSLATION_LANGUAGES = [
  'English',
  'Indonesian',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Vietnamese',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Japanese',
  'Korean',
  'Hindi',
  'Arabic',
  'Russian',
  'Thai',
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  // Caption menu (Chrome-style dropdown card)
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  menuCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  menuTitle: {
    color: '#222',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e3e3e8',
    marginHorizontal: 16,
    marginVertical: 4,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: '#1a1a23',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 24,
    maxHeight: '90%',
  },
  sheetGrabber: {
    width: 42,
    height: 4,
    backgroundColor: '#3a3a4a',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sheetTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  sheetClose: {
    color: '#888',
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: 6,
  },
  sheetFooter: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 4,
  },
  generateBtn: {
    backgroundColor: '#6c63ff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 14,
  },
  menuItemDisabled: {
    opacity: 0.45,
  },
  menuItemIcon: {
    fontSize: 22,
    width: 28,
    textAlign: 'center',
  },
  menuItemIconDisabled: {
    opacity: 0.6,
  },
  menuItemBody: {
    flex: 1,
  },
  menuItemLabel: {
    color: '#222',
    fontSize: 15,
    fontWeight: '600',
  },
  menuItemLabelDisabled: {
    color: '#888',
  },
  menuItemDetail: {
    color: '#777',
    fontSize: 12,
    marginTop: 2,
  },
  langScroll: {
    maxHeight: 360,
  },
  langRow: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  langText: {
    color: '#222',
    fontSize: 15,
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

  // Inline edit bar (floats above keyboard)
  editBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#1a1a2e',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2250',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
    minHeight: 60,
    zIndex: 20,
    elevation: 20,
  },
  editTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editTimeInput: {
    width: 84,
    color: '#a89fff',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    borderWidth: 1,
    borderColor: '#3a2c70',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#0e0c20',
  },
  editTimeArrow: {
    color: '#888',
    fontSize: 12,
  },
  editTimeSpacer: {
    flex: 1,
  },
  editInput: {
    color: '#fff',
    fontSize: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: '#6c63ff',
    paddingVertical: 4,
    minHeight: 36,
    maxHeight: 80,
    textAlignVertical: 'top',
  },
  editDeleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#3a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff5252',
  },
  editDeleteText: {
    color: '#ff5252',
    fontSize: 13,
    fontWeight: '600',
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

  // Manual caption modal
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  manualTimeField: {
    flex: 1,
  },
  manualArrow: {
    color: '#888',
    fontSize: 16,
    marginTop: 16,
  },
  manualLabel: {
    color: '#555',
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '500',
  },
  manualInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#222',
    backgroundColor: '#f9f9f9',
  },
  manualTextInput: {
    minHeight: 72,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  manualBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  manualCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  manualCancelText: {
    color: '#555',
    fontSize: 14,
    fontWeight: '600',
  },
  manualAddBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#6c63ff',
    alignItems: 'center',
  },
  manualAddText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
