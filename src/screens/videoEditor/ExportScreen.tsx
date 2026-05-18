import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import WebView from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, Segment } from '../../types/videoEditor';
import { DEFAULT_SUBTITLE_STYLE } from '../../types/videoEditor';
import { trimAndConcat, probeVideoSize, burnSubtitlesWithOverlay, transcodeVideo } from '../../lib/videoEditor/ffmpeg';
import { clearSession } from '../../lib/videoEditor/editSession';
import { preCacheMediaDuration } from '../../services/downloadManager';
import { buildSubtitleRenderHtml } from '../../lib/videoEditor/subtitlePng';

type Props = NativeStackScreenProps<RootStackParamList, 'Export'>;

type PngResult = { id: number; png: string };
type WebViewMessage =
  | { type: 'png'; id: number; png: string; index: number; total: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

type Resolution = { label: string; detail: string; height: number | null };

const RESOLUTIONS: Resolution[] = [
  { label: 'Original', detail: 'Full source resolution', height: null },
  { label: '1080p',    detail: 'Full HD',                height: 1080 },
  { label: '720p',     detail: 'HD',                     height: 720 },
  { label: '480p',     detail: 'Smaller file',           height: 480 },
];

export default function ExportScreen({ navigation, route }: Props) {
  const { videoUri, timelineSegments, duration, segments: subtitleSegments, srt, subtitleStyle } = route.params;
  const effectiveStyle = subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;
  const [status, setStatus] = useState('Preparing…');
  const [hasStarted, setHasStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [outputPath, setOutputPath] = useState('');
  const [error, setError] = useState('');
  const [webViewHtml, setWebViewHtml] = useState<string | null>(null);

  const [displayPct, setDisplayPct] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pngPhaseRef = useRef<{ start: number; end: number; total: number } | null>(null);

  const pngBufferRef = useRef<PngResult[]>([]);
  const pngResolveRef = useRef<((pngs: PngResult[]) => void) | null>(null);
  const pngRejectRef = useRef<((err: Error) => void) | null>(null);

  const setProgress = (pct: number) => {
    const clamped = Math.min(100, Math.max(0, pct));
    setDisplayPct(Math.round(clamped));
    Animated.timing(progressAnim, {
      toValue: clamped,
      duration: 250,
      useNativeDriver: false,
    }).start();
  };

  const startExport = (targetHeight: number | null) => {
    if (hasStarted) return;
    setHasStarted(true);
    runExport(targetHeight);
  };

  const renderSubtitlePngs = (
    segs: Segment[],
    videoWidth: number,
    videoHeight: number,
  ): Promise<PngResult[]> => {
    return new Promise((resolve, reject) => {
      pngBufferRef.current = [];
      pngResolveRef.current = resolve;
      pngRejectRef.current = reject;
      const html = buildSubtitleRenderHtml(segs, videoWidth, videoHeight, effectiveStyle);
      setWebViewHtml(html);
    });
  };

  const finishWebView = () => {
    pngResolveRef.current = null;
    pngRejectRef.current = null;
    pngPhaseRef.current = null;
    setWebViewHtml(null);
  };

  const handleWebViewMessage = (event: { nativeEvent: { data: string } }) => {
    let msg: WebViewMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data) as WebViewMessage;
    } catch {
      return;
    }
    if (msg.type === 'png') {
      pngBufferRef.current.push({ id: msg.id, png: msg.png });
      setStatus(`Rendering subtitles ${msg.index + 1}/${msg.total}…`);
      if (pngPhaseRef.current) {
        const { start, end, total } = pngPhaseRef.current;
        setProgress(start + ((msg.index + 1) / Math.max(1, total)) * (end - start));
      }
    } else if (msg.type === 'done') {
      const pngs = pngBufferRef.current;
      pngBufferRef.current = [];
      pngResolveRef.current?.(pngs);
      finishWebView();
    } else if (msg.type === 'error') {
      pngRejectRef.current?.(new Error(`Subtitle render failed: ${msg.message}`));
      finishWebView();
    }
  };

  const runExport = async (targetHeight: number | null) => {
    try {
      const outputDir = (FileSystem.documentDirectory ?? '') + 'private_downloads/';
      await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
      const stamp = Date.now();

      const keptRanges = timelineSegments
        .filter(s => s.kept)
        .map(s => ({ start: s.startFrac * duration, end: s.endFrac * duration }));

      const isFullVideo =
        keptRanges.length === 1 &&
        keptRanges[0].start <= 0.01 &&
        keptRanges[0].end >= duration - 0.01;

      // Actual duration of what gets exported. For a full video this == duration;
      // for a trim it's the sum of kept ranges. Used for both encode-progress math
      // (so the bar tracks the real source length) and the duration cache (so the
      // Downloads screen shows the trimmed length, not the original).
      const outputDurationSec = keptRanges.reduce((sum, r) => sum + (r.end - r.start), 0);

      const hasSubs = !!(subtitleSegments && subtitleSegments.length > 0 && srt);

      // Phase boundaries (0-100).
      // Trim-only (no subtitles, no resolution downscale requested): trim is the
      // sole heavy operation so it gets the full 0-95% range.
      // When other phases follow (PNG render, re-encode), trim is compressed to
      // 0-30% so downstream phases have room.
      const trimIsOnlyOp = !isFullVideo && !hasSubs && targetHeight === null;
      const P_TRIM  = isFullVideo ? 0 : trimIsOnlyOp ? 95 : 30;
      const P_PNG   = P_TRIM + (hasSubs ? 20 : 0);
      const P_ENC   = P_PNG;
      const P_DONE  = 96;

      setProgress(0);

      const tmpUri = `${outputDir}edited_${stamp}_tmp.mp4`;
      let sourceUri: string;
      let trimmedTmp = false;

      if (isFullVideo) {
        sourceUri = videoUri;
        setProgress(P_TRIM);
      } else {
        await trimAndConcat(
          videoUri,
          keptRanges,
          tmpUri,
          setStatus,
          (frac) => setProgress(frac * P_TRIM),
        );
        sourceUri = tmpUri;
        trimmedTmp = true;
        setProgress(P_TRIM);
      }

      const outputUri = `${outputDir}edited_${stamp}.mp4`;
      const { width: vw, height: vh } = await probeVideoSize(sourceUri);
      const effectiveTargetH =
        targetHeight && vh > targetHeight ? targetHeight : null;

      if (hasSubs) {
        const renderH = effectiveTargetH ?? vh;
        const renderWraw = Math.round((vw * renderH) / vh);
        const renderW = renderWraw - (renderWraw % 2);

        // Tell the PNG progress handler which overall range to fill
        const pngTotal = subtitleSegments!.length + 1; // +1 for blank
        pngPhaseRef.current = { start: P_PNG, end: P_ENC + 5, total: pngTotal };

        const pngResults = await renderSubtitlePngs(subtitleSegments!, renderW, renderH);

        const blank = pngResults.find(r => r.id === -1);
        if (!blank) throw new Error('Subtitle renderer did not produce a blank PNG');

        const segMap = new Map(subtitleSegments!.map(s => [s.id, s]));
        const overlayItems: Array<{ id: number; start: number; end: number; pngBase64: string }> = [];
        for (const r of pngResults) {
          if (r.id === -1) continue;
          const seg = segMap.get(r.id);
          if (seg) overlayItems.push({ id: r.id, start: seg.start, end: seg.end, pngBase64: r.png });
        }

        setProgress(P_ENC + 5);
        await burnSubtitlesWithOverlay(
          sourceUri,
          overlayItems,
          blank.png,
          outputUri,
          setStatus,
          effectiveTargetH,
          outputDurationSec,
          (frac) => setProgress(P_ENC + 5 + frac * (P_DONE - P_ENC - 5)),
        );
      } else if (effectiveTargetH) {
        await transcodeVideo(
          sourceUri,
          outputUri,
          effectiveTargetH,
          setStatus,
          (frac) => setProgress(P_ENC + frac * (P_DONE - P_ENC)),
          outputDurationSec,
        );
      } else if (trimmedTmp) {
        setStatus('Finalising…');
        await FileSystem.moveAsync({ from: tmpUri, to: outputUri });
        trimmedTmp = false;
        setProgress(P_DONE);
      } else {
        setStatus('Copying file…');
        await FileSystem.copyAsync({ from: videoUri, to: outputUri });
        setProgress(P_DONE);
      }

      if (trimmedTmp) {
        await FileSystem.deleteAsync(tmpUri, { idempotent: true });
      }

      setProgress(98);
      if (outputDurationSec > 0) {
        await preCacheMediaDuration(outputUri, outputDurationSec * 1000);
      }

      setOutputPath(outputUri);
      await clearSession(videoUri);
      setProgress(100);
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorIcon}>✕</Text>
          <Text style={styles.errorTitle}>Export failed</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
            <Text style={styles.btnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (done) {
    const filename = outputPath.split('/').pop() ?? outputPath;
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✓</Text>
          <Text style={styles.doneTitle}>Export complete</Text>
          <Text style={styles.filename}>{filename}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.popToTop()}>
            <Text style={styles.btnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!hasStarted) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.pickerTitle}>Export resolution</Text>
          <Text style={styles.pickerHint}>
            Higher resolution preserves quality. Lower resolution produces a smaller file.
          </Text>
          {RESOLUTIONS.map(r => (
            <TouchableOpacity
              key={r.label}
              style={styles.resBtn}
              onPress={() => startExport(r.height)}
              activeOpacity={0.85}
            >
              <Text style={styles.resBtnLabel}>{r.label}</Text>
              <Text style={styles.resBtnDetail}>{r.detail}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {webViewHtml ? (
        <WebView
          style={styles.hiddenWebView}
          source={{ html: webViewHtml }}
          onMessage={handleWebViewMessage}
          javaScriptEnabled
        />
      ) : null}
      <View style={styles.center}>
        <Text style={styles.progressPct}>{displayPct}%</Text>
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progressAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
        <Text style={styles.statusText}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  hiddenWebView: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
  },
  pickerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  pickerHint: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 18,
  },
  resBtn: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a4a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  resBtnLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resBtnDetail: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  progressPct: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginBottom: 16,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: '#2a2a2a',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4ECDC4',
    borderRadius: 4,
  },
  statusText: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: 48,
    color: '#ff5252',
    marginBottom: 16,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  errorDetail: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },
  doneIcon: {
    fontSize: 56,
    color: '#4caf50',
    marginBottom: 16,
  },
  doneTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  filename: {
    color: '#666',
    fontSize: 12,
    marginBottom: 32,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: '#6c63ff',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
