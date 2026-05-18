import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Segment, SubtitleStyle } from '../../types/videoEditor';

const PREFIX = '@edit_session:';

export interface EditSession {
  videoUri: string;
  splitPoints: number[];
  deletedSegments: number[];     // Set<number> serialised as array
  subtitleSegments?: Segment[];  // saved from SubtitleEditorScreen
  subtitleStyle?: SubtitleStyle; // chosen before subtitle generation
  updatedAt: number;
}

function key(videoUri: string): string {
  return PREFIX + videoUri;
}

export async function saveSession(session: EditSession): Promise<void> {
  await AsyncStorage.setItem(key(session.videoUri), JSON.stringify(session));
}

export async function loadSession(videoUri: string): Promise<EditSession | null> {
  try {
    const raw = await AsyncStorage.getItem(key(videoUri));
    if (!raw) return null;
    return JSON.parse(raw) as EditSession;
  } catch {
    return null;
  }
}

export async function clearSession(videoUri: string): Promise<void> {
  await AsyncStorage.removeItem(key(videoUri));
}

export async function sessionExists(videoUri: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(key(videoUri));
  return raw !== null;
}
