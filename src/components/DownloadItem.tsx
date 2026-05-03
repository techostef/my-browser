import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Modal } from 'react-native';
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
  onMove?: (task: DownloadTask) => void;
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
  onMove,
  onRemove,
}: Props) {
  const statusColor = getStatusColor(task.status);
  const isPlayableMedia =
    task.status === 'completed' && !!task.filePath && mediaType !== 'other';
  const canManageCompletedFile =
    task.source !== 'device' &&
    (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled');
  const [videoThumbnailUri, setVideoThumbnailUri] = useState<string | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);
  const sizeBytes = task.totalBytes > 0 ? task.totalBytes : task.bytesDownloaded;

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

      {/* <View style={styles.statusRow}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>
            {task.status.toUpperCase()}
          </Text>
        </View>
        {task.error ? (
          <Text style={styles.errorText} numberOfLines={1}>
            {task.error}
          </Text>
        ) : (
          <Text style={styles.pageTitle} numberOfLines={1}>
            {task.pageTitle}
          </Text>
        )}
      </View> */}

      <View style={styles.bottomRow}>
        <View style={styles.infoSection}>
          <Text style={styles.fileName} numberOfLines={1}>
            {task.fileName || task.url.split('/').pop() || 'video'}
          </Text>
          <Text style={styles.fileSize} numberOfLines={1}>
            {formatBytes(sizeBytes)}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => setActionsVisible(true)}>
          <Text style={styles.menuBtnText}>⋯</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={actionsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setActionsVisible(false)}>
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setActionsVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.dialogCard} onPress={() => {}}>
            <View style={styles.actions}>
              {isPlayableMedia && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.openBtn]}
                  onPress={() => {
                    onOpenMedia(task);
                    setActionsVisible(false);
                  }}>
                  <Text style={styles.actionBtnText}>▶ Open</Text>
                </TouchableOpacity>
              )}
              {task.status === 'downloading' && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.pauseBtn]}
                  onPress={() => {
                    onPause(task.id);
                    setActionsVisible(false);
                  }}>
                  <Text style={styles.actionBtnText}>⏸ Pause</Text>
                </TouchableOpacity>
              )}
              {task.status === 'paused' && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.resumeBtn]}
                  onPress={() => {
                    onResume(task.id);
                    setActionsVisible(false);
                  }}>
                  <Text style={styles.actionBtnText}>▶ Resume</Text>
                </TouchableOpacity>
              )}
              {(task.status === 'downloading' || task.status === 'paused' || task.status === 'queued') && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.cancelBtn]}
                  onPress={() => {
                    onCancel(task.id);
                    setActionsVisible(false);
                  }}>
                  <Text style={styles.actionBtnText}>✕ Cancel</Text>
                </TouchableOpacity>
              )}
              {canManageCompletedFile && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.moveBtn]}
                  onPress={() => {
                    onMove?.(task);
                    setActionsVisible(false);
                  }}>
                  <Text style={styles.actionBtnText}>📁 Move</Text>
                </TouchableOpacity>
              )}
              {canManageCompletedFile && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.renameBtn]}
                  onPress={() => {
                    onRename(task);
                    setActionsVisible(false);
                  }}>
                  <Text style={styles.actionBtnText}>✏ Rename</Text>
                </TouchableOpacity>
              )}
              {canManageCompletedFile && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.removeBtn]}
                  onPress={() => {
                    onRemove(task.id);
                    setActionsVisible(false);
                  }}>
                  <Text style={styles.actionBtnText}>🗑 Delete</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  thumbnailWrap: {
    width: '100%',
    height: 120,
    borderRadius: 10,
    overflow: 'hidden',
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
    fontSize: 30,
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
    marginTop: 8,
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
  pageTitle: {
    fontSize: 11,
    color: '#888',
    marginLeft: 8,
    flex: 1,
  },
  errorText: {
    color: '#E74C3C',
    fontSize: 10,
    marginLeft: 8,
    flex: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  infoSection: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  fileSize: {
    fontSize: 11,
    color: '#888',
    marginTop: 1,
  },
  fileFolder: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },
  menuBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBtnText: {
    fontSize: 18,
    lineHeight: 18,
    color: '#444',
    marginTop: -4,
  },
  actions: {
    gap: 8,
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  dialogCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
  },
  actionBtn: {
    width: '100%',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#222',
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
  moveBtn: {
    backgroundColor: '#EFE7FF',
  },
  renameBtn: {
    backgroundColor: '#E3F2FD',
  },
  removeBtn: {
    backgroundColor: '#F5F5F5',
  },
});
