import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { DownloadTask, DownloadAction, DetectedVideo } from '../types';
import { downloadManager } from '../services/downloadManager';

interface DownloadState {
  downloads: DownloadTask[];
  folders: string[];
  deviceFolders: string[];
}

interface DownloadContextValue extends DownloadState {
  startDownload: (video: DetectedVideo) => void;
  refreshDownloads: () => Promise<void>;
  // Blob download is split into three steps so the caller can track each phase
  // in the Downloads tab without a blocking modal:
  //   1. createBlobTask   — immediately add a task visible in Downloads
  //   2. updateBlobProgress — update bytes/total as MSE buffers or chunks arrive
  //   3. completeBlobDownload — write the assembled base64 to disk
  createBlobTask: (taskId: string, pageTitle: string, totalBytes: number) => void;
  updateBlobProgress: (taskId: string, bytesDownloaded: number, totalBytes: number) => void;
  completeBlobDownload: (taskId: string, pageTitle: string, base64Data: string) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  renameDownload: (id: string, newFileName: string) => Promise<void>;
  createFolder: (folderName: string) => Promise<void>;
  renameFolder: (folderName: string, newFolderName: string) => Promise<void>;
  deleteFolder: (folderName: string, force?: boolean) => Promise<void>;
  scanDeviceDownloadFolder: (folderPath?: string) => Promise<void>;
  moveDownloadToFolder: (id: string, folderName?: string | null) => Promise<void>;
  removeDownload: (id: string) => void;
}

const initialState: DownloadState = { downloads: [], folders: [], deviceFolders: [] };

function downloadReducer(
  state: DownloadState,
  action: DownloadAction,
): DownloadState {
  switch (action.type) {
    case 'SET_DOWNLOADS':
      return { ...state, downloads: action.payload.downloads };

    case 'ADD_DOWNLOAD':
      return { ...state, downloads: [action.payload, ...state.downloads] };

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        downloads: state.downloads.map(d =>
          d.id === action.payload.id
            ? {
                ...d,
                progress: action.payload.progress,
                bytesDownloaded: action.payload.bytesDownloaded,
                totalBytes: action.payload.totalBytes,
              }
            : d,
        ),
      };

    case 'SET_STATUS':
      return {
        ...state,
        downloads: state.downloads.map(d =>
          d.id === action.payload.id
            ? {
                ...d,
                status: action.payload.status,
                error: action.payload.error,
              }
            : d,
        ),
      };

    case 'SET_FILE_PATH':
      return {
        ...state,
        downloads: state.downloads.map(d =>
          d.id === action.payload.id
            ? { ...d, filePath: action.payload.filePath }
            : d,
        ),
      };

    case 'REMOVE_DOWNLOAD':
      return {
        ...state,
        downloads: state.downloads.filter(d => d.id !== action.payload.id),
      };

    case 'SET_FOLDERS':
      return {
        ...state,
        folders: action.payload.folders,
      };

    case 'SET_DEVICE_FOLDERS':
      return {
        ...state,
        deviceFolders: action.payload.folders,
      };

    default:
      return state;
  }
}

interface DownloadActions {
  startDownload: DownloadContextValue['startDownload'];
  refreshDownloads: DownloadContextValue['refreshDownloads'];
  createBlobTask: DownloadContextValue['createBlobTask'];
  updateBlobProgress: DownloadContextValue['updateBlobProgress'];
  completeBlobDownload: DownloadContextValue['completeBlobDownload'];
  pauseDownload: DownloadContextValue['pauseDownload'];
  resumeDownload: DownloadContextValue['resumeDownload'];
  cancelDownload: DownloadContextValue['cancelDownload'];
  renameDownload: DownloadContextValue['renameDownload'];
  createFolder: DownloadContextValue['createFolder'];
  renameFolder: DownloadContextValue['renameFolder'];
  deleteFolder: DownloadContextValue['deleteFolder'];
  scanDeviceDownloadFolder: DownloadContextValue['scanDeviceDownloadFolder'];
  moveDownloadToFolder: DownloadContextValue['moveDownloadToFolder'];
  removeDownload: DownloadContextValue['removeDownload'];
}

const DownloadContext = createContext<DownloadContextValue | null>(null);
const DownloadActionsContext = createContext<DownloadActions | null>(null);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(downloadReducer, initialState);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const downloadsRef = useRef(state.downloads);
  downloadsRef.current = state.downloads;

  const refreshDownloads = useCallback(async () => {
    try {
      const privateFiles = await downloadManager.listPrivateDownloads();
      const scannedDeviceFiles = downloadsRef.current.filter(
        d => d.status === 'completed' && d.source === 'device',
      );
      const privateFolders = await downloadManager.listPrivateFolders();
      const activeOrPending = downloadsRef.current.filter(d => d.status !== 'completed');
      const merged = [...activeOrPending, ...privateFiles, ...scannedDeviceFiles].sort((a, b) => b.createdAt - a.createdAt);
      dispatchRef.current({ type: 'SET_DOWNLOADS', payload: { downloads: merged } });
      dispatchRef.current({ type: 'SET_FOLDERS', payload: { folders: privateFolders } });
    } catch (err) {
      console.warn('Failed to refresh downloads from private folder:', err);
    }
  }, []);

  const scanDeviceDownloadFolder = useCallback(async () => {
    try {
      const privateFiles = await downloadManager.listPrivateDownloads();
      const privateFolders = await downloadManager.listPrivateFolders();
      const scannedDevice = await downloadManager.scanDeviceDownloadFolder();
      const activeOrPending = downloadsRef.current.filter(d => d.status !== 'completed');
      const previousDeviceFiles = downloadsRef.current.filter(
        d => d.status === 'completed' && d.source === 'device',
      );
      const mergedDeviceFileMap = new Map<string, DownloadTask>();
      for (const file of previousDeviceFiles) {
        mergedDeviceFileMap.set(file.id, file);
      }
      for (const file of scannedDevice.files) {
        mergedDeviceFileMap.set(file.id, file);
      }

      const merged = [
        ...activeOrPending,
        ...privateFiles,
        ...Array.from(mergedDeviceFileMap.values()),
      ].sort((a, b) => b.createdAt - a.createdAt);

      const mergedDeviceFolders = Array.from(
        new Set([...state.deviceFolders, ...scannedDevice.folders]),
      ).sort((a, b) => a.localeCompare(b));

      dispatchRef.current({ type: 'SET_DOWNLOADS', payload: { downloads: merged } });
      dispatchRef.current({ type: 'SET_FOLDERS', payload: { folders: privateFolders } });
      dispatchRef.current({ type: 'SET_DEVICE_FOLDERS', payload: { folders: mergedDeviceFolders } });
    } catch (err) {
      console.warn('Scan device download folder failed:', err);
      throw err;
    }
  }, [state.deviceFolders]);

  useEffect(() => {
    downloadManager.initializePrivateFolder().catch(err => {
      console.warn('Failed to initialize private downloads folder:', err);
    });

    downloadManager.setProgressCallback((id, received, total) => {
      const progress = total > 0 ? Math.round((received / total) * 100) : 0;
      dispatchRef.current({
        type: 'UPDATE_PROGRESS',
        payload: { id, progress, bytesDownloaded: received, totalBytes: total },
      });
    });

    downloadManager.setStatusCallback((id, status, filePath, error) => {
      dispatchRef.current({
        type: 'SET_STATUS',
        payload: { id, status, error },
      });
      if (filePath) {
        dispatchRef.current({
          type: 'SET_FILE_PATH',
          payload: { id, filePath },
        });
      }
    });
    refreshDownloads();
  }, [refreshDownloads]);

  const createFolder = useCallback(async (folderName: string) => {
    const trimmed = folderName.trim();
    if (!trimmed) {
      return;
    }

    try {
      await downloadManager.createPrivateFolder(trimmed);
      await refreshDownloads();
    } catch (err) {
      console.warn('Create folder failed:', err);
      throw err;
    }
  }, [refreshDownloads]);

  const renameFolder = useCallback(async (folderName: string, newFolderName: string) => {
    const fromName = folderName.trim();
    const toName = newFolderName.trim();
    if (!fromName || !toName) {
      return;
    }

    try {
      await downloadManager.renamePrivateFolder(fromName, toName);
      await refreshDownloads();
    } catch (err) {
      console.warn('Rename folder failed:', err);
      throw err;
    }
  }, [refreshDownloads]);

  const deleteFolder = useCallback(async (folderName: string, force = false) => {
    const trimmed = folderName.trim();
    if (!trimmed) {
      return;
    }

    try {
      await downloadManager.deletePrivateFolder(trimmed, force);
      await refreshDownloads();
    } catch (err) {
      console.warn('Delete folder failed:', err);
      throw err;
    }
  }, [refreshDownloads]);

  const moveDownloadToFolder = useCallback(async (id: string, folderName?: string | null) => {
    const task = downloadsRef.current.find(d => d.id === id);
    if (!task?.filePath || task.status !== 'completed' || task.source === 'device') {
      return;
    }

    try {
      await downloadManager.movePrivateFileToFolder(task.filePath, folderName);
      await refreshDownloads();
    } catch (err) {
      console.warn('Move to folder failed:', err);
      throw err;
    }
  }, [refreshDownloads]);

  const startDownload = useCallback((video: DetectedVideo) => {
    const id = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const task: DownloadTask = {
      id,
      url: video.url,
      fileName: '',
      filePath: '',
      status: 'queued',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      pageTitle: video.pageTitle,
      createdAt: Date.now(),
    };

    dispatchRef.current({ type: 'ADD_DOWNLOAD', payload: task });

    downloadManager.startDownload(id, video.url, video.pageTitle, video.pageUrl, video.cookies).catch(err => {
      console.warn('Download failed to start:', err);
    });
  }, []);

  const pauseDownload = useCallback((id: string) => {
    downloadManager.pauseDownload(id);
  }, []);

  const resumeDownload = useCallback((id: string) => {
    const task = downloadsRef.current.find(d => d.id === id);
    if (!task) {
      return;
    }
    downloadManager.resumeDownload(id).catch(err => {
      console.warn('Resume failed:', err);
    });
  }, []);

  const cancelDownload = useCallback((id: string) => {
    downloadManager.cancelDownload(id);
  }, []);

  const renameDownload = useCallback(async (id: string, newFileName: string) => {
    const task = downloadsRef.current.find(d => d.id === id);
    if (!task?.filePath || task.source === 'device') {
      return;
    }
    try {
      await downloadManager.renamePrivateFile(task.filePath, newFileName);
      await refreshDownloads();
    } catch (err) {
      console.warn('Rename failed:', err);
    }
  }, [refreshDownloads]);

  const createBlobTask = useCallback((taskId: string, pageTitle: string, totalBytes: number) => {
    const task: DownloadTask = {
      id: taskId,
      url: 'blob-video',
      fileName: '',
      filePath: '',
      status: 'downloading',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes,
      pageTitle,
      createdAt: Date.now(),
    };
    dispatchRef.current({ type: 'ADD_DOWNLOAD', payload: task });
  }, []);

  const updateBlobProgress = useCallback((taskId: string, bytesDownloaded: number, totalBytes: number) => {
    const progress = totalBytes > 0 ? Math.min(99, Math.round((bytesDownloaded / totalBytes) * 100)) : 0;
    dispatchRef.current({
      type: 'UPDATE_PROGRESS',
      payload: { id: taskId, progress, bytesDownloaded, totalBytes },
    });
  }, []);

  const completeBlobDownload = useCallback((taskId: string, pageTitle: string, base64Data: string) => {
    downloadManager.saveBlobData(taskId, pageTitle, base64Data).catch(err => {
      console.warn('Blob save failed:', err);
    });
  }, []);

  const removeDownload = useCallback((id: string) => {
    const task = downloadsRef.current.find(d => d.id === id);

    if (task?.status === 'completed' && task.filePath && task.source !== 'device') {
      downloadManager.deletePrivateFile(task.filePath).catch(err => {
        console.warn('Delete private file failed:', err);
      });
    } else {
      downloadManager.cancelDownload(id);
    }

    dispatchRef.current({ type: 'REMOVE_DOWNLOAD', payload: { id } });
  }, []);

  const actions = useMemo<DownloadActions>(
    () => ({
      startDownload,
      refreshDownloads,
      createBlobTask,
      updateBlobProgress,
      completeBlobDownload,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      renameDownload,
      createFolder,
      renameFolder,
      deleteFolder,
      scanDeviceDownloadFolder,
      moveDownloadToFolder,
      removeDownload,
    }),
    [
      startDownload,
      refreshDownloads,
      createBlobTask,
      updateBlobProgress,
      completeBlobDownload,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      renameDownload,
      createFolder,
      renameFolder,
      deleteFolder,
      scanDeviceDownloadFolder,
      moveDownloadToFolder,
      removeDownload,
    ],
  );

  const value = useMemo<DownloadContextValue>(
    () => ({ ...state, ...actions }),
    [state, actions],
  );

  return (
    <DownloadActionsContext.Provider value={actions}>
      <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>
    </DownloadActionsContext.Provider>
  );
}

export function useDownloads(): DownloadContextValue {
  const ctx = useContext(DownloadContext);
  if (!ctx) {
    throw new Error('useDownloads must be used within a DownloadProvider');
  }
  return ctx;
}

// Subscribe to only the stable action callbacks — consumers of this hook
// will NOT re-render when download progress/state changes.
export function useDownloadActions(): DownloadActions {
  const ctx = useContext(DownloadActionsContext);
  if (!ctx) {
    throw new Error('useDownloadActions must be used within a DownloadProvider');
  }
  return ctx;
}
