import type { TimelineSegment } from '../components/VideoTimeline';
import type { Segment } from '../types';

/**
 * Check if the full video is unchanged (no splits or all segments kept).
 */
export function isFullVideo(segments: TimelineSegment[]): boolean {
  return segments.every((s) => s.kept);
}

/**
 * Filter transcription segments to only include those within kept video ranges.
 * Adjusts timestamps so kept sections play back-to-back starting from 0.
 */
export function filterSegments(
  srtSegments: Segment[],
  timelineSegments: TimelineSegment[],
  duration: number,
): { segments: Segment[]; srt: string } {
  const kept = timelineSegments.filter((s) => s.kept);

  if (kept.length === 0 || isFullVideo(timelineSegments)) {
    return { segments: srtSegments, srt: segmentsToSrt(srtSegments) };
  }

  // Build a list of kept time ranges (in seconds)
  const keptRanges = kept.map((s) => ({
    start: s.startFrac * duration,
    end: s.endFrac * duration,
  }));

  // Compute cumulative offset for each kept range so timestamps are contiguous
  let offset = 0;
  const rangesWithOffset = keptRanges.map((r) => {
    const mapped = { ...r, offset };
    offset += r.end - r.start;
    return mapped;
  });

  // Filter and remap SRT segments
  const filtered: Segment[] = [];
  let id = 1;

  for (const seg of srtSegments) {
    for (const range of rangesWithOffset) {
      // Check if this SRT segment overlaps with this kept range
      const overlapStart = Math.max(seg.start, range.start);
      const overlapEnd = Math.min(seg.end, range.end);

      if (overlapStart < overlapEnd) {
        filtered.push({
          id: id++,
          start: overlapStart - range.start + range.offset,
          end: overlapEnd - range.start + range.offset,
          text: seg.text,
        });
      }
    }
  }

  return { segments: filtered, srt: segmentsToSrt(filtered) };
}

// ─── SRT formatting ────────────────────────────────────────────────────────────

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

function segmentsToSrt(segments: Segment[]): string {
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${toTimestamp(seg.start)} --> ${toTimestamp(seg.end)}\n${seg.text.trim()}`,
    )
    .join('\n\n');
}
