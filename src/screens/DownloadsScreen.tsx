import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Alert,
  Modal,
  Image,
  TextInput,
  Keyboard,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Video, ResizeMode } from 'expo-av';

import DownloadItem, { DownloadMediaType } from '../components/DownloadItem';
import { DownloadTask } from '../types';
import { useDownloads } from '../store/downloadStore';

export default function DownloadsScreen() {
  const {
    downloads,
    refreshDownloads,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    renameDownload,
    removeDownload,
  } = useDownloads();
  const [renameTask, setRenameTask] = useState<DownloadTask | null>(null);
  const [renameText, setRenameText] = useState('');
  const [previewTask, setPreviewTask] = useState<DownloadTask | null>(null);

  const getMediaType = useCallback((task: DownloadTask): DownloadMediaType => {
    const source = (task.fileName || task.filePath || task.url || '')
      .toLowerCase()
      .split('?')[0]
      .split('#')[0];
    const ext = source.split('.').pop() || '';

    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'heif'].includes(ext)) {
      return 'image';
    }
    if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', '3gp'].includes(ext)) {
      return 'video';
    }
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) {
      return 'audio';
    }
    return 'other';
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshDownloads().catch(err => {
        console.warn('Failed to scan private folder on Downloads focus:', err);
      });
    }, [refreshDownloads]),
  );

  const handleRename = useCallback((task: DownloadTask) => {
    if (!task.filePath) {
      return;
    }
    const initialName = task.fileName || task.filePath.split('/').pop() || '';
    setRenameTask(task);
    setRenameText(initialName);
  }, []);

  const closeRenameModal = useCallback(() => {
    setRenameTask(null);
    setRenameText('');
    Keyboard.dismiss();
  }, []);

  const submitRename = useCallback(() => {
    if (!renameTask) {
      return;
    }
    const trimmed = renameText.trim();
    if (!trimmed) {
      return;
    }
    renameDownload(renameTask.id, trimmed)
      .catch(err => {
        console.warn('Rename failed:', err);
      })
      .finally(() => {
        closeRenameModal();
      });
  }, [closeRenameModal, renameDownload, renameTask, renameText]);

  const handleRemove = useCallback((id: string) => {
    Alert.alert('Delete file', 'Remove this download from private folder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => removeDownload(id),
      },
    ]);
  }, [removeDownload]);

  const handleOpenMedia = useCallback((task: DownloadTask) => {
    if (task.status !== 'completed' || !task.filePath) {
      return;
    }
    if (getMediaType(task) === 'other') {
      return;
    }
    setPreviewTask(task);
  }, [getMediaType]);

  const closePreviewModal = useCallback(() => {
    setPreviewTask(null);
  }, []);

  const previewType = previewTask ? getMediaType(previewTask) : 'other';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Downloads</Text>
        <Text style={styles.headerSubtitle}>
          {downloads.length} item{downloads.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {downloads.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📥</Text>
          <Text style={styles.emptyText}>No downloads yet</Text>
          <Text style={styles.emptySubtext}>
            Browse a page with videos and tap the download button
          </Text>
        </View>
      ) : (
        <FlatList
          data={downloads}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <DownloadItem
              task={item}
              mediaType={getMediaType(item)}
              onPause={pauseDownload}
              onResume={resumeDownload}
              onCancel={cancelDownload}
              onOpenMedia={handleOpenMedia}
              onRename={handleRename}
              onRemove={handleRemove}
            />
          )}
        />
      )}

      <Modal
        visible={!!renameTask}
        transparent
        animationType="fade"
        onRequestClose={closeRenameModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename file</Text>
            <TextInput
              style={styles.modalInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Enter new file name"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={closeRenameModal}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalPrimaryBtn]} onPress={submitRename}>
                <Text style={[styles.modalBtnText, styles.modalPrimaryBtnText]}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!previewTask}
        animationType="slide"
        onRequestClose={closePreviewModal}>
        <SafeAreaView style={styles.previewContainer} edges={['top']}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle} numberOfLines={1}>
              {previewTask?.fileName || 'Media preview'}
            </Text>
            <TouchableOpacity style={styles.previewCloseBtn} onPress={closePreviewModal}>
              <Text style={styles.previewCloseText}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.previewBody}>
            {previewTask?.filePath && previewType === 'image' && (
              <Image
                source={{ uri: previewTask.filePath }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}

            {previewTask?.filePath && (previewType === 'video' || previewType === 'audio') && (
              <Video
                source={{ uri: previewTask.filePath }}
                style={previewType === 'audio' ? styles.previewAudio : styles.previewVideo}
                useNativeControls
                shouldPlay
                resizeMode={ResizeMode.CONTAIN}
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 10,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#222',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 8,
  },
  modalBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#EEE',
  },
  modalPrimaryBtn: {
    backgroundColor: '#2196F3',
  },
  modalBtnText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '600',
  },
  modalPrimaryBtnText: {
    color: '#FFF',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#111',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2E2E2E',
  },
  previewTitle: {
    flex: 1,
    fontSize: 14,
    color: '#FFF',
    marginRight: 12,
    fontWeight: '600',
  },
  previewCloseBtn: {
    backgroundColor: '#2B2B2B',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewCloseText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  previewBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewVideo: {
    width: '100%',
    height: '70%',
  },
  previewAudio: {
    width: '100%',
    height: 90,
  },
});
