import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BrowserTab } from '../types';

const DEFAULT_URL = 'https://www.google.com';
const STORAGE_KEY = '@browser_tabs';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function createTab(url: string = DEFAULT_URL): BrowserTab {
  return {
    id: generateId(),
    url,
    lastVisitedUrl: url,
    title: 'New Tab',
    urlHistory: [url],
    historyIndex: 0,
  };
}

type TabAction =
  | { type: 'ADD_TAB'; payload?: { url?: string } }
  | { type: 'REMOVE_TAB'; payload: { id: string } }
  | { type: 'SET_ACTIVE_TAB'; payload: { id: string } }
  | { type: 'UPDATE_TAB'; payload: { id: string; url?: string; title?: string; lastVisitedUrl?: string } }
  | { type: 'SET_HIDDEN'; payload: { id: string; hidden: boolean } }
  | { type: 'PUSH_URL'; payload: { id: string; url: string; title?: string } }
  | { type: 'NAVIGATE_HISTORY'; payload: { id: string; direction: -1 | 1 } }
  | { type: 'RESTORE'; payload: TabState };

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
    case 'RESTORE': {
      // Migrate tabs that were persisted before urlHistory was added
      const tabs = action.payload.tabs.map(t => ({
        ...t,
        urlHistory: t.urlHistory ?? [t.url],
        historyIndex: t.historyIndex ?? 0,
      }));
      return { ...action.payload, tabs };
    }
    case 'ADD_TAB': {
      const newTab = createTab(action.payload?.url);
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      };
    }
    case 'REMOVE_TAB': {
      const { id } = action.payload;
      const idx = state.tabs.findIndex(t => t.id === id);
      if (idx < 0) return state;
      let newTabs = state.tabs.filter(t => t.id !== id);
      if (newTabs.filter(t => !t.hidden).length === 0) {
        newTabs = [...newTabs, createTab()];
      }
      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        const visible = newTabs.filter(t => !t.hidden);
        const visibleIdx = Math.min(
          state.tabs.slice(0, idx).filter(t => !t.hidden).length,
          visible.length - 1,
        );
        newActiveId = visible[Math.max(0, visibleIdx)].id;
      }
      return { tabs: newTabs, activeTabId: newActiveId };
    }
    case 'SET_ACTIVE_TAB': {
      return { ...state, activeTabId: action.payload.id };
    }
    case 'UPDATE_TAB': {
      const { id, ...updates } = action.payload;
      return {
        ...state,
        tabs: state.tabs.map(t => (t.id === id ? { ...t, ...updates } : t)),
      };
    }
    case 'SET_HIDDEN': {
      const { id, hidden } = action.payload;
      return {
        ...state,
        tabs: state.tabs.map(t => (t.id === id ? { ...t, hidden } : t)),
      };
    }
    case 'PUSH_URL': {
      const { id, url, title } = action.payload;
      return {
        ...state,
        tabs: state.tabs.map(t => {
          if (t.id !== id) return t;
          // Don't push if same as current position
          if (t.urlHistory[t.historyIndex] === url) {
            return title ? { ...t, title } : t;
          }
          // Truncate any forward history, then append
          const newHistory = [...t.urlHistory.slice(0, t.historyIndex + 1), url];
          return {
            ...t,
            url,
            lastVisitedUrl: url,
            title: title || t.title,
            urlHistory: newHistory,
            historyIndex: newHistory.length - 1,
          };
        }),
      };
    }
    case 'NAVIGATE_HISTORY': {
      const { id, direction } = action.payload;
      return {
        ...state,
        tabs: state.tabs.map(t => {
          if (t.id !== id) return t;
          const newIndex = t.historyIndex + direction;
          if (newIndex < 0 || newIndex >= t.urlHistory.length) return t;
          const url = t.urlHistory[newIndex];
          return { ...t, url, lastVisitedUrl: url, historyIndex: newIndex };
        }),
      };
    }
    default:
      return state;
  }
}

interface TabContextValue {
  tabs: BrowserTab[];
  activeTabId: string;
  activeTab: BrowserTab;
  isReady: boolean;
  addTab: (url?: string) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: { url?: string; title?: string; lastVisitedUrl?: string }) => void;
  setTabHidden: (id: string, hidden: boolean) => void;
  pushUrl: (id: string, url: string, title?: string) => void;
  navigateHistory: (id: string, direction: -1 | 1) => void;
}

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
            dispatch({ type: 'RESTORE', payload: parsed });
          }
        }
      } catch (e) {
        console.warn('Failed to restore tabs:', e);
      }
      setIsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(e => {
        console.warn('Failed to persist tabs:', e);
      });
    }, 500);
  }, [state, isReady]);

  const addTab = useCallback((url?: string) => {
    dispatch({ type: 'ADD_TAB', payload: url ? { url } : undefined });
  }, []);

  const removeTab = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_TAB', payload: { id } });
  }, []);

  const setActiveTab = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: { id } });
  }, []);

  const updateTab = useCallback(
    (id: string, updates: { url?: string; title?: string; lastVisitedUrl?: string }) => {
      dispatch({ type: 'UPDATE_TAB', payload: { id, ...updates } });
    },
    [],
  );

  const setTabHidden = useCallback((id: string, hidden: boolean) => {
    dispatch({ type: 'SET_HIDDEN', payload: { id, hidden } });
  }, []);

  const pushUrl = useCallback((id: string, url: string, title?: string) => {
    dispatch({ type: 'PUSH_URL', payload: { id, url, title } });
  }, []);

  const navigateHistory = useCallback((id: string, direction: -1 | 1) => {
    dispatch({ type: 'NAVIGATE_HISTORY', payload: { id, direction } });
  }, []);

  const activeTab = state.tabs.find(t => t.id === state.activeTabId) || state.tabs[0];

  return (
    <TabContext.Provider
      value={{
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        activeTab,
        isReady,
        addTab,
        removeTab,
        setActiveTab,
        updateTab,
        setTabHidden,
        pushUrl,
        navigateHistory,
      }}>
      {children}
    </TabContext.Provider>
  );
}

export function useTabs() {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error('useTabs must be used within a TabProvider');
  return ctx;
}
