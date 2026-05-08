import type { TimelineSegment } from '../../components/videoEditor/VideoTimeline';

export interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface UploadResponse {
  filePath: string;
  segments: Segment[];
  srt: string;
}

export type RootStackParamList = {
  MainTabs: undefined;
  Trim: {
    videoUri: string;
    duration: number;
  };
  SubtitleEditor: {
    videoUri: string;
    segments: Segment[];
    srt: string;
    timelineSegments: TimelineSegment[];
    duration: number;
  };
  Export: {
    videoUri: string;
    timelineSegments: TimelineSegment[];
    duration: number;
    srt?: string;
  };
};
