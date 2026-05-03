import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { DownloadTask } from '../types';

export type DownloadMediaType = 'image' | 'video' | 'audio' | 'other';

interface Props {
  task: DownloadTask;
  mediaType: DownloadMediaType;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onOpenMedia: (task: DownloadTask) => void;
  onRename: (task: DownloadTask) => void;
  onRemove: (id: string) => void;
}

const videoThumbnailCache = new Map<string, string>();

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getStatusColor(status: DownloadTask['status']): string {
  switch (status) {
    case 'downloading':
      return '#4ECDC4';
    case 'completed':
      return '#2ECC71';
    case 'paused':
      return '#F39C12';
    case 'failed':
      return '#E74C3C';
    case 'cancelled':
      return '#95A5A6';
    case 'queued':
      return '#3498DB';
    default:
      return '#95A5A6';
  }
}

export default function DownloadItem({
  task,
  mediaType,
  onPause,
  onResume,
  onCancel,
  onOpenMedia,
  onRename,
  onRemove,
}: Props) {
  const statusColor = getStatusColor(task.status);
  const isPlayableMedia =
    task.status === 'completed' && !!task.filePath && mediaType !== 'other';
  const [videoThumbnailUri, setVideoThumbnailUri] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (mediaType !== 'video' || !task.filePath || task.status !== 'completed') {
      setVideoThumbnailUri(null);
      return () => {
        isMounted = false;
      };
    }

    const cached = videoThumbnailCache.get(task.filePath);
    if (cached) {
      setVideoThumbnailUri(cached);
      return () => {
        isMounted = false;
      };
    }

    VideoThumbnails.getThumbnailAsync(task.filePath, { time: 1000 })
      .then(result => {
        if (!isMounted || !result?.uri) {
          return;
        }
        videoThumbnailCache.set(task.filePath, result.uri);
        setVideoThumbnailUri(result.uri);
      })
      .catch(err => {
        console.warn('Failed to create video thumbnail:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [mediaType, task.filePath, task.status]);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.thumbnailWrap}
        disabled={!isPlayableMedia}
        onPress={() => onOpenMedia(task)}>
        {mediaType === 'image' && task.filePath ? (
          <Image source={{ uri: task.filePath }} style={styles.thumbnailImage} />
        ) : mediaType === 'video' && videoThumbnailUri ? (
          <Image source={{ uri: videoThumbnailUri }} style={styles.thumbnailImage} />
        ) : (
          <View style={styles.thumbnailFallback}>
            <Text style={styles.thumbnailIcon}>
              {mediaType === 'video' ? '🎬' : mediaType === 'audio' ? '🎵' : '📄'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.infoSection}>
        <Text style={styles.fileName} numberOfLines={1}>
          {task.fileName || task.url.split('/').pop() || 'video'}
        </Text>
        <Text style={styles.pageTitle} numberOfLines={1}>
          {task.pageTitle}
        </Text>

        {/* Progress bar */}
        {(task.status === 'downloading' || task.status === 'paused') && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBg}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${task.progress}%`,
                    backgroundColor: statusColor,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {task.progress}% · {formatBytes(task.bytesDownloaded)}
              {task.totalBytes > 0 ? ` / ${formatBytes(task.totalBytes)}` : ''}
            </Text>
          </View>
        )}

        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>
              {task.status.toUpperCase()}
            </Text>
          </View>
          {task.error && (
            <Text style={styles.errorText} numberOfLines={1}>
              {task.error}
            </Text>
          )}
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {isPlayableMedia && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.openBtn]}
            onPress={() => onOpenMedia(task)}>
            <Text style={styles.actionBtnText}>▶️</Text>
          </TouchableOpacity>
        )}
        {task.status === 'downloading' && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.pauseBtn]}
            onPress={() => onPause(task.id)}>
            <Text style={styles.actionBtnText}>⏸</Text>
          </TouchableOpacity>
        )}
        {task.status === 'paused' && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.resumeBtn]}
            onPress={() => onResume(task.id)}>
            <Text style={styles.actionBtnText}>▶</Text>
          </TouchableOpacity>
        )}
        {(task.status === 'downloading' || task.status === 'paused' || task.status === 'queued') && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.cancelBtn]}
            onPress={() => onCancel(task.id)}>
            <Text style={styles.actionBtnText}>✕</Text>
          </TouchableOpacity>
        )}
        {(task.status === 'completed' ||
          task.status === 'failed' ||
          task.status === 'cancelled') && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.renameBtn]}
            onPress={() => onRename(task)}>
            <Text style={styles.actionBtnText}>✏️</Text>
          </TouchableOpacity>
        )}
        {(task.status === 'completed' ||
          task.status === 'failed' ||
          task.status === 'cancelled') && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.removeBtn]}
            onPress={() => onRemove(task.id)}>
            <Text style={styles.actionBtnText}>🗑</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  thumbnailWrap: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    marginRight: 10,
    backgroundColor: '#EFEFEF',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8ECF1',
  },
  thumbnailIcon: {
    fontSize: 24,
  },
  infoSection: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  pageTitle: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  progressContainer: {
    marginTop: 8,
  },
  progressBg: {
    height: 6,
    backgroundColor: '#E8E8E8',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 10,
    color: '#888',
    marginTop: 3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
  },
  errorText: {
    color: '#E74C3C',
    fontSize: 10,
    marginLeft: 8,
    flex: 1,
  },
  actions: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: 16,
  },
  pauseBtn: {
    backgroundColor: '#FFF3E0',
  },
  resumeBtn: {
    backgroundColor: '#E8F5E9',
  },
  cancelBtn: {
    backgroundColor: '#FFEBEE',
  },
  openBtn: {
    backgroundColor: '#E8F5E9',
  },
  renameBtn: {
    backgroundColor: '#E3F2FD',
  },
  removeBtn: {
    backgroundColor: '#F5F5F5',
  },
});
