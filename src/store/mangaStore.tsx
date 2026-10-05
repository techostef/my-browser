import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { AppState } from "react-native";
import { mangaFolderOf } from "../services/mangaDownloadService";
import { MangaChapter, MangaTitle } from "../types/manga";

const STORAGE_KEY = "@manga_library_v1";
// Download progress updates the store once per image; batch the disk writes.
const PERSIST_DEBOUNCE_MS = 500;

/** True while any chapter of the title is downloading or waiting in the queue. */
export function isMangaDownloading(manga: MangaTitle): boolean {
  return manga.chapters.some(
    (ch) => ch.status === "downloading" || ch.status === "queued",
  );
}

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
  // Latest titles for callbacks, so they keep a stable identity across updates
  const titlesRef = useRef(state.titles);
  titlesRef.current = state.titles;
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const flushPersist = useCallback(() => {
    if (!persistTimer.current) return;
    clearTimeout(persistTimer.current);
    persistTimer.current = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(titlesRef.current)).catch(
      () => {},
    );
  }, []);

  // Persist (debounced) whenever titles change (after initial load)
  useEffect(() => {
    if (!state.loaded) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
  }, [state.titles, state.loaded, flushPersist]);

  // Write pending changes right away when the app is backgrounded or unmounted
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") flushPersist();
    });
    return () => {
      sub.remove();
      flushPersist();
    };
  }, [flushPersist]);

  const addTitle = useCallback((title: MangaTitle) => {
    dispatch({ type: "ADD_TITLE", payload: title });
  }, []);

  const updateTitle = useCallback(
    (id: string, changes: Partial<MangaTitle>) => {
      dispatch({ type: "UPDATE_TITLE", payload: { id, changes } });
    },
    [],
  );

  const removeTitle = useCallback(async (id: string) => {
    const title = titlesRef.current.find((t) => t.id === id);
    if (title) {
      // Delete from disk. The folder is resolved from recorded paths because a
      // renamed title no longer matches its folder name.
      const folder = mangaFolderOf(title);
      const paths = folder
        ? [folder]
        : title.chapters.map((ch) => ch.folderPath).filter(Boolean);
      await Promise.all(
        paths.map((p) =>
          FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {}),
        ),
      );
    }
    dispatch({ type: "REMOVE_TITLE", payload: { id } });
  }, []);

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
      const title = titlesRef.current.find((t) => t.id === mangaId);
      const chapter = title?.chapters.find((c) => c.id === chapterId);
      if (chapter?.folderPath) {
        await FileSystem.deleteAsync(chapter.folderPath, {
          idempotent: true,
        }).catch(() => {});
      }
      dispatch({ type: "REMOVE_CHAPTER", payload: { mangaId, chapterId } });
    },
    [],
  );

  const getTitle = useCallback((id: string) => {
    return titlesRef.current.find((t) => t.id === id);
  }, []);

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
