import * as MediaLibrary from 'expo-media-library';

export async function requestStoragePermission(): Promise<boolean> {
  try {
    const permission = await MediaLibrary.requestPermissionsAsync();
    return permission.granted;
  } catch (err) {
    console.warn('Storage permission error:', err);
    return false;
  }
}
