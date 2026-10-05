import * as FileSystem from 'expo-file-system/legacy';
import { MangaTitle } from '../types/manga';

const MANGA_ROOT = 'private_downloads/Manga/';

export function sanitizeMangaName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  // "." / ".." would resolve outside the manga's own folder
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned : 'Unknown';
}

export function padChapterNumber(n: number | string): string {
  const num = parseFloat(String(n));
  const floored = Math.floor(num);
  return String(floored).padStart(3, '0');
}

/** Returns the absolute folder path for a chapter (does NOT create it). */
export function chapterFolderPath(mangaTitleSafe: string, chapterNumber: string): string {
  const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${baseDir}private_downloads/Manga/${mangaTitleSafe}/Chapter-${padChapterNumber(chapterNumber)}/`;
}

/** Returns the absolute folder path for a manga title (does NOT create it). */
export function mangaTitleFolderPath(mangaTitleSafe: string): string {
  const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${baseDir}private_downloads/Manga/${mangaTitleSafe}/`;
}

/**
 * Resolves a manga's folder on disk from the paths recorded at download time,
 * so it stays correct after the user renames the title. Returns null when the
 * result is not a direct child of the Manga root (never delete outside it).
 */
export function mangaFolderOf(manga: MangaTitle): string | null {
  const recorded =
    manga.chapters.find((ch) => ch.folderPath)?.folderPath || manga.coverImagePath;
  const folder = recorded
    ? recorded.replace(/[^/]+\/?$/, '')
    : mangaTitleFolderPath(sanitizeMangaName(manga.title));
  const idx = folder.indexOf(MANGA_ROOT);
  if (idx < 0) return null;
  const name = folder.slice(idx + MANGA_ROOT.length);
  return /^[^/]+\/$/.test(name) && !/^\.+\/$/.test(name) ? folder : null;
}

/**
 * Downloads a list of image URLs into destFolder/001.jpg, 002.jpg, etc.
 * Returns array of absolute local file paths for successfully downloaded images.
 * Retries each image up to 3 times before skipping.
 */
export async function downloadChapterImages(
  destFolder: string,
  imageUrls: string[],
  cookies: string | undefined,
  onProgress: (downloaded: number, total: number) => void,
): Promise<string[]> {
  await FileSystem.makeDirectoryAsync(destFolder, { intermediates: true });

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  };
  if (cookies) {
    headers['Cookie'] = cookies;
  }

  const downloaded: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const ext = (url.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
    const destPath = `${destFolder}${String(i + 1).padStart(3, '0')}.${safeExt}`;

    let success = false;
    for (let attempt = 0; attempt < 3 && !success; attempt++) {
      try {
        const result = await FileSystem.downloadAsync(url, destPath, { headers });
        if (result.status >= 200 && result.status < 300) {
          downloaded.push(destPath);
          success = true;
        }
      } catch {
        // retry
      }
    }
    onProgress(i + 1, imageUrls.length);
  }

  return downloaded;
}

/** Sums the sizes of all files in a chapter folder. Returns 0 on error. */
export async function getChapterSizeBytes(folderPath: string): Promise<number> {
  try {
    const files = await FileSystem.readDirectoryAsync(folderPath);
    let total = 0;
    for (const file of files) {
      const info = await FileSystem.getInfoAsync(`${folderPath}${file}`, { size: true } as any);
      if (info.exists && (info as any).size) total += (info as any).size;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Copies the first successfully downloaded image as the manga cover.
 * Cover is saved to {mangaFolder}cover.jpg
 */
export async function saveCoverImage(mangaFolder: string, firstImagePath: string): Promise<string> {
  const coverPath = `${mangaFolder}cover.jpg`;
  const info = await FileSystem.getInfoAsync(coverPath);
  if (!info.exists) {
    await FileSystem.copyAsync({ from: firstImagePath, to: coverPath }).catch(() => {});
  }
  return coverPath;
}
