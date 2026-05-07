import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@browser_settings";
const HISTORY_KEY = "@browser_history";

// ─── Search engines ───────────────────────────────────────────────────────────

export const SEARCH_ENGINES: Record<string, string> = {
  Google: "https://www.google.com/search?q=",
  Bing: "https://www.bing.com/search?q=",
  DuckDuckGo: "https://duckduckgo.com/?q=",
  Yahoo: "https://search.yahoo.com/search?p=",
  "Brave Search": "https://search.brave.com/search?q=",
  Ecosia: "https://www.ecosia.org/search?q=",
};

export const SEARCH_ENGINE_HOME: Record<string, string> = {
  Google: "https://www.google.com",
  Bing: "https://www.bing.com",
  DuckDuckGo: "https://duckduckgo.com",
  Yahoo: "https://www.yahoo.com",
  "Brave Search": "https://search.brave.com",
  Ecosia: "https://www.ecosia.org",
};

// ─── Settings state ───────────────────────────────────────────────────────────

export interface SettingsState {
  searchEngine: string;
  language: string;
  blockTrackers: boolean;
  doNotTrack: boolean;
  clearOnExit: boolean;
  theme: string;
  compactTabs: boolean;
}

const DEFAULT_SETTINGS: SettingsState = {
  searchEngine: "Google",
  language: "English",
  blockTrackers: true,
  doNotTrack: false,
  clearOnExit: false,
  theme: "System Default",
  compactTabs: false,
};

type SettingsAction = { type: "SET"; payload: Partial<SettingsState> } | { type: "RESTORE"; payload: SettingsState };

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case "SET":
      return { ...state, ...action.payload };
    case "RESTORE":
      return { ...DEFAULT_SETTINGS, ...action.payload };
    default:
      return state;
  }
}

// ─── History ──────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  timestamp: number;
}

type HistoryAction =
  | { type: "PUSH"; payload: HistoryEntry }
  | { type: "CLEAR" }
  | { type: "RESTORE"; payload: HistoryEntry[] };

function historyReducer(state: HistoryEntry[], action: HistoryAction): HistoryEntry[] {
  switch (action.type) {
    case "PUSH": {
      // Deduplicate: remove any prior entry for the same URL then prepend
      const filtered = state.filter((e) => e.url !== action.payload.url);
      return [action.payload, ...filtered].slice(0, 500);
    }
    case "CLEAR":
      return [];
    case "RESTORE":
      return action.payload;
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface SettingsContextValue {
  settings: SettingsState;
  setSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  history: HistoryEntry[];
  pushHistory: (entry: Omit<HistoryEntry, "id" | "timestamp">) => void;
  clearHistory: () => void;
  searchUrl: (query: string) => string;
  homeUrl: () => string;
  isReady: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, dispatchSettings] = useReducer(settingsReducer, DEFAULT_SETTINGS);
  const [history, dispatchHistory] = useReducer(historyReducer, []);
  const [isReady, setIsReady] = React.useState(false);

  const saveSettingsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveHistoryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount
  useEffect(() => {
    (async () => {
      try {
        const [rawSettings, rawHistory] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(HISTORY_KEY),
        ]);
        if (rawSettings) {
          const parsed = JSON.parse(rawSettings) as Partial<SettingsState>;
          dispatchSettings({ type: "RESTORE", payload: { ...DEFAULT_SETTINGS, ...parsed } });
        }
        if (rawHistory) {
          const parsed = JSON.parse(rawHistory) as HistoryEntry[];
          if (Array.isArray(parsed)) dispatchHistory({ type: "RESTORE", payload: parsed });
        }
      } catch (e) {
        console.warn("Failed to restore settings/history:", e);
      }
      setIsReady(true);
    })();
  }, []);

  // Persist settings on change (debounced)
  useEffect(() => {
    if (!isReady) return;
    if (saveSettingsTimeout.current) clearTimeout(saveSettingsTimeout.current);
    saveSettingsTimeout.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch((e) =>
        console.warn("Failed to save settings:", e)
      );
    }, 300);
  }, [settings, isReady]);

  // Persist history on change (debounced)
  useEffect(() => {
    if (!isReady) return;
    if (saveHistoryTimeout.current) clearTimeout(saveHistoryTimeout.current);
    saveHistoryTimeout.current = setTimeout(() => {
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history)).catch((e) =>
        console.warn("Failed to save history:", e)
      );
    }, 500);
  }, [history, isReady]);

  const setSetting = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    dispatchSettings({ type: "SET", payload: { [key]: value } });
  }, []);

  const pushHistory = useCallback((entry: Omit<HistoryEntry, "id" | "timestamp">) => {
    dispatchHistory({
      type: "PUSH",
      payload: {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        timestamp: Date.now(),
        ...entry,
      },
    });
  }, []);

  const clearHistory = useCallback(() => {
    dispatchHistory({ type: "CLEAR" });
  }, []);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const searchUrl = useCallback((query: string) => {
    const baseUrl = SEARCH_ENGINES[settingsRef.current.searchEngine] ?? SEARCH_ENGINES.Google;
    return baseUrl + encodeURIComponent(query);
  }, []);

  const homeUrl = useCallback(() => {
    return SEARCH_ENGINE_HOME[settingsRef.current.searchEngine] ?? SEARCH_ENGINE_HOME.Google;
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, setSetting, history, pushHistory, clearHistory, searchUrl, homeUrl, isReady }),
    [settings, setSetting, history, pushHistory, clearHistory, searchUrl, homeUrl, isReady]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
