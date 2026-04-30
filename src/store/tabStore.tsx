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
  };
}

type TabAction =
  | { type: 'ADD_TAB'; payload?: { url?: string } }
  | { type: 'REMOVE_TAB'; payload: { id: string } }
  | { type: 'SET_ACTIVE_TAB'; payload: { id: string } }
  | { type: 'UPDATE_TAB'; payload: { id: string; url?: string; title?: string; lastVisitedUrl?: string } }
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
      return action.payload;
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
      if (state.tabs.length <= 1) return state; // Keep at least one tab
      const idx = state.tabs.findIndex(t => t.id === id);
      const newTabs = state.tabs.filter(t => t.id !== id);
      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        // Switch to the tab before the removed one, or the first tab
        const newIdx = Math.min(idx, newTabs.length - 1);
        newActiveId = newTabs[newIdx].id;
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
}

const TabContext = createContext<TabContextValue | null>(null);

export function TabProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tabReducer, initialState);
  const [isReady, setIsReady] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore tabs from storage on mount
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

  // Persist tabs to storage on every state change (debounced)
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
