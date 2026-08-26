export interface BrowserTab {
  id: string;
  url: string;
  lastVisitedUrl: string;
  title: string;
  hidden?: boolean;
  incognito?: boolean;
  urlHistory: string[];
  historyIndex: number;
}

export interface HlsVariant {
  bandwidth: number;
  averageBandwidth?: number;
  resolution?: string; // e.g. "720x1280"
  codecs?: string;
  audio?: string; // audio group ID
  subtitles?: string; // subtitles group ID
  uri: string; // relative or absolute URI of the variant playlist
}

export interface HlsMediaTrack {
  type: 'AUDIO' | 'SUBTITLES' | 'VIDEO' | 'CLOSED-CAPTIONS';
  groupId: string;
  name: string;
  language?: string;
  uri?: string;
  default?: boolean;
  autoselect?: boolean;
}

interface MediaSegment {
  uri: string;
  duration: number;
}

export interface HlsMasterInfo {
  isMaster?: boolean;
  variants: HlsVariant[];
  audioTracks: HlsMediaTrack[];
  subtitleTracks: HlsMediaTrack[];
  mediaSegments?: MediaSegment[];
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
  // Populated when an M3U8 master playlist is fetched and parsed
  hlsInfo?: HlsMasterInfo;
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
  duration?: number; // milliseconds, for video/audio files
  error?: string;
}

export const DEVICE_DOWNLOAD_MOVE_TARGET = '__target_device_download__';

export type DownloadAction =
  | { type: 'SET_DOWNLOADS'; payload: { downloads: DownloadTask[] } }
  | { type: 'ADD_DOWNLOAD'; payload: DownloadTask }
  | { type: 'UPDATE_PROGRESS'; payload: { id: string; progress: number; bytesDownloaded: number; totalBytes: number } }
  | { type: 'SET_STATUS'; payload: { id: string; status: DownloadStatus; error?: string } }
  | { type: 'SET_FILE_PATH'; payload: { id: string; filePath: string } }
  | { type: 'SET_FILE_SIZES'; payload: { sizes: Record<string, number> } }
  | { type: 'SET_FILE_DURATIONS'; payload: { durations: Record<string, number> } }
  | { type: 'SET_FOLDERS'; payload: { folders: string[] } }
  | { type: 'SET_DEVICE_FOLDERS'; payload: { folders: string[] } }
  | { type: 'SET_DEVICE_SCAN_RUNNING'; payload: { isRunning: boolean } }
  | { type: 'REMOVE_DOWNLOAD'; payload: { id: string } };

export interface WebViewMessage {
  type: 'VIDEO_DETECTED' | 'VIDEO_REMOVED' | 'PAGE_INFO';
  payload: any;
}
