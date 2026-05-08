export interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
}

function toTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return (
    `${String(h).padStart(2, '0')}:` +
    `${String(m).padStart(2, '0')}:` +
    `${String(s).padStart(2, '0')},` +
    `${String(ms).padStart(3, '0')}`
  );
}

function parseTimestamp(ts: string): number {
  const [hms = '0:0:0', msStr = '0'] = ts.trim().split(',');
  const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(msStr) / 1000;
}

export function segmentsToSrt(segments: Segment[]): string {
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${toTimestamp(seg.start)} --> ${toTimestamp(seg.end)}\n${seg.text.trim()}`
    )
    .join('\n\n');
}

export function parseSrt(srt: string): Segment[] {
  return srt
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block, i) => {
      const lines = block.split('\n');
      const timeLine = lines[1] ?? '';
      const [startStr = '', endStr = ''] = timeLine.split(' --> ');
      return {
        id: i + 1,
        start: parseTimestamp(startStr),
        end: parseTimestamp(endStr),
        text: lines.slice(2).join('\n').trim(),
      };
    });
}
