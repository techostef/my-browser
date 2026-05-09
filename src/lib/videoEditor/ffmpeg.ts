import { FFmpegKit, ReturnCode } from '@wokcito/ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import { EncodingType } from 'expo-file-system';

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
  const ceiling = !targetHeight ? 8000
    : targetHeight <= 480 ? 600
    : targetHeight <= 720 ? 1600
    : targetHeight <= 1080 ? 3200
    : 4800;

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

export async function trimAndConcat(
  inputUri: string,
  keptRanges: { start: number; end: number }[],
  outputUri: string,
  onProgress?: (msg: string) => void,
  onEncodeProgress?: (fraction: number) => void,
): Promise<void> {
  if (keptRanges.length === 0) throw new Error('No segments to export');

  // Match the source's bitrate so output size scales with trim duration instead
  // of ballooning to the per-resolution ceiling.
  const { videoKbps, height: srcH } = await probeVideoInfo(inputUri);

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
        ` ${enc} -c:a aac -avoid_negative_ts make_zero` +
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
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
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

// Extracts a time-bounded audio chunk directly from the source (video or audio).
// 16 kHz mono 32 kbps AAC — each 5-minute chunk is ~1.2 MB, well under OpenAI's 25 MB limit.
export async function extractAudioChunk(
  inputUri: string,
  startSec: number,
  durationSec: number,
  outputUri: string,
): Promise<void> {
  await runFFmpeg(
    `-ss ${startSec} -i "${toPath(inputUri)}" -t ${durationSec}` +
    ` -vn -ar 16000 -ac 1 -c:a aac -b:a 32k "${toPath(outputUri)}" -y`,
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

export async function probeVideoInfo(uri: string): Promise<{
  width: number;
  height: number;
  videoKbps: number;
  durationSec: number;
}> {
  const session = await FFmpegKit.execute(`-hide_banner -i "${toPath(uri)}"`);
  const logs = await session.getLogs();

  let width = 1280;
  let height = 720;
  let videoKbps = 0;
  let totalKbps = 0;
  let durationSec = 0;

  for (const log of logs) {
    const msg = String(log.getMessage());

    const sizeMatch = msg.match(/\bVideo:.*?\b(\d{2,5})x(\d{2,5})\b/);
    if (sizeMatch) {
      width = parseInt(sizeMatch[1], 10);
      height = parseInt(sizeMatch[2], 10);
    }

    // Per-stream video bitrate: "Video: ... , 1500 kb/s, 25 fps ..."
    const vbrMatch = msg.match(/Video:.*?,\s*(\d+)\s*kb\/s/);
    if (vbrMatch) {
      videoKbps = parseInt(vbrMatch[1], 10);
    }

    // Container-level overall bitrate: "Duration: ..., bitrate: 1600 kb/s"
    const tbrMatch = msg.match(/Duration:.*?bitrate:\s*(\d+)\s*kb\/s/);
    if (tbrMatch) {
      totalKbps = parseInt(tbrMatch[1], 10);
    }

    const durMatch = msg.match(/Duration:\s+(\d+):(\d+):(\d+)\.(\d+)/);
    if (durMatch) {
      durationSec =
        parseInt(durMatch[1]) * 3600 +
        parseInt(durMatch[2]) * 60 +
        parseInt(durMatch[3]) +
        parseInt(durMatch[4]) / 100;
    }
  }

  // Fallback 1: subtract typical AAC audio (128k) from container bitrate
  if (!videoKbps && totalKbps) {
    videoKbps = Math.max(500, totalKbps - 128);
  }

  // Fallback 2: compute from file size and duration. Catches files where
  // FFmpeg's log doesn't include a bitrate field (some MP4s with stripped
  // metadata or VBR streams). Without this we'd silently use the per-resolution
  // ceiling — exactly the bug that bloats trimmed exports back to source size.
  if (!videoKbps && durationSec > 0) {
    try {
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      const fileBytes = (info.exists && 'size' in info) ? ((info as any).size as number) : 0;
      if (fileBytes > 0) {
        const overallKbps = (fileBytes * 8) / 1000 / durationSec;
        videoKbps = Math.max(500, Math.round(overallKbps - 128));
      }
    } catch {
      // leave videoKbps at 0; chooseBitrate will use the resolution ceiling
    }
  }

  return { width, height, videoKbps, durationSec };
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
