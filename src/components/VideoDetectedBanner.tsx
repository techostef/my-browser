import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';
import { DetectedVideo } from '../types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

interface Props {
  videos: DetectedVideo[];
  onPreview: (video: DetectedVideo) => void;
  onDismiss: () => void;
}

export default function VideoDetectedBanner({
  videos,
  onPreview,
  onDismiss,
}: Props) {
  if (videos.length === 0) return null;

  const downloadableTypes = ['mp4', 'blob-ready'];
  const downloadableVideos = videos.filter(
    v => downloadableTypes.includes(v.type),
  );
  const nonDownloadable = videos.filter(
    v => !downloadableTypes.includes(v.type),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {videos.length} video{videos.length > 1 ? 's' : ''} detected
        </Text>
        <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {downloadableVideos.length > 0 && (
        <FlatList
          data={downloadableVideos}
          keyExtractor={(item, index) => `${item.url}-${index}`}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.videoRow}
              activeOpacity={0.7}
              onPress={() => onPreview(item)}>
              <View style={styles.videoInfo}>
                <Text style={styles.videoType}>
                  {item.type === 'blob-ready' ? 'BLOB' : item.type.toUpperCase()}
                </Text>
                <Text style={styles.videoUrl} numberOfLines={1}>
                  {item.type === 'blob-ready'
                    ? `${item.pageTitle || 'Video'} (${formatSize(item.blobSize || 0)})`
                    : item.url}
                </Text>
              </View>
              <View style={styles.previewBtn}>
                <Text style={styles.previewBtnText}>▶ Preview</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {nonDownloadable.length > 0 && (
        <View style={styles.warningRow}>
          <Text style={styles.warningText}>
            {nonDownloadable.length} video{nonDownloadable.length > 1 ? 's' : ''}{' '}
            ({nonDownloadable.map(v => v.type).join(', ')}) — not directly
            downloadable
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: '#1A1A2E',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 4,
    maxHeight: 220,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: {
    color: '#4ECDC4',
    fontSize: 14,
    fontWeight: '700',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FFF',
    fontSize: 14,
  },
  list: {
    maxHeight: 140,
  },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  videoInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  videoType: {
    backgroundColor: '#4ECDC4',
    color: '#1A1A2E',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
    overflow: 'hidden',
  },
  videoUrl: {
    flex: 1,
    color: '#CCC',
    fontSize: 12,
  },
  previewBtn: {
    backgroundColor: '#4ECDC4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  previewBtnText: {
    color: '#1A1A2E',
    fontWeight: '700',
    fontSize: 12,
  },
  warningRow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  warningText: {
    color: '#F9A825',
    fontSize: 11,
    fontStyle: 'italic',
  },
});
