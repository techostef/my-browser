import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

const HISTORY_KEY = '@search_history_v1';
const MAX_HISTORY = 50;

let cache: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const getSnapshot = () => cache;

const persist = (next: string[]) => {
  cache = next;
  AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  emit();
};

const loadOnce = () => {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(HISTORY_KEY).then((raw) => {
    if (raw) {
      cache = JSON.parse(raw);
      emit();
    }
  });
};

export function useSearchHistory() {
  const history = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    loadOnce();
  }, []);

  const saveEntry = useCallback((entry: string) => {
    const filtered = cache.filter((h) => h !== entry);
    persist([entry, ...filtered].slice(0, MAX_HISTORY));
  }, []);

  const deleteEntry = useCallback((entry: string) => {
    persist(cache.filter((h) => h !== entry));
  }, []);

  return { history, saveEntry, deleteEntry };
}
