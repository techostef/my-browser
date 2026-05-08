import * as FileSystem from 'expo-file-system';
import { parseSrt, type Segment } from './srt';
import { getOpenAIKey } from '../openaiKey';
import { extractAudio } from './ffmpeg';

function isAudioFile(uri: string): boolean {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  return ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'].includes(ext);
}

export async function transcribeVideo(fileUri: string): Promise<{
  segments: Segment[];
  srt: string;
}> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    throw new Error('No OpenAI API key set. Add it in Settings → AI Subtitles.');
  }

  // Extract audio-only track for video files to reduce upload size
  let uploadUri = fileUri;
  let tempAudio: string | null = null;

  if (!isAudioFile(fileUri)) {
    tempAudio = `${FileSystem.cacheDirectory ?? ''}whisper_audio_${Date.now()}.m4a`;
    await extractAudio(fileUri, tempAudio);
    uploadUri = tempAudio;
  }

  try {
    const result = await FileSystem.uploadAsync(
      'https://api.openai.com/v1/audio/transcriptions',
      uploadUri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'audio/mp4',
        parameters: {
          model: 'whisper-1',
          response_format: 'srt',
        },
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Whisper API error (${result.status}): ${result.body}`);
    }

    const srt = result.body;
    const segments = parseSrt(srt);
    return { segments, srt: srt.trim() };
  } finally {
    if (tempAudio) {
      await FileSystem.deleteAsync(tempAudio, { idempotent: true });
    }
  }
}
