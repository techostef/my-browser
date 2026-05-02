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
  type: 'mp4' | 'webm' | 'hls' | 'blob' | 'blob-ready' | 'unknown';
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
  cookies?: string;
  blobSize?: number;
  videoWidth?: string;
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
  status: DownloadStatus;
  progress: number; // 0-100
  bytesDownloaded: number;
  totalBytes: number;
  pageTitle: string;
  createdAt: number;
  error?: string;
}

export type DownloadAction =
  | { type: 'ADD_DOWNLOAD'; payload: DownloadTask }
  | { type: 'UPDATE_PROGRESS'; payload: { id: string; progress: number; bytesDownloaded: number; totalBytes: number } }
  | { type: 'SET_STATUS'; payload: { id: string; status: DownloadStatus; error?: string } }
  | { type: 'SET_FILE_PATH'; payload: { id: string; filePath: string } }
  | { type: 'REMOVE_DOWNLOAD'; payload: { id: string } };

export interface WebViewMessage {
  type: 'VIDEO_DETECTED' | 'VIDEO_REMOVED' | 'PAGE_INFO';
  payload: any;
}
