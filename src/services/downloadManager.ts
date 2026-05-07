import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FFmpegKit, ReturnCode } from '@wokcito/ffmpeg-kit-react-native';
import { DownloadTask, HlsMasterInfo, HlsVariant } from '../types';

const MEDIA_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', '3gp', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);

const DURATION_CACHE_KEY = '@media_duration_cache_v1';
let durationCache: Record<string, number> | null = null;
let durationCacheDirty = false;

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

// Cap concurrent media-decoder loads. Each Audio.Sound allocates a native decoder;
// running 100s in parallel exhausts memory and crashes the app on Android.
const PROBE_CONCURRENCY = 2;
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
  try {
    const sound = new Audio.Sound();
    try {
      await sound.loadAsync({ uri: filePath }, {}, false);
      const status = await sound.getStatusAsync();
      await sound.unloadAsync();
      if (status.isLoaded && status.durationMillis != null) {
        cache[key] = status.durationMillis;
        durationCacheDirty = true;
        return status.durationMillis;
      }
    } catch {
      // best effort — make sure we still unload if loadAsync partially succeeded
      try { await sound.unloadAsync(); } catch { /* ignore */ }
    }
  } finally {
    releaseProbeSlot();
  }

  cache[key] = 0; // remember failures to skip them next time
  durationCacheDirty = true;
  return undefined;
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
  task?: FileSystem.DownloadResumable;
  ffmpegSessionId?: number;
  url: string;
  fileUri: string;
  bytesDownloaded: number;
  totalBytes: number;
}

interface DeviceFolderScanResult {
  files: DownloadTask[];
  folders: string[];
}

class DownloadManager {
  private activeTasks: Map<string, ActiveTask> = new Map();
  private onProgress: ProgressCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private readonly privateFolderName = 'private_downloads/';
  private privateFolderUri: string | null = null;

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

      const infos = await Promise.all(entries.map(async entry => {
        const entryPath = `${dirPath}${entry}`;
        const info = await FileSystem.getInfoAsync(entryPath);
        return { entry, entryPath, info };
      }));

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

      const fileTasks = await Promise.all(fileEntries.map(async ({ entry, entryPath, size, modificationTime }) => {
        const createdAt = this.normalizeTimestamp(modificationTime);
        const mtime = modificationTime;
        const duration = await probeMediaDuration(entryPath, size, mtime);
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
        };
      }));
      files.push(...fileTasks);

      await Promise.all(subDirs.map(({ entry, entryPath }) => {
        const childFolderPath = folderPath ? `${folderPath}/${entry}` : entry;
        return walk(`${entryPath}/`, childFolderPath);
      }));
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
    return folders;
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
  ): Promise<string> {
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
    await FileSystem.copyAsync({ from: filePath, to: targetPath });
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

  async startDownload(
    id: string,
    url: string,
    pageTitle: string,
    pageUrl?: string,
    cookies?: string,
    hlsInfo?: HlsMasterInfo,
    selectedVariant?: HlsVariant,
  ): Promise<string> {
    if (this.isHlsUrl(url) || (hlsInfo?.variants && hlsInfo.variants.length > 0)) {
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
          this.onProgress?.(id, stats.getSize(), 0);
        },
      );

      this.activeTasks.set(id, {
        ffmpegSessionId: session.getSessionId(),
        url,
        fileUri: outputPath,
        bytesDownloaded: 0,
        totalBytes: 0,
      });

      await done;

      this.activeTasks.delete(id);
      this.onStatusChange?.(id, 'completed', outputPath);
      return outputPath;
    } catch (err: any) {
      await FileSystem.deleteAsync(outputPath, { idempotent: true }).catch(() => {});
      if (err?.message === 'cancelled') {
        this.activeTasks.delete(id);
        this.onStatusChange?.(id, 'cancelled');
        return '';
      }
      console.error('[HLS-FFmpeg] download failed:', err?.message);
      this.onStatusChange?.(id, 'failed', undefined, err?.message || 'HLS download failed');
      throw err;
    }
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
      if (active.ffmpegSessionId !== undefined) {
        // FFmpeg doesn't support pause; cancel instead
        FFmpegKit.cancel(active.ffmpegSessionId);
        this.activeTasks.delete(id);
        this.onStatusChange?.(id, 'cancelled');
        return;
      }
      this.onStatusChange?.(id, 'paused');
      active.task?.pauseAsync().catch((err: unknown) => {
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
      const result = await active.task!.resumeAsync();
      if (!result?.uri) {
        throw new Error('Download was cancelled');
      }

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
      if (active.ffmpegSessionId !== undefined) {
        FFmpegKit.cancel(active.ffmpegSessionId);
      } else {
        active.task?.cancelAsync().catch(() => {});
      }
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
