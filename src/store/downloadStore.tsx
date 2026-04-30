import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { DownloadTask, DownloadAction, DetectedVideo } from '../types';
import { downloadManager } from '../services/downloadManager';

interface DownloadState {
  downloads: DownloadTask[];
}

interface DownloadContextValue extends DownloadState {
  startDownload: (video: DetectedVideo) => void;
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
  removeDownload: (id: string) => void;
}

const initialState: DownloadState = { downloads: [] };

function downloadReducer(
  state: DownloadState,
  action: DownloadAction,
): DownloadState {
  switch (action.type) {
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

const DownloadContext = createContext<DownloadContextValue | null>(null);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(downloadReducer, initialState);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
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
  }, []);

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
    const task = state.downloads.find(d => d.id === id);
    if (!task) {
      return;
    }
    downloadManager.resumeDownload(id).catch(err => {
      console.warn('Resume failed:', err);
    });
  }, [state.downloads]);

  const cancelDownload = useCallback((id: string) => {
    downloadManager.cancelDownload(id);
  }, []);

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
    downloadManager.cancelDownload(id);
    dispatch({ type: 'REMOVE_DOWNLOAD', payload: { id } });
  }, []);

  return (
    <DownloadContext.Provider
      value={{
        ...state,
        startDownload,
        createBlobTask,
        updateBlobProgress,
        completeBlobDownload,
        pauseDownload,
        resumeDownload,
        cancelDownload,
        removeDownload,
      }}>
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownloads(): DownloadContextValue {
  const ctx = useContext(DownloadContext);
  if (!ctx) {
    throw new Error('useDownloads must be used within a DownloadProvider');
  }
  return ctx;
}
