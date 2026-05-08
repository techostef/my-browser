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
      await runFFmpeg(
        `-ss ${start} -i "${toPath(inputUri)}" -t ${end - start}` +
          ` -c:v libx264 -preset ultrafast -c:a aac -avoid_negative_ts make_zero` +
          ` "${toPath(segPath)}" -y`,
      );
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
  await runFFmpeg(
    `-i "${toPath(inputUri)}" -vf scale=-2:${targetHeight}` +
    ` -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac` +
    ` "${toPath(outputUri)}" -y`,
  );
}

export async function burnSubtitlesWithOverlay(
  videoUri: string,
  subtitlePngs: Array<{ id: number; start: number; end: number; pngBase64: string }>,
  outputUri: string,
  onProgress?: (msg: string) => void,
  targetHeight?: number | null,
): Promise<void> {
  if (subtitlePngs.length === 0) {
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
    // Write each PNG to a temp file
    const pngPaths: Array<{ path: string; start: number; end: number }> = [];
    for (const item of subtitlePngs) {
      const p = `${tmpDir}sub_${item.id}.png`;
      await FileSystem.writeAsStringAsync(p, item.pngBase64, { encoding: EncodingType.Base64 });
      pngPaths.push({ path: p, start: item.start, end: item.end });
    }

    onProgress?.('Burning subtitles…');

    // Build FFmpeg command with chained overlay filters.
    // Each PNG is a separate input with -loop 1 so it stays available through the
    // entire video — without this the PNG is a single-frame stream that ends
    // almost immediately, truncating the output to ~100ms.
    // enable='between(t,start,end)' makes each PNG visible only during its segment.
    // -shortest stops the output at the source video's duration since the looped
    // PNG streams are infinite.
    const inputs = pngPaths.map(p => `-loop 1 -i "${toPath(p.path)}"`).join(' ');
    const N = pngPaths.length;

    // Escape commas inside between(t,a,b) with backslashes — single-quoting
    // the expression is unreliable when the command goes through FFmpegKit's
    // tokenizer, but `\,` works in every parsing layer.
    // If targetHeight is set, the final overlay output is named [v_N] and a
    // trailing scale filter produces [vout]; otherwise the last overlay is
    // [vout] directly.
    const willScale = !!targetHeight;
    let filterChain = '';
    for (let i = 0; i < N; i++) {
      const inLabel = i === 0 ? '[0:v]' : `[v${i}]`;
      const pngLabel = `[${i + 1}:v]`;
      const isLast = i === N - 1;
      const outLabel = (isLast && !willScale) ? '[vout]' : `[v${i + 1}]`;
      const { start, end } = pngPaths[i];
      filterChain +=
        `${inLabel}${pngLabel}overlay=x=(W-w)/2:y=H-h-24:enable=between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})${outLabel}`;
      if (!isLast) filterChain += ';';
    }
    if (willScale) {
      filterChain += `;[v${N}]scale=-2:${targetHeight}[vout]`;
    }

    await runFFmpeg(
      `-i "${toPath(videoUri)}" ${inputs}` +
      ` -filter_complex "${filterChain}"` +
      ` -map "[vout]" -map 0:a? -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac` +
      ` -shortest "${toPath(outputUri)}" -y`,
    );
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  }
}
