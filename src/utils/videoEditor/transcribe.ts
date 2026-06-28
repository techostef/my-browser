import { parseSrt } from '../../lib/videoEditor/srt';
import type { Segment } from '../../types/videoEditor';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';

/**
 * Transcribe a video/audio file using OpenAI Whisper API directly from the device.
 * Returns SRT text and parsed segments.
 */
export async function transcribeVideo(
  fileUri: string,
): Promise<{ segments: Segment[]; srt: string }> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      'Missing OpenAI API key. Set EXPO_PUBLIC_OPENAI_API_KEY in your .env file.',
    );
  }

  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: 'audio.mp4',
    type: 'video/mp4',
  } as unknown as Blob);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'srt');

  const response = await fetch(
    'https://api.openai.com/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
  }

  const srt = await response.text();
  const segments = parseSrt(srt);
  return { segments, srt: srt.trim() };
}
