import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@browser_settings";
const HISTORY_KEY = "@browser_history";
const BOOKMARKS_KEY = "@browser_bookmarks";

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

// ─── Theme tokens ─────────────────────────────────────────────────────────────

export type ColorScheme = "light" | "dark";

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSecondary: string;
  border: string;
  text: string;
  textSecondary: string;
  tabBar: string;
  tabBarBorder: string;
  tabBarActive: string;
  tabBarInactive: string;
  inputBackground: string;
  inputBorder: string;
  navButton: string;
  addressBar: string;
}

const LIGHT: ThemeColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSecondary: "#F2F2F7",
  border: "#E5E5EA",
  text: "#1C1C1E",
  textSecondary: "#8E8E93",
  tabBar: "#FFFFFF",
  tabBarBorder: "#EEEEEE",
  tabBarActive: "#4ECDC4",
  tabBarInactive: "#999999",
  inputBackground: "#FFFFFF",
  inputBorder: "#DDDDDD",
  navButton: "#E8E8E8",
  addressBar: "#F8F8F8",
};

const DARK: ThemeColors = {
  background: "#000000",
  surface: "#1C1C1E",
  surfaceSecondary: "#2C2C2E",
  border: "#3A3A3C",
  text: "#FFFFFF",
  textSecondary: "#8E8E93",
  tabBar: "#1C1C1E",
  tabBarBorder: "#3A3A3C",
  tabBarActive: "#4ECDC4",
  tabBarInactive: "#636366",
  inputBackground: "#2C2C2E",
  inputBorder: "#3A3A3C",
  navButton: "#2C2C2E",
  addressBar: "#1C1C1E",
};

export const THEME_COLORS: Record<ColorScheme, ThemeColors> = { light: LIGHT, dark: DARK };

// ─── Shortcuts ────────────────────────────────────────────────────────────────

export interface Shortcut {
  id: string;
  title: string;
  url: string;
  /** Emoji or single char used as fallback favicon */
  emoji?: string;
}

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: "s1", title: "GitHub",      url: "https://github.com",           emoji: "🐙" },
  { id: "s2", title: "YouTube",     url: "https://youtube.com",          emoji: "▶️" },
  { id: "s3", title: "ChatGPT",     url: "https://chat.openai.com",      emoji: "🤖" },
  { id: "s4", title: "Reddit",      url: "https://reddit.com",           emoji: "🟠" },
  { id: "s5", title: "X / Twitter", url: "https://x.com",                emoji: "𝕏" },
  { id: "s6", title: "Wikipedia",   url: "https://wikipedia.org",        emoji: "📖" },
];

// ─── Settings state ───────────────────────────────────────────────────────────

export interface SettingsState {
  searchEngine: string;
  language: string;
  theme: string;
  compactTabs: boolean;
  shortcuts: Shortcut[];
}

const DEFAULT_SETTINGS: SettingsState = {
  searchEngine: "Google",
  language: "English",
  theme: "System Default",
  compactTabs: false,
  shortcuts: DEFAULT_SHORTCUTS,
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

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}

type BookmarkAction =
  | { type: "ADD"; payload: Bookmark }
  | { type: "REMOVE"; payload: { id: string } }
  | { type: "RESTORE"; payload: Bookmark[] };

function bookmarkReducer(state: Bookmark[], action: BookmarkAction): Bookmark[] {
  switch (action.type) {
    case "ADD":
      return [action.payload, ...state.filter((b) => b.url !== action.payload.url)];
    case "REMOVE":
      return state.filter((b) => b.id !== action.payload.id);
    case "RESTORE":
      return action.payload;
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
  bookmarks: Bookmark[];
  addBookmark: (entry: Omit<Bookmark, "id" | "createdAt">) => void;
  removeBookmark: (id: string) => void;
  searchUrl: (query: string) => string;
  homeUrl: () => string;
  addShortcut: (shortcut: Omit<Shortcut, "id">) => void;
  removeShortcut: (id: string) => void;
  resolvedScheme: ColorScheme;
  themeColors: ThemeColors;
  isReady: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, dispatchSettings] = useReducer(settingsReducer, DEFAULT_SETTINGS);
  const [history, dispatchHistory] = useReducer(historyReducer, []);
  const [bookmarks, dispatchBookmarks] = useReducer(bookmarkReducer, []);
  const [isReady, setIsReady] = React.useState(false);
  const systemScheme = useColorScheme();

  const saveSettingsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveHistoryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveBookmarksTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount
  useEffect(() => {
    (async () => {
      try {
        const [rawSettings, rawHistory, rawBookmarks] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(HISTORY_KEY),
          AsyncStorage.getItem(BOOKMARKS_KEY),
        ]);
        if (rawSettings) {
          const parsed = JSON.parse(rawSettings) as Partial<SettingsState>;
          dispatchSettings({ type: "RESTORE", payload: { ...DEFAULT_SETTINGS, ...parsed } });
        }
        if (rawHistory) {
          const parsed = JSON.parse(rawHistory) as HistoryEntry[];
          if (Array.isArray(parsed)) dispatchHistory({ type: "RESTORE", payload: parsed });
        }
        if (rawBookmarks) {
          const parsed = JSON.parse(rawBookmarks) as Bookmark[];
          if (Array.isArray(parsed)) dispatchBookmarks({ type: "RESTORE", payload: parsed });
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

  // Persist bookmarks on change (debounced)
  useEffect(() => {
    if (!isReady) return;
    if (saveBookmarksTimeout.current) clearTimeout(saveBookmarksTimeout.current);
    saveBookmarksTimeout.current = setTimeout(() => {
      AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks)).catch((e) =>
        console.warn("Failed to save bookmarks:", e)
      );
    }, 300);
  }, [bookmarks, isReady]);

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

  const addBookmark = useCallback((entry: Omit<Bookmark, "id" | "createdAt">) => {
    dispatchBookmarks({
      type: "ADD",
      payload: {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: Date.now(),
        ...entry,
      },
    });
  }, []);

  const removeBookmark = useCallback((id: string) => {
    dispatchBookmarks({ type: "REMOVE", payload: { id } });
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

  const addShortcut = useCallback((shortcut: Omit<Shortcut, "id">) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    dispatchSettings({
      type: "SET",
      payload: { shortcuts: [...settingsRef.current.shortcuts, { ...shortcut, id }] },
    });
  }, []);

  const removeShortcut = useCallback((id: string) => {
    dispatchSettings({
      type: "SET",
      payload: { shortcuts: settingsRef.current.shortcuts.filter((s) => s.id !== id) },
    });
  }, []);

  const resolvedScheme: ColorScheme =
    settings.theme === "Dark" ? "dark"
    : settings.theme === "Light" ? "light"
    : (systemScheme ?? "light");

  const themeColors = THEME_COLORS[resolvedScheme];

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, setSetting, history, pushHistory, clearHistory, bookmarks, addBookmark, removeBookmark, searchUrl, homeUrl, addShortcut, removeShortcut, resolvedScheme, themeColors, isReady }),
    [settings, setSetting, history, pushHistory, clearHistory, bookmarks, addBookmark, removeBookmark, searchUrl, homeUrl, addShortcut, removeShortcut, resolvedScheme, themeColors, isReady]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

export function useThemeColors(): ThemeColors {
  return useSettings().themeColors;
}
