import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Dimensions,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';

// ─── Constants ────────────────────────────────────────────────────────────────
const THUMB_HEIGHT = 56;
const TICK_ROW_HEIGHT = 22;
const PX_PER_SEC = 80;
const MIN_ZOOM = 1;
const MAX_ZOOM = 20;
const RENDER_BUFFER = 300;
const SCREEN_W = Dimensions.get('window').width;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(secs: number, showMs: boolean): string {
  const safe = Math.max(0, secs);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const base = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  if (!showMs) return base;
  return `${base}.${Math.floor((safe % 1) * 1000)
    .toString()
    .padStart(3, '0')}`;
}

function getTickConfig(zoom: number) {
  if (zoom >= 12) return { interval: 0.1, labelEvery: 0.5, showMs: true };
  if (zoom >= 6) return { interval: 0.25, labelEvery: 1, showMs: true };
  if (zoom >= 3) return { interval: 0.5, labelEvery: 2, showMs: false };
  return { interval: 1, labelEvery: 2, showMs: false };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineSegment {
  startFrac: number;
  endFrac: number;
  kept: boolean;
}

interface VideoTimelineProps {
  videoUri: string;
  duration: number;
  segments: TimelineSegment[];
  selectedSegment: number | null;
  playheadFrac: number;
  onSeek: (seconds: number) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VideoTimeline({
  videoUri,
  duration,
  segments,
  selectedSegment,
  playheadFrac,
  onSeek,
}: VideoTimelineProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [containerW, setContainerW] = useState(SCREEN_W - 32);
  const [zoom, setZoom] = useState(1);
  const [scrollX, setScrollX] = useState(0);
  const [thumbnails, setThumbnails] = useState<{ time: number; uri: string }[]>([]);

  const isUserScrolling = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const halfW = containerW / 2;
  const filmW = Math.max(duration * PX_PER_SEC * zoom, containerW);
  const numThumbs = thumbnails.length;
  const thumbW = numThumbs > 0 ? filmW / numThumbs : 0;

  const tickCfg = useMemo(() => getTickConfig(zoom), [zoom]);

  // ─── Thumbnail extraction (1 per second, max 60) ────────────────────────────
  useEffect(() => {
    if (duration <= 0) return;
    let cancelled = false;
    (async () => {
      const n = Math.min(Math.max(Math.ceil(duration), 1), 60);
      const step = duration / n;
      const res: { time: number; uri: string }[] = [];
      for (let i = 0; i < n; i++) {
        if (cancelled) break;
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
            time: Math.floor(i * step * 1000),
            quality: 0.3,
          });
          res.push({ time: i * step, uri });
        } catch {
          // skip failed frames
        }
      }
      if (!cancelled) setThumbnails(res);
    })();
    return () => { cancelled = true; };
  }, [videoUri, duration]);

  // ─── Auto-scroll to playhead when video is playing ──────────────────────────
  useEffect(() => {
    if (isUserScrolling.current) return;
    scrollRef.current?.scrollTo({ x: playheadFrac * filmW, animated: false });
  }, [playheadFrac, filmW]);

  // ─── Layout ─────────────────────────────────────────────────────────────────
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setContainerW(e.nativeEvent.layout.width),
    [],
  );

  // ─── Scroll handling ────────────────────────────────────────────────────────
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      setScrollX(x);
      if (isUserScrolling.current && duration > 0) {
        const frac = Math.max(0, Math.min(1, x / filmW));
        onSeek(frac * duration);
      }
    },
    [filmW, duration, onSeek],
  );

  const handleDragBegin = useCallback(() => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    isUserScrolling.current = true;
  }, []);

  const handleDragEnd = useCallback(() => {
    scrollEndTimer.current = setTimeout(() => {
      isUserScrolling.current = false;
    }, 300);
  }, []);

  const handleMomentumBegin = useCallback(() => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
  }, []);

  const handleMomentumEnd = useCallback(() => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    isUserScrolling.current = false;
  }, []);

  // ─── Zoom ───────────────────────────────────────────────────────────────────
  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5)), []);

  // ─── Visible range (film-relative px) for virtualization ────────────────────
  const vL = scrollX - RENDER_BUFFER;
  const vR = scrollX + containerW + RENDER_BUFFER;

  // ─── Visible ticks ──────────────────────────────────────────────────────────
  const visibleTicks = useMemo(() => {
    if (duration <= 0) return [];
    const { interval, labelEvery, showMs } = tickCfg;
    const out: { x: number; label: string | null; major: boolean }[] = [];
    for (let t = 0; t <= duration + 0.001; t += interval) {
      const rt = Math.round(t * 1000) / 1000;
      const x = (rt / duration) * filmW;
      if (x < vL || x > vR) continue;
      const isLbl =
        Math.abs(rt % labelEvery) < interval * 0.5 ||
        Math.abs((rt % labelEvery) - labelEvery) < interval * 0.5;
      out.push({ x, label: isLbl ? fmtTime(rt, showMs) : null, major: isLbl });
    }
    return out;
  }, [duration, filmW, tickCfg, vL, vR]);

  // ─── Visible thumbnails ─────────────────────────────────────────────────────
  const visibleThumbs = useMemo(() => {
    if (numThumbs === 0 || thumbW <= 0) return [];
    const startIdx = Math.max(0, Math.floor(vL / thumbW) - 1);
    const endIdx = Math.min(numThumbs - 1, Math.ceil(vR / thumbW) + 1);
    const out: { idx: number; uri: string; x: number }[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      out.push({ idx: i, uri: thumbnails[i].uri, x: i * thumbW });
    }
    return out;
  }, [numThumbs, thumbW, vL, vR, thumbnails]);

  // ─── Derived ────────────────────────────────────────────────────────────────
  const curSec =
    duration > 0 ? Math.max(0, Math.min(duration, (scrollX / filmW) * duration)) : 0;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root} onLayout={onLayout}>
      {/* ── Timeline area (ScrollView + fixed playhead) ── */}
      <View style={styles.timelineArea}>
        {/* Fixed playhead line at center */}
        <View
          style={[styles.playheadFixed, { left: halfW - 1 }]}
          pointerEvents="none"
        >
          <View style={styles.phTriangle} />
          <View style={styles.phLine} />
        </View>

        {/* Scrollable content */}
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          bounces={false}
          scrollEventThrottle={16}
          onScroll={handleScroll}
          onScrollBeginDrag={handleDragBegin}
          onScrollEndDrag={handleDragEnd}
          onMomentumScrollBegin={handleMomentumBegin}
          onMomentumScrollEnd={handleMomentumEnd}
          contentContainerStyle={{ paddingHorizontal: halfW }}
          decelerationRate="fast"
        >
          <View style={{ width: filmW }}>
            {/* Time tick row (above filmstrip) */}
            <View style={styles.tickRow}>
              {visibleTicks.map((t, i) => (
                <View key={i} style={[styles.tick, { left: t.x }]}>
                  <View
                    style={[styles.tickMark, { height: t.major ? 10 : 5 }]}
                  />
                  {t.label && (
                    <Text style={styles.tickLbl} numberOfLines={1}>
                      {t.label}
                    </Text>
                  )}
                </View>
              ))}
            </View>

            {/* Thumbnail filmstrip */}
            <View style={styles.filmstrip}>
              {/* Thumbnails (only visible ones rendered) */}
              {visibleThumbs.map((t) => (
                <Image
                  key={t.idx}
                  source={{ uri: t.uri }}
                  style={{
                    position: 'absolute' as const,
                    left: t.x,
                    width: thumbW + 1,
                    height: THUMB_HEIGHT,
                  }}
                  resizeMode="cover"
                />
              ))}

              {/* Segment overlays */}
              {segments.map((seg, i) => {
                const left = seg.startFrac * filmW;
                const width = (seg.endFrac - seg.startFrac) * filmW;
                const isSelected = i === selectedSegment;
                const isDeleted = !seg.kept;
                return (
                  <React.Fragment key={`seg-${i}`}>
                    {/* Deleted segment: red-tinted dim overlay */}
                    {isDeleted && (
                      <View
                        style={[
                          styles.deletedOverlay,
                          { left, width },
                        ]}
                      />
                    )}
                    {/* Selected segment: highlight border */}
                    {isSelected && (
                      <View
                        style={[
                          styles.selectedOverlay,
                          { left, width },
                        ]}
                      />
                    )}
                  </React.Fragment>
                );
              })}

              {/* Split lines at segment boundaries (skip 0 and 1) */}
              {segments.slice(0, -1).map((seg, i) => {
                const x = seg.endFrac * filmW;
                return (
                  <View
                    key={`split-${i}`}
                    style={[styles.splitLine, { left: x - 1 }]}
                  />
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* ── Bottom bar: current time + zoom ── */}
      <View style={styles.bottomBar}>
        <Text style={styles.curTime}>{fmtTime(curSec, tickCfg.showMs)}</Text>
        <View style={styles.zoomCtrl}>
          <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}>
            <Text style={styles.zBtnTxt}>−</Text>
          </TouchableOpacity>
          <Text style={styles.zLbl}>{zoom.toFixed(1)}×</Text>
          <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}>
            <Text style={styles.zBtnTxt}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    marginHorizontal: 16,
  },

  // Timeline area wrapper (holds playhead + scroll)
  timelineArea: {
    height: TICK_ROW_HEIGHT + THUMB_HEIGHT,
    position: 'relative',
  },

  // Fixed playhead
  playheadFixed: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    zIndex: 20,
    alignItems: 'center',
  },
  phTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#fff',
  },
  phLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#fff',
  },

  // Tick row
  tickRow: {
    height: TICK_ROW_HEIGHT,
    position: 'relative',
  },
  tick: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
  },
  tickMark: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  tickLbl: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    marginTop: 1,
    textAlign: 'center',
    width: 48,
  },

  // Filmstrip
  filmstrip: {
    height: THUMB_HEIGHT,
    position: 'relative',
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#222',
  },

  // Segment overlays
  deletedOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 50, 50, 0.45)',
    zIndex: 3,
  },
  selectedOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 4,
    backgroundColor: 'transparent',
    zIndex: 4,
  },

  // Split lines
  splitLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#fff',
    zIndex: 5,
  },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  curTime: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  zoomCtrl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  zoomBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zBtnTxt: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  zLbl: {
    color: '#888',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    minWidth: 32,
    textAlign: 'center',
  },
});
