import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/videoEditor';
import { trimAndConcat, burnSubtitles } from '../../lib/videoEditor/ffmpeg';
import { clearSession } from '../../lib/videoEditor/editSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Export'>;

export default function ExportScreen({ navigation, route }: Props) {
  const { videoUri, timelineSegments, duration, srt } = route.params;
  const [status, setStatus] = useState('Preparing…');
  const [done, setDone] = useState(false);
  const [outputPath, setOutputPath] = useState('');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runExport();
  }, []);

  const runExport = async () => {
    try {
      const outputDir = (FileSystem.documentDirectory ?? '') + 'private_downloads/';
      await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
      const outputUri = `${outputDir}edited_${Date.now()}.mp4`;

      const keptRanges = timelineSegments
        .filter(s => s.kept)
        .map(s => ({ start: s.startFrac * duration, end: s.endFrac * duration }));

      const isFullVideo =
        keptRanges.length === 1 &&
        keptRanges[0].start <= 0.01 &&
        keptRanges[0].end >= duration - 0.01;

      if (isFullVideo) {
        if (srt) {
          await burnSubtitles(videoUri, srt, outputUri, setStatus);
        } else {
          setStatus('Copying file…');
          await FileSystem.copyAsync({ from: videoUri, to: outputUri });
        }
      } else {
        if (srt) {
          // Trim first into a temp file, then burn subtitles
          const tmpUri = `${FileSystem.cacheDirectory ?? ''}trimmed_${Date.now()}.mp4`;
          await trimAndConcat(videoUri, keptRanges, tmpUri, setStatus);
          await burnSubtitles(tmpUri, srt, outputUri, setStatus);
          await FileSystem.deleteAsync(tmpUri, { idempotent: true });
        } else {
          await trimAndConcat(videoUri, keptRanges, outputUri, setStatus);
        }
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
