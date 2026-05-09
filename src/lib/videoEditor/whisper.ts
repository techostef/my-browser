import * as FileSystem from 'expo-file-system';
import { parseSrt, segmentsToSrt, type Segment } from './srt';
import { getOpenAIKey } from '../openaiKey';
import { extractAudioChunk, probeVideoInfo } from './ffmpeg';

// Each 5-minute chunk at mono 64 kbps AAC ≈ 2.4 MB — well under the 25 MB limit.
const CHUNK_SECS = 300;

// User-imported model lives here. Import via Settings → Whisper Model.
export const LOCAL_MODEL_PATH = `${FileSystem.documentDirectory ?? ''}whisper_model/model.bin`;

const UPLOAD_TIMEOUT_MS = 180_000; // 3 minutes
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// OpenAI API path
// ---------------------------------------------------------------------------

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

// Upload is network-bound — run this many chunks simultaneously.
const API_CONCURRENCY = 4;

async function transcribeWithApi(
  fileUri: string,
  chunkCount: number,
  tmpDir: string,
  apiKey: string,
  onProgress?: (msg: string) => void,
): Promise<Segment[]> {
  // chunkCount of 500 means duration was unknown; don't show a misleading total.
  const showTotal = chunkCount < 500;
  const resultsByChunk: (Segment[] | null)[] = [];

  for (let batchStart = 0; batchStart < chunkCount; batchStart += API_CONCURRENCY) {
    const batchEnd = Math.min(batchStart + API_CONCURRENCY, chunkCount);
    const rangeLabel = batchEnd - batchStart === 1
      ? `part ${batchStart + 1}`
      : `parts ${batchStart + 1}–${batchEnd}`;
    onProgress?.(showTotal
      ? `Transcribing ${rangeLabel} / ${chunkCount}…`
      : `Transcribing ${rangeLabel}…`);

    const batchResults = await Promise.all(
      Array.from({ length: batchEnd - batchStart }, async (_, j) => {
        const i = batchStart + j;
        const start = i * CHUNK_SECS;
        const chunkPath = `${tmpDir}chunk_${i}.m4a`;

        await extractAudioChunk(fileUri, start, CHUNK_SECS, chunkPath);
        const info = await FileSystem.getInfoAsync(chunkPath, { size: true });
        if (!info.exists || (info as any).size < 1000) return null;

        const segs = await uploadWithRetry(chunkPath, apiKey);
        return segs.map(seg => ({
          id: 0,
          start: seg.start + start,
          end: seg.end + start,
          text: seg.text,
        }));
      }),
    );

    let reachedEnd = false;
    for (const result of batchResults) {
      resultsByChunk.push(result);
      if (result === null) { reachedEnd = true; break; }
    }
    if (reachedEnd) break;
  }

  // Flatten in chunk order and assign final IDs.
  const allSegments: Segment[] = [];
  for (const segs of resultsByChunk) {
    if (!segs) continue;
    for (const seg of segs) {
      allSegments.push({ ...seg, id: allSegments.length + 1 });
    }
  }
  return allSegments;
}

// ---------------------------------------------------------------------------
// On-device path (whisper.rn)
// Fails fast if the package isn't installed or the model file is missing —
// the caller catches and falls back to the API path.
// ---------------------------------------------------------------------------

async function transcribeLocally(
  fileUri: string,
  chunkCount: number,
  tmpDir: string,
  onProgress?: (msg: string) => void,
): Promise<Segment[]> {
  let initWhisper: ((opts: { filePath: string }) => Promise<any>) | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    initWhisper = require('whisper.rn').initWhisper;
  } catch {
    throw new Error('whisper.rn not installed');
  }

  const modelInfo = await FileSystem.getInfoAsync(LOCAL_MODEL_PATH);
  if (!modelInfo.exists) throw new Error('No local Whisper model found. Import one in Settings → Whisper Model.');

  const ctx = await initWhisper!({ filePath: LOCAL_MODEL_PATH });
  const allSegments: Segment[] = [];
  try {
    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SECS;
      const label = chunkCount === 1
        ? 'Transcribing (on-device)…'
        : `Transcribing part ${i + 1}/${chunkCount} (on-device)…`;
      onProgress?.(label);

      const chunkPath = `${tmpDir}chunk_${i}.m4a`;
      await extractAudioChunk(fileUri, start, CHUNK_SECS, chunkPath);

      const chunkInfo = await FileSystem.getInfoAsync(chunkPath, { size: true });
      if (!chunkInfo.exists || (chunkInfo as any).size < 1000) break;

      // whisper.rn returns t0/t1 in centiseconds
      const { promise } = ctx.transcribe(chunkPath, {
        language: 'ja',
        maxLen: 1,
        tokenTimestamps: true,
      });
      const { segments } = await promise;

      for (const seg of (segments ?? []) as any[]) {
        const text = String(seg.text ?? '').trim();
        if (!text) continue;
        allSegments.push({
          id: allSegments.length + 1,
          start: (seg.t0 as number) / 100 + start,
          end: (seg.t1 as number) / 100 + start,
          text,
        });
      }
    }
  } finally {
    await ctx.release?.();
  }
  return allSegments;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function transcribeVideo(
  fileUri: string,
  onProgress?: (msg: string) => void,
  source: 'ai' | 'local' = 'ai',
): Promise<{ segments: Segment[]; srt: string }> {
  const { durationSec } = await probeVideoInfo(fileUri);
  // If probe fails (returns 0) use a large upper bound — the loop breaks on the
  // first empty chunk so we won't overshoot by more than one iteration.
  const chunkCount = durationSec > 0
    ? Math.max(1, Math.ceil(durationSec / CHUNK_SECS))
    : 500;

  const tmpDir = `${FileSystem.cacheDirectory ?? ''}whisper_chunks_${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

  try {
    if (source === 'local') {
      // On-device only — throws if model is missing or inference fails.
      const segments = await transcribeLocally(fileUri, chunkCount, tmpDir, onProgress);
      return { segments, srt: segmentsToSrt(segments) };
    }

    // AI path
    const apiKey = await getOpenAIKey();
    if (!apiKey) {
      throw new Error('No OpenAI API key set. Add it in Settings → AI Subtitles.');
    }
    const segments = await transcribeWithApi(fileUri, chunkCount, tmpDir, apiKey, onProgress);
    return { segments, srt: segmentsToSrt(segments) };
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true });
  }
}
