import * as FileSystem from 'expo-file-system';
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

class DownloadManager {
  private activeTasks: Map<string, ActiveTask> = new Map();
  private onProgress: ProgressCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private readonly privateFolderName = 'private_downloads/';
  private privateFolderUri: string | null = null;

  setProgressCallback(cb: ProgressCallback) {
    this.onProgress = cb;
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
