import { getOpenAIKey } from '../openaiKey';
import type { Segment } from './srt';

const CHUNK_SIZE = 40;

export async function translateSegments(
  segments: Segment[],
  targetLanguage: string,
  onProgress?: (msg: string) => void,
): Promise<Segment[]> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    throw new Error('No OpenAI API key set. Add it in Settings → AI Subtitles.');
  }

  const result: Segment[] = [];
  for (let i = 0; i < segments.length; i += CHUNK_SIZE) {
    const chunk = segments.slice(i, i + CHUNK_SIZE);
    const upper = Math.min(i + CHUNK_SIZE, segments.length);
    onProgress?.(`Translating ${i + 1}–${upper} / ${segments.length}…`);
    const translated = await translateChunk(chunk, targetLanguage, apiKey);
    result.push(...translated);
  }
  return result;
}

async function translateChunk(
  chunk: Segment[],
  targetLanguage: string,
  apiKey: string,
): Promise<Segment[]> {
  const items = chunk.map(s => ({ id: s.id, text: s.text }));
  const userPrompt =
    `Translate the "text" of each item into ${targetLanguage}. ` +
    `Preserve meaning, tone and line breaks. Keep the original "id" values. ` +
    `Return ONLY a JSON object of shape {"items":[{"id":<number>,"text":<string>}]}.\n\n` +
    `Input:\n${JSON.stringify(items)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-',
      messages: [
        { role: 'system', content: 'You are a professional translator. Respond only with the requested JSON.' },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Translate failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from translator');

  let parsed: { items?: Array<{ id: number; text: string }> };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Translator returned malformed JSON');
  }

  const items2 = parsed.items ?? [];
  const textById = new Map(items2.map(it => [it.id, it.text]));
  return chunk.map(s => ({ ...s, text: textById.get(s.id) ?? s.text }));
}
