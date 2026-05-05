import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
// @ts-ignore - mux.js ships its own runtime types separately
import muxjs from 'mux.js';
import { DownloadTask } from '../types';

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

      for (const entry of entries) {
        const entryPath = `${dirPath}${entry}`;
        const info = await FileSystem.getInfoAsync(entryPath);
        if (!info.exists) {
          continue;
        }

        if (info.isDirectory) {
          const childFolderPath = folderPath ? `${folderPath}/${entry}` : entry;
          await walk(`${entryPath}/`, childFolderPath);
          continue;
        }

        const createdAt = this.normalizeTimestamp(info.modificationTime);
        const size = typeof info.size === 'number' ? info.size : 0;

        files.push({
          id: `file_${entryPath}`,
          url: entryPath,
          fileName: entry,
          filePath: entryPath,
          source: 'private',
          folderPath,
          status: 'completed',
          progress: 100,
          bytesDownloaded: size,
          totalBytes: size,
          pageTitle: 'Private file',
          createdAt,
        });
      }
    };

    await walk(privateDir, '');
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
        if (parts[4].toLowerCase() !== 'download') {
          return null;
        }
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

      let after: string | undefined;
      while (true) {
        const page = await MediaLibrary.getAssetsAsync({
          first: 1000,
          after,
          mediaType: ['audio', 'video', 'photo', 'unknown'],
          sortBy: [MediaLibrary.SortBy.creationTime],
        });

        for (const asset of page.assets) {
          if (seenAssetIds.has(asset.id)) {
            continue;
          }
          seenAssetIds.add(asset.id);

          let filePath = asset.uri;
          try {
            const info = await MediaLibrary.getAssetInfoAsync(asset.id);
            if (info.localUri) {
              filePath = info.localUri;
            }
          } catch {
            filePath = asset.uri;
          }

          const folderPath = getDownloadRelativeFolder(filePath);
          if (folderPath === null) {
            continue;
          }

          if (folderPath) {
            const folderParts = folderPath.split('/').filter(Boolean);
            for (let i = 0; i < folderParts.length; i++) {
              const nestedPath = folderParts.slice(0, i + 1).join('/');
              scannedFolderSet.add(nestedPath);
            }
          }

          const fileName = asset.filename || filePath.split('/').pop() || `device_${asset.id}`;
          let sizeBytes = 0;
          try {
            const fileInfo = await FileSystem.getInfoAsync(filePath);
            if (fileInfo.exists && typeof fileInfo.size === 'number') {
              sizeBytes = fileInfo.size;
            }
          } catch {
            sizeBytes = 0;
          }

          scannedFiles.push({
            id: `device_${asset.id}`,
            url: filePath,
            fileName,
            filePath,
            source: 'device',
            folderPath,
            status: 'completed',
            progress: 100,
            bytesDownloaded: sizeBytes,
            totalBytes: sizeBytes,
            pageTitle: 'Device Download',
            createdAt: this.normalizeTimestamp(asset.creationTime),
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
  ): Promise<string> {
    if (this.isHlsUrl(url)) {
      return this.startHlsDownload(id, url, pageTitle, pageUrl, cookies);
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

  // ===== HLS (.m3u8) Download =====

  private buildHeaders(pageUrl?: string, cookies?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    };
    if (pageUrl) {
      headers['Referer'] = pageUrl;
      try {
        headers['Origin'] = new URL(pageUrl).origin;
      } catch {}
    }
    if (cookies) {
      headers['Cookie'] = cookies;
    }
    return headers;
  }

  private resolveUrl(segmentUrl: string, baseUrl: string): string {
    try {
      return new URL(segmentUrl, baseUrl).href;
    } catch {
      return segmentUrl;
    }
  }

  private parseM3u8(content: string, baseUrl: string): {
    isMaster: boolean;
    segments: string[];
    bestVariant?: string;
    initUri?: string;
    audioRenditions: { groupId: string; name: string; isDefault: boolean; uri?: string }[];
    bestVariantAudioGroup?: string;
  } {
    const lines = content.split('\n').map(l => l.trim());
    const segments: string[] = [];
    const audioRenditions: { groupId: string; name: string; isDefault: boolean; uri?: string }[] = [];
    let isMaster = false;
    let bestVariant: string | undefined;
    let bestVariantAudioGroup: string | undefined;
    let bestBandwidth = -1;
    let initUri: string | undefined;

    const attr = (line: string, key: string): string | undefined => {
      const m = line.match(new RegExp(`${key}=(?:"([^"]*)"|([^,]*))`));
      return m ? (m[1] ?? m[2]) : undefined;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Master playlist: separate audio rendition declarations
      if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line)) {
        const groupId = attr(line, 'GROUP-ID') || '';
        const name = attr(line, 'NAME') || '';
        const isDefault = /DEFAULT=YES/.test(line);
        const uriRaw = attr(line, 'URI');
        audioRenditions.push({
          groupId,
          name,
          isDefault,
          uri: uriRaw ? this.resolveUrl(uriRaw, baseUrl) : undefined,
        });
      }

      // Master playlist: video variant declarations
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        isMaster = true;
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        const audioGroup = attr(line, 'AUDIO');
        // Next non-empty, non-comment line is the variant URL
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j];
          if (next && !next.startsWith('#')) {
            if (bandwidth > bestBandwidth) {
              bestBandwidth = bandwidth;
              bestVariant = this.resolveUrl(next, baseUrl);
              bestVariantAudioGroup = audioGroup;
            }
            break;
          }
        }
      }

      // fMP4 init segment reference: #EXT-X-MAP:URI="init.mp4"
      if (line.startsWith('#EXT-X-MAP:')) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch) {
          initUri = this.resolveUrl(uriMatch[1], baseUrl);
        }
      }

      // Media playlist: collect segment URLs
      if (!line.startsWith('#') && line.length > 0) {
        // Only collect if this doesn't look like a variant playlist reference
        // (we detect those via the isMaster flag above after full parse)
        segments.push(this.resolveUrl(line, baseUrl));
      }
    }

    return { isMaster, segments, bestVariant, initUri, audioRenditions, bestVariantAudioGroup };
  }

  private async readFileBytes(path: string): Promise<Uint8Array> {
    const b64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const raw = globalThis.atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
  }

  private detectSegmentFormat(bytes: Uint8Array): 'ts' | 'fmp4' | 'unknown' {
    // MPEG-TS packets always begin with sync byte 0x47.
    if (bytes.length >= 1 && bytes[0] === 0x47) return 'ts';
    // ISO BMFF (fMP4): a length-prefixed box, type at bytes 4..7.
    if (bytes.length >= 8) {
      const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
      if (['ftyp', 'styp', 'moof', 'sidx', 'free', 'skip', 'moov'].includes(boxType)) {
        return 'fmp4';
      }
    }
    return 'unknown';
  }

  // Returns the byte offset of the first ISO BMFF box with the given 4-char
  // type found in data[start..end), or -1 if not found.
  private findMp4Box(data: Uint8Array, type: string, start: number, end: number): number {
    let i = start;
    while (i + 8 <= end) {
      const size = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
      if (size < 8) break;
      if (
        data[i + 4] === type.charCodeAt(0) &&
        data[i + 5] === type.charCodeAt(1) &&
        data[i + 6] === type.charCodeAt(2) &&
        data[i + 7] === type.charCodeAt(3)
      ) {
        return i;
      }
      i += size;
    }
    return -1;
  }

  // Rewrites track_id in tkhd (inside moov) and tfhd (inside moof/traf) boxes.
  private patchTrackId(data: Uint8Array, fromId: number, toId: number): void {
    const ru32 = (o: number) =>
      ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
    const wu32 = (o: number, v: number) => {
      data[o] = (v >>> 24) & 0xff;
      data[o + 1] = (v >>> 16) & 0xff;
      data[o + 2] = (v >>> 8) & 0xff;
      data[o + 3] = v & 0xff;
    };

    // Patch tkhd inside moov (init segment)
    const moovOff = this.findMp4Box(data, 'moov', 0, data.length);
    if (moovOff >= 0) {
      const moovEnd = moovOff + ru32(moovOff);
      let search = moovOff + 8;
      while (search < moovEnd) {
        const trakOff = this.findMp4Box(data, 'trak', search, moovEnd);
        if (trakOff < 0) break;
        const trakEnd = trakOff + ru32(trakOff);
        const tkhdOff = this.findMp4Box(data, 'tkhd', trakOff + 8, trakEnd);
        if (tkhdOff >= 0) {
          const ver = data[tkhdOff + 8];
          const tidOff = ver === 0 ? tkhdOff + 20 : tkhdOff + 28;
          if (ru32(tidOff) === fromId) wu32(tidOff, toId);
        }
        search = trakEnd;
      }
    }

    // Patch tfhd inside moof → traf (fragment headers)
    let pos = 0;
    while (pos + 8 <= data.length) {
      const boxSize = ru32(pos);
      if (boxSize < 8) break;
      const bt = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
      if (bt === 'moof') {
        const moofEnd = pos + boxSize;
        const trafOff = this.findMp4Box(data, 'traf', pos + 8, moofEnd);
        if (trafOff >= 0) {
          const trafEnd = trafOff + ru32(trafOff);
          const tfhdOff = this.findMp4Box(data, 'tfhd', trafOff + 8, trafEnd);
          if (tfhdOff >= 0 && ru32(tfhdOff + 12) === fromId) {
            wu32(tfhdOff + 12, toId);
          }
        }
      }
      pos += boxSize;
    }
  }

  // Merges two fMP4 init segments (one video-only, one audio-only) into a
  // single init segment containing both tracks. Audio trak is appended to the
  // video moov box.
  private mergeVideoAudioInit(videoInit: Uint8Array, audioInit: Uint8Array): Uint8Array {
    const ru32 = (d: Uint8Array, o: number) =>
      ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

    const vMoovOff = this.findMp4Box(videoInit, 'moov', 0, videoInit.length);
    if (vMoovOff < 0) return videoInit;
    const vMoovSize = ru32(videoInit, vMoovOff);
    const vMoovData = videoInit.slice(vMoovOff, vMoovOff + vMoovSize);

    const aMoovOff = this.findMp4Box(audioInit, 'moov', 0, audioInit.length);
    if (aMoovOff < 0) return videoInit;
    const aMoovEnd = aMoovOff + ru32(audioInit, aMoovOff);
    const aTrakOff = this.findMp4Box(audioInit, 'trak', aMoovOff + 8, aMoovEnd);
    if (aTrakOff < 0) return videoInit;
    const aTrakSize = ru32(audioInit, aTrakOff);
    const audioTrak = audioInit.slice(aTrakOff, aTrakOff + aTrakSize);

    // new moov = original video moov bytes + audio trak appended
    const newMoovSize = vMoovSize + aTrakSize;
    const newMoov = new Uint8Array(newMoovSize);
    newMoov.set(vMoovData, 0);
    newMoov.set(audioTrak, vMoovSize);
    // patch moov box size
    newMoov[0] = (newMoovSize >>> 24) & 0xff;
    newMoov[1] = (newMoovSize >>> 16) & 0xff;
    newMoov[2] = (newMoovSize >>> 8) & 0xff;
    newMoov[3] = newMoovSize & 0xff;

    // grab ftyp from video init
    const vFtypOff = this.findMp4Box(videoInit, 'ftyp', 0, videoInit.length);
    let ftyp: Uint8Array;
    if (vFtypOff >= 0) {
      const ftypSize = ru32(videoInit, vFtypOff);
      ftyp = videoInit.slice(vFtypOff, vFtypOff + ftypSize);
    } else {
      ftyp = new Uint8Array(0);
    }

    const result = new Uint8Array(ftyp.length + newMoovSize);
    result.set(ftyp, 0);
    result.set(newMoov, ftyp.length);
    return result;
  }

  private async startHlsDownload(
    id: string,
    url: string,
    pageTitle: string,
    pageUrl?: string,
    cookies?: string,
  ): Promise<string> {
    const TAG = '[HLS-DL]';
    const headers = this.buildHeaders(pageUrl, cookies);
    const privateDir = await this.ensurePrivateFolder();

    this.onStatusChange?.(id, 'downloading');
    this.onProgress?.(id, 0, 0);

    try {
      // Step 1: Fetch the m3u8 manifest
      console.log(`${TAG} Fetching manifest: ${url.substring(0, 150)}`);
      let manifestUrl = url;
      let response = await fetch(manifestUrl, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: HTTP ${response.status}`);
      }
      let manifestText = await response.text();

      // Step 2: Parse manifest — resolve master playlist to media playlist
      let parsed = this.parseM3u8(manifestText, manifestUrl);
      let audioRendition: { uri?: string } | undefined;
      if (parsed.isMaster && parsed.bestVariant) {
        // console.log(`${TAG} Master playlist: ${parsed.audioRenditions.length} audio rendition(s), variant audio group=${parsed.bestVariantAudioGroup ?? '(none)'}`);
        if (parsed.audioRenditions.length > 0) {
          // Prefer the rendition whose GROUP-ID matches the chosen variant's AUDIO attribute,
          // falling back to the DEFAULT=YES rendition, then the first one.
          audioRendition =
            parsed.audioRenditions.find(r => r.groupId === parsed.bestVariantAudioGroup) ||
            parsed.audioRenditions.find(r => r.isDefault) ||
            parsed.audioRenditions[0];
          // console.log(`${TAG} Selected audio rendition: groupId=${(audioRendition as any).groupId} name=${(audioRendition as any).name} uri=${audioRendition.uri?.substring(0, 100) ?? '(inline in variant)'}`);
        }
        // console.log(`${TAG} Picking best variant: ${parsed.bestVariant.substring(0, 150)}`);
        manifestUrl = parsed.bestVariant;
        response = await fetch(manifestUrl, { headers });
        if (!response.ok) {
          throw new Error(`Failed to fetch variant playlist: HTTP ${response.status}`);
        }
        manifestText = await response.text();
        parsed = this.parseM3u8(manifestText, manifestUrl);
      }

      const videoSegmentUrls = parsed.segments.filter(
        s => !s.includes('.m3u8') && s.length > 0,
      );

      if (videoSegmentUrls.length === 0) {
        throw new Error('No video segments found in HLS playlist');
      }

      // Step 2b: If the master playlist declared a separate audio rendition
      // with its own URI, fetch that playlist so we can download audio segments.
      let audioSegmentUrls: string[] = [];
      let audioParsed: ReturnType<typeof this.parseM3u8> | undefined;
      if (audioRendition?.uri) {
        console.log(`${TAG} Fetching separate audio playlist`);
        const audioResp = await fetch(audioRendition.uri, { headers });
        if (audioResp.ok) {
          const audioText = await audioResp.text();
          audioParsed = this.parseM3u8(audioText, audioRendition.uri);
          audioSegmentUrls = audioParsed.segments.filter(
            s => !s.includes('.m3u8') && s.length > 0,
          );
          console.log(`${TAG} Found ${audioSegmentUrls.length} audio segments`);
        } else {
          console.warn(`${TAG} Failed to fetch audio playlist (HTTP ${audioResp.status}), proceeding without separate audio`);
        }
      }

      const hasSeparateAudio = audioSegmentUrls.length > 0;
      const totalSegments = videoSegmentUrls.length + audioSegmentUrls.length;
      let downloadedCount = 0;

      // Step 3: Download video (and optionally audio) segments
      const tempDir = `${privateDir}hls_${id}/`;
      await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

      // Video init segment (fMP4)
      let videoInitSegPath: string | undefined;
      if (parsed.initUri) {
        videoInitSegPath = `${tempDir}video_init.mp4`;
        const dl = await FileSystem.downloadAsync(parsed.initUri, videoInitSegPath, { headers });
        if (!dl?.uri) throw new Error('Failed to download video fMP4 init segment');
      }

      // Audio init segment (fMP4)
      let audioInitSegPath: string | undefined;
      if (hasSeparateAudio && audioParsed?.initUri) {
        audioInitSegPath = `${tempDir}audio_init.mp4`;
        const dl = await FileSystem.downloadAsync(audioParsed.initUri, audioInitSegPath, { headers });
        if (!dl?.uri) throw new Error('Failed to download audio fMP4 init segment');
      }

      // Download video segments
      const videoSegPaths: string[] = [];
      for (let i = 0; i < videoSegmentUrls.length; i++) {
        const segPath = `${tempDir}vseg_${String(i).padStart(5, '0')}.ts`;
        const dl = await FileSystem.downloadAsync(videoSegmentUrls[i], segPath, { headers });
        if (!dl?.uri) throw new Error(`Failed to download video segment ${i + 1}/${videoSegmentUrls.length}`);
        videoSegPaths.push(dl.uri);
        downloadedCount++;
        this.onProgress?.(id, downloadedCount, totalSegments);
      }

      // Download audio segments (if separate)
      const audioSegPaths: string[] = [];
      if (hasSeparateAudio) {
        for (let i = 0; i < audioSegmentUrls.length; i++) {
          const segPath = `${tempDir}aseg_${String(i).padStart(5, '0')}.ts`;
          const dl = await FileSystem.downloadAsync(audioSegmentUrls[i], segPath, { headers });
          if (!dl?.uri) throw new Error(`Failed to download audio segment ${i + 1}/${audioSegmentUrls.length}`);
          audioSegPaths.push(dl.uri);
          downloadedCount++;
          this.onProgress?.(id, downloadedCount, totalSegments);
        }
      }

      // Step 4: Detect segment format and assemble into a seekable MP4.
      const probeBytes = await this.readFileBytes(videoSegPaths[0]);
      const format = this.detectSegmentFormat(probeBytes);

      const safe = (pageTitle || 'video')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 40);
      const outputFileName = `${safe}_${Date.now()}.mp4`;
      const outputPath = `${privateDir}${outputFileName}`;

      let merged: Uint8Array;

      if (format === 'ts') {
        // --- Transmux video ---
        const videoTx = new muxjs.mp4.Transmuxer({ remux: true });
        let videoInit: Uint8Array | null = null;
        const videoChunks: Uint8Array[] = [];
        let videoBytes = 0;

        videoTx.on('data', (seg: { type?: string; initSegment?: Uint8Array; data: Uint8Array }) => {
          if (!videoInit && seg.initSegment && seg.initSegment.length > 0) {
            videoInit = seg.initSegment;
          }
          if (seg.data && seg.data.length > 0) {
            videoChunks.push(seg.data);
            videoBytes += seg.data.length;
          }
        });

        videoTx.push(probeBytes);
        for (let i = 1; i < videoSegPaths.length; i++) {
          videoTx.push(await this.readFileBytes(videoSegPaths[i]));
        }
        videoTx.flush();

        if (!videoInit || videoChunks.length === 0) {
          throw new Error('Video transmux produced no MP4 data');
        }

        if (hasSeparateAudio) {
          // --- Transmux audio separately ---
          const audioTx = new muxjs.mp4.Transmuxer({ remux: true });
          let audioInit: Uint8Array | null = null;
          const audioChunks: Uint8Array[] = [];
          let audioBytes = 0;

          audioTx.on('data', (seg: { type?: string; initSegment?: Uint8Array; data: Uint8Array }) => {
            if (!audioInit && seg.initSegment && seg.initSegment.length > 0) {
              audioInit = seg.initSegment;
            }
            if (seg.data && seg.data.length > 0) {
              audioChunks.push(seg.data);
              audioBytes += seg.data.length;
            }
          });

          for (const aPath of audioSegPaths) {
            audioTx.push(await this.readFileBytes(aPath));
          }
          audioTx.flush();

          if (audioInit && audioChunks.length > 0) {
            // Patch audio track_id → 2 (mux.js assigns 1 to the only track)
            this.patchTrackId(audioInit, 1, 2);
            const audioData = new Uint8Array(audioBytes);
            let aOff = 0;
            for (const c of audioChunks) { audioData.set(c, aOff); aOff += c.length; }
            this.patchTrackId(audioData, 1, 2);

            // Merge init segments: video moov + audio trak
            const mergedInit = this.mergeVideoAudioInit(videoInit, audioInit);

            // Assemble: merged init + video fragments + audio fragments
            merged = new Uint8Array(mergedInit.length + videoBytes + audioBytes);
            merged.set(mergedInit, 0);
            let off = mergedInit.length;
            for (const c of videoChunks) { merged.set(c, off); off += c.length; }
            merged.set(audioData, off);
            console.log(`${TAG} Merged video+audio: ${merged.length} bytes`);
          } else {
            console.warn(`${TAG} Audio transmux produced no data, falling back to video-only`);
            const initBytes: Uint8Array = videoInit;
            merged = new Uint8Array(initBytes.length + videoBytes);
            merged.set(initBytes, 0);
            let off = initBytes.length;
            for (const c of videoChunks) { merged.set(c, off); off += c.length; }
          }
        } else {
          // No separate audio — TS segments already contain muxed audio+video
          const initBytes: Uint8Array = videoInit;
          merged = new Uint8Array(initBytes.length + videoBytes);
          merged.set(initBytes, 0);
          let off = initBytes.length;
          for (const c of videoChunks) { merged.set(c, off); off += c.length; }
        }
      } else if (format === 'fmp4') {
        // fMP4: concatenate init + fragments; handle separate audio if present
        const videoFrags: Uint8Array[] = [];
        let vLen = 0;
        if (videoInitSegPath) {
          const init = await this.readFileBytes(videoInitSegPath);
          videoFrags.push(init);
          vLen += init.length;
        }
        videoFrags.push(probeBytes);
        vLen += probeBytes.length;
        for (let i = 1; i < videoSegPaths.length; i++) {
          const seg = await this.readFileBytes(videoSegPaths[i]);
          videoFrags.push(seg);
          vLen += seg.length;
        }

        if (hasSeparateAudio) {
          const audioFrags: Uint8Array[] = [];
          let aLen = 0;
          if (audioInitSegPath) {
            const init = await this.readFileBytes(audioInitSegPath);
            audioFrags.push(init);
            aLen += init.length;
          }
          for (const aPath of audioSegPaths) {
            const seg = await this.readFileBytes(aPath);
            audioFrags.push(seg);
            aLen += seg.length;
          }

          // Concat audio into one buffer and patch track_id
          const audioAll = new Uint8Array(aLen);
          let aOff = 0;
          for (const f of audioFrags) { audioAll.set(f, aOff); aOff += f.length; }
          this.patchTrackId(audioAll, 1, 2);

          // Merge init segments
          const vInitData = videoInitSegPath ? await this.readFileBytes(videoInitSegPath) : videoFrags[0];
          const aInitData = audioInitSegPath ? await this.readFileBytes(audioInitSegPath) : audioFrags[0];
          const mergedInit = this.mergeVideoAudioInit(vInitData, aInitData);

          // Skip init data from raw buffers (use only media fragments)
          const vInitSize = videoInitSegPath ? (await this.readFileBytes(videoInitSegPath)).length : 0;
          const aInitSize = audioInitSegPath ? (await this.readFileBytes(audioInitSegPath)).length : 0;
          const videoAll = new Uint8Array(vLen);
          let vOff = 0;
          for (const f of videoFrags) { videoAll.set(f, vOff); vOff += f.length; }
          const vData = videoAll.subarray(vInitSize);
          const aData = audioAll.subarray(aInitSize);

          merged = new Uint8Array(mergedInit.length + vData.length + aData.length);
          merged.set(mergedInit, 0);
          merged.set(vData, mergedInit.length);
          merged.set(aData, mergedInit.length + vData.length);
        } else {
          merged = new Uint8Array(vLen);
          let off = 0;
          for (const f of videoFrags) { merged.set(f, off); off += f.length; }
        }
      } else {
        const head = Array.from(probeBytes.slice(0, 16))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' ');
        throw new Error(`Unrecognized segment format (first 16 bytes: ${head})`);
      }

      // Encode to base64 in 3-byte-aligned chunks so intermediate chunks
      // produce no padding — only the final chunk may have padding.
      const ENCODE_CHUNK = 3 * 1024;
      let finalBase64 = '';
      for (let bi = 0; bi < merged.length; bi += ENCODE_CHUNK) {
        const end = Math.min(bi + ENCODE_CHUNK, merged.length);
        const slice = merged.subarray(bi, end);
        let bin = '';
        for (let bj = 0; bj < slice.length; bj++) {
          bin += String.fromCharCode(slice[bj]);
        }
        finalBase64 += globalThis.btoa(bin);
      }

      await FileSystem.writeAsStringAsync(outputPath, finalBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Cleanup temp segments
      await FileSystem.deleteAsync(tempDir, { idempotent: true }).catch(() => {});

      // console.log(`${TAG} Output file saved: ${outputPath} (${merged.length} bytes, format=${format})`);

      this.onStatusChange?.(id, 'completed', outputPath);
      return outputPath;
    } catch (err: any) {
      console.error(`${TAG} HLS download failed:`, err?.message);
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
      const result = await active.task.downloadAsync();
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
