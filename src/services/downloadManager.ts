import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { DownloadTask } from '../types';
import { requestStoragePermission } from '../utils/permissions';

type ProgressCallback = (
  id: string,
  received: number,
  total: number,
) => void;
type StatusCallback = (
  id: string,
  status: DownloadTask['status'],
  filePath?: string,
  error?: string,
) => void;

interface ActiveTask {
  task: FileSystem.DownloadResumable;
  url: string;
  fileUri: string;
  bytesDownloaded: number;
  totalBytes: number;
}

class DownloadManager {
  private activeTasks: Map<string, ActiveTask> = new Map();
  private onProgress: ProgressCallback | null = null;
  private onStatusChange: StatusCallback | null = null;

  setProgressCallback(cb: ProgressCallback) {
    this.onProgress = cb;
  }

  setStatusCallback(cb: StatusCallback) {
    this.onStatusChange = cb;
  }

  private sanitizeFileName(url: string, pageTitle: string): string {
    // Try to extract filename from URL
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const segments = pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1] || '';

      if (lastSegment && /\.\w{2,4}$/.test(lastSegment)) {
        return lastSegment.replace(/[^a-zA-Z0-9._-]/g, '_');
      }
    } catch {
      // URL parsing failed
    }

    // Fallback: use page title + timestamp
    const safe = (pageTitle || 'video')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 40);
    return `${safe}_${Date.now()}.mp4`;
  }

  async startDownload(
    id: string,
    url: string,
    pageTitle: string,
    pageUrl?: string,
    cookies?: string,
  ): Promise<string> {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      throw new Error('Storage permission denied');
    }

    const fileName = this.sanitizeFileName(url, pageTitle);
    const documentDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
    if (!documentDir) {
      throw new Error('No writable file directory available');
    }
    const destPath = `${documentDir}${fileName}`;

    this.onStatusChange?.(id, 'downloading');

    // Build headers to mimic a browser request from the originating page
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    };
    if (pageUrl) {
      headers['Referer'] = pageUrl;
      try {
        const origin = new URL(pageUrl).origin;
        headers['Origin'] = origin;
      } catch {}
    }
    if (cookies) {
      headers['Cookie'] = cookies;
    }

    const task = FileSystem.createDownloadResumable(
      url,
      destPath,
      { headers },
      (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
        const received = progress.totalBytesWritten || 0;
        const total = progress.totalBytesExpectedToWrite || 0;

        const active = this.activeTasks.get(id);
        if (active) {
          active.bytesDownloaded = received;
          active.totalBytes = total;
        }

        this.onProgress?.(id, received, total);
      },
    );

    this.activeTasks.set(id, {
      task,
      url,
      fileUri: destPath,
      bytesDownloaded: 0,
      totalBytes: 0,
    });

    return this.runTask(id);
  }

  private async runTask(id: string): Promise<string> {
    const active = this.activeTasks.get(id);
    if (!active) {
      throw new Error('Download task not found');
    }

    try {
      const result = await active.task.downloadAsync();
      if (!result?.uri) {
        throw new Error('Download was cancelled');
      }

      await MediaLibrary.saveToLibraryAsync(result.uri);
      this.activeTasks.delete(id);
      this.onStatusChange?.(id, 'completed', result.uri);
      return result.uri;
    } catch (err: any) {
      if (err?.message?.includes('pause')) {
        return '';
      }
      if (err?.message?.includes('cancel')) {
        this.activeTasks.delete(id);
        this.onStatusChange?.(id, 'cancelled');
        return '';
      }
      this.activeTasks.delete(id);
      this.onStatusChange?.(id, 'failed', undefined, err?.message || 'Download failed');
      throw err;
    }
  }

  pauseDownload(id: string): void {
    const active = this.activeTasks.get(id);
    if (active) {
      this.onStatusChange?.(id, 'paused');
      active.task.pauseAsync().catch((err: unknown) => {
        console.log(`Paused download ${id}`, err);
      });
    }
  }

  async resumeDownload(id: string): Promise<string> {
    const active = this.activeTasks.get(id);
    if (!active) {
      throw new Error('No paused task found for this download');
    }

    this.onStatusChange?.(id, 'downloading');
    return this.runResumeTask(id);
  }

  private async runResumeTask(id: string): Promise<string> {
    const active = this.activeTasks.get(id);
    if (!active) {
      throw new Error('Download task not found');
    }

    try {
      const result = await active.task.resumeAsync();
      if (!result?.uri) {
        throw new Error('Download was cancelled');
      }

      await MediaLibrary.saveToLibraryAsync(result.uri);
      this.activeTasks.delete(id);
      this.onStatusChange?.(id, 'completed', result.uri);
      return result.uri;
    } catch (err: any) {
      if (err?.message?.includes('cancel')) {
        this.activeTasks.delete(id);
        this.onStatusChange?.(id, 'cancelled');
        return '';
      }
      if (err?.message?.includes('pause')) {
        return '';
      }
      this.activeTasks.delete(id);
      this.onStatusChange?.(id, 'failed', undefined, err?.message || 'Resume failed');
      throw err;
    }
  }

  cancelDownload(id: string): void {
    const active = this.activeTasks.get(id);
    if (active) {
      active.task.cancelAsync().catch(() => {});
      this.activeTasks.delete(id);
    }
    this.onStatusChange?.(id, 'cancelled');
  }

  isActive(id: string): boolean {
    return this.activeTasks.has(id);
  }

  async saveBlobData(
    id: string,
    pageTitle: string,
    base64Data: string,
  ): Promise<string> {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      throw new Error('Storage permission denied');
    }

    const safe = (pageTitle || 'video')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 40);
    const fileName = `${safe}_${Date.now()}.mp4`;
    const documentDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
    if (!documentDir) {
      throw new Error('No writable file directory available');
    }
    const destPath = `${documentDir}${fileName}`;

    this.onStatusChange?.(id, 'downloading');

    try {
      await FileSystem.writeAsStringAsync(destPath, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await MediaLibrary.saveToLibraryAsync(destPath);
      this.onStatusChange?.(id, 'completed', destPath);
      return destPath;
    } catch (err: any) {
      // Clean up on failure
      FileSystem.deleteAsync(destPath, { idempotent: true }).catch(() => {});
      this.onStatusChange?.(id, 'failed', undefined, err?.message || 'Blob save failed');
      throw err;
    }
  }
}

// Singleton
export const downloadManager = new DownloadManager();
