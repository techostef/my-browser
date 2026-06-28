import AsyncStorage from "@react-native-async-storage/async-storage";
import * as VideoThumbnails from "expo-video-thumbnails";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { clearSession } from "../lib/videoEditor/editSession";

const PROJECTS_KEY = "@editor_projects";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  videoUri: string;
  videoName: string;
  thumbnailUri?: string;
  duration: number;
  createdAt: number;
  updatedAt: number;
}

type Action =
  | { type: "ADD"; payload: Project }
  | { type: "UPDATE"; payload: Partial<Project> & { id: string } }
  | { type: "REMOVE"; payload: { id: string } }
  | { type: "RESTORE"; payload: Project[] };

function reducer(state: Project[], action: Action): Project[] {
  switch (action.type) {
    case "ADD":
      return [
        action.payload,
        ...state.filter((p) => p.videoUri !== action.payload.videoUri),
      ];
    case "UPDATE":
      return state.map((p) =>
        p.id === action.payload.id ? { ...p, ...action.payload } : p,
      );
    case "REMOVE":
      return state.filter((p) => p.id !== action.payload.id);
    case "RESTORE":
      return action.payload;
    default:
      return state;
  }
}

// ─── Context ───────────────────────────────────────────────────────────────────

interface ProjectContextValue {
  projects: Project[];
  addOrUpdateProject: (
    videoUri: string,
    videoName: string,
    duration: number,
  ) => Promise<Project>;
  updateProject: (id: string, patch: Partial<Project>) => void;
  removeProject: (id: string) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, dispatch] = useReducer(reducer, []);
  const isReady = useRef(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount
  useEffect(() => {
    AsyncStorage.getItem(PROJECTS_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Project[];
          if (Array.isArray(parsed))
            dispatch({ type: "RESTORE", payload: parsed });
        } catch {}
      }
      isReady.current = true;
    });
  }, []);

  // Debounced persist on changes
  useEffect(() => {
    if (!isReady.current) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)).catch(
        () => {},
      );
    }, 400);
  }, [projects]);

  const addOrUpdateProject = useCallback(
    async (
      videoUri: string,
      videoName: string,
      duration: number,
    ): Promise<Project> => {
      const existing = projects.find((p) => p.videoUri === videoUri);
      if (existing) {
        const updated = {
          ...existing,
          videoName,
          duration,
          updatedAt: Date.now(),
        };
        dispatch({
          type: "UPDATE",
          payload: {
            id: existing.id,
            videoName,
            duration,
            updatedAt: Date.now(),
          },
        });
        return updated;
      }

      const id =
        Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const now = Date.now();
      const project: Project = {
        id,
        videoUri,
        videoName,
        duration,
        createdAt: now,
        updatedAt: now,
      };
      dispatch({ type: "ADD", payload: project });

      // Generate thumbnail in background
      VideoThumbnails.getThumbnailAsync(videoUri, { time: 0 })
        .then(({ uri }) =>
          dispatch({ type: "UPDATE", payload: { id, thumbnailUri: uri } }),
        )
        .catch(() => {});

      return project;
    },
    [projects],
  );

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    dispatch({ type: "UPDATE", payload: { id, ...patch } });
  }, []);

  const removeProject = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (project) await clearSession(project.videoUri);
      dispatch({ type: "REMOVE", payload: { id } });
    },
    [projects],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({ projects, addOrUpdateProject, updateProject, removeProject }),
    [projects, addOrUpdateProject, updateProject, removeProject],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjects must be used inside ProjectProvider");
  return ctx;
}
