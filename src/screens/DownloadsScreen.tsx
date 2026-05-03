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
import { DEVICE_DOWNLOAD_MOVE_TARGET, DownloadTask } from '../types';
import { useDownloads } from '../store/downloadStore';

export default function DownloadsScreen() {
  const {
    downloads,
    folders,
    deviceFolders,
    isDeviceScanRunning,
    refreshDownloads,
    scanDeviceDownloadFolder,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    renameDownload,
    createFolder,
    renameFolder,
    deleteFolder,
    moveDownloadToFolder,
    removeDownload,
  } = useDownloads();

  const DEVICE_ROOT_PATH = '__device_download__';

  type DownloadGridItem =
    | { type: 'folder'; path: string; name: string; source: 'private' | 'device'; isDeviceRoot?: boolean }
    | { type: 'file'; task: DownloadTask };

  const [renameTask, setRenameTask] = useState<DownloadTask | null>(null);
  const [renameText, setRenameText] = useState('');
  const [previewTask, setPreviewTask] = useState<DownloadTask | null>(null);
  const [folderDialogMode, setFolderDialogMode] = useState<'create' | 'rename' | null>(null);
  const [activeFolderPath, setActiveFolderPath] = useState('');
  const [folderNameText, setFolderNameText] = useState('');
  const [currentFolderPath, setCurrentFolderPath] = useState('');
  const [moveTask, setMoveTask] = useState<DownloadTask | null>(null);

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
        console.warn('Failed to scan private downloads on Downloads focus:', err);
      });
    }, [refreshDownloads]),
  );

  const isDevicePath =
    currentFolderPath === DEVICE_ROOT_PATH ||
    currentFolderPath.startsWith(`${DEVICE_ROOT_PATH}/`);
  const currentDeviceFolderPath =
    currentFolderPath === DEVICE_ROOT_PATH
      ? ''
      : currentFolderPath.startsWith(`${DEVICE_ROOT_PATH}/`)
        ? currentFolderPath.substring(DEVICE_ROOT_PATH.length + 1)
        : '';

  const openDeviceRoot = useCallback(() => {
    setCurrentFolderPath(DEVICE_ROOT_PATH);
  }, []);

  const handleRescanDevice = useCallback(() => {
    scanDeviceDownloadFolder().catch(err => {
      Alert.alert('Scan failed', err instanceof Error ? err.message : 'Unable to scan device download folder');
    });
  }, [scanDeviceDownloadFolder]);

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

  const openCreateFolder = useCallback(() => {
    setFolderDialogMode('create');
    setActiveFolderPath('');
    setFolderNameText('');
  }, []);

  const openRenameFolder = useCallback((folderPath: string) => {
    const leafName = folderPath.split('/').pop() || folderPath;
    setFolderDialogMode('rename');
    setActiveFolderPath(folderPath);
    setFolderNameText(leafName);
  }, []);

  const closeFolderDialog = useCallback(() => {
    setFolderDialogMode(null);
    setActiveFolderPath('');
    setFolderNameText('');
    Keyboard.dismiss();
  }, []);

  const submitFolderDialog = useCallback(() => {
    const trimmed = folderNameText.trim();
    if (!trimmed || !folderDialogMode) {
      return;
    }

    const nextPath = currentFolderPath ? `${currentFolderPath}/${trimmed}` : trimmed;
    const action = folderDialogMode === 'create'
      ? createFolder(nextPath)
      : renameFolder(activeFolderPath, trimmed);

    action
      .catch(err => {
        Alert.alert('Folder error', err instanceof Error ? err.message : 'Unable to update folder');
      })
      .finally(() => {
        closeFolderDialog();
      });
  }, [activeFolderPath, closeFolderDialog, createFolder, currentFolderPath, folderDialogMode, folderNameText, renameFolder]);

  const runDeleteFolder = useCallback((folderPath: string, force = false) => {
    deleteFolder(folderPath, force).catch(err => {
      const message = err instanceof Error ? err.message : 'Unable to delete folder';

      if (!force && message.toLowerCase().includes('not empty')) {
        Alert.alert(
          'Delete folder and all contents?',
          'This folder contains files or subfolders. This action cannot be undone.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete All',
              style: 'destructive',
              onPress: () => runDeleteFolder(folderPath, true),
            },
          ],
        );
        return;
      }

      Alert.alert('Folder error', message);
    });
  }, [deleteFolder]);

  const handleDeleteFolder = useCallback((folderPath: string) => {
    const folderName = folderPath.split('/').pop() || folderPath;
    Alert.alert('Delete folder', `Delete folder "${folderName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => runDeleteFolder(folderPath),
      },
    ]);
  }, [runDeleteFolder]);

  const handleFolderAction = useCallback((folderPath: string) => {
    const folderName = folderPath.split('/').pop() || folderPath;
    Alert.alert(folderName, 'Folder options', [
      {
        text: 'Rename',
        onPress: () => openRenameFolder(folderPath),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => handleDeleteFolder(folderPath),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleDeleteFolder, openRenameFolder]);

  const handleOpenFolder = useCallback((item: Extract<DownloadGridItem, { type: 'folder' }>) => {
    if (item.isDeviceRoot) {
      openDeviceRoot();
      return;
    }

    if (item.source === 'device') {
      setCurrentFolderPath(item.path);
      return;
    }

    setCurrentFolderPath(item.path);
  }, [openDeviceRoot]);

  const handleBackFolder = useCallback(() => {
    if (!currentFolderPath) {
      return;
    }

    if (currentFolderPath === DEVICE_ROOT_PATH) {
      setCurrentFolderPath('');
      return;
    }

    if (currentFolderPath.startsWith(`${DEVICE_ROOT_PATH}/`)) {
      const relative = currentFolderPath.substring(DEVICE_ROOT_PATH.length + 1);
      const slashIndex = relative.lastIndexOf('/');
      setCurrentFolderPath(
        slashIndex >= 0
          ? `${DEVICE_ROOT_PATH}/${relative.substring(0, slashIndex)}`
          : DEVICE_ROOT_PATH,
      );
      return;
    }

    const slashIndex = currentFolderPath.lastIndexOf('/');
    setCurrentFolderPath(slashIndex >= 0 ? currentFolderPath.substring(0, slashIndex) : '');
  }, [currentFolderPath]);

  const handleMoveRequest = useCallback((task: DownloadTask) => {
    if (task.status !== 'completed' || !task.filePath) {
      return;
    }
    setMoveTask(task);
  }, []);

  const closeMoveModal = useCallback(() => {
    setMoveTask(null);
  }, []);

  const handleMoveToFolder = useCallback((folderName?: string | null) => {
    if (!moveTask) {
      return;
    }

    const target = moveTask.source === 'private' ? DEVICE_DOWNLOAD_MOVE_TARGET : folderName;

    moveDownloadToFolder(moveTask.id, target)
      .catch(err => {
        const message = err instanceof Error ? err.message : 'Unable to move file';
        Alert.alert('Move error', message);
      })
      .finally(() => {
        closeMoveModal();
      });
  }, [closeMoveModal, moveDownloadToFolder, moveTask]);

  const previewType = previewTask ? getMediaType(previewTask) : 'other';

  const visiblePrivateFolders = !isDevicePath
    ? folders
        .filter(folderPath => {
          const slashIndex = folderPath.lastIndexOf('/');
          const parentPath = slashIndex >= 0 ? folderPath.substring(0, slashIndex) : '';
          return parentPath === currentFolderPath;
        })
        .map(folderPath => ({
          type: 'folder' as const,
          path: folderPath,
          name: folderPath.split('/').pop() || folderPath,
          source: 'private' as const,
        }))
    : [];

  const visibleDeviceFolders = isDevicePath
    ? deviceFolders
        .filter(folderPath => {
          const slashIndex = folderPath.lastIndexOf('/');
          const parentPath = slashIndex >= 0 ? folderPath.substring(0, slashIndex) : '';
          return parentPath === currentDeviceFolderPath;
        })
        .map(folderPath => ({
          type: 'folder' as const,
          path: `${DEVICE_ROOT_PATH}/${folderPath}`,
          name: folderPath.split('/').pop() || folderPath,
          source: 'device' as const,
        }))
    : [];

  const visibleFolders: DownloadGridItem[] = [
    ...visiblePrivateFolders,
    ...(currentFolderPath === ''
      ? [
          {
            type: 'folder' as const,
            path: DEVICE_ROOT_PATH,
            name: 'Device Download',
            source: 'device' as const,
            isDeviceRoot: true,
          },
        ]
      : []),
    ...visibleDeviceFolders,
  ].sort((a, b) => (a.type === 'folder' && b.type === 'folder' ? a.name.localeCompare(b.name) : 0));

  const visibleDownloads = downloads.filter(task => {
    if (task.status !== 'completed') {
      return currentFolderPath === '';
    }

    if (task.source === 'device') {
      if (!isDevicePath) {
        return false;
      }
      const fileFolder = task.folderPath || '';
      return fileFolder === currentDeviceFolderPath;
    }

    if (isDevicePath) {
      return false;
    }

    const fileFolder = task.folderPath || '';
    return fileFolder === currentFolderPath;
  });

  const gridData: DownloadGridItem[] = [
    ...visibleFolders,
    ...visibleDownloads.map(task => ({ type: 'file' as const, task })),
  ];

  console.log("gridData", gridData)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Downloads</Text>
          <Text style={styles.headerSubtitle}>
            {(currentFolderPath || 'Root').replace(DEVICE_ROOT_PATH, 'Device Download')} · {gridData.length} item{gridData.length !== 1 ? 's' : ''}
          </Text>
        </View>
        {!isDevicePath ? (
          <TouchableOpacity style={styles.newFolderBtn} onPress={openCreateFolder}>
            <Text style={styles.newFolderBtnText}>+ Folder</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.rescanBtn, isDeviceScanRunning ? styles.rescanBtnDisabled : null]}
            onPress={handleRescanDevice}
            disabled={isDeviceScanRunning}>
            <Text style={styles.rescanBtnText}>{isDeviceScanRunning ? 'Scanning...' : 'Rescan'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {currentFolderPath ? (
        <View style={styles.folderPathRow}>
          <TouchableOpacity style={styles.backFolderBtn} onPress={handleBackFolder}>
            <Text style={styles.backFolderText}>← Back</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isDevicePath ? (
        <View style={styles.deviceScanStatusRow}>
          <Text style={styles.deviceScanStatusText}>
            {isDeviceScanRunning ? 'Device download scan is running...' : 'Showing last scanned device download results'}
          </Text>
        </View>
      ) : null}

      {gridData.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📥</Text>
          <Text style={styles.emptyText}>
            {isDeviceScanRunning
              ? 'Scanning device folder...'
              : currentFolderPath
                ? 'This folder is empty'
                : 'No downloads yet'}
          </Text>
          <Text style={styles.emptySubtext}>
            {isDevicePath
              ? 'Use Rescan to refresh files and folders from device storage'
              : currentFolderPath
              ? 'Create a subfolder or move files here'
              : 'Browse a page with videos and tap the download button'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={gridData}
          numColumns={2}
          keyExtractor={item => (item.type === 'folder' ? `folder_${item.path}` : item.task.id)}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.listRow}
          renderItem={({ item }) => (
            <View style={styles.gridItem}>
              {item.type === 'folder' ? (
                <View style={styles.folderCard}>
                  <TouchableOpacity style={styles.folderCardBody} onPress={() => handleOpenFolder(item)}>
                    <Text style={styles.folderIcon}>📁</Text>
                    <Text style={styles.folderName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.folderMeta} numberOfLines={1}>
                      {item.isDeviceRoot && isDeviceScanRunning ? 'Scanning...' : 'Tap to open'}
                    </Text>
                  </TouchableOpacity>
                  {item.source === 'private' ? (
                    <TouchableOpacity style={styles.folderMenuBtn} onPress={() => handleFolderAction(item.path)}>
                      <Text style={styles.folderMenuText}>⋯</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <DownloadItem
                  task={item.task}
                  mediaType={getMediaType(item.task)}
                  onPause={pauseDownload}
                  onResume={resumeDownload}
                  onCancel={cancelDownload}
                  onOpenMedia={handleOpenMedia}
                  onRename={handleRename}
                  onMove={handleMoveRequest}
                  onRemove={handleRemove}
                />
              )}
            </View>
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
        visible={!!folderDialogMode}
        transparent
        animationType="fade"
        onRequestClose={closeFolderDialog}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {folderDialogMode === 'create' ? 'Create folder' : 'Rename folder'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={folderNameText}
              onChangeText={setFolderNameText}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Folder name"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={closeFolderDialog}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalPrimaryBtn]} onPress={submitFolderDialog}>
                <Text style={[styles.modalBtnText, styles.modalPrimaryBtnText]}>
                  {folderDialogMode === 'create' ? 'Create' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!moveTask}
        transparent
        animationType="fade"
        onRequestClose={closeMoveModal}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeMoveModal}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              {moveTask?.source === 'device' ? 'Move file to private folder' : 'Move file to device download'}
            </Text>
            <View style={styles.moveOptions}>
              {moveTask?.source === 'device' ? (
                <>
                  <TouchableOpacity style={styles.moveOptionBtn} onPress={() => handleMoveToFolder(null)}>
                    <Text style={styles.moveOptionText}>Root</Text>
                  </TouchableOpacity>
                  {folders.map(folder => (
                    <TouchableOpacity key={folder} style={styles.moveOptionBtn} onPress={() => handleMoveToFolder(folder)}>
                      <Text style={styles.moveOptionText}>{folder}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              ) : (
                <TouchableOpacity style={styles.moveOptionBtn} onPress={() => handleMoveToFolder(DEVICE_DOWNLOAD_MOVE_TARGET)}>
                  <Text style={styles.moveOptionText}>Device Download</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  newFolderBtn: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  newFolderBtnText: {
    color: '#1A73E8',
    fontSize: 12,
    fontWeight: '700',
  },
  rescanBtn: {
    backgroundColor: '#E7F7ED',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rescanBtnDisabled: {
    opacity: 0.65,
  },
  rescanBtnText: {
    color: '#1F8A4C',
    fontSize: 12,
    fontWeight: '700',
  },
  folderPathRow: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  deviceScanStatusRow: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  deviceScanStatusText: {
    fontSize: 12,
    color: '#4A6A8A',
  },
  backFolderBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#E8EDF4',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  backFolderText: {
    color: '#1F4E79',
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  listRow: {
    justifyContent: 'space-between',
  },
  gridItem: {
    width: '48.5%',
    marginBottom: 10,
  },
  folderCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  folderCardBody: {
    height: 120,
    borderRadius: 10,
    backgroundColor: '#E8F0FE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  folderIcon: {
    fontSize: 34,
    marginBottom: 8,
  },
  folderName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2B2B2B',
  },
  folderMeta: {
    fontSize: 10,
    color: '#6A6A6A',
    marginTop: 3,
  },
  folderMenuBtn: {
    marginTop: 8,
    alignSelf: 'flex-end',
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderMenuText: {
    fontSize: 18,
    lineHeight: 18,
    color: '#444',
    marginTop: -4,
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
  moveOptions: {
    gap: 8,
  },
  moveOptionBtn: {
    borderRadius: 8,
    backgroundColor: '#F2F2F2',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  moveOptionText: {
    fontSize: 14,
    color: '#222',
    fontWeight: '600',
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
