import type { TimelineSegment } from '../../components/videoEditor/VideoTimeline';
import { segmentsToSrt } from '../../lib/videoEditor/srt';
import type { Segment } from '../../types/videoEditor';

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
