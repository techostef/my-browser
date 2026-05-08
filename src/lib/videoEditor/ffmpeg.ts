import { FFmpegKit, ReturnCode } from '@wokcito/ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';

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

export async function burnSubtitles(
  videoUri: string,
  srtContent: string,
  outputUri: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const tmpDir = FileSystem.cacheDirectory + 'srt_tmp_' + Date.now() + '/';
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

  try {
    const srtPath = `${tmpDir}subtitles.srt`;
    await FileSystem.writeAsStringAsync(srtPath, srtContent);

    onProgress?.('Embedding subtitles…');
    // Mux SRT as a mov_text soft subtitle track — no libass/FreeType required.
    // All streams from the video (0) are copied, the SRT (1) is encoded as mov_text.
    await runFFmpeg(
      `-i "${toPath(videoUri)}" -i "${toPath(srtPath)}"` +
      ` -map 0 -map 1` +
      ` -c:v copy -c:a copy -c:s mov_text` +
      ` "${toPath(outputUri)}" -y`,
    );
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  }
}
