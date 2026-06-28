import AsyncStorage from '@react-native-async-storage/async-storage';
import { FFmpegKit, ReturnCode } from '@wokcito/ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { DownloadTask, HlsMasterInfo, HlsVariant } from '../types';

const MEDIA_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', '3gp', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
// All media files are probed with FFmpegKit (reads container headers, safe for all formats).
const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', '3gp']);

const DURATION_CACHE_KEY = '@media_duration_cache_v1';
let durationCache: Record<string, number> | null = null;
let durationCacheDirty = false;
const IS_SHOW_MANGA_FOLDER = false;


// ---- Persistent download state -------------------------------------------
// Stored as a JSON-serialized record keyed by download id under a single
// AsyncStorage key. Only `paused` downloads survive — completed/cancelled
// records are deleted, and `downloading` snapshots are written as `paused`
// so that a crash mid-download leaves a resumable entry.
const PERSISTED_DOWNLOADS_KEY = '@persisted_downloads_v1';

interface PersistedDownload {
  id: string;
  type: 'direct' | 'hls';
  url: string;
  fileUri: string;
  fileName: string;
  pageTitle: string;
  pageUrl?: string;
  cookies?: string;
  expectedTotalBytes: number;
  bytesDownloaded: number;
  createdAt: number;
  status: 'paused';

  // direct-only — full savable state from DownloadResumable.savable().
  // resumeData is populated only after pauseAsync() succeeds.
  savable?: FileSystem.DownloadPauseState;

  // HLS-only
  hlsInfo?: HlsMasterInfo;
  selectedVariant?: HlsVariant;
}

let persistedCache: Record<string, PersistedDownload> | null = null;

async function loadPersistedDownloads(): Promise<Record<string, PersistedDownload>> {
  if (persistedCache) { return persistedCache; }
  try {
    const raw = await AsyncStorage.getItem(PERSISTED_DOWNLOADS_KEY);
    if (!raw) {
      persistedCache = {};
      return persistedCache;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      persistedCache = parsed as Record<string, PersistedDownload>;
    } else {
      persistedCache = {};
    }
  } catch (err) {
    console.warn('Failed to load persisted downloads (resetting):', err);
    persistedCache = {};
  }
  return persistedCache;
}

async function flushPersistedDownloads(): Promise<void> {
  if (!persistedCache) { return; }
  try {
    await AsyncStorage.setItem(PERSISTED_DOWNLOADS_KEY, JSON.stringify(persistedCache));
  } catch (err) {
    console.warn('Failed to persist downloads:', err);
  }
}

async function upsertPersistedDownload(record: PersistedDownload): Promise<void> {
  const cache = await loadPersistedDownloads();
  cache[record.id] = record;
  await flushPersistedDownloads();
}

async function removePersistedDownload(id: string): Promise<void> {
  const cache = await loadPersistedDownloads();
  if (cache[id]) {
    delete cache[id];
    await flushPersistedDownloads();
  }
}

async function loadDurationCache(): Promise<Record<string, number>> {
  if (durationCache) { return durationCache; }
  try {
    const raw = await AsyncStorage.getItem(DURATION_CACHE_KEY);
    durationCache = raw ? JSON.parse(raw) : {};
  } catch {
    durationCache = {};
  }
  return durationCache!;
}

async function flushDurationCache(): Promise<void> {
  if (!durationCacheDirty || !durationCache) { return; }
  durationCacheDirty = false;
  try {
    await AsyncStorage.setItem(DURATION_CACHE_KEY, JSON.stringify(durationCache));
  } catch {
    // best effort
  }
}

function durationCacheKey(filePath: string, size: number, mtime: number): string {
  return `${filePath}|${size}|${mtime}`;
}

// Pre-populate the duration cache for a just-exported file so the Downloads
// scan never needs to probe it (avoids any probe-related issues entirely).
export async function preCacheMediaDuration(fileUri: string, durationMs: number): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) return;
    const anyInfo = info as any;
    const size: number = typeof anyInfo.size === 'number' ? anyInfo.size : 0;
    const mtime: number = typeof anyInfo.modificationTime === 'number' ? anyInfo.modificationTime : 0;
    const cache = await loadDurationCache();
    cache[durationCacheKey(fileUri, size, mtime)] = durationMs;
    durationCacheDirty = true;
    await flushDurationCache();
  } catch { /* best effort */ }
}

async function concurrentMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Cap concurrent FFmpeg probe sessions to avoid exhausting native resources.
const PROBE_CONCURRENCY = 2;
// Cap concurrent file-stat calls. Each FileSystem.getInfoAsync registers a native bridge
// callback; firing hundreds at once triggers the "Excessive pending callbacks" warning.
const STAT_CONCURRENCY = 20;
let probeInFlight = 0;
const probeQueue: Array<() => void> = [];

async function acquireProbeSlot(): Promise<void> {
  if (probeInFlight < PROBE_CONCURRENCY) {
    probeInFlight++;
    return;
  }
  await new Promise<void>(resolve => probeQueue.push(resolve));
  probeInFlight++;
}

function releaseProbeSlot(): void {
  probeInFlight--;
  const next = probeQueue.shift();
  if (next) { next(); }
}

// Use FFmpegKit to read duration from a video file's container header.
// This handles any format (including MP4s with mov_text subtitle tracks) without
// invoking Android's MediaPlayer, which native-crashes on unknown codec streams.
async function probeVideoWithFFmpeg(filePath: string): Promise<number | undefined> {
  try {
    // Intentionally no output — FFmpeg exits with error but logs file metadata.
    const session = await FFmpegKit.execute(`-hide_banner -i "${filePath}"`);
    const logs = await session.getLogs();
    for (const log of logs) {
      const match = (log.getMessage() as string).match(
        /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/,
      );
      if (match) {
        const ms =
          (parseInt(match[1], 10) * 3600 +
            parseInt(match[2], 10) * 60 +
            parseFloat(match[3])) *
          1000;
        return ms;
      }
    }
  } catch { /* ignore */ }
  return undefined;
}

async function probeMediaDuration(filePath: string, size: number, mtime: number): Promise<number | undefined> {
  const ext = filePath.split('.').pop()?.toLowerCase().split('?')[0] || '';
  if (!MEDIA_EXTS.has(ext)) {
    return undefined;
  }

  const cache = await loadDurationCache();
  const key = durationCacheKey(filePath, size, mtime);
  if (cache[key] !== undefined) {
    return cache[key] || undefined;
  }

  await acquireProbeSlot();
  let durationMs: number | undefined;
  try {
    if (VIDEO_EXTS.has(ext)) {
      // FFmpegKit reads only the container header — safe for all formats including
      // FFmpegKit reads only the container header — safe for all formats.
      durationMs = await probeVideoWithFFmpeg(filePath);
    } else {
      durationMs = await probeVideoWithFFmpeg(filePath);
    }
  } finally {
    releaseProbeSlot();
  }

  cache[key] = durationMs ?? 0;
  durationCacheDirty = true;
  // Flush after each probe so a mid-walk crash doesn't reset the whole cache.
  void flushDurationCache();
  return durationMs;
}

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
  type: 'direct' | 'hls';
  task?: FileSystem.DownloadResumable;
  ffmpegSessionId?: number;
  url: string;
  fileUri: string;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  // Authoritative expected size captured from a HEAD pre-flight. Many video
  // servers don't include Content-Length in the GET progress events (chunked
  // transfer), which would otherwise make truncation undetectable.
  expectedTotalBytes?: number;
  paused?: boolean;
  // Stall-watchdog: epoch ms of the last progress event. Used to detect
  // connection loss without depending on NetInfo.
  lastProgressAt?: number;
  // Last on-disk file size observed by the stall watchdog. Used to detect
  // growth even when expo-file-system stops firing progress events.
  lastDiskSize?: number;
  // Number of consecutive stall-watchdog ticks where no growth was detected.
  // We require multiple consecutive stalls before auto-pausing to avoid
  // false positives when getInfoAsync can't read the file size mid-write.
  stallCount?: number;
  // Headers used for the original GET, preserved so a savable-based resume
  // (post app restart) can reconstruct the DownloadResumable.
  requestHeaders?: Record<string, string>;
  // Cached copy of the most recent task.savable() so resumeDownload can find
  // resumeData without recalling savable() (the live task may already be gone
  // after an auto-pause failure).
  savable?: FileSystem.DownloadPauseState;
  createdAt: number;
  pageTitle: string;
  pageUrl?: string;
  cookies?: string;
  // HLS-only — preserved so resumeDownload can restart the FFmpeg job from scratch.
  hlsInfo?: HlsMasterInfo;
  selectedVariant?: HlsVariant;
}

interface DeviceFolderScanResult {
  files: DownloadTask[];
  folders: string[];
}

// Auto-pause a download whose last progress event is older than this. Lets us
// detect connection loss without depending on NetInfo.
// NOTE: expo-file-system on Android may not fire progress events frequently for
// large files (>40MB). A too-short threshold falsely pauses healthy downloads.
const STALL_THRESHOLD_MS = 60_000;
const STALL_SCAN_INTERVAL_MS = 5_000;
// Debounce persisted-progress writes so we don't pound AsyncStorage on every
// progress event.
const PERSIST_PROGRESS_DEBOUNCE_MS = 2_000;

class DownloadManager {
  private activeTasks: Map<string, ActiveTask> = new Map();
  private onProgress: ProgressCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private readonly privateFolderName = 'private_downloads/';
  private privateFolderUri: string | null = null;
  private stallWatchdogHandle: ReturnType<typeof setInterval> | null = null;
  private persistProgressTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  setProgressCallback(cb: ProgressCallback) {
    this.onProgress = cb;
  }

  private sanitizeFolderName(name: string): string {
    const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
    return cleaned;
  }

  private sanitizeFolderPath(path: string): string {
    return path
      .split('/')
      .map(segment => this.sanitizeFolderName(segment))
      .filter(Boolean)
      .join('/');
  }

  private joinPrivateFolderPath(privateDir: string, folderPath: string): string {
    const safePath = this.sanitizeFolderPath(folderPath);
    return safePath ? `${privateDir}${safePath}/` : privateDir;
  }

  setStatusCallback(cb: StatusCallback) {
    this.onStatusChange = cb;
  }

  // ---- Persistence ------------------------------------------------------

  private async persistFromActive(id: string): Promise<void> {
    const active = this.activeTasks.get(id);
    if (!active) { return; }
    // Try to capture the latest savable() snapshot for direct downloads.
    let savable = active.savable;
    if (active.type === 'direct' && active.task) {
      try {
        savable = active.task.savable();
        active.savable = savable;
      } catch { /* keep stale snapshot if savable throws */ }
    }
    await upsertPersistedDownload({
      id,
      type: active.type,
      url: active.url,
      fileUri: active.fileUri,
      fileName: active.fileName,
      pageTitle: active.pageTitle,
      pageUrl: active.pageUrl,
      cookies: active.cookies,
      expectedTotalBytes: active.expectedTotalBytes ?? active.totalBytes ?? 0,
      bytesDownloaded: active.bytesDownloaded,
      createdAt: active.createdAt,
      status: 'paused',
      savable,
      hlsInfo: active.hlsInfo,
      selectedVariant: active.selectedVariant,
    });
  }

  private schedulePersistProgress(id: string): void {
    if (this.persistProgressTimers.has(id)) { return; }
    const timer = setTimeout(() => {
      this.persistProgressTimers.delete(id);
      void this.persistFromActive(id);
    }, PERSIST_PROGRESS_DEBOUNCE_MS);
    this.persistProgressTimers.set(id, timer);
  }

  private clearPersistTimer(id: string): void {
    const timer = this.persistProgressTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.persistProgressTimers.delete(id);
    }
  }

  // ---- Stall watchdog ---------------------------------------------------

  private ensureStallWatchdog(): void {
    if (this.stallWatchdogHandle) { return; }
    this.stallWatchdogHandle = setInterval(() => {
      const now = Date.now();
      let anyActive = false;
      for (const [id, active] of this.activeTasks) {
        if (active.paused) { continue; }
        anyActive = true;
        const last = active.lastProgressAt ?? active.createdAt;
        if (now - last > STALL_THRESHOLD_MS) {
          this.autoPauseStalled(id).catch(err => {
            console.warn(`auto-pause for ${id} failed:`, err);
          });
        }
      }
      if (!anyActive) { this.stopStallWatchdog(); }
    }, STALL_SCAN_INTERVAL_MS);
  }

  private stopStallWatchdog(): void {
    if (this.stallWatchdogHandle) {
      clearInterval(this.stallWatchdogHandle);
      this.stallWatchdogHandle = null;
    }
  }

  private async autoPauseStalled(id: string): Promise<void> {
    const active = this.activeTasks.get(id);
    if (!active || active.paused) { return; }

    // For direct downloads, check if the file is still growing on disk before
    // declaring it stalled. expo-file-system on Android may stop firing progress
    // events for large files (>40MB) while the download is still healthy.
    if (active.type === 'direct') {
      try {
        const info = await FileSystem.getInfoAsync(active.fileUri);
        const diskSize = (info as any).size;
        if (typeof diskSize === 'number' && diskSize > 0) {
          const prevDiskSize = active.lastDiskSize ?? active.bytesDownloaded;
          active.lastDiskSize = diskSize;
          if (diskSize > prevDiskSize) {
            // File is still growing — update tracking and skip the pause.
            active.bytesDownloaded = diskSize;
            active.lastProgressAt = Date.now();
            active.stallCount = 0;
            const reportedTotal = active.expectedTotalBytes || active.totalBytes || 0;
            this.onProgress?.(id, diskSize, reportedTotal);
            return;
          }
          // Disk size unchanged — increment stall counter but don't pause yet.
          active.stallCount = (active.stallCount ?? 0) + 1;
          if (active.stallCount < 3) {
            return;
          }
        } else {
          // getInfoAsync couldn't read the size (file locked mid-write) — skip.
          return;
        }
      } catch {
        // getInfoAsync threw (file locked or inaccessible mid-write) — skip.
        return;
      }
    }

    // For HLS downloads, also check if the output file is still growing
    // before declaring it stalled. FFmpeg stats callbacks may stop firing
    // while the download is still active.
    if (active.type === 'hls') {
      try {
        const info = await FileSystem.getInfoAsync(active.fileUri);
        const diskSize = (info as any).size;
        if (typeof diskSize === 'number' && diskSize > 0) {
          const prevDiskSize = active.lastDiskSize ?? active.bytesDownloaded;
          active.lastDiskSize = diskSize;
          if (diskSize > prevDiskSize) {
            active.bytesDownloaded = diskSize;
            active.lastProgressAt = Date.now();
            active.stallCount = 0;
            this.onProgress?.(id, diskSize, 0);
            return;
          }
          active.stallCount = (active.stallCount ?? 0) + 1;
          if (active.stallCount < 3) {
            return;
          }
        } else {
          return;
        }
      } catch {
        return;
      }
    }

    active.stallCount = 0;
    active.paused = true;
    if (active.type === 'hls') {
      if (active.ffmpegSessionId !== undefined) {
        const sessionId = active.ffmpegSessionId;
        active.ffmpegSessionId = undefined;
        FFmpegKit.cancel(sessionId);
      }
      this.onStatusChange?.(id, 'paused', undefined, 'Connection lost — tap Resume to continue');
      await this.persistFromActive(id);
      return;
    }
    // direct
    try {
      await active.task?.pauseAsync();
      active.savable = active.task?.savable();
    } catch (err) {
      // pauseAsync may throw if the underlying network is already broken;
      // we still want to persist what we have so resume can be attempted.
      console.warn(`auto-pause pauseAsync failed for ${id}:`, err);
    }
    this.onStatusChange?.(id, 'paused', undefined, 'Connection lost — tap Resume to continue');
    await this.persistFromActive(id);
  }

  private async ensurePrivateFolder(): Promise<string> {
    if (this.privateFolderUri) {
      return this.privateFolderUri;
    }

    const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
    if (!baseDir) {
      throw new Error('No writable file directory available');
    }

    const privateDir = `${baseDir}${this.privateFolderName}`;
    await FileSystem.makeDirectoryAsync(privateDir, { intermediates: true });
    this.privateFolderUri = privateDir;
    return privateDir;
  }

  async initializePrivateFolder(): Promise<string> {
    return this.ensurePrivateFolder();
  }

  private normalizeTimestamp(msOrSeconds?: number | null): number {
    if (!msOrSeconds) {
      return Date.now();
    }
    return msOrSeconds < 1_000_000_000_000 ? Math.round(msOrSeconds * 1000) : Math.round(msOrSeconds);
  }

  private sanitizeProvidedFileName(name: string): string {
    const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
    return cleaned || `file_${Date.now()}`;
  }

  async listPrivateDownloads(): Promise<DownloadTask[]> {
    const privateDir = await this.ensurePrivateFolder();
    const files: DownloadTask[] = [];

    const walk = async (dirPath: string, folderPath: string): Promise<void> => {
      const entries = await FileSystem.readDirectoryAsync(dirPath);

      const infos = await concurrentMap(entries, async entry => {
        const entryPath = `${dirPath}${entry}`;
        const info = await FileSystem.getInfoAsync(entryPath);
        return { entry, entryPath, info };
      }, STAT_CONCURRENCY);

      const subDirs: Array<{ entry: string; entryPath: string }> = [];
      const fileEntries: Array<{ entry: string; entryPath: string; size: number; modificationTime: number }> = [];

      for (const item of infos) {
        if (!item.info.exists) { continue; }
        if (item.info.isDirectory) {
          subDirs.push({ entry: item.entry, entryPath: item.entryPath });
        } else {
          const anyInfo = item.info as any;
          fileEntries.push({
            entry: item.entry,
            entryPath: item.entryPath,
            size: typeof anyInfo.size === 'number' ? anyInfo.size : 0,
            modificationTime: typeof anyInfo.modificationTime === 'number' ? anyInfo.modificationTime : 0,
          });
        }
      }

      const rawTasks = await concurrentMap(fileEntries, async ({ entry, entryPath, size, modificationTime }) => {
        const createdAt = this.normalizeTimestamp(modificationTime);
        const mtime = modificationTime;
        const duration = await probeMediaDuration(entryPath, size, mtime);

        // Corrupted editor exports (failed writes with no moov atom) have undefined
        // duration and will crash Android's MediaMetadataRetriever during thumbnail
        // generation. Delete them automatically — but ONLY in the root folder, never
        // inside trash or any subfolder, since the user expects trashed files to stay
        // until they explicitly purge them. A duration probe in trash can also miss
        // the cache (filePath changes when moved), so a transient undefined here
        // would otherwise wipe the file out from under the user.
        if (
          duration === undefined &&
          folderPath === '' &&
          /^edited_\d+(?:_tmp)?\.(mp4|mov)$/i.test(entry)
        ) {
          try { await FileSystem.deleteAsync(entryPath, { idempotent: true }); } catch { /* ignore */ }
          return null;
        }

        return {
          id: `file_${entryPath}`,
          url: entryPath,
          fileName: entry,
          filePath: entryPath,
          source: 'private' as const,
          folderPath,
          status: 'completed' as const,
          progress: 100,
          bytesDownloaded: size,
          totalBytes: size,
          pageTitle: 'Private file',
          createdAt,
          duration,
        } as DownloadTask;
      }, STAT_CONCURRENCY);
      files.push(...rawTasks.filter((t): t is DownloadTask => t !== null));

      if (IS_SHOW_MANGA_FOLDER) {
        await Promise.all(subDirs
          .map(({ entry, entryPath }) => {
            const childFolderPath = folderPath ? `${folderPath}/${entry}` : entry;
            return walk(`${entryPath}/`, childFolderPath);
          }));
      } else {
        await Promise.all(subDirs
          .filter(({ entry }) => !(folderPath === '' && entry === 'Manga'))
          .map(({ entry, entryPath }) => {
            const childFolderPath = folderPath ? `${folderPath}/${entry}` : entry;
            return walk(`${entryPath}/`, childFolderPath);
          }));
      }
    };

    await walk(privateDir, '');
    void flushDurationCache();
    files.sort((a, b) => b.createdAt - a.createdAt);
    return files;
  }

  async scanDeviceDownloadFolder(): Promise<DeviceFolderScanResult> {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Storage permission is required to read device downloads');
      }

      const scannedFiles: DownloadTask[] = [];
      const scannedFolderSet = new Set<string>();
      const seenAssetIds = new Set<string>();

      const splitPathSegments = (path: string): string[] => {
        return path.split('/').filter(Boolean);
      };

      const getDownloadRelativeFolder = (fileUri: string): string | null => {
        const cleanUri = fileUri.split('?')[0];
        const parts = splitPathSegments(cleanUri);
        const downloadIndex = parts.findIndex(segment => segment.toLowerCase() === 'download');
        if (downloadIndex < 0) {
          return null;
        }
        const afterDownload = parts.slice(downloadIndex + 1);
        if (afterDownload.length <= 1) {
          return '';
        }
        return afterDownload.slice(0, -1).join('/');
      };

      // Fast path: query only the "Download" album instead of iterating through every photo on the device.
      let downloadAlbum: MediaLibrary.Album | null = null;
      try {
        downloadAlbum = await MediaLibrary.getAlbumAsync('Download');
      } catch {
        downloadAlbum = null;
      }

      const albumQuery: MediaLibrary.AssetsOptions['album'] | undefined = downloadAlbum?.id;

      let after: string | undefined;
      while (true) {
        const page = await MediaLibrary.getAssetsAsync({
          first: 1000,
          after,
          mediaType: ['audio', 'video', 'photo', 'unknown'],
          sortBy: [MediaLibrary.SortBy.creationTime],
          ...(albumQuery ? { album: albumQuery } : {}),
        });

        // When using the Download album, all assets are already in scope — skip the path filter.
        // When falling back to full library scan, filter by URI containing "download".
        const candidates = page.assets.filter(asset => {
          if (seenAssetIds.has(asset.id)) { return false; }
          if (albumQuery) { return true; }
          const cleanUri = asset.uri.split('?')[0].toLowerCase();
          return cleanUri.includes('/download/') || cleanUri.includes('/downloads/');
        });

        for (const asset of candidates) {
          seenAssetIds.add(asset.id);

          // Use asset.uri directly — skip getAssetInfoAsync (the per-asset native call that was the bottleneck).
          // asset.uri is already a file:// path on Android for files in shared storage.
          const filePath = asset.uri;
          const folderPath = getDownloadRelativeFolder(filePath);
          if (folderPath === null) { continue; }

          if (folderPath) {
            const folderParts = folderPath.split('/').filter(Boolean);
            for (let i = 0; i < folderParts.length; i++) {
              const nestedPath = folderParts.slice(0, i + 1).join('/');
              scannedFolderSet.add(nestedPath);
            }
          }

          const fileName = asset.filename || filePath.split('/').pop() || `device_${asset.id}`;

          scannedFiles.push({
            id: `device_${asset.id}`,
            url: filePath,
            fileName,
            filePath,
            source: 'device',
            folderPath,
            status: 'completed',
            progress: 100,
            bytesDownloaded: 0,
            totalBytes: 0,
            pageTitle: 'Device Download',
            createdAt: this.normalizeTimestamp(asset.creationTime),
            duration: asset.duration > 0 ? Math.round(asset.duration * 1000) : undefined,
          });
        }

        if (!page.hasNextPage || !page.endCursor) {
          break;
        }
        after = page.endCursor;
      }

      scannedFiles.sort((a, b) => b.createdAt - a.createdAt);
      const scannedFolders = Array.from(scannedFolderSet).sort((a, b) => a.localeCompare(b));

      return {
        files: scannedFiles,
        folders: scannedFolders,
      };
    } catch (err) {
      console.warn('Failed to scan device downloads without SAF picker:', err);
      throw err;
    }
  }

  async listPrivateFolders(): Promise<string[]> {
    const privateDir = await this.ensurePrivateFolder();
    const folders: string[] = [];

    const walk = async (dirPath: string, parentFolderPath: string): Promise<void> => {
      const entries = await FileSystem.readDirectoryAsync(dirPath);

      for (const entry of entries) {
        const entryPath = `${dirPath}${entry}`;
        const info = await FileSystem.getInfoAsync(entryPath);
        if (!info.exists || !info.isDirectory) {
          continue;
        }

        const folderPath = parentFolderPath ? `${parentFolderPath}/${entry}` : entry;
        folders.push(folderPath);
        await walk(`${entryPath}/`, folderPath);
      }
    };

    await walk(privateDir, '');

    folders.sort((a, b) => a.localeCompare(b));
    if (IS_SHOW_MANGA_FOLDER) return folders;
    return folders.filter(f => f !== 'Manga' && !f.startsWith('Manga/'));
  }

  async createPrivateFolder(folderPath: string): Promise<string> {
    const privateDir = await this.ensurePrivateFolder();
    const safePath = this.sanitizeFolderPath(folderPath);
    if (!safePath) {
      throw new Error('Folder name cannot be empty');
    }

    const targetPath = `${privateDir}${safePath}/`;
    const existing = await FileSystem.getInfoAsync(targetPath);
    if (existing.exists) {
      throw new Error('Folder already exists');
    }

    await FileSystem.makeDirectoryAsync(targetPath, { intermediates: true });
    return targetPath;
  }

  async renamePrivateFolder(folderPath: string, newFolderName: string): Promise<string> {
    const privateDir = await this.ensurePrivateFolder();
    const safeCurrentPath = this.sanitizeFolderPath(folderPath);
    const safeNewName = this.sanitizeFolderName(newFolderName);

    if (!safeCurrentPath || !safeNewName) {
      throw new Error('Folder name cannot be empty');
    }

    const slashIndex = safeCurrentPath.lastIndexOf('/');
    const parentPath = slashIndex >= 0 ? safeCurrentPath.substring(0, slashIndex) : '';
    const currentName = slashIndex >= 0 ? safeCurrentPath.substring(slashIndex + 1) : safeCurrentPath;

    if (currentName === safeNewName) {
      return `${privateDir}${safeCurrentPath}/`;
    }

    const currentPath = `${privateDir}${safeCurrentPath}/`;
    const nextRelativePath = parentPath ? `${parentPath}/${safeNewName}` : safeNewName;
    const nextPath = `${privateDir}${nextRelativePath}/`;

    const currentInfo = await FileSystem.getInfoAsync(currentPath);
    if (!currentInfo.exists || !currentInfo.isDirectory) {
      throw new Error('Folder not found');
    }

    const nextInfo = await FileSystem.getInfoAsync(nextPath);
    if (nextInfo.exists) {
      throw new Error('A folder with this name already exists');
    }

    await FileSystem.moveAsync({ from: currentPath, to: nextPath });
    return nextPath;
  }

  async deletePrivateFolder(folderPath: string, force = false): Promise<void> {
    const privateDir = await this.ensurePrivateFolder();
    const safePath = this.sanitizeFolderPath(folderPath);
    if (!safePath) {
      throw new Error('Folder name cannot be empty');
    }

    const targetPath = `${privateDir}${safePath}/`;
    const folderInfo = await FileSystem.getInfoAsync(targetPath);
    if (!folderInfo.exists) {
      return;
    }
    if (!folderInfo.isDirectory) {
      throw new Error('Invalid folder');
    }

    const entries = await FileSystem.readDirectoryAsync(targetPath);
    if (entries.length > 0 && !force) {
      throw new Error('Folder is not empty');
    }

    await FileSystem.deleteAsync(targetPath, { idempotent: true });
  }

  private async getUniqueFilePath(filePath: string): Promise<string> {
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists) {
      return filePath;
    }

    const slashIndex = filePath.lastIndexOf('/');
    const dirPath = filePath.substring(0, slashIndex + 1);
    const fileName = filePath.substring(slashIndex + 1);
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.substring(dotIndex) : '';

    let attempt = 1;
    while (true) {
      const candidate = `${dirPath}${baseName} (${attempt})${extension}`;
      const candidateInfo = await FileSystem.getInfoAsync(candidate);
      if (!candidateInfo.exists) {
        return candidate;
      }
      attempt += 1;
    }
  }

  async movePrivateFileToFolder(filePath: string, folderPath?: string | null): Promise<string> {
    const privateDir = await this.ensurePrivateFolder();
    const fileName = filePath.split('/').pop();
    if (!fileName) {
      throw new Error('Invalid file path');
    }

    let targetDir = privateDir;
    if (folderPath && folderPath.trim()) {
      const safeFolderPath = this.sanitizeFolderPath(folderPath);
      if (!safeFolderPath) {
        throw new Error('Folder name cannot be empty');
      }
      targetDir = `${privateDir}${safeFolderPath}/`;
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
    }

    const targetPath = await this.getUniqueFilePath(`${targetDir}${fileName}`);
    if (targetPath === filePath) {
      return filePath;
    }

    await FileSystem.moveAsync({ from: filePath, to: targetPath });
    return targetPath;
  }

  async copyDeviceFileToPrivateFolder(
    filePath: string,
    folderPath?: string | null,
    fileName?: string,
    assetId?: string | null,
  ): Promise<string> {
    const privateDir = await this.ensurePrivateFolder();
    // filePath may be a content:// URI (e.g. content://media/external/video/media/12345)
    // whose last path segment is just the numeric asset ID, not the real filename.
    // Callers should pass fileName explicitly when the path doesn't encode the name.
    const resolvedFileName = fileName || filePath.split('/').pop();
    if (!resolvedFileName) {
      throw new Error('Invalid file path');
    }

    let targetDir = privateDir;
    if (folderPath && folderPath.trim()) {
      const safeFolderPath = this.sanitizeFolderPath(folderPath);
      if (!safeFolderPath) {
        throw new Error('Folder name cannot be empty');
      }
      targetDir = `${privateDir}${safeFolderPath}/`;
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
    }

    // Resolve the source path via MediaLibrary when we have an assetId.
    // The original filePath (whether content:// or file://) may not be directly
    // readable by FileSystem.copyAsync on all Android versions.
    let sourcePath = filePath;
    if (assetId) {
      try {
        const assetInfo = await MediaLibrary.getAssetInfoAsync(assetId);
        const resolvedUri = assetInfo.localUri || (assetInfo as any).uri;
        if (resolvedUri) {
          sourcePath = resolvedUri;
        }
      } catch {
        // If resolution fails, fall back to the original filePath.
      }
    }

    const targetPath = await this.getUniqueFilePath(`${targetDir}${resolvedFileName}`);
    await FileSystem.copyAsync({ from: sourcePath, to: targetPath });
    return targetPath;
  }

  async copyPrivateFileToDeviceDownload(filePath: string): Promise<void> {
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Storage permission is required to copy file to device download folder');
    }

    const sourceInfo = await FileSystem.getInfoAsync(filePath);
    if (!sourceInfo.exists || sourceInfo.isDirectory) {
      throw new Error('Invalid file path');
    }

    const asset = await MediaLibrary.createAssetAsync(filePath);
    const albumName = 'Download';
    const existingAlbum = await MediaLibrary.getAlbumAsync(albumName);

    if (existingAlbum) {
      await MediaLibrary.addAssetsToAlbumAsync([asset], existingAlbum, false);
    } else {
      await MediaLibrary.createAlbumAsync(albumName, asset, false);
    }
  }

  readonly trashFolderName = '__trash__';

  async movePrivateFileToTrash(filePath: string): Promise<string> {
    const privateDir = await this.ensurePrivateFolder();
    const trashDir = `${privateDir}${this.trashFolderName}/`;
    await FileSystem.makeDirectoryAsync(trashDir, { intermediates: true });
    const fileName = filePath.split('/').pop();
    if (!fileName) { throw new Error('Invalid file path'); }
    const targetPath = await this.getUniqueFilePath(`${trashDir}${fileName}`);
    await FileSystem.moveAsync({ from: filePath, to: targetPath });
    return targetPath;
  }

  async deletePrivateFile(filePath: string): Promise<void> {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
  }

  async renamePrivateFile(filePath: string, newFileName: string): Promise<string> {
    const privateDir = await this.ensurePrivateFolder();
    const safeName = this.sanitizeProvidedFileName(newFileName);
    const newPath = `${privateDir}${safeName}`;
    await FileSystem.moveAsync({ from: filePath, to: newPath });
    return newPath;
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

  private isHlsUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes('.m3u8') || lower.includes('m3u8');
  }

  // HEAD pre-flight so we know the real Content-Length even when the GET
  // progress callback doesn't surface it (chunked transfer, some CDNs).
  // Returns 0 if the size can't be determined — caller treats that as
  // "unverifiable" rather than "zero bytes".
  private async fetchExpectedContentLength(url: string, headers: Record<string, string>): Promise<number> {
    try {
      const response = await fetch(url, { method: 'HEAD', headers });
      const value = response.headers.get('Content-Length') || response.headers.get('content-length');
      if (value) {
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && n > 0) {
          return n;
        }
      }
    } catch { /* network error or HEAD not supported — fall back */ }
    return 0;
  }

  async startDownload(
    id: string,
    url: string,
    pageTitle: string,
    pageUrl?: string,
    cookies?: string,
    hlsInfo?: HlsMasterInfo,
    selectedVariant?: HlsVariant,
  ): Promise<string> {
    // Use HLS download if URL is m3u8 OR if hlsInfo exists (even with empty variants)
    if (this.isHlsUrl(url) || hlsInfo) {
      return this.startHlsDownload(id, url, pageTitle, pageUrl, cookies, hlsInfo, selectedVariant);
    }

    const fileName = this.sanitizeFileName(url, pageTitle);
    const privateDir = await this.ensurePrivateFolder();
    const destPath = `${privateDir}${fileName}`;

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

    // Capture the real expected size up front so we can detect a truncated
    // download even when the server doesn't send Content-Length on the GET.
    const expectedTotalBytes = await this.fetchExpectedContentLength(url, headers);

    const progressCb = this.makeProgressCallback(id, expectedTotalBytes);
    const task = FileSystem.createDownloadResumable(url, destPath, { headers }, progressCb);

    const createdAt = Date.now();
    this.activeTasks.set(id, {
      type: 'direct',
      task,
      url,
      fileUri: destPath,
      fileName,
      bytesDownloaded: 0,
      totalBytes: 0,
      expectedTotalBytes,
      lastProgressAt: createdAt,
      requestHeaders: headers,
      createdAt,
      pageTitle,
      pageUrl,
      cookies,
    });

    void upsertPersistedDownload({
      id,
      type: 'direct',
      url,
      fileUri: destPath,
      fileName,
      pageTitle,
      pageUrl,
      cookies,
      expectedTotalBytes,
      bytesDownloaded: 0,
      createdAt,
      status: 'paused',
      savable: task.savable(),
    });

    this.ensureStallWatchdog();
    return this.runTask(id);
  }

  // Factored out so the resume-from-savable path can wire the same callback.
  private makeProgressCallback(id: string, expectedTotalBytes: number) {
    return (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
      const received = progress.totalBytesWritten || 0;
      const total = progress.totalBytesExpectedToWrite || 0;

      const active = this.activeTasks.get(id);
      if (active) {
        active.bytesDownloaded = received;
        active.totalBytes = total;
        active.lastProgressAt = Date.now();
      }

      const reportedTotal = total > 0 ? total : expectedTotalBytes;
      this.onProgress?.(id, received, reportedTotal);
      this.schedulePersistProgress(id);
    };
  }

  // ===== HLS (.m3u8) Download via FFmpegKit =====

  private resolveHlsUri(base: string, uri: string): string {
    if (/^https?:\/\//i.test(uri)) return uri;
    try {
      const { origin } = new URL(base);
      return uri.startsWith('/') ? `${origin}${uri}` : `${base.replace(/\/[^/]*$/, '/')}${uri}`;
    } catch {
      return uri;
    }
  }

  private async startHlsDownload(
    id: string,
    url: string,
    pageTitle: string,
    pageUrl?: string,
    cookies?: string,
    hslInfo?: HlsMasterInfo,
    selectedVariant?: HlsVariant,
  ): Promise<string> {
    const privateDir = await this.ensurePrivateFolder();

    this.onStatusChange?.(id, 'downloading');
    this.onProgress?.(id, 0, 0);

    const safe = (pageTitle || 'video')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 40);
    const outputPath = `${privateDir}${safe}_${Date.now()}.mp4`;
    const outputFsPath = outputPath.replace(/^file:\/\//, '');

    // Build headers argument
    const headerLines = [
      'User-Agent: Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    ];
    if (pageUrl) {
      headerLines.push(`Referer: ${pageUrl}`);
      try { headerLines.push(`Origin: ${new URL(pageUrl).origin}`); } catch {}
    }
    if (cookies) {
      headerLines.push(`Cookie: ${cookies}`);
    }
    const headersValue = headerLines.join('\r\n') + '\r\n';

    let args: string[];
    if (hslInfo && hslInfo.variants.length > 0) {
      const best = selectedVariant ?? hslInfo.variants.reduce((a, b) => b.bandwidth > a.bandwidth ? b : a);
      const videoUrl = this.resolveHlsUri(url, best.uri);

      const audioTrack = best.audio
        ? hslInfo.audioTracks.find(t => t.groupId === best.audio && t.uri)
        : undefined;

      if (audioTrack?.uri) {
        const audioUrl = this.resolveHlsUri(url, audioTrack.uri);
        args = [
          '-headers', headersValue,
          '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
          '-i', videoUrl,
          '-headers', headersValue,
          '-i', audioUrl,
          '-map', '0:v',
          '-map', '1:a',
          '-c', 'copy',
          '-y',
          outputFsPath,
        ];
      } else {
        args = [
          '-headers', headersValue,
          '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
          '-i', videoUrl,
          '-c', 'copy',
          '-y',
          outputFsPath,
        ];
      }
    } else {
      args = [
        '-headers', headersValue,
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
        '-i', url,
        '-c', 'copy',
        '-y',
        outputFsPath,
      ];
    }

    try {
      let resolveCompletion!: () => void;
      let rejectCompletion!: (err: Error) => void;
      const done = new Promise<void>((res, rej) => {
        resolveCompletion = res;
        rejectCompletion = rej;
      });

      const session = await FFmpegKit.executeWithArgumentsAsync(
        args,
        async (s) => {
          const rc = await s.getReturnCode();
          if (ReturnCode.isSuccess(rc)) {
            resolveCompletion();
          } else if (ReturnCode.isCancel(rc)) {
            rejectCompletion(new Error('cancelled'));
          } else {
            const logs = await s.getAllLogsAsString();
            rejectCompletion(new Error(logs?.slice(-300) || 'FFmpeg failed'));
          }
        },
        undefined,
        (stats) => {
          const size = stats.getSize();
          const active = this.activeTasks.get(id);
          if (active) {
            active.bytesDownloaded = size;
            active.lastProgressAt = Date.now();
          }
          this.onProgress?.(id, size, 0);
        },
      );

      const createdAt = Date.now();
      this.activeTasks.set(id, {
        type: 'hls',
        ffmpegSessionId: session.getSessionId(),
        url,
        fileUri: outputPath,
        fileName: outputPath.split('/').pop() || '',
        bytesDownloaded: 0,
        totalBytes: 0,
        lastProgressAt: createdAt,
        createdAt,
        // Preserve original args so pauseDownload can keep the task alive and
        // resumeDownload can restart the FFmpeg job with the same parameters.
        pageTitle,
        pageUrl,
        cookies,
        hlsInfo: hslInfo,
        selectedVariant,
      });

      void upsertPersistedDownload({
        id,
        type: 'hls',
        url,
        fileUri: outputPath,
        fileName: outputPath.split('/').pop() || '',
        pageTitle,
        pageUrl,
        cookies,
        expectedTotalBytes: 0,
        bytesDownloaded: 0,
        createdAt,
        status: 'paused',
        hlsInfo: hslInfo,
        selectedVariant,
      });

      this.ensureStallWatchdog();

      await done;

      this.activeTasks.delete(id);
      this.clearPersistTimer(id);
      void removePersistedDownload(id);
      this.onStatusChange?.(id, 'completed', outputPath);
      return outputPath;
    } catch (err: any) {
      await FileSystem.deleteAsync(outputPath, { idempotent: true }).catch(() => {});
      const stillActive = this.activeTasks.get(id);
      if (stillActive?.paused) {
        // Pause path: status is already 'paused' and the task record stays in
        // the map so resumeDownload can restart it.
        return '';
      }
      if (err?.message === 'cancelled') {
        this.activeTasks.delete(id);
        this.clearPersistTimer(id);
        void removePersistedDownload(id);
        this.onStatusChange?.(id, 'cancelled');
        return '';
      }
      console.error('[HLS-FFmpeg] download failed:', err?.message);
      this.activeTasks.delete(id);
      this.clearPersistTimer(id);
      void removePersistedDownload(id);
      this.onStatusChange?.(id, 'failed', undefined, err?.message || 'HLS download failed');
      throw err;
    }
  }

  // On Android, expo-file-system can resolve downloadAsync()/resumeAsync()
  // successfully with a truncated body when the underlying HTTP connection
  // drops mid-stream (e.g. airplane mode toggled). We verify against the
  // best-known expected size and the on-disk size.
  private async verifyDownloadComplete(
    uri: string,
    expectedBytes: number,
    lastReceivedBytes: number,
  ): Promise<{ ok: boolean; actualBytes: number; expectedBytes: number }> {
    let actualBytes = lastReceivedBytes;
    try {
      const info = await FileSystem.getInfoAsync(uri);
      const sizeFromDisk = (info as any).size;
      if (typeof sizeFromDisk === 'number' && sizeFromDisk > 0) {
        actualBytes = sizeFromDisk;
      }
    } catch { /* fall back to progress-reported bytes */ }

    // If we genuinely have no expected size, we can't verify — accept it.
    if (expectedBytes <= 0) {
      return { ok: true, actualBytes, expectedBytes };
    }
    return { ok: actualBytes >= expectedBytes, actualBytes, expectedBytes };
  }

  private async finalizeDownload(
    id: string,
    uri: string,
    expectedBytes: number,
    lastReceivedBytes: number,
    autoResumeAttempt: number = 0,
  ): Promise<string> {
    const verification = await this.verifyDownloadComplete(uri, expectedBytes, lastReceivedBytes);
    if (!verification.ok) {
      const active = this.activeTasks.get(id);

      // Auto-resume up to 5 times when the download is truncated.
      // expo-file-system on Android resolves downloadAsync early for large files;
      // resuming picks up from the partial bytes already on disk.
      if (active && autoResumeAttempt < 5) {
        console.log(`[Download] Auto-resuming ${id}: got ${verification.actualBytes}/${verification.expectedBytes} bytes (attempt ${autoResumeAttempt + 1})`);
        active.bytesDownloaded = verification.actualBytes;
        active.lastProgressAt = Date.now();
        active.stallCount = 0;
        try { active.savable = active.task?.savable(); } catch { /* ignore */ }

        // Reconstruct the resumable from the current state
        const headers = active.requestHeaders ?? active.savable?.options?.headers ?? {};
        const progressCb = this.makeProgressCallback(id, active.expectedTotalBytes ?? 0);
        const resumeData = active.savable?.resumeData;
        const reconstructed = FileSystem.createDownloadResumable(
          active.url,
          active.fileUri,
          { headers },
          progressCb,
          resumeData,
        );
        active.task = reconstructed;
        active.paused = false;

        try {
          const result = resumeData
            ? await reconstructed.resumeAsync()
            : await reconstructed.downloadAsync();
          if (!result?.uri) {
            throw new Error('Download was cancelled during auto-resume');
          }
          return await this.finalizeDownload(id, result.uri, expectedBytes, active.bytesDownloaded, autoResumeAttempt + 1);
        } catch (resumeErr: any) {
          if (active.paused) { return ''; }
          if (resumeErr?.message?.includes('cancel')) {
            this.activeTasks.delete(id);
            this.clearPersistTimer(id);
            void removePersistedDownload(id);
            this.onStatusChange?.(id, 'cancelled');
            return '';
          }
          // Fall through to pause if resume itself fails
        }
      }

      // All auto-resume attempts exhausted or no active task — pause for manual retry.
      if (active) {
        active.paused = true;
        active.bytesDownloaded = verification.actualBytes;
        try { active.savable = active.task?.savable(); } catch { /* ignore */ }
      }
      await this.persistFromActive(id);
      const msg = `Download incomplete: received ${verification.actualBytes} of ${verification.expectedBytes} bytes — tap Resume to continue`;
      this.onStatusChange?.(id, 'paused', undefined, msg);
      throw new Error(msg);
    }

    this.activeTasks.delete(id);
    this.clearPersistTimer(id);
    void removePersistedDownload(id);
    this.onStatusChange?.(id, 'completed', uri);
    return uri;
  }

  // Prefer the HEAD-derived expected size over the progress-reported one
  // because some servers don't include Content-Length in GET responses.
  private resolveExpectedBytes(active: ActiveTask): number {
    if (active.expectedTotalBytes && active.expectedTotalBytes > 0) {
      return active.expectedTotalBytes;
    }
    return active.totalBytes;
  }

  private async runTask(id: string): Promise<string> {
    const active = this.activeTasks.get(id);
    if (!active) {
      throw new Error('Download task not found');
    }

    try {
      const result = await active.task!.downloadAsync();
      if (!result?.uri) {
        throw new Error('Download was cancelled');
      }

      return await this.finalizeDownload(id, result.uri, this.resolveExpectedBytes(active), active.bytesDownloaded);
    } catch (err: any) {
      const current = this.activeTasks.get(id);
      if (current?.paused) {
        return '';
      }
      if (err?.message?.includes('cancel')) {
        this.activeTasks.delete(id);
        this.clearPersistTimer(id);
        void removePersistedDownload(id);
        this.onStatusChange?.(id, 'cancelled');
        return '';
      }
      this.activeTasks.delete(id);
      this.clearPersistTimer(id);
      void removePersistedDownload(id);
      this.onStatusChange?.(id, 'failed', undefined, err?.message || 'Download failed');
      throw err;
    }
  }

  pauseDownload(id: string): void {
    const active = this.activeTasks.get(id);
    if (!active) { return; }
    active.paused = true;
    if (active.type === 'hls') {
      if (active.ffmpegSessionId !== undefined) {
        const sessionId = active.ffmpegSessionId;
        active.ffmpegSessionId = undefined;
        FFmpegKit.cancel(sessionId);
        FileSystem.deleteAsync(active.fileUri, { idempotent: true }).catch(() => {});
      }
      this.onStatusChange?.(id, 'paused');
      void this.persistFromActive(id);
      return;
    }
    this.onStatusChange?.(id, 'paused');
    // Wait for pauseAsync so savable() captures the resumeData, then persist.
    (async () => {
      try {
        await active.task?.pauseAsync();
        active.savable = active.task?.savable();
      } catch (err) {
        console.log(`Paused download ${id} (pauseAsync threw)`, err);
      }
      await this.persistFromActive(id);
    })();
  }

  async resumeDownload(id: string): Promise<string> {
    const active = this.activeTasks.get(id);
    if (!active) {
      throw new Error('No paused task found for this download');
    }

    // HLS: restart FFmpeg from scratch with the stored args.
    if (active.type === 'hls') {
      const { url, pageTitle, pageUrl, cookies, hlsInfo, selectedVariant } = active;
      this.activeTasks.delete(id);
      this.clearPersistTimer(id);
      return this.startHlsDownload(id, url, pageTitle, pageUrl, cookies, hlsInfo, selectedVariant);
    }

    // Direct: if the in-memory task is gone (e.g. restored from persistence),
    // reconstruct the DownloadResumable from the saved state.
    if (!active.task) {
      const headers = active.requestHeaders ?? active.savable?.options?.headers ?? {};
      const resumeData = active.savable?.resumeData;
      const progressCb = this.makeProgressCallback(id, active.expectedTotalBytes ?? 0);
      const reconstructed = FileSystem.createDownloadResumable(
        active.url,
        active.fileUri,
        { headers },
        progressCb,
        resumeData,
      );
      active.task = reconstructed;
    }

    active.paused = false;
    active.lastProgressAt = Date.now();
    this.onStatusChange?.(id, 'downloading');
    this.ensureStallWatchdog();

    // If there's no resumeData (truncation-detected case or never-paused),
    // calling resumeAsync would no-op or fail — fall back to fresh download.
    const hasResumeData = !!active.savable?.resumeData;
    if (hasResumeData) {
      return this.runResumeTask(id);
    }
    return this.runTask(id);
  }

  private async runResumeTask(id: string): Promise<string> {
    const active = this.activeTasks.get(id);
    if (!active) {
      throw new Error('Download task not found');
    }

    try {
      const result = await active.task!.resumeAsync();
      if (!result?.uri) {
        throw new Error('Download was cancelled');
      }

      return await this.finalizeDownload(id, result.uri, this.resolveExpectedBytes(active), active.bytesDownloaded);
    } catch (err: any) {
      const current = this.activeTasks.get(id);
      if (current?.paused) {
        return '';
      }
      if (err?.message?.includes('cancel')) {
        this.activeTasks.delete(id);
        this.clearPersistTimer(id);
        void removePersistedDownload(id);
        this.onStatusChange?.(id, 'cancelled');
        return '';
      }
      this.activeTasks.delete(id);
      this.clearPersistTimer(id);
      void removePersistedDownload(id);
      this.onStatusChange?.(id, 'failed', undefined, err?.message || 'Resume failed');
      throw err;
    }
  }

  cancelDownload(id: string): void {
    const active = this.activeTasks.get(id);
    if (active) {
      if (active.ffmpegSessionId !== undefined) {
        FFmpegKit.cancel(active.ffmpegSessionId);
      } else {
        active.task?.cancelAsync().catch(() => {});
      }
      // Delete partial bytes so a stale file doesn't survive across restarts.
      FileSystem.deleteAsync(active.fileUri, { idempotent: true }).catch(() => {});
      this.activeTasks.delete(id);
    }
    this.clearPersistTimer(id);
    void removePersistedDownload(id);
    this.onStatusChange?.(id, 'cancelled');
  }

  isActive(id: string): boolean {
    return this.activeTasks.has(id);
  }

  getActiveFileUris(): Set<string> {
    const uris = new Set<string>();
    for (const task of this.activeTasks.values()) {
      uris.add(task.fileUri);
      uris.add(task.fileUri.replace(/^file:\/\//, ''));
    }
    return uris;
  }

  // Loads paused records from AsyncStorage and re-creates in-memory ActiveTask
  // entries for each, ready to be resumed by the user. Returns DownloadTask
  // snapshots for the store to merge into the visible list.
  async restorePersistedDownloads(): Promise<DownloadTask[]> {
    const cache = await loadPersistedDownloads();
    const restored: DownloadTask[] = [];

    for (const record of Object.values(cache)) {
      // Skip records whose partial file was wiped from disk (e.g. user cleared
      // app storage). Otherwise resume would fail in confusing ways.
      let existingBytes = 0;
      try {
        const info = await FileSystem.getInfoAsync(record.fileUri);
        if (info.exists && !info.isDirectory) {
          const anyInfo = info as any;
          if (typeof anyInfo.size === 'number') { existingBytes = anyInfo.size; }
        } else if (record.type === 'direct' && record.bytesDownloaded > 0) {
          // Partial expected but missing — drop the orphaned record.
          await removePersistedDownload(record.id);
          continue;
        }
      } catch { /* best effort */ }

      if (this.activeTasks.has(record.id)) {
        // Already restored (e.g. duplicate call) — skip.
        continue;
      }

      if (record.type === 'direct') {
        const headers = record.savable?.options?.headers ?? {};
        // Defer creating the DownloadResumable until the user taps Resume:
        // savable() may not be present yet (e.g. crash before first pause),
        // and we don't want to fire any network calls on app start.
        this.activeTasks.set(record.id, {
          type: 'direct',
          url: record.url,
          fileUri: record.fileUri,
          fileName: record.fileName,
          bytesDownloaded: existingBytes || record.bytesDownloaded,
          totalBytes: record.expectedTotalBytes,
          expectedTotalBytes: record.expectedTotalBytes,
          requestHeaders: headers as Record<string, string>,
          savable: record.savable,
          paused: true,
          createdAt: record.createdAt,
          pageTitle: record.pageTitle,
          pageUrl: record.pageUrl,
          cookies: record.cookies,
        });
      } else {
        this.activeTasks.set(record.id, {
          type: 'hls',
          url: record.url,
          fileUri: record.fileUri,
          fileName: record.fileName,
          bytesDownloaded: 0,
          totalBytes: 0,
          paused: true,
          createdAt: record.createdAt,
          pageTitle: record.pageTitle,
          pageUrl: record.pageUrl,
          cookies: record.cookies,
          hlsInfo: record.hlsInfo,
          selectedVariant: record.selectedVariant,
        });
      }

      const sizeForTask = existingBytes || record.bytesDownloaded;
      const totalForTask = record.expectedTotalBytes || sizeForTask;
      const progress = totalForTask > 0 ? Math.min(99, Math.round((sizeForTask / totalForTask) * 100)) : 0;
      restored.push({
        id: record.id,
        url: record.url,
        fileName: record.fileName,
        filePath: record.fileUri,
        status: 'paused',
        progress,
        bytesDownloaded: sizeForTask,
        totalBytes: totalForTask,
        pageTitle: record.pageTitle,
        createdAt: record.createdAt,
        error: 'Paused — tap Resume to continue',
      });
    }

    return restored;
  }

  async saveBlobData(
    id: string,
    pageTitle: string,
    base64Data: string,
  ): Promise<string> {
    const safe = (pageTitle || 'video')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 40);
    const fileName = `${safe}_${Date.now()}.mp4`;
    const privateDir = await this.ensurePrivateFolder();
    const destPath = `${privateDir}${fileName}`;

    this.onStatusChange?.(id, 'downloading');

    try {
      await FileSystem.writeAsStringAsync(destPath, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

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
