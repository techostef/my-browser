import OpenAI from 'openai';
import { createReadStream } from 'fs';
import { parseSrt, type Segment } from '../../lib/videoEditor/srt';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribeVideo(filePath: string): Promise<{
  segments: Segment[];
  srt: string;
}> {
  const srt = await openai.audio.transcriptions.create({
    file: createReadStream(filePath),
    model: 'whisper-1',
    response_format: 'srt',
  }) as unknown as string;

  const segments = parseSrt(srt);
  return { segments, srt: srt.trim() };
}
