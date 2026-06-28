import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
} from "react";
import { MangaChapter, MangaTitle } from "../types/manga";

const STORAGE_KEY = "@manga_library_v1";

interface MangaState {
  titles: MangaTitle[];
  loaded: boolean;
}

type MangaAction =
  | { type: "LOAD"; payload: MangaTitle[] }
  | { type: "ADD_TITLE"; payload: MangaTitle }
  | {
      type: "UPDATE_TITLE";
      payload: { id: string; changes: Partial<MangaTitle> };
    }
  | { type: "REMOVE_TITLE"; payload: { id: string } }
  | {
      type: "UPDATE_CHAPTER";
      payload: {
        mangaId: string;
        chapterId: string;
        changes: Partial<MangaChapter>;
      };
    }
  | { type: "REMOVE_CHAPTER"; payload: { mangaId: string; chapterId: string } };

function reducer(state: MangaState, action: MangaAction): MangaState {
  switch (action.type) {
    case "LOAD":
      return {
        titles: action.payload.map((t) => ({
          ...t,
          chapters: t.chapters.map((c) =>
            c.status === "downloading" || c.status === "queued"
              ? { ...c, status: "failed" as const, progress: 0 }
              : c,
          ),
        })),
        loaded: true,
      };
    case "ADD_TITLE":
      return { ...state, titles: [action.payload, ...state.titles] };
    case "UPDATE_TITLE":
      return {
        ...state,
        titles: state.titles.map((t) =>
          t.id === action.payload.id ? { ...t, ...action.payload.changes } : t,
        ),
      };
    case "REMOVE_TITLE":
      return {
        ...state,
        titles: state.titles.filter((t) => t.id !== action.payload.id),
      };
    case "UPDATE_CHAPTER":
      return {
        ...state,
        titles: state.titles.map((t) =>
          t.id === action.payload.mangaId
            ? {
                ...t,
                chapters: t.chapters.map((c) =>
                  c.id === action.payload.chapterId
                    ? { ...c, ...action.payload.changes }
                    : c,
                ),
              }
            : t,
        ),
      };
    case "REMOVE_CHAPTER":
      return {
        ...state,
        titles: state.titles.map((t) =>
          t.id === action.payload.mangaId
            ? {
                ...t,
                chapters: t.chapters.filter(
                  (c) => c.id !== action.payload.chapterId,
                ),
              }
            : t,
        ),
      };
    default:
      return state;
  }
}

interface MangaContextValue {
  titles: MangaTitle[];
  loaded: boolean;
  addTitle: (title: MangaTitle) => void;
  updateTitle: (id: string, changes: Partial<MangaTitle>) => void;
  removeTitle: (id: string) => Promise<void>;
  updateChapter: (
    mangaId: string,
    chapterId: string,
    changes: Partial<MangaChapter>,
  ) => void;
  removeChapter: (mangaId: string, chapterId: string) => Promise<void>;
  getTitle: (id: string) => MangaTitle | undefined;
}

const MangaContext = createContext<MangaContextValue | null>(null);

export function MangaProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { titles: [], loaded: false });

  // Load from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        dispatch({ type: "LOAD", payload: raw ? JSON.parse(raw) : [] });
      })
      .catch(() => {
        dispatch({ type: "LOAD", payload: [] });
      });
  }, []);

  // Persist whenever titles change (after initial load)
  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state.titles)).catch(
      () => {},
    );
  }, [state.titles, state.loaded]);

  const addTitle = useCallback((title: MangaTitle) => {
    dispatch({ type: "ADD_TITLE", payload: title });
  }, []);

  const updateTitle = useCallback(
    (id: string, changes: Partial<MangaTitle>) => {
      dispatch({ type: "UPDATE_TITLE", payload: { id, changes } });
    },
    [],
  );

  const removeTitle = useCallback(
    async (id: string) => {
      const title = state.titles.find((t) => t.id === id);
      if (title) {
        // Delete folder from disk
        const baseDir =
          FileSystem.documentDirectory || FileSystem.cacheDirectory;
        const safeName = title.title.replace(/[\\/:*?"<>|]/g, "_").trim();
        const folderUri = `${baseDir}private_downloads/Manga/${safeName}/`;
        await FileSystem.deleteAsync(folderUri, { idempotent: true }).catch(
          () => {},
        );
      }
      dispatch({ type: "REMOVE_TITLE", payload: { id } });
    },
    [state.titles],
  );

  const updateChapter = useCallback(
    (mangaId: string, chapterId: string, changes: Partial<MangaChapter>) => {
      dispatch({
        type: "UPDATE_CHAPTER",
        payload: { mangaId, chapterId, changes },
      });
    },
    [],
  );

  const removeChapter = useCallback(
    async (mangaId: string, chapterId: string) => {
      const title = state.titles.find((t) => t.id === mangaId);
      const chapter = title?.chapters.find((c) => c.id === chapterId);
      if (chapter?.folderPath) {
        await FileSystem.deleteAsync(chapter.folderPath, {
          idempotent: true,
        }).catch(() => {});
      }
      dispatch({ type: "REMOVE_CHAPTER", payload: { mangaId, chapterId } });
    },
    [state.titles],
  );

  const getTitle = useCallback(
    (id: string) => {
      return state.titles.find((t) => t.id === id);
    },
    [state.titles],
  );

  return (
    <MangaContext.Provider
      value={{
        titles: state.titles,
        loaded: state.loaded,
        addTitle,
        updateTitle,
        removeTitle,
        updateChapter,
        removeChapter,
        getTitle,
      }}
    >
      {children}
    </MangaContext.Provider>
  );
}

export function useManga() {
  const ctx = useContext(MangaContext);
  if (!ctx) throw new Error("useManga must be used inside MangaProvider");
  return ctx;
}
