import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { downloadManager } from "../services/downloadManager";
import {
  DetectedVideo,
  DEVICE_DOWNLOAD_MOVE_TARGET,
  DownloadAction,
  DownloadTask,
  HlsVariant,
} from "../types";

interface DownloadState {
  downloads: DownloadTask[];
  folders: string[];
  deviceFolders: string[];
  isDeviceScanRunning: boolean;
}

interface DeviceScanCachePayload {
  files: DownloadTask[];
  folders: string[];
}

interface DownloadContextValue extends DownloadState {
  startDownload: (video: DetectedVideo, selectedVariant?: HlsVariant) => void;
  refreshDownloads: () => Promise<void>;
  // Blob download is split into three steps so the caller can track each phase
  // in the Downloads tab without a blocking modal:
  //   1. createBlobTask   — immediately add a task visible in Downloads
  //   2. updateBlobProgress — update bytes/total as MSE buffers or chunks arrive
  //   3. completeBlobDownload — write the assembled base64 to disk
  createBlobTask: (
    taskId: string,
    pageTitle: string,
    totalBytes: number,
  ) => void;
  updateBlobProgress: (
    taskId: string,
    bytesDownloaded: number,
    totalBytes: number,
  ) => void;
  completeBlobDownload: (
    taskId: string,
    pageTitle: string,
    base64Data: string,
  ) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  renameDownload: (id: string, newFileName: string) => Promise<string | null>;
  createFolder: (folderName: string) => Promise<void>;
  renameFolder: (folderName: string, newFolderName: string) => Promise<void>;
  deleteFolder: (folderName: string, force?: boolean) => Promise<void>;
  scanDeviceDownloadFolder: (folderPath?: string) => Promise<void>;
  moveDownloadToFolder: (
    id: string,
    folderName?: string | null,
    conflict?: "rename" | "replace",
  ) => Promise<string | null>;
  bulkMoveDownloadsToFolder: (
    ids: string[],
    folderName?: string | null,
    conflict?: "rename" | "replace",
  ) => Promise<Record<string, string>>;
  countMoveConflicts: (
    ids: string[],
    folderName?: string | null,
  ) => Promise<number>;
  removeDownload: (id: string) => Promise<string | null>;
  deleteFromTrash: (id: string) => void;
  prefetchDeviceFileSizes: (ids: string[]) => void;
}

const DEVICE_SCAN_CACHE_KEY = "@device_download_scan_cache_v2";
const DEVICE_SCAN_CHUNK_SIZE = 200;
const PRIVATE_CACHE_KEY = "@private_downloads_cache_v1";
const PRIVATE_CACHE_CHUNK_SIZE = 200;

type SlimDeviceTask = Pick<
  DownloadTask,
  | "id"
  | "fileName"
  | "filePath"
  | "folderPath"
  | "totalBytes"
  | "createdAt"
  | "duration"
>;
type SlimPrivateTask = Pick<
  DownloadTask,
  | "id"
  | "fileName"
  | "filePath"
  | "folderPath"
  | "totalBytes"
  | "createdAt"
  | "duration"
>;

const initialState: DownloadState = {
  downloads: [],
  folders: [],
  deviceFolders: [],
  isDeviceScanRunning: false,
};

function downloadReducer(
  state: DownloadState,
  action: DownloadAction,
): DownloadState {
  switch (action.type) {
    case "SET_DOWNLOADS":
      return { ...state, downloads: action.payload.downloads };

    case "ADD_DOWNLOAD":
      return { ...state, downloads: [action.payload, ...state.downloads] };

    case "UPDATE_PROGRESS":
      return {
        ...state,
        downloads: state.downloads.map((d) =>
          d.id === action.payload.id
            ? {
                ...d,
                progress: action.payload.progress,
                bytesDownloaded: action.payload.bytesDownloaded,
                totalBytes: action.payload.totalBytes,
              }
            : d,
        ),
      };

    case "SET_STATUS":
      return {
        ...state,
        downloads: state.downloads.map((d) =>
          d.id === action.payload.id
            ? {
                ...d,
                status: action.payload.status,
                error: action.payload.error,
              }
            : d,
        ),
      };

    case "SET_FILE_PATH":
      return {
        ...state,
        downloads: state.downloads.map((d) =>
          d.id === action.payload.id
            ? { ...d, filePath: action.payload.filePath }
            : d,
        ),
      };

    case "SET_FILE_SIZES":
      return {
        ...state,
        downloads: state.downloads.map((d) => {
          const next = action.payload.sizes[d.id];
          if (next === undefined || d.totalBytes === next) {
            return d;
          }
          return { ...d, totalBytes: next, bytesDownloaded: next };
        }),
      };

    case "REMOVE_DOWNLOAD":
      return {
        ...state,
        downloads: state.downloads.filter((d) => d.id !== action.payload.id),
      };

    case "SET_FOLDERS":
      return {
        ...state,
        folders: action.payload.folders,
      };

    case "SET_DEVICE_FOLDERS":
      return {
        ...state,
        deviceFolders: action.payload.folders,
      };

    case "SET_DEVICE_SCAN_RUNNING":
      return {
        ...state,
        isDeviceScanRunning: action.payload.isRunning,
      };

    default:
      return state;
  }
}

interface DownloadActions {
  startDownload: DownloadContextValue["startDownload"];
  refreshDownloads: DownloadContextValue["refreshDownloads"];
  createBlobTask: DownloadContextValue["createBlobTask"];
  updateBlobProgress: DownloadContextValue["updateBlobProgress"];
  completeBlobDownload: DownloadContextValue["completeBlobDownload"];
  pauseDownload: DownloadContextValue["pauseDownload"];
  resumeDownload: DownloadContextValue["resumeDownload"];
  cancelDownload: DownloadContextValue["cancelDownload"];
  renameDownload: DownloadContextValue["renameDownload"];
  createFolder: DownloadContextValue["createFolder"];
  renameFolder: DownloadContextValue["renameFolder"];
  deleteFolder: DownloadContextValue["deleteFolder"];
  scanDeviceDownloadFolder: DownloadContextValue["scanDeviceDownloadFolder"];
  moveDownloadToFolder: DownloadContextValue["moveDownloadToFolder"];
  bulkMoveDownloadsToFolder: DownloadContextValue["bulkMoveDownloadsToFolder"];
  removeDownload: DownloadContextValue["removeDownload"];
  deleteFromTrash: DownloadContextValue["deleteFromTrash"];
  prefetchDeviceFileSizes: DownloadContextValue["prefetchDeviceFileSizes"];
}

const DownloadContext = createContext<DownloadContextValue | null>(null);
const DownloadActionsContext = createContext<DownloadActions | null>(null);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(downloadReducer, initialState);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const downloadsRef = useRef(state.downloads);
  downloadsRef.current = state.downloads;

  const persistDeviceScanCache = useCallback(
    async (files: DownloadTask[], folders: string[]) => {
      try {
        const slim: SlimDeviceTask[] = files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          filePath: f.filePath,
          folderPath: f.folderPath,
          totalBytes: f.totalBytes,
          createdAt: f.createdAt,
          duration: f.duration,
        }));

        const chunkKeys: string[] = [];
        for (let i = 0; i * DEVICE_SCAN_CHUNK_SIZE < slim.length; i++) {
          const chunkKey = `${DEVICE_SCAN_CACHE_KEY}_chunk_${i}`;
          chunkKeys.push(chunkKey);
          await AsyncStorage.setItem(
            chunkKey,
            JSON.stringify(
              slim.slice(
                i * DEVICE_SCAN_CHUNK_SIZE,
                (i + 1) * DEVICE_SCAN_CHUNK_SIZE,
              ),
            ),
          );
        }

        await AsyncStorage.setItem(
          DEVICE_SCAN_CACHE_KEY,
          JSON.stringify({ chunkCount: chunkKeys.length, folders }),
        );

        // Remove stale chunks from a previous scan that had more chunks
        let staleIndex = chunkKeys.length;
        while (true) {
          const staleKey = `${DEVICE_SCAN_CACHE_KEY}_chunk_${staleIndex}`;
          const exists = await AsyncStorage.getItem(staleKey);
          if (exists === null) {
            break;
          }
          await AsyncStorage.removeItem(staleKey);
          staleIndex++;
        }
      } catch (err) {
        console.warn("Failed to persist device scan cache:", err);
      }
    },
    [],
  );

  const restoreDeviceScanCache =
    useCallback(async (): Promise<DeviceScanCachePayload> => {
      try {
        const raw = await AsyncStorage.getItem(DEVICE_SCAN_CACHE_KEY);
        if (!raw) {
          return { files: [], folders: [] };
        }

        const meta = JSON.parse(raw) as {
          chunkCount?: number;
          folders?: unknown[];
        };
        const folders = Array.isArray(meta.folders)
          ? meta.folders.filter((f): f is string => typeof f === "string")
          : [];

        const chunkCount =
          typeof meta.chunkCount === "number" ? meta.chunkCount : 0;
        const chunkKeys = Array.from(
          { length: chunkCount },
          (_, i) => `${DEVICE_SCAN_CACHE_KEY}_chunk_${i}`,
        );
        const chunkResults = await AsyncStorage.multiGet(chunkKeys);
        const slimFiles: SlimDeviceTask[] = [];
        for (const [, chunkRaw] of chunkResults) {
          if (!chunkRaw) {
            continue;
          }
          const chunk = JSON.parse(chunkRaw) as SlimDeviceTask[];
          if (Array.isArray(chunk)) {
            slimFiles.push(...chunk);
          }
        }

        const files: DownloadTask[] = slimFiles.map((f) => ({
          id: f.id,
          url: "",
          fileName: f.fileName,
          filePath: f.filePath,
          folderPath: f.folderPath,
          source: "device" as const,
          status: "completed" as const,
          progress: 100,
          bytesDownloaded: f.totalBytes,
          totalBytes: f.totalBytes,
          pageTitle: f.fileName,
          createdAt: f.createdAt,
          duration: f.duration,
        }));

        return { files, folders };
      } catch (err) {
        console.warn("Failed to restore device scan cache:", err);
        return { files: [], folders: [] };
      }
    }, []);

  const persistPrivateCache = useCallback(
    async (files: DownloadTask[], folders: string[]) => {
      try {
        const slim: SlimPrivateTask[] = files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          filePath: f.filePath,
          folderPath: f.folderPath,
          totalBytes: f.totalBytes,
          createdAt: f.createdAt,
          duration: f.duration,
        }));

        const chunkKeys: string[] = [];
        for (let i = 0; i * PRIVATE_CACHE_CHUNK_SIZE < slim.length; i++) {
          const chunkKey = `${PRIVATE_CACHE_KEY}_chunk_${i}`;
          chunkKeys.push(chunkKey);
          await AsyncStorage.setItem(
            chunkKey,
            JSON.stringify(
              slim.slice(
                i * PRIVATE_CACHE_CHUNK_SIZE,
                (i + 1) * PRIVATE_CACHE_CHUNK_SIZE,
              ),
            ),
          );
        }

        await AsyncStorage.setItem(
          PRIVATE_CACHE_KEY,
          JSON.stringify({ chunkCount: chunkKeys.length, folders }),
        );

        let staleIndex = chunkKeys.length;
        while (true) {
          const staleKey = `${PRIVATE_CACHE_KEY}_chunk_${staleIndex}`;
          const exists = await AsyncStorage.getItem(staleKey);
          if (exists === null) {
            break;
          }
          await AsyncStorage.removeItem(staleKey);
          staleIndex++;
        }
      } catch (err) {
        console.warn("Failed to persist private cache:", err);
      }
    },
    [],
  );

  const restorePrivateCache = useCallback(async (): Promise<{
    files: DownloadTask[];
    folders: string[];
  }> => {
    try {
      const raw = await AsyncStorage.getItem(PRIVATE_CACHE_KEY);
      if (!raw) {
        return { files: [], folders: [] };
      }

      const meta = JSON.parse(raw) as {
        chunkCount?: number;
        folders?: unknown[];
      };
      const folders = Array.isArray(meta.folders)
        ? meta.folders.filter((f): f is string => typeof f === "string")
        : [];

      const chunkCount =
        typeof meta.chunkCount === "number" ? meta.chunkCount : 0;
      const chunkKeys = Array.from(
        { length: chunkCount },
        (_, i) => `${PRIVATE_CACHE_KEY}_chunk_${i}`,
      );
      const chunkResults = await AsyncStorage.multiGet(chunkKeys);
      const slimFiles: SlimPrivateTask[] = [];
      for (const [, chunkRaw] of chunkResults) {
        if (!chunkRaw) {
          continue;
        }
        const chunk = JSON.parse(chunkRaw) as SlimPrivateTask[];
        if (Array.isArray(chunk)) {
          slimFiles.push(...chunk);
        }
      }

      const files: DownloadTask[] = slimFiles.map((f) => ({
        id: f.id,
        url: f.filePath,
        fileName: f.fileName,
        filePath: f.filePath,
        folderPath: f.folderPath,
        source: "private" as const,
        status: "completed" as const,
        progress: 100,
        bytesDownloaded: f.totalBytes,
        totalBytes: f.totalBytes,
        pageTitle: "Private file",
        createdAt: f.createdAt,
        duration: f.duration,
      }));

      return { files, folders };
    } catch (err) {
      console.warn("Failed to restore private cache:", err);
      return { files: [], folders: [] };
    }
  }, []);

  const refreshDownloads = useCallback(async () => {
    try {
      const privateFiles = await downloadManager.listPrivateDownloads();
      const scannedDeviceFiles = downloadsRef.current.filter(
        (d) => d.status === "completed" && d.source === "device",
      );
      const privateFolders = await downloadManager.listPrivateFolders();
      const activeOrPending = downloadsRef.current.filter(
        (d) => d.status !== "completed",
      );

      // Exclude files that are currently being written by an active download.
      // listPrivateDownloads() scans the filesystem and can pick up partial/in-progress
      // files, which would produce a duplicate entry alongside the active dl_... task.
      const activeUris = downloadManager.getActiveFileUris();
      const filteredPrivateFiles =
        activeUris.size > 0
          ? privateFiles.filter(
              (f) => !f.filePath || !activeUris.has(f.filePath),
            )
          : privateFiles;

      const merged = [
        ...activeOrPending,
        ...filteredPrivateFiles,
        ...scannedDeviceFiles,
      ].sort((a, b) => b.createdAt - a.createdAt);
      dispatchRef.current({
        type: "SET_DOWNLOADS",
        payload: { downloads: merged },
      });
      dispatchRef.current({
        type: "SET_FOLDERS",
        payload: { folders: privateFolders },
      });
      void persistPrivateCache(privateFiles, privateFolders);
    } catch (err) {
      console.warn("Failed to refresh downloads from private folder:", err);
    }
  }, []);

  const scanDeviceDownloadFolder = useCallback(async () => {
    dispatchRef.current({
      type: "SET_DEVICE_SCAN_RUNNING",
      payload: { isRunning: true },
    });
    try {
      const privateFolders = await downloadManager.listPrivateFolders();
      const scannedDevice = await downloadManager.scanDeviceDownloadFolder();
      // Read private files AFTER the async work completes so any concurrent
      // refreshDownloads() (e.g. post-copy) has already updated state. Reading
      // the snapshot before the awaits would overwrite newly-added private files.
      const privateFiles = downloadsRef.current.filter(
        (d) => d.status === "completed" && d.source === "private",
      );
      const activeOrPending = downloadsRef.current.filter(
        (d) => d.status !== "completed",
      );

      const merged = [
        ...activeOrPending,
        ...privateFiles,
        ...scannedDevice.files,
      ].sort((a, b) => b.createdAt - a.createdAt);

      dispatchRef.current({
        type: "SET_DOWNLOADS",
        payload: { downloads: merged },
      });
      dispatchRef.current({
        type: "SET_FOLDERS",
        payload: { folders: privateFolders },
      });
      dispatchRef.current({
        type: "SET_DEVICE_FOLDERS",
        payload: { folders: scannedDevice.folders },
      });
      await persistDeviceScanCache(scannedDevice.files, scannedDevice.folders);
    } catch (err) {
      console.warn("Scan device download folder failed:", err);
      throw err;
    } finally {
      dispatchRef.current({
        type: "SET_DEVICE_SCAN_RUNNING",
        payload: { isRunning: false },
      });
    }
  }, [persistDeviceScanCache]);

  useEffect(() => {
    downloadManager.setProgressCallback((id, received, total) => {
      const progress = total > 0 ? Math.round((received / total) * 100) : 0;
      dispatchRef.current({
        type: "UPDATE_PROGRESS",
        payload: { id, progress, bytesDownloaded: received, totalBytes: total },
      });
    });

    downloadManager.setStatusCallback((id, status, filePath, error) => {
      dispatchRef.current({
        type: "SET_STATUS",
        payload: { id, status, error },
      });
      if (filePath) {
        dispatchRef.current({
          type: "SET_FILE_PATH",
          payload: { id, filePath },
        });
      }
    });

    (async () => {
      try {
        // Restore both caches in parallel — these are AsyncStorage reads, fast & cheap.
        // CRITICAL: do NOT call listPrivateDownloads here. With 350+ files, the duration
        // probes block the JS thread for many seconds and can OOM-kill the app.
        const [cachedPrivate, cachedDeviceScan, persistedPaused] =
          await Promise.all([
            restorePrivateCache(),
            restoreDeviceScanCache(),
            downloadManager.restorePersistedDownloads().catch((err) => {
              console.warn("Failed to restore persisted downloads:", err);
              return [] as DownloadTask[];
            }),
          ]);

        const merged = [
          ...downloadsRef.current.filter((d) => d.status !== "completed"),
          ...persistedPaused,
          ...cachedPrivate.files,
          ...cachedDeviceScan.files,
        ].sort((a, b) => b.createdAt - a.createdAt);

        dispatchRef.current({
          type: "SET_DOWNLOADS",
          payload: { downloads: merged },
        });
        dispatchRef.current({
          type: "SET_FOLDERS",
          payload: { folders: cachedPrivate.folders },
        });
        dispatchRef.current({
          type: "SET_DEVICE_FOLDERS",
          payload: { folders: cachedDeviceScan.folders },
        });

        // Initialize the on-disk private folder lazily (doesn't read files, just ensures the dir exists).
        downloadManager.initializePrivateFolder().catch((err) => {
          console.warn("initializePrivateFolder failed:", err);
        });
      } catch (err) {
        console.warn("Failed to bootstrap downloads:", err);
      }

      // Rescan both private and device folders in the background — UI already shows cached data.
      // refreshDownloads will update the cache when done.
      refreshDownloads().catch((err) => {
        console.warn("Startup private rescan failed:", err);
      });
      scanDeviceDownloadFolder().catch((err) => {
        console.warn("Startup device scan failed:", err);
      });
    })();
  }, [
    restoreDeviceScanCache,
    restorePrivateCache,
    refreshDownloads,
    scanDeviceDownloadFolder,
  ]);

  const createFolder = useCallback(
    async (folderName: string) => {
      const trimmed = folderName.trim();
      if (!trimmed) {
        return;
      }

      try {
        await downloadManager.createPrivateFolder(trimmed);
        await refreshDownloads();
      } catch (err) {
        console.warn("Create folder failed:", err);
        throw err;
      }
    },
    [refreshDownloads],
  );

  const renameFolder = useCallback(
    async (folderName: string, newFolderName: string) => {
      const fromName = folderName.trim();
      const toName = newFolderName.trim();
      if (!fromName || !toName) {
        return;
      }

      try {
        await downloadManager.renamePrivateFolder(fromName, toName);
        await refreshDownloads();
      } catch (err) {
        console.warn("Rename folder failed:", err);
        throw err;
      }
    },
    [refreshDownloads],
  );

  const deleteFolder = useCallback(
    async (folderName: string, force = false) => {
      const trimmed = folderName.trim();
      if (!trimmed) {
        return;
      }

      try {
        await downloadManager.deletePrivateFolder(trimmed, force);
        await refreshDownloads();
      } catch (err) {
        console.warn("Delete folder failed:", err);
        throw err;
      }
    },
    [refreshDownloads],
  );

  const bulkMoveDownloadsToFolder = useCallback(
    async (
      ids: string[],
      folderName?: string | null,
      conflict: "rename" | "replace" = "rename",
    ): Promise<Record<string, string>> => {
      const tasks = ids
        .map((id) => downloadsRef.current.find((d) => d.id === id))
        .filter(
          (t): t is DownloadTask =>
            !!t && !!t.filePath && t.status === "completed",
        );

      if (tasks.length === 0) {
        return {};
      }

      const CONCURRENCY = 4;
      const errors: string[] = [];
      const idMapping: Record<string, string> = {};

      const runOne = async (task: DownloadTask) => {
        try {
          if (task.source === "device") {
            const assetId = task.id.startsWith("device_")
              ? task.id.slice(7)
              : null;
            await downloadManager.copyDeviceFileToPrivateFolder(
              task.filePath,
              folderName,
              task.fileName || undefined,
              assetId,
              conflict,
            );
          } else if (folderName === DEVICE_DOWNLOAD_MOVE_TARGET) {
            await downloadManager.copyPrivateFileToDeviceDownload(
              task.filePath,
            );
          } else {
            const newPath = await downloadManager.movePrivateFileToFolder(
              task.filePath,
              folderName,
              conflict,
            );
            idMapping[task.id] = `file_${newPath}`;
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      };

      let cursor = 0;
      const workers: Promise<void>[] = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push(
          (async () => {
            while (cursor < tasks.length) {
              const i = cursor++;
              await runOne(tasks[i]);
            }
          })(),
        );
      }
      await Promise.all(workers);

      // Refresh once at the end, not per-file
      await Promise.all([refreshDownloads(), scanDeviceDownloadFolder()]);

      if (errors.length > 0) {
        throw new Error(
          `${errors.length} of ${tasks.length} files failed: ${errors[0]}`,
        );
      }
      return idMapping;
    },
    [refreshDownloads, scanDeviceDownloadFolder],
  );

  const moveDownloadToFolder = useCallback(
    async (
      id: string,
      folderName?: string | null,
      conflict: "rename" | "replace" = "rename",
    ): Promise<string | null> => {
      const task = downloadsRef.current.find((d) => d.id === id);
      if (!task?.filePath || task.status !== "completed") {
        return null;
      }

      try {
        let newId: string | null = null;
        if (task.source === "device") {
          const assetId = task.id.startsWith("device_")
            ? task.id.slice(7)
            : null;
          await downloadManager.copyDeviceFileToPrivateFolder(
            task.filePath,
            folderName,
            task.fileName || undefined,
            assetId,
            conflict,
          );
        } else if (folderName === DEVICE_DOWNLOAD_MOVE_TARGET) {
          await downloadManager.copyPrivateFileToDeviceDownload(task.filePath);
        } else {
          const newPath = await downloadManager.movePrivateFileToFolder(
            task.filePath,
            folderName,
            conflict,
          );
          newId = `file_${newPath}`;
        }

        await Promise.all([refreshDownloads(), scanDeviceDownloadFolder()]);
        return newId;
      } catch (err) {
        console.warn("Move to folder failed:", err);
        throw err;
      }
    },
    [refreshDownloads, scanDeviceDownloadFolder],
  );

  const countMoveConflicts = useCallback(
    async (ids: string[], folderName?: string | null): Promise<number> => {
      // The private→device-download action uses MediaLibrary and is out of
      // scope for the in-app conflict prompt.
      if (folderName === DEVICE_DOWNLOAD_MOVE_TARGET) {
        return 0;
      }
      const tasks = ids
        .map((id) => downloadsRef.current.find((d) => d.id === id))
        .filter(
          (t): t is DownloadTask =>
            !!t && !!t.filePath && t.status === "completed",
        );

      const results = await Promise.all(
        tasks.map((task) =>
          downloadManager
            .checkMoveConflict(
              task.filePath,
              folderName,
              task.fileName || undefined,
            )
            .catch(() => false),
        ),
      );
      return results.filter(Boolean).length;
    },
    [],
  );

  const startDownload = useCallback(
    (video: DetectedVideo, selectedVariant?: HlsVariant) => {
      const id = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const task: DownloadTask = {
        id,
        url: video.url,
        fileName: "",
        filePath: "",
        status: "queued",
        progress: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        pageTitle: video.pageTitle,
        createdAt: Date.now(),
      };

      dispatchRef.current({ type: "ADD_DOWNLOAD", payload: task });

      downloadManager
        .startDownload(
          id,
          video.url,
          video.pageTitle,
          video.pageUrl,
          video.cookies,
          video.hlsInfo,
          selectedVariant,
        )
        .catch((err) => {
          console.warn("Download failed to start:", err);
        });
    },
    [],
  );

  const pauseDownload = useCallback((id: string) => {
    downloadManager.pauseDownload(id);
  }, []);

  const resumeDownload = useCallback((id: string) => {
    const task = downloadsRef.current.find((d) => d.id === id);
    if (!task) {
      return;
    }
    downloadManager.resumeDownload(id).catch((err) => {
      console.warn("Resume failed:", err);
    });
  }, []);

  const cancelDownload = useCallback((id: string) => {
    downloadManager.cancelDownload(id);
  }, []);

  const renameDownload = useCallback(
    async (id: string, newFileName: string): Promise<string | null> => {
      const task = downloadsRef.current.find((d) => d.id === id);
      if (!task?.filePath || task.source === "device") {
        return null;
      }
      try {
        const newPath = await downloadManager.renamePrivateFile(
          task.filePath,
          newFileName,
        );
        await refreshDownloads();
        return `file_${newPath}`;
      } catch (err) {
        console.warn("Rename failed:", err);
        return null;
      }
    },
    [refreshDownloads],
  );

  const createBlobTask = useCallback(
    (taskId: string, pageTitle: string, totalBytes: number) => {
      const task: DownloadTask = {
        id: taskId,
        url: "blob-video",
        fileName: "",
        filePath: "",
        status: "downloading",
        progress: 0,
        bytesDownloaded: 0,
        totalBytes,
        pageTitle,
        createdAt: Date.now(),
      };
      dispatchRef.current({ type: "ADD_DOWNLOAD", payload: task });
    },
    [],
  );

  const updateBlobProgress = useCallback(
    (taskId: string, bytesDownloaded: number, totalBytes: number) => {
      const progress =
        totalBytes > 0
          ? Math.min(99, Math.round((bytesDownloaded / totalBytes) * 100))
          : 0;
      dispatchRef.current({
        type: "UPDATE_PROGRESS",
        payload: { id: taskId, progress, bytesDownloaded, totalBytes },
      });
    },
    [],
  );

  const completeBlobDownload = useCallback(
    (taskId: string, pageTitle: string, base64Data: string) => {
      downloadManager
        .saveBlobData(taskId, pageTitle, base64Data)
        .catch((err) => {
          console.warn("Blob save failed:", err);
        });
    },
    [],
  );

  const fetchedSizeIdsRef = useRef<Set<string>>(new Set());
  const prefetchDeviceFileSizes = useCallback((ids: string[]) => {
    const fetched = fetchedSizeIdsRef.current;
    const toFetch: Array<{ id: string; filePath: string }> = [];
    for (const id of ids) {
      if (fetched.has(id)) {
        continue;
      }
      const task = downloadsRef.current.find((d) => d.id === id);
      if (
        !task ||
        task.source !== "device" ||
        !task.filePath ||
        task.totalBytes > 0
      ) {
        continue;
      }
      fetched.add(id);
      toFetch.push({ id, filePath: task.filePath });
    }
    if (toFetch.length === 0) {
      return;
    }

    Promise.all(
      toFetch.map(async ({ id, filePath }) => {
        try {
          const info = await FileSystem.getInfoAsync(filePath);
          const anyInfo = info as any;
          if (
            info.exists &&
            typeof anyInfo.size === "number" &&
            anyInfo.size > 0
          ) {
            return {
              id,
              size: anyInfo.size as number,
              resolvedPath: null as string | null,
            };
          }
          // File not accessible at current URI (e.g. content:// on Android 10+).
          // Resolve to a real file:// path via MediaLibrary using the embedded asset ID.
          const assetId = id.startsWith("device_") ? id.slice(7) : null;
          if (assetId) {
            const assetInfo = await MediaLibrary.getAssetInfoAsync(assetId);
            const localUri = assetInfo.localUri;
            if (localUri) {
              const localInfo = await FileSystem.getInfoAsync(localUri);
              const localAnyInfo = localInfo as any;
              const resolvedSize =
                localInfo.exists && typeof localAnyInfo.size === "number"
                  ? localAnyInfo.size
                  : 0;
              return { id, size: resolvedSize, resolvedPath: localUri };
            }
          }
        } catch {
          // ignore
        }
        return { id, size: 0, resolvedPath: null as string | null };
      }),
    ).then((results) => {
      const sizes: Record<string, number> = {};
      for (const { id, size } of results) {
        if (size > 0) {
          sizes[id] = size;
        }
      }
      if (Object.keys(sizes).length > 0) {
        dispatchRef.current({ type: "SET_FILE_SIZES", payload: { sizes } });
      }
      for (const { id, resolvedPath } of results) {
        if (resolvedPath) {
          dispatchRef.current({
            type: "SET_FILE_PATH",
            payload: { id, filePath: resolvedPath },
          });
        }
      }
    });
  }, []);

  const removeDownload = useCallback(
    async (id: string): Promise<string | null> => {
      const task = downloadsRef.current.find((d) => d.id === id);

      if (
        task?.status === "completed" &&
        task.filePath &&
        task.source !== "device"
      ) {
        const isInTrash =
          (task.folderPath || "").split("/")[0] ===
          downloadManager.trashFolderName;
        if (isInTrash) {
          downloadManager.deletePrivateFile(task.filePath).catch((err) => {
            console.warn("Delete from trash failed:", err);
          });
        } else {
          try {
            const trashPath = await downloadManager.movePrivateFileToTrash(
              task.filePath,
            );
            await refreshDownloads();
            return `file_${trashPath}`;
          } catch (err) {
            console.warn("Move to trash failed:", err);
            return null;
          }
        }
      } else {
        downloadManager.cancelDownload(id);
      }

      dispatchRef.current({ type: "REMOVE_DOWNLOAD", payload: { id } });
      return null;
    },
    [refreshDownloads],
  );

  const deleteFromTrash = useCallback((id: string) => {
    const task = downloadsRef.current.find((d) => d.id === id);
    if (
      task?.status === "completed" &&
      task.filePath &&
      task.source !== "device"
    ) {
      downloadManager.deletePrivateFile(task.filePath).catch((err) => {
        console.warn("Delete from trash permanently failed:", err);
      });
    }
    dispatchRef.current({ type: "REMOVE_DOWNLOAD", payload: { id } });
  }, []);

  const actions = useMemo<DownloadActions>(
    () => ({
      startDownload,
      refreshDownloads,
      createBlobTask,
      updateBlobProgress,
      completeBlobDownload,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      renameDownload,
      createFolder,
      renameFolder,
      deleteFolder,
      scanDeviceDownloadFolder,
      moveDownloadToFolder,
      bulkMoveDownloadsToFolder,
      countMoveConflicts,
      removeDownload,
      deleteFromTrash,
      prefetchDeviceFileSizes,
    }),
    [
      startDownload,
      refreshDownloads,
      createBlobTask,
      updateBlobProgress,
      completeBlobDownload,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      renameDownload,
      createFolder,
      renameFolder,
      deleteFolder,
      scanDeviceDownloadFolder,
      moveDownloadToFolder,
      bulkMoveDownloadsToFolder,
      countMoveConflicts,
      removeDownload,
      deleteFromTrash,
      prefetchDeviceFileSizes,
    ],
  );

  const value = useMemo<DownloadContextValue>(
    () => ({ ...state, ...actions }),
    [state, actions],
  );

  return (
    <DownloadActionsContext.Provider value={actions}>
      <DownloadContext.Provider value={value}>
        {children}
      </DownloadContext.Provider>
    </DownloadActionsContext.Provider>
  );
}

export function useDownloads(): DownloadContextValue {
  const ctx = useContext(DownloadContext);
  if (!ctx) {
    throw new Error("useDownloads must be used within a DownloadProvider");
  }
  return ctx;
}

// Subscribe to only the stable action callbacks — consumers of this hook
// will NOT re-render when download progress/state changes.
export function useDownloadActions(): DownloadActions {
  const ctx = useContext(DownloadActionsContext);
  if (!ctx) {
    throw new Error(
      "useDownloadActions must be used within a DownloadProvider",
    );
  }
  return ctx;
}
