import * as FileSystem from 'expo-file-system';
import { parseSrt, segmentsToSrt, type Segment } from './srt';
import { getOpenAIKey } from '../openaiKey';
import { extractAudio, splitAudio } from './ffmpeg';

// 128 kbps AAC: 20 minutes ≈ 19.2 MB — safely under OpenAI's 25 MB hard limit
const CHUNK_SECS = 1200;
const MAX_BYTES = 24 * 1024 * 1024;
const AUDIO_BPS = 16000; // 128 kbps / 8

function isAudioFile(uri: string): boolean {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  return ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'].includes(ext);
}

async function uploadChunk(audioUri: string, apiKey: string): Promise<Segment[]> {
  const result = await FileSystem.uploadAsync(
    'https://api.openai.com/v1/audio/transcriptions',
    audioUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'audio/mp4',
      parameters: { model: 'whisper-1', response_format: 'srt' },
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Whisper API error (${result.status}): ${result.body}`);
  }
  return parseSrt(result.body);
}

export async function transcribeVideo(
  fileUri: string,
  onProgress?: (msg: string) => void,
): Promise<{ segments: Segment[]; srt: string }> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    throw new Error('No OpenAI API key set. Add it in Settings → AI Subtitles.');
  }

  let uploadUri = fileUri;
  let tempAudio: string | null = null;

  if (!isAudioFile(fileUri)) {
    onProgress?.('Extracting audio…');
    tempAudio = `${FileSystem.cacheDirectory ?? ''}whisper_audio_${Date.now()}.m4a`;
    await extractAudio(fileUri, tempAudio);
    uploadUri = tempAudio;
  }

  try {
    const info = await FileSystem.getInfoAsync(uploadUri, { size: true });
    const fileSize = (info.exists && 'size' in info) ? (info as any).size as number : 0;

    let allSegments: Segment[];

    if (fileSize <= MAX_BYTES) {
      onProgress?.('Transcribing…');
      allSegments = await uploadChunk(uploadUri, apiKey);
    } else {
      // Estimated duration from file size; FFmpeg clips silently at real EOF
      const estimatedDuration = Math.ceil(fileSize / AUDIO_BPS);
      const chunkCount = Math.ceil(estimatedDuration / CHUNK_SECS);
      const tmpDir = `${FileSystem.cacheDirectory ?? ''}whisper_chunks_${Date.now()}/`;
      await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

      allSegments = [];
      try {
        for (let i = 0; i < chunkCount; i++) {
          const start = i * CHUNK_SECS;
          onProgress?.(`Transcribing part ${i + 1}/${chunkCount}…`);
          const chunkPath = `${tmpDir}chunk_${i}.m4a`;
          await splitAudio(uploadUri, start, CHUNK_SECS, chunkPath);

          // Skip chunk if FFmpeg produced nothing (past real EOF)
          const chunkInfo = await FileSystem.getInfoAsync(chunkPath, { size: true });
          if (!chunkInfo.exists || (chunkInfo as any).size < 1000) continue;

          const chunkSegs = await uploadChunk(chunkPath, apiKey);

          // Shift timestamps by chunk start offset and re-assign IDs
          const offset = start;
          for (const seg of chunkSegs) {
            allSegments.push({
              id: allSegments.length + 1,
              start: seg.start + offset,
              end: seg.end + offset,
              text: seg.text,
            });
          }
        }
      } finally {
        await FileSystem.deleteAsync(tmpDir, { idempotent: true });
      }
    }

    const srt = segmentsToSrt(allSegments);
    return { segments: allSegments, srt };
  } finally {
    if (tempAudio) {
      await FileSystem.deleteAsync(tempAudio, { idempotent: true });
    }
  }
}
