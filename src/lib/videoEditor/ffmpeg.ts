import { FFmpegKit, ReturnCode } from '@wokcito/ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import { EncodingType } from 'expo-file-system';

function toPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

async function runFFmpeg(command: string): Promise<void> {
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();
  if (!ReturnCode.isSuccess(returnCode)) {
    const logs = await session.getLogs();
    const logText = logs.map((l: any) => l.getMessage()).join('\n');
    throw new Error(`FFmpeg failed:\n${logText}`);
  }
}

// MediaCodec (Android hardware H.264) is dramatically faster than libx264 —
// often 5-10× on a flagship phone. Picking a sane bitrate per resolution
// keeps file sizes reasonable since MediaCodec is bitrate-driven, not CRF.
function bitrateForHeight(h?: number | null): string {
  if (!h) return '5000k';
  if (h <= 480) return '1500k';
  if (h <= 720) return '3000k';
  if (h <= 1080) return '5000k';
  return '8000k';
}

const HW_VENC = (h?: number | null) =>
  `-c:v h264_mediacodec -b:v ${bitrateForHeight(h)}`;

const SW_VENC =
  `-c:v libx264 -preset ultrafast -tune zerolatency -crf 26 -pix_fmt yuv420p -threads 0`;

// Try the hardware encoder first; fall back to software if MediaCodec rejects
// the input (some devices have buggy or restrictive implementations).
async function runWithEncoderFallback(
  build: (encoderArgs: string) => string,
  outputUri: string,
  targetHeight?: number | null,
): Promise<void> {
  try {
    await runFFmpeg(build(HW_VENC(targetHeight)));
    return;
  } catch {
    // Clean any partial output before retrying with software encoder
    await FileSystem.deleteAsync(outputUri, { idempotent: true });
  }
  await runFFmpeg(build(SW_VENC));
}

export async function trimAndConcat(
  inputUri: string,
  keptRanges: { start: number; end: number }[],
  outputUri: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  if (keptRanges.length === 0) throw new Error('No segments to export');

  const tmpDir = FileSystem.cacheDirectory + 'trim_tmp_' + Date.now() + '/';
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

  try {
    const segmentPaths: string[] = [];

    for (let i = 0; i < keptRanges.length; i++) {
      const { start, end } = keptRanges[i];
      const segPath = `${tmpDir}seg_${i}.mp4`;
      onProgress?.(`Trimming segment ${i + 1}/${keptRanges.length}…`);
      const build = (enc: string) =>
        `-ss ${start} -i "${toPath(inputUri)}" -t ${end - start}` +
        ` ${enc} -c:a aac -avoid_negative_ts make_zero` +
        ` "${toPath(segPath)}" -y`;
      await runWithEncoderFallback(build, segPath);
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
    `-i "${toPath(inputUri)}" -vn -c:a aac -b:a 128k "${toPath(outputUri)}" -y`,
  );
}

export async function probeVideoSize(
  videoUri: string,
): Promise<{ width: number; height: number }> {
  const session = await FFmpegKit.execute(`-hide_banner -i "${toPath(videoUri)}"`);
  const logs = await session.getLogs();
  for (const log of logs) {
    const msg = String(log.getMessage());
    // Match "Video: ... 1920x1080" or "1920x1080 [SAR ...]"
    const m = msg.match(/\bVideo:.*?\b(\d{2,5})x(\d{2,5})\b/);
    if (m) {
      return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
    }
  }
  // Fallback — assume 1280×720 so the pipeline still runs
  return { width: 1280, height: 720 };
}

export async function transcodeVideo(
  inputUri: string,
  outputUri: string,
  targetHeight: number,
  onProgress?: (msg: string) => void,
): Promise<void> {
  onProgress?.(`Encoding ${targetHeight}p…`);
  // Hardware encoder first; software fallback. -c:a copy passes audio through
  // unchanged so we only spend CPU on the video.
  const build = (enc: string) =>
    `-i "${toPath(inputUri)}" -vf scale=-2:${targetHeight}` +
    ` ${enc} -c:a copy -movflags +faststart` +
    ` "${toPath(outputUri)}" -y`;
  await runWithEncoderFallback(build, outputUri, targetHeight);
}

export async function burnSubtitlesWithOverlay(
  videoUri: string,
  subtitlePngs: Array<{ id: number; start: number; end: number; pngBase64: string }>,
  blankPngBase64: string,
  outputUri: string,
  onProgress?: (msg: string) => void,
  targetHeight?: number | null,
  videoDuration?: number,
): Promise<void> {
  const realPngs = subtitlePngs.filter(p => p.id !== -1);
  if (realPngs.length === 0) {
    if (targetHeight) {
      await transcodeVideo(videoUri, outputUri, targetHeight, onProgress);
    } else {
      await FileSystem.copyAsync({ from: videoUri, to: outputUri });
    }
    return;
  }

  const tmpDir = FileSystem.cacheDirectory + 'sub_overlay_' + Date.now() + '/';
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

  try {
    onProgress?.('Saving subtitle images…');

    // Write subtitle PNGs and one transparent gap-filler PNG
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

    // Build a concat-demuxer playlist: subtitle PNGs and blank fillers in
    // chronological order. This collapses 80+ chained overlay filters into a
    // SINGLE overlay stage, which is the real speed bottleneck on Android —
    // MediaCodec encoding is fast, but each per-frame overlay/enable check
    // is single-threaded CPU work.
    let list = '';
    let cursor = 0;
    const minGap = 0.04; // ignore sub-frame gaps
    for (const it of items) {
      if (it.start > cursor + minGap) {
        list += `file '${toPath(blankPath)}'\nduration ${(it.start - cursor).toFixed(3)}\n`;
      }
      const dur = Math.max(0.04, it.end - it.start);
      list += `file '${toPath(it.path)}'\nduration ${dur.toFixed(3)}\n`;
      cursor = it.end;
    }
    // Pad to video duration so the subtitle stream doesn't end early
    const padTo = videoDuration && videoDuration > cursor ? videoDuration : cursor + 60;
    list += `file '${toPath(blankPath)}'\nduration ${(padTo - cursor).toFixed(3)}\n`;
    // concat demuxer requires the last entry repeated without a duration line
    list += `file '${toPath(blankPath)}'\n`;

    const listPath = `${tmpDir}sublist.txt`;
    await FileSystem.writeAsStringAsync(listPath, list);

    onProgress?.('Burning subtitles…');

    // Scale source first so overlay operates on smaller frames when the user
    // picked a lower resolution. The PNGs were rendered at the same target
    // dimensions by the caller, so the overlay aligns 1:1.
    const willScale = !!targetHeight;
    const filter = willScale
      ? `[0:v]scale=-2:${targetHeight}[vs];[vs][1:v]overlay=x=(W-w)/2:y=H-h-24[vout]`
      : `[0:v][1:v]overlay=x=(W-w)/2:y=H-h-24[vout]`;

    const build = (enc: string) =>
      `-i "${toPath(videoUri)}"` +
      ` -f concat -safe 0 -i "${toPath(listPath)}"` +
      ` -filter_complex "${filter}"` +
      ` -map "[vout]" -map 0:a?` +
      ` ${enc} -c:a copy` +
      ` -shortest -movflags +faststart "${toPath(outputUri)}" -y`;
    await runWithEncoderFallback(build, outputUri, targetHeight);
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  }
}
