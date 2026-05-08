import { FFmpegKit, ReturnCode } from '@wokcito/ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';

function toPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

function stripExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastDot > lastSlash ? filePath.slice(0, lastDot) : filePath;
}

export function vttToSrt(vtt: string): string {
  const lines = vtt.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('WEBVTT') || line.startsWith('NOTE')) continue;
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'));

  return blocks
    .filter(b => b.includes('-->'))
    .map((block, i) => {
      const fixed = block.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
      const blockLines = fixed.split('\n');
      // Remove leading index number if present
      if (/^\d+$/.test(blockLines[0].trim())) blockLines.shift();
      return `${i + 1}\n${blockLines.join('\n')}`;
    })
    .join('\n\n');
}

async function extractEmbeddedSubtitles(videoUri: string): Promise<string | null> {
  const tmpPath = `${FileSystem.cacheDirectory ?? ''}sub_${Date.now()}.srt`;
  const session = await FFmpegKit.execute(
    `-i "${toPath(videoUri)}" -map 0:s:0 -c:s srt "${toPath(tmpPath)}" -y`,
  );
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) return null;

  try {
    const info = await FileSystem.getInfoAsync(tmpPath);
    if (!info.exists) return null;
    const content = await FileSystem.readAsStringAsync(tmpPath);
    return content.trim() || null;
  } finally {
    await FileSystem.deleteAsync(tmpPath, { idempotent: true });
  }
}

async function findSidecarSubtitles(videoUri: string): Promise<string | null> {
  const base = stripExtension(toPath(videoUri));

  const srtPath = `${base}.srt`;
  const srtInfo = await FileSystem.getInfoAsync(srtPath);
  if (srtInfo.exists) {
    return (await FileSystem.readAsStringAsync(srtPath)).trim() || null;
  }

  const vttPath = `${base}.vtt`;
  const vttInfo = await FileSystem.getInfoAsync(vttPath);
  if (vttInfo.exists) {
    const vtt = await FileSystem.readAsStringAsync(vttPath);
    return vttToSrt(vtt) || null;
  }

  return null;
}

export async function getSubtitles(videoUri: string): Promise<string | null> {
  const embedded = await extractEmbeddedSubtitles(videoUri);
  if (embedded) return embedded;
  return findSidecarSubtitles(videoUri);
}
