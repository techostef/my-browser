export interface MangaTitle {
  id: string;             // slug from URL, e.g. "the-beginning-after-the-end"
  title: string;          // display name; user can rename
  coverImagePath: string; // local file:// path to cover image
  sourceUrl: string;      // manga index page URL
  chapters: MangaChapter[];
  createdAt: number;      // ms timestamp
}

export interface MangaChapter {
  id: string;             // e.g. "chapter-1"
  mangaId: string;
  chapterNumber: string;  // "1", "1.5", "2" — display + sort
  title: string;          // e.g. "The End of the Tunnel"
  url: string;            // original chapter page URL
  status: 'pending' | 'queued' | 'downloading' | 'completed' | 'failed';
  progress: number;       // 0–100
  imageCount: number;     // total pages
  downloadedImages: number;
  folderPath: string;     // absolute local path to chapter folder
  readProgress: number;   // last viewed page index (0-based)
}

// Sent by background WebView after extracting chapter list
export interface MangaChapterInfo {
  chapterNumber: string;
  title: string;
  url: string;
}

// Posted from live WebView after manga index detection
export interface MangaDetectionResult {
  found: boolean;
  indexUrl?: string;       // URL of manga series index page (for sourceUrl reference)
  chapterPageUrl?: string; // URL of the current chapter page (has full chapter select)
  mangaTitle?: string;     // title scraped from page
}
