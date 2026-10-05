import { FFmpegKit, FFprobeKit, ReturnCode } from '@wokcito/ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { EncodingType } from 'expo-file-system/legacy';

function toPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

async function runFFmpeg(
  command: string,
  onStats?: (timeMs: number) => void,
): Promise<void> {
  if (onStats) {
    await new Promise<void>((resolve, reject) => {
      FFmpegKit.executeAsync(
        command,
        async (session: any) => {
          const returnCode = await session.getReturnCode();
          if (ReturnCode.isSuccess(returnCode)) {
            resolve();
          } else {
            const logs = await session.getLogs();
            const logText = logs.map((l: any) => l.getMessage()).join('\n');
            reject(new Error(`FFmpeg failed:\n${logText}`));
          }
        },
        undefined,
        (stats: any) => onStats(stats.getTime()),
      );
    });
    return;
  }
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();
  if (!ReturnCode.isSuccess(returnCode)) {
    const logs = await session.getLogs();
    const logText = logs.map((l: any) => l.getMessage()).join('\n');
    throw new Error(`FFmpeg failed:\n${logText}`);
  }
}

// MediaCodec (Android hardware H.264) is bitrate-driven (not CRF), so picking
// the right target bitrate is the difference between a 470 MB and a 1.2 GB
// output for the same content. We match the source bitrate (+15% headroom for
// re-encoding losses) and clamp by the per-resolution ceiling. Without this,
// trimming a 1.6 Mbps source ends up at 5 Mbps — way bigger than the original.
function chooseBitrate(targetHeight?: number | null, sourceKbps?: number): string {
  // "Original" (targetHeight === null): match source bitrate with no ceiling,
  // so the output stays as close to the original quality as possible.
  if (!targetHeight) {
    if (sourceKbps && sourceKbps > 0) {
      return `${Math.max(500, Math.round(sourceKbps * 1.15))}k`;
    }
    return '8000k'; // fallback when probe fails
  }

  const ceiling =
      targetHeight <= 480 ? 1500
    : targetHeight <= 720 ? 4000
    : targetHeight <= 1080 ? 8000
    : 12000;

  if (!sourceKbps || sourceKbps <= 0) {
    return `${ceiling}k`;
  }
  const target = Math.max(500, Math.min(ceiling, Math.round(sourceKbps * 1.15)));
  return `${target}k`;
}

const HW_VENC = (h?: number | null, sourceKbps?: number) =>
  `-c:v h264_mediacodec -b:v ${chooseBitrate(h, sourceKbps)}`;

// Software fallback also needs to honor the source bitrate. Plain CRF 26 +
// ultrafast often emits ~3 Mbps regardless of input, which cancels out the
// hardware path's bitrate matching whenever MediaCodec rejects the input.
const SW_VENC = (h?: number | null, sourceKbps?: number) => {
  if (sourceKbps && sourceKbps > 0) {
    const br = chooseBitrate(h, sourceKbps);
    const brNum = parseInt(br, 10);
    return `-c:v libx264 -preset ultrafast -b:v ${br} -maxrate ${br} -bufsize ${brNum * 2}k -pix_fmt yuv420p -threads 0`;
  }
  return `-c:v libx264 -preset ultrafast -tune zerolatency -crf 26 -pix_fmt yuv420p -threads 0`;
};

async function runWithEncoderFallback(
  build: (encoderArgs: string) => string,
  outputUri: string,
  targetHeight?: number | null,
  onStats?: (timeMs: number) => void,
  sourceKbps?: number,
): Promise<void> {
  try {
    await runFFmpeg(build(HW_VENC(targetHeight, sourceKbps)), onStats);
    return;
  } catch {
    await FileSystem.deleteAsync(outputUri, { idempotent: true });
    onStats?.(0);
  }
  await runFFmpeg(build(SW_VENC(targetHeight, sourceKbps)), onStats);
}

// Re-encode audio near the source rate instead of FFmpeg's AAC default, so a
// low-bitrate source track doesn't grow on export.
function audioEncArgs(audioKbps?: number): string {
  const kbps = audioKbps && audioKbps > 0 ? Math.min(192, Math.max(64, audioKbps)) : 128;
  return `-c:a aac -b:a ${kbps}k`;
}

export type KeptRange = { start: number; end: number };

// Lossless cut: no re-encode, so output size scales with the kept duration and
// the export finishes in seconds. Cut points snap to the keyframe at or before
// each range start. Falls back to trimAndConcat when the streams can't be
// copied into MP4 (e.g. VP9/Opus from WebM sources on older muxers).
export async function trimAndConcatCopy(
  inputUri: string,
  keptRanges: KeptRange[],
  outputUri: string,
  onProgress?: (msg: string) => void,
  onEncodeProgress?: (fraction: number) => void,
): Promise<void> {
  if (keptRanges.length === 0) throw new Error('No segments to export');

  const tmpDir = FileSystem.cacheDirectory + 'trimcopy_tmp_' + Date.now() + '/';
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

  try {
    const segmentPaths: string[] = [];
    for (let i = 0; i < keptRanges.length; i++) {
      const { start, end } = keptRanges[i];
      const segPath = `${tmpDir}seg_${i}.mp4`;
      onProgress?.(`Cutting segment ${i + 1}/${keptRanges.length}…`);
      await runFFmpeg(
        `-ss ${start} -i "${toPath(inputUri)}" -t ${end - start}` +
        ` -map 0:v:0 -map 0:a:0? -c copy -avoid_negative_ts make_zero` +
        ` "${toPath(segPath)}" -y`,
      );
      segmentPaths.push(segPath);
      onEncodeProgress?.((i + 1) / (keptRanges.length + 1));
    }

    if (segmentPaths.length === 1) {
      await runFFmpeg(
        `-i "${toPath(segmentPaths[0])}" -c copy -movflags +faststart "${toPath(outputUri)}" -y`,
      );
    } else {
      const listPath = `${tmpDir}list.txt`;
      const listContent = segmentPaths.map(p => `file '${toPath(p)}'`).join('\n');
      await FileSystem.writeAsStringAsync(listPath, listContent);

      onProgress?.('Joining segments…');
      await runFFmpeg(
        `-f concat -safe 0 -i "${toPath(listPath)}" -c copy -movflags +faststart "${toPath(outputUri)}" -y`,
      );
    }
    onEncodeProgress?.(1);
  } catch {
    await FileSystem.deleteAsync(outputUri, { idempotent: true });
    onEncodeProgress?.(0);
    await trimAndConcat(inputUri, keptRanges, outputUri, onProgress, onEncodeProgress);
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  }
}

export async function trimAndConcat(
  inputUri: string,
  keptRanges: KeptRange[],
  outputUri: string,
  onProgress?: (msg: string) => void,
  onEncodeProgress?: (fraction: number) => void,
): Promise<void> {
  if (keptRanges.length === 0) throw new Error('No segments to export');

  // Match the source's bitrate so output size scales with trim duration instead
  // of ballooning to the per-resolution ceiling.
  const { videoKbps, audioKbps, height: srcH } = await probeVideoInfo(inputUri);

  const tmpDir = FileSystem.cacheDirectory + 'trim_tmp_' + Date.now() + '/';
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

  try {
    const segmentPaths: string[] = [];
    const totalOut = keptRanges.reduce((s, r) => s + (r.end - r.start), 0);
    let doneSecs = 0;

    for (let i = 0; i < keptRanges.length; i++) {
      const { start, end } = keptRanges[i];
      const segDur = end - start;
      const segPath = `${tmpDir}seg_${i}.mp4`;
      onProgress?.(`Trimming segment ${i + 1}/${keptRanges.length}…`);

      const onStats = onEncodeProgress
        ? (timeMs: number) => {
            const segFrac = Math.min(1, timeMs / Math.max(1, segDur * 1000));
            onEncodeProgress((doneSecs + segFrac * segDur) / Math.max(1, totalOut));
          }
        : undefined;

      const build = (enc: string) =>
        `-ss ${start} -i "${toPath(inputUri)}" -t ${segDur}` +
        ` ${enc} ${audioEncArgs(audioKbps)} -avoid_negative_ts make_zero` +
        ` "${toPath(segPath)}" -y`;
      await runWithEncoderFallback(build, segPath, srcH, onStats, videoKbps);
      doneSecs += segDur;
      segmentPaths.push(segPath);
    }

    if (segmentPaths.length === 1) {
      await FileSystem.copyAsync({ from: segmentPaths[0], to: outputUri });
    } else {
      const listPath = `${tmpDir}list.txt`;
      const listContent = segmentPaths.map(p => `file '${toPath(p)}'`).join('\n');
      await FileSystem.writeAsStringAsync(listPath, listContent);

      onProgress?.('Joining segments…');
      await runFFmpeg(
        `-f concat -safe 0 -i "${toPath(listPath)}" -c copy "${toPath(outputUri)}" -y`,
      );
    }
    await warnIfOversized(inputUri, outputUri, keptRanges);
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  }
}

async function fileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size : 0;
  } catch {
    return 0;
  }
}

// Diagnostics only: a re-encoded trim should be roughly proportional to the
// kept duration. Anything far above that means bitrate detection failed.
async function warnIfOversized(
  inputUri: string,
  outputUri: string,
  keptRanges: KeptRange[],
): Promise<void> {
  const { durationSec } = await probeVideoInfo(inputUri);
  const [srcBytes, outBytes] = await Promise.all([fileSize(inputUri), fileSize(outputUri)]);
  if (!durationSec || !srcBytes || !outBytes) return;
  const kept = keptRanges.reduce((s, r) => s + (r.end - r.start), 0);
  const expected = srcBytes * (kept / durationSec);
  if (outBytes > expected * 1.3) {
    console.warn(
      `[ffmpeg] trim output ${(outBytes / 1e6).toFixed(1)} MB exceeds expected ` +
      `${(expected / 1e6).toFixed(1)} MB for ${kept.toFixed(1)}s of ${durationSec.toFixed(1)}s`,
    );
  }
}

export async function extractAudio(
  inputUri: string,
  outputUri: string,
): Promise<void> {
  await runFFmpeg(
    `-i "${toPath(inputUri)}" -vn -ar 16000 -ac 1 -c:a aac -b:a 32k "${toPath(outputUri)}" -y`,
  );
}

// Extracts a time-bounded audio chunk as 16 kHz 16-bit mono PCM WAV.
// whisper.cpp processes at 16 kHz internally, so this is lossless from its perspective.
// Each 5-minute chunk ≈ 9.6 MB — fine for on-device use (no upload needed).
export async function extractAudioChunkWav(
  inputUri: string,
  startSec: number,
  durationSec: number,
  outputUri: string,
): Promise<void> {
  await runFFmpeg(
    `-ss ${startSec} -i "${toPath(inputUri)}" -t ${durationSec}` +
    ` -vn -ar 16000 -ac 1 -c:a pcm_s16le "${toPath(outputUri)}" -y`,
  );
}

// Extracts a time-bounded audio chunk directly from the source (video or audio).
// Mono 128 kbps AAC — each 5-minute chunk is ~4.8 MB, well under OpenAI's 25 MB limit.
export async function extractAudioChunk(
  inputUri: string,
  startSec: number,
  durationSec: number,
  outputUri: string,
): Promise<void> {
  await runFFmpeg(
    `-ss ${startSec} -i "${toPath(inputUri)}" -t ${durationSec}` +
    ` -vn -ac 1 -c:a aac -b:a 128k "${toPath(outputUri)}" -y`,
  );
}

export async function splitAudio(
  inputUri: string,
  startSec: number,
  durationSec: number,
  outputUri: string,
): Promise<void> {
  await runFFmpeg(
    `-ss ${startSec} -i "${toPath(inputUri)}" -t ${durationSec}` +
    ` -c:a copy -avoid_negative_ts make_zero "${toPath(outputUri)}" -y`,
  );
}

export interface VideoInfo {
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
  durationSec: number;
  videoCodec: string;
}

function toKbps(bps: unknown): number {
  const n = Number(bps);
  return isFinite(n) && n > 0 ? Math.round(n / 1000) : 0;
}

// VideoInfo plus the container-level bitrate, used only as a fallback.
type RawProbe = VideoInfo & { formatKbps: number };

// Structured probe via ffprobe. Returns null when ffprobe can't read the file.
async function probeWithFFprobe(uri: string): Promise<RawProbe | null> {
  try {
    const session = await FFprobeKit.getMediaInformation(toPath(uri));
    const info = session.getMediaInformation();
    if (!info) return null;

    const streams = info.getStreams() ?? [];
    const video = streams.find(s => s.getType() === 'video');
    const audio = streams.find(s => s.getType() === 'audio');
    if (!video) return null;

    return {
      width: Number(video.getWidth()) || 1280,
      height: Number(video.getHeight()) || 720,
      videoKbps: toKbps(video.getBitrate()),
      audioKbps: audio ? toKbps(audio.getBitrate()) : 0,
      durationSec: Number(info.getDuration()) || 0,
      videoCodec: String(video.getCodec() ?? ''),
      formatKbps: toKbps(info.getBitrate()),
    };
  } catch {
    return null;
  }
}

// Fallback probe from `ffmpeg -i` logs. FFmpegKit delivers each av_log call
// as its own message and the "Duration: …, bitrate: …" line is printed by
// several calls, so the messages must be joined before matching.
async function probeFromLogs(uri: string): Promise<RawProbe> {
  const session = await FFmpegKit.execute(`-hide_banner -i "${toPath(uri)}"`);
  const logs = await session.getLogs();
  const text = logs.map((l: any) => String(l.getMessage())).join('');

  let width = 1280;
  let height = 720;
  const sizeMatch = text.match(/\bVideo:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  if (sizeMatch) {
    width = parseInt(sizeMatch[1], 10);
    height = parseInt(sizeMatch[2], 10);
  }
  const codecMatch = text.match(/\bVideo:\s*(\w+)/);
  const vbrMatch = text.match(/\bVideo:[^\n]*?,\s*(\d+)\s*kb\/s/);
  const abrMatch = text.match(/\bAudio:[^\n]*?,\s*(\d+)\s*kb\/s/);
  const tbrMatch = text.match(/Duration:[^\n]*?bitrate:\s*(\d+)\s*kb\/s/);

  let durationSec = 0;
  const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)(?:\.(\d+))?/);
  if (durMatch) {
    const frac = durMatch[4] ? parseInt(durMatch[4], 10) / Math.pow(10, durMatch[4].length) : 0;
    durationSec =
      parseInt(durMatch[1], 10) * 3600 +
      parseInt(durMatch[2], 10) * 60 +
      parseInt(durMatch[3], 10) +
      frac;
  }

  return {
    width,
    height,
    videoKbps: vbrMatch ? parseInt(vbrMatch[1], 10) : 0,
    audioKbps: abrMatch ? parseInt(abrMatch[1], 10) : 0,
    durationSec,
    videoCodec: codecMatch ? codecMatch[1] : '',
    formatKbps: tbrMatch ? parseInt(tbrMatch[1], 10) : 0,
  };
}

export async function probeVideoInfo(uri: string): Promise<VideoInfo> {
  const { formatKbps, ...info } =
    (await probeWithFFprobe(uri)) ?? (await probeFromLogs(uri));
  const audioGuess = info.audioKbps || 128;

  // Fallback 1: container bitrate minus audio. Common for MKV/WebM and
  // remuxed HLS/DASH downloads, which carry no per-stream video bitrate.
  if (!info.videoKbps && formatKbps) {
    info.videoKbps = Math.max(500, formatKbps - audioGuess);
  }

  // Fallback 2: file size over duration. Without a bitrate the encoder would
  // use the per-resolution ceiling, which bloats trimmed exports past the
  // size of the source.
  if (!info.videoKbps && info.durationSec > 0) {
    const fileBytes = await fileSize(uri);
    if (fileBytes > 0) {
      const overallKbps = (fileBytes * 8) / 1000 / info.durationSec;
      info.videoKbps = Math.max(500, Math.round(overallKbps - audioGuess));
    }
  }

  return info;
}

export async function probeVideoSize(
  videoUri: string,
): Promise<{ width: number; height: number }> {
  const info = await probeVideoInfo(videoUri);
  return { width: info.width, height: info.height };
}

export async function transcodeVideo(
  inputUri: string,
  outputUri: string,
  targetHeight: number,
  onProgress?: (msg: string) => void,
  onEncodeProgress?: (fraction: number) => void,
  totalDuration?: number,
): Promise<void> {
  onProgress?.(`Encoding ${targetHeight}p…`);
  const { videoKbps, height: srcH } = await probeVideoInfo(inputUri);

  // Scale source bitrate by area ratio when downscaling — a 1.6 Mbps 720p
  // doesn't need 1.6 Mbps at 480p; (480/720)² ≈ 0.44, so ~700 kbps suffices.
  const areaRatio = srcH > 0 ? (targetHeight * targetHeight) / (srcH * srcH) : 1;
  const scaledKbps = videoKbps > 0 ? Math.round(videoKbps * Math.min(1, areaRatio)) : 0;

  const onStats = (onEncodeProgress && totalDuration)
    ? (timeMs: number) => onEncodeProgress(Math.min(1, timeMs / Math.max(1, totalDuration * 1000)))
    : undefined;
  const build = (enc: string) =>
    `-i "${toPath(inputUri)}" -vf scale=-2:${targetHeight}` +
    ` ${enc} -c:a copy -movflags +faststart` +
    ` "${toPath(outputUri)}" -y`;
  await runWithEncoderFallback(build, outputUri, targetHeight, onStats, scaledKbps);
}

export async function burnSubtitlesWithOverlay(
  videoUri: string,
  subtitlePngs: Array<{ id: number; start: number; end: number; pngBase64: string }>,
  blankPngBase64: string,
  outputUri: string,
  onProgress?: (msg: string) => void,
  targetHeight?: number | null,
  videoDuration?: number,
  onEncodeProgress?: (fraction: number) => void,
): Promise<void> {
  const realPngs = subtitlePngs.filter(p => p.id !== -1);
  if (realPngs.length === 0) {
    if (targetHeight) {
      await transcodeVideo(videoUri, outputUri, targetHeight, onProgress, onEncodeProgress, videoDuration);
    } else {
      onEncodeProgress?.(1);
      await FileSystem.copyAsync({ from: videoUri, to: outputUri });
    }
    return;
  }

  const tmpDir = FileSystem.cacheDirectory + 'sub_overlay_' + Date.now() + '/';
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

  try {
    onProgress?.('Saving subtitle images…');

    const blankPath = `${tmpDir}blank.png`;
    await FileSystem.writeAsStringAsync(blankPath, blankPngBase64, {
      encoding: EncodingType.Base64,
    });

    const items: Array<{ path: string; start: number; end: number }> = [];
    for (const item of realPngs) {
      const p = `${tmpDir}sub_${item.id}.png`;
      await FileSystem.writeAsStringAsync(p, item.pngBase64, { encoding: EncodingType.Base64 });
      items.push({ path: p, start: item.start, end: item.end });
    }
    items.sort((a, b) => a.start - b.start);

    let list = '';
    let cursor = 0;
    const minGap = 0.04;
    for (const it of items) {
      if (it.start > cursor + minGap) {
        list += `file '${toPath(blankPath)}'\nduration ${(it.start - cursor).toFixed(3)}\n`;
      }
      const dur = Math.max(0.04, it.end - it.start);
      list += `file '${toPath(it.path)}'\nduration ${dur.toFixed(3)}\n`;
      cursor = it.end;
    }
    const padTo = videoDuration && videoDuration > cursor ? videoDuration : cursor + 60;
    list += `file '${toPath(blankPath)}'\nduration ${(padTo - cursor).toFixed(3)}\n`;
    list += `file '${toPath(blankPath)}'\n`;

    const listPath = `${tmpDir}sublist.txt`;
    await FileSystem.writeAsStringAsync(listPath, list);

    onProgress?.('Burning subtitles…');

    const willScale = !!targetHeight;
    const filter = willScale
      ? `[0:v]scale=-2:${targetHeight}[vs];[vs][1:v]overlay=x=(W-w)/2:y=H-h-24[vout]`
      : `[0:v][1:v]overlay=x=(W-w)/2:y=H-h-24[vout]`;

    const onStats = (onEncodeProgress && videoDuration)
      ? (timeMs: number) => onEncodeProgress(Math.min(1, timeMs / Math.max(1, videoDuration * 1000)))
      : undefined;

    const { videoKbps, height: srcH } = await probeVideoInfo(videoUri);
    // Scale by area when downscaling, same logic as transcodeVideo
    const areaRatio = (targetHeight && srcH > 0)
      ? (targetHeight * targetHeight) / (srcH * srcH)
      : 1;
    const scaledKbps = videoKbps > 0 ? Math.round(videoKbps * Math.min(1, areaRatio)) : 0;

    const build = (enc: string) =>
      `-i "${toPath(videoUri)}"` +
      ` -f concat -safe 0 -i "${toPath(listPath)}"` +
      ` -filter_complex "${filter}"` +
      ` -map "[vout]" -map 0:a?` +
      ` ${enc} -c:a copy` +
      ` -shortest -movflags +faststart "${toPath(outputUri)}" -y`;
    await runWithEncoderFallback(build, outputUri, targetHeight, onStats, scaledKbps);
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  }
}
