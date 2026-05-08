import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@openai_api_key';

export async function getOpenAIKey(): Promise<string> {
  return (await AsyncStorage.getItem(KEY)) ?? '';
}

export async function setOpenAIKey(key: string): Promise<void> {
  await AsyncStorage.setItem(KEY, key.trim());
}

export async function clearOpenAIKey(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
