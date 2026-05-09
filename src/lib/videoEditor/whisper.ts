import * as FileSystem from 'expo-file-system';
import { parseSrt, segmentsToSrt, type Segment } from './srt';
import { getOpenAIKey } from '../openaiKey';
import { extractAudio, splitAudio } from './ffmpeg';

// Audio is mono 64 kbps AAC (extractAudio). Sizes:
//   10-minute chunk ≈ 4.8 MB — small enough for slow connections, safely under
//   OpenAI's 25 MB hard limit even with HTTP overhead.
const CHUNK_SECS = 600;
const MAX_BYTES = 24 * 1024 * 1024;
const AUDIO_BPS = 8000; // 64 kbps / 8

// One upload should never block forever. After this we abandon the request and
// retry — Whisper occasionally hangs on the response side and a fresh request
// usually succeeds.
const UPLOAD_TIMEOUT_MS = 180_000; // 3 minutes
const MAX_ATTEMPTS = 3;

function isAudioFile(uri: string): boolean {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  return ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'].includes(ext);
}

async function uploadOnce(audioUri: string, apiKey: string): Promise<Segment[]> {
  const upload = FileSystem.uploadAsync(
    'https://api.openai.com/v1/audio/transcriptions',
    audioUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'audio/mp4',
      parameters: { model: 'gpt-4o-mini-transcribe', response_format: 'srt' },
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );

  // Soft timeout — uploadAsync can't be cancelled, but we can stop waiting on
  // it. The orphaned request finishes in the background harmlessly.
  const result = await Promise.race([
    upload,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Upload timed out')), UPLOAD_TIMEOUT_MS),
    ),
  ]);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Whisper API error (${result.status}): ${result.body}`);
  }
  return parseSrt(result.body);
}

async function uploadWithRetry(
  audioUri: string,
  apiKey: string,
  onProgress?: (msg: string) => void,
  baseLabel?: string,
): Promise<Segment[]> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1 && baseLabel) {
        onProgress?.(`${baseLabel} (retry ${attempt - 1}/${MAX_ATTEMPTS - 1})…`);
      }
      return await uploadOnce(audioUri, apiKey);
    } catch (e) {
      lastErr = e as Error;
      if (attempt < MAX_ATTEMPTS) {
        // Exponential backoff: 2s, 4s
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastErr ?? new Error('Whisper upload failed');
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
      const label = 'Transcribing…';
      onProgress?.(label);
      allSegments = await uploadWithRetry(uploadUri, apiKey, onProgress, label);
    } else {
      const estimatedDuration = Math.ceil(fileSize / AUDIO_BPS);
      const chunkCount = Math.ceil(estimatedDuration / CHUNK_SECS);
      const tmpDir = `${FileSystem.cacheDirectory ?? ''}whisper_chunks_${Date.now()}/`;
      await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

      allSegments = [];
      try {
        for (let i = 0; i < chunkCount; i++) {
          const start = i * CHUNK_SECS;
          const label = `Transcribing part ${i + 1}/${chunkCount}…`;
          onProgress?.(label);
          const chunkPath = `${tmpDir}chunk_${i}.m4a`;
          await splitAudio(uploadUri, start, CHUNK_SECS, chunkPath);

          const chunkInfo = await FileSystem.getInfoAsync(chunkPath, { size: true });
          if (!chunkInfo.exists || (chunkInfo as any).size < 1000) continue;

          const chunkSegs = await uploadWithRetry(chunkPath, apiKey, onProgress, label);

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
