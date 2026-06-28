import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { BrowserTab } from "../types";

export const HOME_URL = "about:home";
const DEFAULT_URL = HOME_URL;
const STORAGE_KEY = "@browser_tabs";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function createTab(url: string = DEFAULT_URL, incognito = false): BrowserTab {
  return {
    id: generateId(),
    url,
    lastVisitedUrl: url,
    title: "New Tab",
    urlHistory: [url],
    historyIndex: 0,
    incognito: incognito || undefined,
  };
}

type TabAction =
  | { type: "ADD_TAB"; payload?: { url?: string; incognito?: boolean } }
  | { type: "REMOVE_TAB"; payload: { id: string } }
  | { type: "SET_ACTIVE_TAB"; payload: { id: string } }
  | {
      type: "UPDATE_TAB";
      payload: {
        id: string;
        url?: string;
        title?: string;
        lastVisitedUrl?: string;
      };
    }
  | { type: "SET_HIDDEN"; payload: { id: string; hidden: boolean } }
  | { type: "PUSH_URL"; payload: { id: string; url: string; title?: string } }
  | {
      type: "REPLACE_URL";
      payload: { id: string; url: string; title?: string };
    }
  | { type: "NAVIGATE_HISTORY"; payload: { id: string; direction: -1 | 1 } }
  | { type: "REMOVE_MULTIPLE_TABS"; payload: { ids: string[] } }
  | { type: "RESTORE"; payload: TabState };

interface TabState {
  tabs: BrowserTab[];
  activeTabId: string;
}

const initialTab = createTab();
const initialState: TabState = {
  tabs: [initialTab],
  activeTabId: initialTab.id,
};

function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case "RESTORE": {
      // Migrate tabs that were persisted before urlHistory was added
      const tabs = action.payload.tabs.map((t) => ({
        ...t,
        urlHistory: t.urlHistory ?? [t.url],
        historyIndex: t.historyIndex ?? 0,
      }));
      return { ...action.payload, tabs };
    }
    case "ADD_TAB": {
      const newTab = createTab(action.payload?.url, action.payload?.incognito);
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      };
    }
    case "REMOVE_TAB": {
      const { id } = action.payload;
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return state;
      let newTabs = state.tabs.filter((t) => t.id !== id);
      if (newTabs.filter((t) => !t.hidden).length === 0) {
        newTabs = [...newTabs, createTab()];
      }
      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        const visible = newTabs.filter((t) => !t.hidden);
        const visibleIdx = Math.min(
          state.tabs.slice(0, idx).filter((t) => !t.hidden).length,
          visible.length - 1,
        );
        newActiveId = visible[Math.max(0, visibleIdx)].id;
      }
      return { tabs: newTabs, activeTabId: newActiveId };
    }
    case "REMOVE_MULTIPLE_TABS": {
      const idSet = new Set(action.payload.ids);
      let newTabs = state.tabs.filter((t) => !idSet.has(t.id));
      if (newTabs.filter((t) => !t.hidden).length === 0) {
        newTabs = [...newTabs, createTab()];
      }
      const newActiveId = idSet.has(state.activeTabId)
        ? (newTabs.find((t) => !t.hidden)?.id ?? newTabs[0].id)
        : state.activeTabId;
      return { tabs: newTabs, activeTabId: newActiveId };
    }
    case "UPDATE_TAB": {
      const { id, ...updates } = action.payload;
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return state;
      const current = state.tabs[idx];
      // Bail out when nothing actually changes — avoids needless context updates.
      const changed = (Object.keys(updates) as (keyof typeof updates)[]).some(
        (k) => updates[k] !== undefined && current[k] !== updates[k],
      );
      if (!changed) return state;
      const newTabs = state.tabs.slice();
      newTabs[idx] = { ...current, ...updates };
      return { ...state, tabs: newTabs };
    }
    case "SET_HIDDEN": {
      const { id, hidden } = action.payload;
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx < 0 || state.tabs[idx].hidden === hidden) return state;
      const newTabs = state.tabs.slice();
      newTabs[idx] = { ...newTabs[idx], hidden };
      return { ...state, tabs: newTabs };
    }
    case "PUSH_URL": {
      const { id, url, title } = action.payload;
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return state;
      const current = state.tabs[idx];
      const sameUrl = current.urlHistory[current.historyIndex] === url;
      if (sameUrl) {
        // Nothing to push. Only update title if it actually differs.
        if (!title || current.title === title) return state;
        const newTabs = state.tabs.slice();
        newTabs[idx] = { ...current, title };
        return { ...state, tabs: newTabs };
      }
      // Truncate any forward history, then append.
      const newHistory = [
        ...current.urlHistory.slice(0, current.historyIndex + 1),
        url,
      ];
      const newTabs = state.tabs.slice();
      newTabs[idx] = {
        ...current,
        url,
        lastVisitedUrl: url,
        title: title || current.title,
        urlHistory: newHistory,
        historyIndex: newHistory.length - 1,
      };
      return { ...state, tabs: newTabs };
    }
    case "REPLACE_URL": {
      // Overwrite the URL at the current history position without growing the
      // stack. Used when the page only changed query params / fragment so
      // back-navigation can skip these transient URLs.
      const { id, url, title } = action.payload;
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return state;
      const current = state.tabs[idx];
      const sameUrl = current.urlHistory[current.historyIndex] === url;
      const sameTitle = !title || current.title === title;
      if (sameUrl && sameTitle) return state;
      const newHistory = current.urlHistory.slice();
      newHistory[current.historyIndex] = url;
      const newTabs = state.tabs.slice();
      newTabs[idx] = {
        ...current,
        url,
        lastVisitedUrl: url,
        title: title || current.title,
        urlHistory: newHistory,
      };
      return { ...state, tabs: newTabs };
    }
    case "NAVIGATE_HISTORY": {
      const { id, direction } = action.payload;
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return state;
      const current = state.tabs[idx];
      const newIndex = current.historyIndex + direction;
      if (newIndex < 0 || newIndex >= current.urlHistory.length) return state;
      const url = current.urlHistory[newIndex];
      const newTabs = state.tabs.slice();
      newTabs[idx] = {
        ...current,
        url,
        lastVisitedUrl: url,
        historyIndex: newIndex,
      };
      return { ...state, tabs: newTabs };
    }
    case "SET_ACTIVE_TAB": {
      if (state.activeTabId === action.payload.id) return state;
      return { ...state, activeTabId: action.payload.id };
    }
    default:
      return state;
  }
}

interface TabActions {
  addTab: (url?: string, incognito?: boolean) => void;
  removeTab: (id: string) => void;
  removeMultipleTabs: (ids: string[]) => void;
  setActiveTab: (id: string) => void;
  updateTab: (
    id: string,
    updates: { url?: string; title?: string; lastVisitedUrl?: string },
  ) => void;
  setTabHidden: (id: string, hidden: boolean) => void;
  pushUrl: (id: string, url: string, title?: string) => void;
  replaceUrl: (id: string, url: string, title?: string) => void;
  navigateHistory: (id: string, direction: -1 | 1) => void;
  getTabsSnapshot: () => BrowserTab[];
}

interface TabContextValue extends TabActions {
  tabs: BrowserTab[];
  activeTabId: string;
  activeTab: BrowserTab;
  isReady: boolean;
}

// Split contexts so consumers can subscribe to only the slice they need.
// Components that only consume actions won't re-render when tabs change,
// and components that only read `activeTabId` won't re-render on title updates.
const TabListContext = createContext<BrowserTab[] | null>(null);
const ActiveTabIdContext = createContext<string>("");
const IsReadyContext = createContext<boolean>(false);
const TabActionsContext = createContext<TabActions | null>(null);

// Legacy aggregate context kept for backwards compatibility with existing callers.
const TabContext = createContext<TabContextValue | null>(null);

export function TabProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tabReducer, initialState);
  const [isReady, setIsReady] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed: TabState = JSON.parse(stored);
          if (parsed.tabs && parsed.tabs.length > 0 && parsed.activeTabId) {
            dispatch({ type: "RESTORE", payload: parsed });
            const activeTab = parsed.tabs.find(
              (t) => t.id === parsed.activeTabId,
            );
            if (activeTab?.url !== HOME_URL) {
              dispatch({ type: "ADD_TAB", payload: { url: HOME_URL } });
            }
          }
        }
      } catch (e) {
        console.warn("Failed to restore tabs:", e);
      }
      setIsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      // Never persist incognito tabs
      const persistState = {
        ...state,
        tabs: state.tabs.filter((t) => !t.incognito),
      };
      // If active tab was incognito, don't persist an invalid activeTabId
      const hasActive = persistState.tabs.some(
        (t) => t.id === persistState.activeTabId,
      );
      if (!hasActive && persistState.tabs.length > 0) {
        persistState.activeTabId =
          persistState.tabs[persistState.tabs.length - 1].id;
      }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persistState)).catch(
        (e) => {
          console.warn("Failed to persist tabs:", e);
        },
      );
    }, 500);
  }, [state, isReady]);

  const addTab = useCallback((url?: string, incognito?: boolean) => {
    dispatch({ type: "ADD_TAB", payload: { url, incognito } });
  }, []);

  const removeTab = useCallback((id: string) => {
    dispatch({ type: "REMOVE_TAB", payload: { id } });
  }, []);

  const removeMultipleTabs = useCallback((ids: string[]) => {
    dispatch({ type: "REMOVE_MULTIPLE_TABS", payload: { ids } });
  }, []);

  const setActiveTab = useCallback((id: string) => {
    dispatch({ type: "SET_ACTIVE_TAB", payload: { id } });
  }, []);

  const updateTab = useCallback(
    (
      id: string,
      updates: { url?: string; title?: string; lastVisitedUrl?: string },
    ) => {
      dispatch({ type: "UPDATE_TAB", payload: { id, ...updates } });
    },
    [],
  );

  const setTabHidden = useCallback((id: string, hidden: boolean) => {
    dispatch({ type: "SET_HIDDEN", payload: { id, hidden } });
  }, []);

  const pushUrl = useCallback((id: string, url: string, title?: string) => {
    dispatch({ type: "PUSH_URL", payload: { id, url, title } });
  }, []);

  const replaceUrl = useCallback((id: string, url: string, title?: string) => {
    dispatch({ type: "REPLACE_URL", payload: { id, url, title } });
  }, []);

  const navigateHistory = useCallback((id: string, direction: -1 | 1) => {
    dispatch({ type: "NAVIGATE_HISTORY", payload: { id, direction } });
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0],
    [state.tabs, state.activeTabId],
  );

  // Snapshot accessor so callbacks can read latest tabs without subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;
  const getTabsSnapshot = useCallback(() => stateRef.current.tabs, []);

  // Actions are stable for the lifetime of the provider — consumers of this
  // context never re-render from state updates.
  const actions = useMemo<TabActions>(
    () => ({
      addTab,
      removeTab,
      removeMultipleTabs,
      setActiveTab,
      updateTab,
      setTabHidden,
      pushUrl,
      replaceUrl,
      navigateHistory,
      getTabsSnapshot,
    }),
    [
      addTab,
      removeTab,
      removeMultipleTabs,
      setActiveTab,
      updateTab,
      setTabHidden,
      pushUrl,
      replaceUrl,
      navigateHistory,
      getTabsSnapshot,
    ],
  );

  const legacyValue = useMemo<TabContextValue>(
    () => ({
      ...actions,
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      activeTab,
      isReady,
    }),
    [actions, state.tabs, state.activeTabId, activeTab, isReady],
  );

  return (
    <TabActionsContext.Provider value={actions}>
      <IsReadyContext.Provider value={isReady}>
        <TabListContext.Provider value={state.tabs}>
          <ActiveTabIdContext.Provider value={state.activeTabId}>
            <TabContext.Provider value={legacyValue}>
              {children}
            </TabContext.Provider>
          </ActiveTabIdContext.Provider>
        </TabListContext.Provider>
      </IsReadyContext.Provider>
    </TabActionsContext.Provider>
  );
}

export function useTabs() {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error("useTabs must be used within a TabProvider");
  return ctx;
}

export function useTabActions(): TabActions {
  const ctx = useContext(TabActionsContext);
  if (!ctx) throw new Error("useTabActions must be used within a TabProvider");
  return ctx;
}

export function useTabList(): BrowserTab[] {
  const ctx = useContext(TabListContext);
  if (!ctx) throw new Error("useTabList must be used within a TabProvider");
  return ctx;
}

export function useActiveTabId(): string {
  return useContext(ActiveTabIdContext);
}

export function useIsTabsReady(): boolean {
  return useContext(IsReadyContext);
}

export function useActiveTab(): BrowserTab {
  const tabs = useTabList();
  const activeTabId = useActiveTabId();
  return useMemo(
    () => tabs.find((t) => t.id === activeTabId) || tabs[0],
    [tabs, activeTabId],
  );
}
