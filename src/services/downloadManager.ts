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
        console.log("parts", parts)
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
      return { files: [], folders: [] };
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
        console.log(`${TAG} Master playlist: ${parsed.audioRenditions.length} audio rendition(s), variant audio group=${parsed.bestVariantAudioGroup ?? '(none)'}`);
        if (parsed.audioRenditions.length > 0) {
          // Prefer the rendition whose GROUP-ID matches the chosen variant's AUDIO attribute,
          // falling back to the DEFAULT=YES rendition, then the first one.
          audioRendition =
            parsed.audioRenditions.find(r => r.groupId === parsed.bestVariantAudioGroup) ||
            parsed.audioRenditions.find(r => r.isDefault) ||
            parsed.audioRenditions[0];
          console.log(`${TAG} Selected audio rendition: groupId=${(audioRendition as any).groupId} name=${(audioRendition as any).name} uri=${audioRendition.uri?.substring(0, 100) ?? '(inline in variant)'}`);
        }
        console.log(`${TAG} Picking best variant: ${parsed.bestVariant.substring(0, 150)}`);
        manifestUrl = parsed.bestVariant;
        response = await fetch(manifestUrl, { headers });
        if (!response.ok) {
          throw new Error(`Failed to fetch variant playlist: HTTP ${response.status}`);
        }
        manifestText = await response.text();
        parsed = this.parseM3u8(manifestText, manifestUrl);
      }

      const segmentUrls = parsed.segments.filter(
        s => !s.includes('.m3u8') && s.length > 0,
      );

      if (segmentUrls.length === 0) {
        throw new Error('No video segments found in HLS playlist');
      }

      console.log(`${TAG} Found ${segmentUrls.length} segments to download${parsed.initUri ? ' (with fMP4 init segment)' : ''}`);

      // Step 3: Download segments (and fMP4 init segment if the playlist had #EXT-X-MAP)
      const totalSegments = segmentUrls.length;
      const segmentPaths: string[] = [];
      const tempDir = `${privateDir}hls_${id}/`;
      await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });

      let initSegPath: string | undefined;
      if (parsed.initUri) {
        initSegPath = `${tempDir}init.mp4`;
        const initDl = await FileSystem.downloadAsync(parsed.initUri, initSegPath, { headers });
        if (!initDl?.uri) {
          throw new Error('Failed to download fMP4 init segment');
        }
      }

      for (let i = 0; i < totalSegments; i++) {
        const segUrl = segmentUrls[i];
        const segPath = `${tempDir}seg_${String(i).padStart(5, '0')}.ts`;

        const dlResult = await FileSystem.downloadAsync(segUrl, segPath, { headers });
        if (!dlResult?.uri) {
          throw new Error(`Failed to download segment ${i + 1}/${totalSegments}`);
        }
        segmentPaths.push(dlResult.uri);

        // Report progress based on segments completed
        this.onProgress?.(id, i + 1, totalSegments);
      }

      // Step 4: Detect segment format. Some HLS streams use MPEG-TS; newer ones
      // (CMAF) use fMP4 fragments. We pick a different assembly path for each.
      const probeBytes = await this.readFileBytes(segmentPaths[0]);
      const format = this.detectSegmentFormat(probeBytes);
      console.log(`${TAG} All ${totalSegments} segments downloaded, format=${format}`);

      const safe = (pageTitle || 'video')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 40);
      const outputFileName = `${safe}_${Date.now()}.mp4`;
      const outputPath = `${privateDir}${outputFileName}`;

      let merged: Uint8Array;

      if (format === 'ts') {
        // MPEG-TS path: demux PES packets and remux into fMP4 via mux.js.
        const transmuxer = new muxjs.mp4.Transmuxer({ remux: true });
        let muxInit: Uint8Array | null = null;
        const mp4Chunks: Uint8Array[] = [];
        let mp4Bytes = 0;
        const typeCounts: Record<string, number> = {};

        transmuxer.on('data', (segment: { type?: string; initSegment?: Uint8Array; data: Uint8Array }) => {
          const segType = segment.type || 'unknown';
          typeCounts[segType] = (typeCounts[segType] || 0) + 1;
          if (!muxInit && segment.initSegment && segment.initSegment.length > 0) {
            muxInit = segment.initSegment;
          }
          if (segment.data && segment.data.length > 0) {
            mp4Chunks.push(segment.data);
            mp4Bytes += segment.data.length;
          }
        });

        // Feed segment 0 (already in memory) and the rest one at a time.
        transmuxer.push(probeBytes);
        for (let i = 1; i < segmentPaths.length; i++) {
          transmuxer.push(await this.readFileBytes(segmentPaths[i]));
        }
        transmuxer.flush();

        console.log(`${TAG} mux.js emitted segment types: ${JSON.stringify(typeCounts)}, totalBytes=${mp4Bytes}`);

        if (!muxInit || mp4Chunks.length === 0) {
          throw new Error('Transmux produced no MP4 data');
        }

        const initBytes: Uint8Array = muxInit;
        merged = new Uint8Array(initBytes.length + mp4Bytes);
        merged.set(initBytes, 0);
        let writeOffset = initBytes.length;
        for (const chunk of mp4Chunks) {
          merged.set(chunk, writeOffset);
          writeOffset += chunk.length;
        }
      } else if (format === 'fmp4') {
        // fMP4 path: segments are already valid MP4 fragments. Concatenate the
        // init segment (from #EXT-X-MAP) followed by all media segments.
        const fragments: Uint8Array[] = [];
        let totalLen = 0;
        if (initSegPath) {
          const init = await this.readFileBytes(initSegPath);
          fragments.push(init);
          totalLen += init.length;
        }
        // Segment 0 already read for format detection
        fragments.push(probeBytes);
        totalLen += probeBytes.length;
        for (let i = 1; i < segmentPaths.length; i++) {
          const seg = await this.readFileBytes(segmentPaths[i]);
          fragments.push(seg);
          totalLen += seg.length;
        }
        merged = new Uint8Array(totalLen);
        let writeOffset = 0;
        for (const frag of fragments) {
          merged.set(frag, writeOffset);
          writeOffset += frag.length;
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

      console.log(`${TAG} Output file saved: ${outputPath} (${merged.length} bytes, format=${format})`);

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
