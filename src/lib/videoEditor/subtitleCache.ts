import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Segment } from '../../types/videoEditor';

const PREFIX = '@subtitle_cache:';

interface SubtitleCacheEntry {
  videoUri: string;
  segments: Segment[];
  updatedAt: number;
}

function key(videoUri: string): string {
  return PREFIX + videoUri;
}

export async function saveSubtitles(videoUri: string, segments: Segment[]): Promise<void> {
  if (segments.length === 0) return;
  const entry: SubtitleCacheEntry = {
    videoUri,
    segments,
    updatedAt: Date.now(),
  };
  await AsyncStorage.setItem(key(videoUri), JSON.stringify(entry));
}

export async function loadSubtitles(videoUri: string): Promise<Segment[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key(videoUri));
    if (!raw) return null;
    const entry = JSON.parse(raw) as SubtitleCacheEntry;
    return entry.segments && entry.segments.length > 0 ? entry.segments : null;
  } catch {
    return null;
  }
}

export async function clearSubtitles(videoUri: string): Promise<void> {
  await AsyncStorage.removeItem(key(videoUri));
}

export async function clearAllSubtitles(): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const subtitleKeys = allKeys.filter(k => k.startsWith(PREFIX));
  if (subtitleKeys.length > 0) {
    await AsyncStorage.multiRemove(subtitleKeys);
  }
}

export async function getSubtitleCount(): Promise<number> {
  const allKeys = await AsyncStorage.getAllKeys();
  return allKeys.filter(k => k.startsWith(PREFIX)).length;
}
