import type { Segment } from '../../types/videoEditor';

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

export function segmentsToSrt(segments: Segment[]): string {
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${toTimestamp(seg.start)} --> ${toTimestamp(seg.end)}\n${seg.text.trim()}`
    )
    .join('\n\n');
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
