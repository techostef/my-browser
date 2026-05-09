import * as FileSystem from 'expo-file-system';
import { parseSrt, segmentsToSrt, type Segment } from './srt';
import { getOpenAIKey } from '../openaiKey';
import { extractAudioChunk, probeVideoInfo } from './ffmpeg';

// Each 5-minute chunk at 16 kHz mono 32 kbps ≈ 1.2 MB — well under the 25 MB limit.
const CHUNK_SECS = 300;

// One upload should never block forever. After this we abandon the request and
// retry — the API occasionally hangs on the response side and a fresh request
// usually succeeds.
const UPLOAD_TIMEOUT_MS = 180_000; // 3 minutes
const MAX_ATTEMPTS = 3;

async function uploadOnce(audioUri: string, apiKey: string): Promise<Segment[]> {
  const upload = FileSystem.uploadAsync(
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

  const { durationSec } = await probeVideoInfo(fileUri);
  const chunkCount = Math.max(1, Math.ceil(durationSec / CHUNK_SECS));

  const tmpDir = `${FileSystem.cacheDirectory ?? ''}whisper_chunks_${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

  const allSegments: Segment[] = [];
  try {
    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SECS;
      const label = chunkCount === 1
        ? 'Transcribing…'
        : `Transcribing part ${i + 1}/${chunkCount}…`;
      onProgress?.(label);

      const chunkPath = `${tmpDir}chunk_${i}.m4a`;
      await extractAudioChunk(fileUri, start, CHUNK_SECS, chunkPath);

      const chunkInfo = await FileSystem.getInfoAsync(chunkPath, { size: true });
      if (!chunkInfo.exists || (chunkInfo as any).size < 1000) continue;

      const chunkSegs = await uploadWithRetry(chunkPath, apiKey, onProgress, label);
      for (const seg of chunkSegs) {
        allSegments.push({
          id: allSegments.length + 1,
          start: seg.start + start,
          end: seg.end + start,
          text: seg.text,
        });
      }
    }
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  }

  const srt = segmentsToSrt(allSegments);
  return { segments: allSegments, srt };
}
