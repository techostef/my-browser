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
  removeDownload: (id: string) => void;
}

const initialState: DownloadState = { downloads: [] };

function downloadReducer(
  state: DownloadState,
  action: DownloadAction,
): DownloadState {
  switch (action.type) {
    case 'SET_DOWNLOADS':
      return { downloads: action.payload.downloads };

    case 'ADD_DOWNLOAD':
      return { downloads: [action.payload, ...state.downloads] };

    case 'UPDATE_PROGRESS':
      return {
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
        downloads: state.downloads.map(d =>
          d.id === action.payload.id
            ? { ...d, filePath: action.payload.filePath }
            : d,
        ),
      };

    case 'REMOVE_DOWNLOAD':
      return {
        downloads: state.downloads.filter(d => d.id !== action.payload.id),
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
      const activeOrPending = downloadsRef.current.filter(d => d.status !== 'completed');
      const merged = [...activeOrPending, ...privateFiles].sort((a, b) => b.createdAt - a.createdAt);
      dispatchRef.current({ type: 'SET_DOWNLOADS', payload: { downloads: merged } });
    } catch (err) {
      console.warn('Failed to refresh downloads from private folder:', err);
    }
  }, []);

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
    if (!task?.filePath) {
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

    if (task?.status === 'completed' && task.filePath) {
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
