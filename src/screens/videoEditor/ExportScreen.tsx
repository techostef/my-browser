import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import WebView from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, Segment } from '../../types/videoEditor';
import { trimAndConcat, probeVideoSize, burnSubtitlesWithOverlay } from '../../lib/videoEditor/ffmpeg';
import { clearSession } from '../../lib/videoEditor/editSession';
import { preCacheMediaDuration } from '../../services/downloadManager';
import { buildSubtitleRenderHtml } from '../../lib/videoEditor/subtitlePng';

type Props = NativeStackScreenProps<RootStackParamList, 'Export'>;

type PngResult = { id: number; png: string };
type WebViewMessage =
  | { type: 'png'; id: number; png: string; index: number; total: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

export default function ExportScreen({ navigation, route }: Props) {
  const { videoUri, timelineSegments, duration, segments: subtitleSegments, srt } = route.params;
  const [status, setStatus] = useState('Preparing…');
  const [done, setDone] = useState(false);
  const [outputPath, setOutputPath] = useState('');
  const [error, setError] = useState('');
  const [webViewHtml, setWebViewHtml] = useState<string | null>(null);
  const started = useRef(false);
  const pngBufferRef = useRef<PngResult[]>([]);
  const pngResolveRef = useRef<((pngs: PngResult[]) => void) | null>(null);
  const pngRejectRef = useRef<((err: Error) => void) | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runExport();
  }, []);

  // Render subtitle PNGs via a hidden WebView
  const renderSubtitlePngs = (
    segs: Segment[],
    videoWidth: number,
    videoHeight: number,
  ): Promise<PngResult[]> => {
    return new Promise((resolve, reject) => {
      pngBufferRef.current = [];
      pngResolveRef.current = resolve;
      pngRejectRef.current = reject;
      const html = buildSubtitleRenderHtml(segs, videoWidth, videoHeight);
      setWebViewHtml(html);
    });
  };

  const finishWebView = () => {
    pngResolveRef.current = null;
    pngRejectRef.current = null;
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

  const runExport = async () => {
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

      // Step 1: trim/copy video to a temp file
      const tmpUri = `${outputDir}edited_${stamp}_tmp.mp4`;
      if (isFullVideo) {
        setStatus('Copying file…');
        await FileSystem.copyAsync({ from: videoUri, to: tmpUri });
      } else {
        await trimAndConcat(videoUri, keptRanges, tmpUri, setStatus);
      }

      const outputUri = `${outputDir}edited_${stamp}.mp4`;

      if (subtitleSegments && subtitleSegments.length > 0 && srt) {
        // Step 2: probe video dimensions for canvas sizing
        setStatus('Preparing subtitles…');
        const { width: vw, height: vh } = await probeVideoSize(tmpUri);

        // Step 3: render PNGs in the hidden WebView
        const pngResults = await renderSubtitlePngs(subtitleSegments, vw, vh);

        // Map PNGs back to their segments for timing data
        const segMap = new Map(subtitleSegments.map(s => [s.id, s]));
        const overlayItems: Array<{ id: number; start: number; end: number; pngBase64: string }> = [];
        for (const r of pngResults) {
          const seg = segMap.get(r.id);
          if (seg) overlayItems.push({ id: r.id, start: seg.start, end: seg.end, pngBase64: r.png });
        }

        // Step 4: burn PNGs as overlay frames
        await burnSubtitlesWithOverlay(tmpUri, overlayItems, outputUri, setStatus);
        await FileSystem.deleteAsync(tmpUri, { idempotent: true });
      } else {
        // No subtitles — just rename tmp to final
        await FileSystem.moveAsync({ from: tmpUri, to: outputUri });
      }

      // Pre-cache duration so the Downloads scan never probes this file
      if (duration > 0) {
        await preCacheMediaDuration(outputUri, duration * 1000);
      }

      setOutputPath(outputUri);
      await clearSession(videoUri);
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

  return (
    <View style={styles.container}>
      {/* Hidden WebView used to render subtitle PNGs via HTML5 Canvas */}
      {webViewHtml ? (
        <WebView
          style={styles.hiddenWebView}
          source={{ html: webViewHtml }}
          onMessage={handleWebViewMessage}
          javaScriptEnabled
        />
      ) : null}
      <View style={styles.center}>
        <ActivityIndicator color="#fff" size="large" style={styles.spinner} />
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  spinner: {
    marginBottom: 20,
  },
  statusText: {
    color: '#aaa',
    fontSize: 15,
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
