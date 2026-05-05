export interface BrowserTab {
  id: string;
  url: string;
  lastVisitedUrl: string;
  title: string;
  hidden?: boolean;
  urlHistory: string[];
  historyIndex: number;
}

export interface DetectedVideo {
  url: string;
  type: 'mp4' | 'webm' | 'hls' | 'dash' | 'blob' | 'blob-ready' | 'unknown';
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
  cookies?: string;
  blobSize?: number;
  videoWidth?: string;
  isValid?: boolean;
  startTime?: number;
  // Populated for blob/blob-ready videos after extraction-to-cache so the
  // preview modal can play the captured bytes via file:// (the original
  // blob: URL is scoped to the page that created it and is unusable elsewhere).
  localUri?: string;
}

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadTask {
  id: string;
  url: string;
  fileName: string;
  filePath: string;
  source?: 'private' | 'device';
  folderPath?: string;
  status: DownloadStatus;
  progress: number; // 0-100
  bytesDownloaded: number;
  totalBytes: number;
  pageTitle: string;
  createdAt: number;
  error?: string;
}

export const DEVICE_DOWNLOAD_MOVE_TARGET = '__target_device_download__';

export type DownloadAction =
  | { type: 'SET_DOWNLOADS'; payload: { downloads: DownloadTask[] } }
  | { type: 'ADD_DOWNLOAD'; payload: DownloadTask }
  | { type: 'UPDATE_PROGRESS'; payload: { id: string; progress: number; bytesDownloaded: number; totalBytes: number } }
  | { type: 'SET_STATUS'; payload: { id: string; status: DownloadStatus; error?: string } }
  | { type: 'SET_FILE_PATH'; payload: { id: string; filePath: string } }
  | { type: 'SET_FOLDERS'; payload: { folders: string[] } }
  | { type: 'SET_DEVICE_FOLDERS'; payload: { folders: string[] } }
  | { type: 'SET_DEVICE_SCAN_RUNNING'; payload: { isRunning: boolean } }
  | { type: 'REMOVE_DOWNLOAD'; payload: { id: string } };

export interface WebViewMessage {
  type: 'VIDEO_DETECTED' | 'VIDEO_REMOVED' | 'PAGE_INFO';
  payload: any;
}
