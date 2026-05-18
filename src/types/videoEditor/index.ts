import type { TimelineSegment } from '../../components/videoEditor/VideoTimeline';

export interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export type SubtitleFontFamily = 'sans' | 'serif' | 'mono';
export type SubtitleFontSize = 'sm' | 'md' | 'lg' | 'xl';

export interface SubtitleStyle {
  color: string;            // background hex, e.g. '#000000'
  opacity: number;          // background 0..1; 0 means no background
  textColor: string;        // text hex; defaults to white
  fontFamily: SubtitleFontFamily;
  fontSize: SubtitleFontSize;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  color: '#000000',
  opacity: 0.65,
  textColor: '#FFFFFF',
  fontFamily: 'sans',
  fontSize: 'md',
};

// Scale multipliers applied to the height-derived base font size.
export const SUBTITLE_FONT_SCALE: Record<SubtitleFontSize, number> = {
  sm: 0.8,
  md: 1.0,
  lg: 1.2,
  xl: 1.4,
};

// CSS / canvas font-family strings (work in both WebView canvas and RN Text).
export const SUBTITLE_FONT_CSS: Record<SubtitleFontFamily, string> = {
  sans: 'sans-serif',
  serif: 'serif',
  mono: 'monospace',
};

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
    subtitleStyle?: SubtitleStyle;
  };
  Export: {
    videoUri: string;
    timelineSegments: TimelineSegment[];
    duration: number;
    segments?: Segment[];
    srt?: string;
    subtitleStyle?: SubtitleStyle;
  };
};
