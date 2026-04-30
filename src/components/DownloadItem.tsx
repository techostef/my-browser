import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DownloadTask } from '../types';

interface Props {
  task: DownloadTask;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

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
  onPause,
  onResume,
  onCancel,
  onRemove,
}: Props) {
  const statusColor = getStatusColor(task.status);

  return (
    <View style={styles.container}>
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
  removeBtn: {
    backgroundColor: '#F5F5F5',
  },
});
