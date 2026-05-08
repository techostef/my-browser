import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  View,
  Text,
  FlatList,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useProjects } from "../store/projectStore";

import AsyncStorage from "@react-native-async-storage/async-storage";

import DownloadItem, { DownloadMediaType } from "../components/DownloadItem";
import { DEVICE_DOWNLOAD_MOVE_TARGET, DownloadTask } from "../types";
import { useDownloads } from "../store/downloadStore";

import { DownloadGridItem, FolderGridItem, FilterType, SortKey } from "../components/downloads/types";
import FolderCard from "../components/downloads/FolderCard";
import RenameModal from "../components/downloads/RenameModal";
import FolderDialog from "../components/downloads/FolderDialog";
import FolderPickerModal, { FolderPickerOption } from "../components/downloads/FolderPickerModal";
import PreviewModal from "../components/downloads/PreviewModal";
import ActionsDropdown from "../components/downloads/ActionsDropdown";
import FilterDialog from "../components/downloads/FilterDialog";
import LabelPickerModal from "../components/downloads/LabelPickerModal";
import ManageLabelsModal from "../components/downloads/ManageLabelsModal";
import MoveProgressModal from "../components/downloads/MoveProgressModal";
import DownloadsHeader from "../components/downloads/DownloadsHeader";
import FilterBar from "../components/downloads/FilterBar";

const DEVICE_ROOT_PATH = "__device_download__";
const TRASH_FOLDER_PATH = "__trash__";

export default function DownloadsScreen() {
  const navigation = useNavigation();
  const { addOrUpdateProject } = useProjects();
  const {
    downloads,
    folders,
    deviceFolders,
    isDeviceScanRunning,
    refreshDownloads,
    scanDeviceDownloadFolder,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    renameDownload,
    createFolder,
    renameFolder,
    deleteFolder,
    moveDownloadToFolder,
    bulkMoveDownloadsToFolder,
    removeDownload,
    deleteFromTrash,
    prefetchDeviceFileSizes,
  } = useDownloads();

  // ── state ──────────────────────────────────────────────────────────────────
  const [renameTask, setRenameTask] = useState<DownloadTask | null>(null);
  const [renameText, setRenameText] = useState("");
  const [previewTask, setPreviewTask] = useState<DownloadTask | null>(null);
  const [folderDialogMode, setFolderDialogMode] = useState<"create" | "rename" | null>(null);
  const [activeFolderPath, setActiveFolderPath] = useState("");
  const [folderNameText, setFolderNameText] = useState("");
  const [currentFolderPath, setCurrentFolderPath] = useState("");
  const [copyTask, setCopyTask] = useState<DownloadTask | null>(null);
  const [moveTaskInPrivate, setMoveTaskInPrivate] = useState<DownloadTask | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveModalVisible, setBulkMoveModalVisible] = useState(false);
  const [bulkMoveToPrivateModalVisible, setBulkMoveToPrivateModalVisible] = useState(false);
  const [actionsDialogVisible, setActionsDialogVisible] = useState(false);
  const [filterDialogVisible, setFilterDialogVisible] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name_asc");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [labelDefs, setLabelDefs] = useState<string[]>([]);
  const [fileLabels, setFileLabels] = useState<Record<string, string[]>>({});
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [labelTaskTarget, setLabelTaskTarget] = useState<DownloadTask | null>(null);
  const [manageLabelModalVisible, setManageLabelModalVisible] = useState(false);
  const [manageLabelNewText, setManageLabelNewText] = useState("");
  const [moveProgress, setMoveProgress] = useState<{ total: number; label: string } | null>(null);

  // ── refs ───────────────────────────────────────────────────────────────────
  const currentFolderPathRef = useRef(currentFolderPath);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const fileLabelsRef = useRef(fileLabels);
  fileLabelsRef.current = fileLabels;
  const prefetchSizesRef = useRef(prefetchDeviceFileSizes);
  prefetchSizesRef.current = prefetchDeviceFileSizes;

  useEffect(() => {
    currentFolderPathRef.current = currentFolderPath;
  }, [currentFolderPath]);

  // ── persistence ────────────────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem("@downloads_sort_key").then((val) => {
      if (val) setSortKey(val as SortKey);
    });
  }, []);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem("@label_definitions_v1"),
      AsyncStorage.getItem("@file_labels_v1"),
    ]).then(([defs, labels]) => {
      if (defs) setLabelDefs(JSON.parse(defs));
      if (labels) setFileLabels(JSON.parse(labels));
    });
  }, []);

  // ── label helpers ──────────────────────────────────────────────────────────
  const saveLabelDefs = useCallback((defs: string[]) => {
    setLabelDefs(defs);
    AsyncStorage.setItem("@label_definitions_v1", JSON.stringify(defs));
  }, []);

  const handleToggleFileLabel = useCallback((taskId: string, label: string) => {
    setFileLabels((prev) => {
      const current = prev[taskId] || [];
      const next = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
      const updated = { ...prev, [taskId]: next };
      AsyncStorage.setItem("@file_labels_v1", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleAddLabelDef = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLabelDefs((prev) => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed];
      AsyncStorage.setItem("@label_definitions_v1", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDeleteLabelDef = useCallback((label: string) => {
    setLabelDefs((prev) => {
      const next = prev.filter((l) => l !== label);
      AsyncStorage.setItem("@label_definitions_v1", JSON.stringify(next));
      return next;
    });
    setFileLabels((prev) => {
      const updated: Record<string, string[]> = {};
      for (const id of Object.keys(prev)) {
        updated[id] = prev[id].filter((l) => l !== label);
      }
      AsyncStorage.setItem("@file_labels_v1", JSON.stringify(updated));
      return updated;
    });
    setLabelFilter((lf) => lf.filter((l) => l !== label));
  }, []);

  const migrateLabels = useCallback((idMapping: Record<string, string>) => {
    setFileLabels((prev) => {
      const updated = { ...prev };
      let changed = false;
      for (const [oldId, newId] of Object.entries(idMapping)) {
        const labels = prev[oldId];
        if (labels && labels.length > 0) {
          delete updated[oldId];
          updated[newId] = labels;
          changed = true;
        }
      }
      if (!changed) return prev;
      AsyncStorage.setItem("@file_labels_v1", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const cleanupLabels = useCallback((id: string) => {
    setFileLabels((prev) => {
      if (!prev[id]) return prev;
      const updated = { ...prev };
      delete updated[id];
      AsyncStorage.setItem("@file_labels_v1", JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── sort ───────────────────────────────────────────────────────────────────
  const applySortKey = useCallback((key: SortKey) => {
    setSortKey(key);
    AsyncStorage.setItem("@downloads_sort_key", key);
  }, []);

  // ── media type ─────────────────────────────────────────────────────────────
  const getMediaType = useCallback((task: DownloadTask): DownloadMediaType => {
    const source = (task.fileName || task.filePath || task.url || "")
      .toLowerCase()
      .split("?")[0]
      .split("#")[0];
    const ext = source.split(".").pop() || "";
    if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "heic", "heif"].includes(ext)) return "image";
    if (["mp4", "mov", "mkv", "webm", "avi", "m4v", "3gp"].includes(ext)) return "video";
    if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
    return "other";
  }, []);

  // ── refresh on focus ───────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      refreshDownloads().catch((err) => {
        console.warn("Failed to scan private downloads on Downloads focus:", err);
      });
    }, [refreshDownloads]),
  );

  // ── device path helpers ────────────────────────────────────────────────────
  const isDevicePath =
    currentFolderPath === DEVICE_ROOT_PATH ||
    currentFolderPath.startsWith(`${DEVICE_ROOT_PATH}/`);

  const currentDeviceFolderPath =
    currentFolderPath === DEVICE_ROOT_PATH
      ? ""
      : currentFolderPath.startsWith(`${DEVICE_ROOT_PATH}/`)
        ? currentFolderPath.substring(DEVICE_ROOT_PATH.length + 1)
        : "";

  const isInTrash =
    currentFolderPath === TRASH_FOLDER_PATH ||
    currentFolderPath.startsWith(`${TRASH_FOLDER_PATH}/`);

  // ── folder navigation ──────────────────────────────────────────────────────
  const handleBackFolder = useCallback(() => {
    if (!currentFolderPath) return;

    if (currentFolderPath === DEVICE_ROOT_PATH) {
      setCurrentFolderPath("");
      return;
    }

    if (currentFolderPath.startsWith(`${DEVICE_ROOT_PATH}/`)) {
      const relative = currentFolderPath.substring(DEVICE_ROOT_PATH.length + 1);
      const slashIndex = relative.lastIndexOf("/");
      setCurrentFolderPath(
        slashIndex >= 0
          ? `${DEVICE_ROOT_PATH}/${relative.substring(0, slashIndex)}`
          : DEVICE_ROOT_PATH,
      );
      return;
    }

    const slashIndex = currentFolderPath.lastIndexOf("/");
    setCurrentFolderPath(slashIndex >= 0 ? currentFolderPath.substring(0, slashIndex) : "");
  }, [currentFolderPath]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (currentFolderPathRef.current) {
          handleBackFolder();
          return true;
        }
        (navigation as any).navigate("Browser");
        return true;
      });
      return () => sub.remove();
    }, [handleBackFolder, navigation]),
  );

  const handleOpenFolder = useCallback(
    (item: FolderGridItem) => {
      if (item.isDeviceRoot) {
        setCurrentFolderPath(DEVICE_ROOT_PATH);
        return;
      }
      setCurrentFolderPath(item.path);
    },
    [],
  );

  // ── folder management ──────────────────────────────────────────────────────
  const openCreateFolder = useCallback(() => {
    setFolderDialogMode("create");
    setActiveFolderPath("");
    setFolderNameText("");
  }, []);

  const openRenameFolder = useCallback((folderPath: string) => {
    const leafName = folderPath.split("/").pop() || folderPath;
    setFolderDialogMode("rename");
    setActiveFolderPath(folderPath);
    setFolderNameText(leafName);
  }, []);

  const closeFolderDialog = useCallback(() => {
    setFolderDialogMode(null);
    setActiveFolderPath("");
    setFolderNameText("");
  }, []);

  const submitFolderDialog = useCallback(() => {
    const trimmed = folderNameText.trim();
    if (!trimmed || !folderDialogMode) return;

    const nextPath = currentFolderPath ? `${currentFolderPath}/${trimmed}` : trimmed;
    const action =
      folderDialogMode === "create"
        ? createFolder(nextPath)
        : renameFolder(activeFolderPath, trimmed);

    action
      .catch((err) => {
        Alert.alert(
          "Folder error",
          err instanceof Error ? err.message : "Unable to update folder",
        );
      })
      .finally(closeFolderDialog);
  }, [activeFolderPath, closeFolderDialog, createFolder, currentFolderPath, folderDialogMode, folderNameText, renameFolder]);

  const runDeleteFolder = useCallback(
    (folderPath: string, force = false) => {
      deleteFolder(folderPath, force).catch((err) => {
        const message = err instanceof Error ? err.message : "Unable to delete folder";
        if (!force && message.toLowerCase().includes("not empty")) {
          Alert.alert(
            "Delete folder and all contents?",
            "This folder contains files or subfolders. This action cannot be undone.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Delete All", style: "destructive", onPress: () => runDeleteFolder(folderPath, true) },
            ],
          );
          return;
        }
        Alert.alert("Folder error", message);
      });
    },
    [deleteFolder],
  );

  const handleDeleteFolder = useCallback(
    (folderPath: string) => {
      const folderName = folderPath.split("/").pop() || folderPath;
      Alert.alert("Delete folder", `Delete folder "${folderName}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => runDeleteFolder(folderPath) },
      ]);
    },
    [runDeleteFolder],
  );

  const handleFolderAction = useCallback(
    (folderPath: string) => {
      const folderName = folderPath.split("/").pop() || folderPath;
      Alert.alert(folderName, "Folder options", [
        { text: "Rename", onPress: () => openRenameFolder(folderPath) },
        { text: "Delete", style: "destructive", onPress: () => handleDeleteFolder(folderPath) },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [handleDeleteFolder, openRenameFolder],
  );

  // ── rename file ────────────────────────────────────────────────────────────
  const handleRename = useCallback((task: DownloadTask) => {
    if (!task.filePath) return;
    const initialName = task.fileName || task.filePath.split("/").pop() || "";
    setRenameTask(task);
    setRenameText(initialName);
  }, []);

  const closeRenameModal = useCallback(() => {
    setRenameTask(null);
    setRenameText("");
  }, []);

  const submitRename = useCallback(() => {
    if (!renameTask) return;
    const trimmed = renameText.trim();
    if (!trimmed) return;
    const oldId = renameTask.id;
    renameDownload(oldId, trimmed)
      .then((newId) => { if (newId) migrateLabels({ [oldId]: newId }); })
      .catch((err) => { console.warn("Rename failed:", err); })
      .finally(closeRenameModal);
  }, [closeRenameModal, renameDownload, renameTask, renameText, migrateLabels]);

  // ── remove / delete ────────────────────────────────────────────────────────
  const handleRemove = useCallback(
    (id: string) => {
      Alert.alert("Move to Trash", "Move this file to the Trash folder?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to Trash",
          style: "destructive",
          onPress: () => {
            removeDownload(id).then((newId) => {
              if (newId) migrateLabels({ [id]: newId });
            });
          },
        },
      ]);
    },
    [removeDownload, migrateLabels],
  );

  const handleDeletePermanently = useCallback(
    (id: string) => {
      Alert.alert(
        "Delete Permanently",
        "This file will be deleted forever and cannot be recovered.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              deleteFromTrash(id);
              cleanupLabels(id);
            },
          },
        ],
      );
    },
    [deleteFromTrash, cleanupLabels],
  );

  // ── preview ────────────────────────────────────────────────────────────────
  const handleOpenMedia = useCallback(
    (task: DownloadTask) => {
      if (task.status !== "completed" || !task.filePath) return;
      if (getMediaType(task) === "other") return;
      setPreviewTask(task);
    },
    [getMediaType],
  );

  // ── copy / move ────────────────────────────────────────────────────────────
  const handleCopyRequest = useCallback((task: DownloadTask) => {
    if (task.status !== "completed" || !task.filePath) return;
    setCopyTask(task);
  }, []);

  const handleMoveInPrivateRequest = useCallback((task: DownloadTask) => {
    if (task.status !== "completed" || !task.filePath || task.source === "device") return;
    setMoveTaskInPrivate(task);
  }, []);

  const handleCopyToFolder = useCallback(
    (folderName?: string | null) => {
      if (!copyTask) return;
      const target = copyTask.source === "private" ? DEVICE_DOWNLOAD_MOVE_TARGET : folderName;
      moveDownloadToFolder(copyTask.id, target)
        .catch((err) => {
          Alert.alert("Copy error", err instanceof Error ? err.message : "Unable to move file");
        })
        .finally(() => setCopyTask(null));
    },
    [copyTask, moveDownloadToFolder],
  );

  const handleMoveInPrivateToFolder = useCallback(
    (folderName?: string | null) => {
      if (!moveTaskInPrivate) return;
      const taskId = moveTaskInPrivate.id;
      setMoveTaskInPrivate(null);
      moveDownloadToFolder(taskId, folderName)
        .then((newId) => { if (newId) migrateLabels({ [taskId]: newId }); })
        .catch((err) => {
          Alert.alert("Move error", err instanceof Error ? err.message : "Unable to move file");
        });
    },
    [moveDownloadToFolder, moveTaskInPrivate, migrateLabels],
  );

  // ── selection ──────────────────────────────────────────────────────────────
  const isSelectionMode = selectedIds.size > 0;

  const handleEnterSelection = useCallback((task: DownloadTask) => {
    setSelectedIds(new Set([task.id]));
  }, []);

  const handleToggleSelect = useCallback((task: DownloadTask) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.has(task.id)) next.add(task.id);
      else next.delete(task.id);
      return next;
    });
  }, []);

  const handleCancelSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size;
    Alert.alert(
      `Delete ${count} item${count !== 1 ? "s" : ""}`,
      "Remove selected downloads? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const ids = Array.from(selectedIds);
            setSelectedIds(new Set());
            Promise.all(ids.map((id) => removeDownload(id))).then((results) => {
              const mapping: Record<string, string> = {};
              for (let i = 0; i < ids.length; i++) {
                const newId = results[i];
                if (newId) mapping[ids[i]] = newId;
              }
              if (Object.keys(mapping).length > 0) migrateLabels(mapping);
            });
          },
        },
      ],
    );
  }, [removeDownload, selectedIds, migrateLabels]);

  const selectedTasks = useMemo(
    () => downloads.filter((t) => selectedIds.has(t.id)),
    [downloads, selectedIds],
  );

  const canBulkMove =
    selectedTasks.length > 0 &&
    selectedTasks.every((t) => t.status === "completed" && !!t.filePath && t.source !== "device");

  const canBulkMoveToPrivate =
    selectedTasks.length > 0 &&
    selectedTasks.every((t) => t.status === "completed" && !!t.filePath && t.source === "device");

  const handleBulkMoveTo = useCallback(
    (folderPath?: string | null) => {
      const ids = Array.from(selectedIds);
      setBulkMoveModalVisible(false);
      setSelectedIds(new Set());
      setMoveProgress({ total: ids.length, label: "Moving files..." });
      bulkMoveDownloadsToFolder(ids, folderPath)
        .then((idMapping) => { if (Object.keys(idMapping).length > 0) migrateLabels(idMapping); })
        .catch((err) => {
          Alert.alert("Move error", err instanceof Error ? err.message : "Unable to move some files");
        })
        .finally(() => setMoveProgress(null));
    },
    [bulkMoveDownloadsToFolder, selectedIds, migrateLabels],
  );

  const handleBulkMoveToPrivate = useCallback(
    (folderPath?: string | null) => {
      const ids = Array.from(selectedIds);
      setBulkMoveToPrivateModalVisible(false);
      setSelectedIds(new Set());
      setMoveProgress({ total: ids.length, label: "Moving to private folder..." });
      bulkMoveDownloadsToFolder(ids, folderPath ?? null)
        .then((idMapping) => { if (Object.keys(idMapping).length > 0) migrateLabels(idMapping); })
        .catch((err) => {
          Alert.alert("Move error", err instanceof Error ? err.message : "Unable to move some files");
        })
        .finally(() => setMoveProgress(null));
    },
    [bulkMoveDownloadsToFolder, selectedIds, migrateLabels],
  );

  // ── device rescan ──────────────────────────────────────────────────────────
  const handleRescanDevice = useCallback(() => {
    scanDeviceDownloadFolder().catch((err) => {
      Alert.alert(
        "Scan failed",
        err instanceof Error ? err.message : "Unable to scan device download folder",
      );
    });
  }, [scanDeviceDownloadFolder]);

  // ── folder item count ──────────────────────────────────────────────────────
  const getParentPath = useCallback((folderPath: string): string => {
    const slashIndex = folderPath.lastIndexOf("/");
    return slashIndex >= 0 ? folderPath.substring(0, slashIndex) : "";
  }, []);

  const getFolderItemCount = useCallback(
    (item: FolderGridItem): number => {
      if (item.isDeviceRoot) {
        return (
          deviceFolders.filter((fp) => getParentPath(fp) === "").length +
          downloads.filter((t) => t.status === "completed" && t.source === "device" && (t.folderPath || "") === "").length
        );
      }
      if (item.source === "device") {
        const rel = item.path.startsWith(`${DEVICE_ROOT_PATH}/`)
          ? item.path.substring(DEVICE_ROOT_PATH.length + 1)
          : item.path;
        return (
          deviceFolders.filter((fp) => getParentPath(fp) === rel).length +
          downloads.filter((t) => t.status === "completed" && t.source === "device" && (t.folderPath || "") === rel).length
        );
      }
      return (
        folders.filter((fp) => getParentPath(fp) === item.path).length +
        downloads.filter((t) => t.status === "completed" && t.source !== "device" && (t.folderPath || "") === item.path).length
      );
    },
    [deviceFolders, downloads, folders, getParentPath],
  );

  // ── visible data ───────────────────────────────────────────────────────────
  const privateFolderTreeOptions = useMemo<Array<{ path: string; name: string; depth: number }>>(
    () =>
      folders
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .map((path) => {
          const segments = path.split("/").filter(Boolean);
          return { path, name: segments[segments.length - 1] || path, depth: Math.max(segments.length - 1, 0) };
        }),
    [folders],
  );

  const visibleFolders: DownloadGridItem[] = useMemo(() => {
    const privateFolders = !isDevicePath
      ? folders
          .filter((fp) => {
            const slashIndex = fp.lastIndexOf("/");
            const parentPath = slashIndex >= 0 ? fp.substring(0, slashIndex) : "";
            return parentPath === currentFolderPath;
          })
          .map((fp) => ({
            type: "folder" as const,
            path: fp,
            name: fp.split("/").pop() || fp,
            source: "private" as const,
          }))
      : [];

    const deviceFolderItems = isDevicePath
      ? deviceFolders
          .filter((fp) => {
            const slashIndex = fp.lastIndexOf("/");
            const parentPath = slashIndex >= 0 ? fp.substring(0, slashIndex) : "";
            return parentPath === currentDeviceFolderPath;
          })
          .map((fp) => ({
            type: "folder" as const,
            path: `${DEVICE_ROOT_PATH}/${fp}`,
            name: fp.split("/").pop() || fp,
            source: "device" as const,
          }))
      : [];

    const deviceRoot =
      currentFolderPath === ""
        ? [{ type: "folder" as const, path: DEVICE_ROOT_PATH, name: "Device Download", source: "device" as const, isDeviceRoot: true }]
        : [];

    return [...privateFolders, ...deviceRoot, ...deviceFolderItems].sort((a, b) =>
      a.type === "folder" && b.type === "folder" ? a.name.localeCompare(b.name) : 0,
    );
  }, [isDevicePath, folders, currentFolderPath, deviceFolders, currentDeviceFolderPath]);

  const visibleDownloads = useMemo(
    () =>
      downloads.filter((task) => {
        if (task.status !== "completed") return currentFolderPath === "";
        if (task.source === "device") {
          if (!isDevicePath) return false;
          return (task.folderPath || "") === currentDeviceFolderPath;
        }
        if (isDevicePath) return false;
        return (task.folderPath || "") === currentFolderPath;
      }),
    [downloads, currentFolderPath, isDevicePath, currentDeviceFolderPath],
  );

  const sortedFiles = useMemo(() => {
    const files = visibleDownloads
      .filter((task) => filterType === "all" || getMediaType(task) === filterType)
      .filter((task) => labelFilter.length === 0 || labelFilter.some((lbl) => (fileLabels[task.id] || []).includes(lbl)))
      .map((task) => ({ type: "file" as const, task }));

    return files.slice().sort((a, b) => {
      switch (sortKey) {
        case "name_asc": return (a.task.fileName || "").localeCompare(b.task.fileName || "");
        case "name_desc": return (b.task.fileName || "").localeCompare(a.task.fileName || "");
        case "date_newest": return (b.task.createdAt ?? 0) - (a.task.createdAt ?? 0);
        case "date_oldest": return (a.task.createdAt ?? 0) - (b.task.createdAt ?? 0);
        case "size_largest": return (b.task.totalBytes ?? 0) - (a.task.totalBytes ?? 0);
        case "size_smallest": return (a.task.totalBytes ?? 0) - (b.task.totalBytes ?? 0);
        case "duration_longest": return (b.task.duration ?? 0) - (a.task.duration ?? 0);
        case "duration_shortest": return (a.task.duration ?? 0) - (b.task.duration ?? 0);
        case "type": {
          const ext = (t: DownloadTask) => (t.fileName || "").split(".").pop()?.toLowerCase() || "";
          return ext(a.task).localeCompare(ext(b.task));
        }
        default: return 0;
      }
    });
  }, [visibleDownloads, sortKey, filterType, getMediaType, labelFilter, fileLabels]);

  const gridData: DownloadGridItem[] = [
    ...(filterType === "all" ? visibleFolders : []),
    ...sortedFiles,
  ];

  const visibleFileIds = useMemo(() => sortedFiles.map((f) => f.task.id), [sortedFiles]);
  const allSelected = visibleFileIds.length > 0 && visibleFileIds.every((id) => selectedIds.has(id));

  const handleSelectAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(visibleFileIds));
  }, [allSelected, visibleFileIds]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filterType !== "all") {
      const icon = filterType === "video" ? "🎬" : filterType === "audio" ? "🎵" : filterType === "image" ? "🖼️" : "📄";
      parts.push(`${icon} ${filterType.charAt(0).toUpperCase() + filterType.slice(1)}`);
    }
    if (labelFilter.length === 1) parts.push(`🏷 ${labelFilter[0]}`);
    else if (labelFilter.length > 1) parts.push(`🏷 ${labelFilter.length} labels`);
    return parts.length > 0 ? parts.join(" · ") : "All";
  }, [filterType, labelFilter]);
  const isFilterActive = filterType !== "all" || labelFilter.length > 0;

  // ── viewability (device file size prefetch) ────────────────────────────────
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 1 });
  const onViewableItemsChangedRef = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: DownloadGridItem }> }) => {
      const ids: string[] = [];
      for (const v of viewableItems) {
        if (v.item.type === "file" && v.item.task.source === "device" && v.item.task.totalBytes === 0) {
          ids.push(v.item.task.id);
        }
      }
      if (ids.length > 0) prefetchSizesRef.current(ids);
    },
  );

  // ── folder picker options builders ─────────────────────────────────────────
  const privateFolderPickerOptions = useCallback(
    (onSelect: (path: string | null) => void): FolderPickerOption[] => [
      { label: "Root", onPress: () => onSelect(null) },
      ...privateFolderTreeOptions.map((f) => ({
        label: `📁 ${f.name}`,
        depth: f.depth,
        onPress: () => onSelect(f.path),
      })),
    ],
    [privateFolderTreeOptions],
  );

  const copyModalOptions = useMemo<FolderPickerOption[]>(() => {
    if (!copyTask) return [];
    if (copyTask.source === "device") {
      return privateFolderPickerOptions(handleCopyToFolder);
    }
    return [{ label: "Device Download", onPress: () => handleCopyToFolder(DEVICE_DOWNLOAD_MOVE_TARGET) }];
  }, [copyTask, privateFolderPickerOptions, handleCopyToFolder]);

  // ── render item ────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: DownloadGridItem }) => {
      if (item.type === "folder") {
        return (
          <View style={styles.gridItem}>
            <FolderCard
              item={item}
              itemCount={getFolderItemCount(item)}
              isDeviceScanRunning={isDeviceScanRunning}
              onOpen={() => handleOpenFolder(item)}
              onAction={item.source === "private" ? () => handleFolderAction(item.path) : undefined}
            />
          </View>
        );
      }

      return (
        <View style={styles.gridItem}>
          <DownloadItem
            task={item.task}
            mediaType={getMediaType(item.task)}
            onPause={pauseDownload}
            onResume={resumeDownload}
            onCancel={cancelDownload}
            onOpenMedia={handleOpenMedia}
            onRename={handleRename}
            onMove={handleCopyRequest}
            onMoveInPrivate={handleMoveInPrivateRequest}
            onRemove={isInTrash ? undefined : handleRemove}
            onDeletePermanently={isInTrash ? handleDeletePermanently : undefined}
            isSelectionMode={isSelectionMode}
            isSelected={selectedIdsRef.current.has(item.task.id)}
            onLongPress={handleEnterSelection}
            onSelect={handleToggleSelect}
            labels={fileLabelsRef.current[item.task.id]}
            onLabel={setLabelTaskTarget}
          />
        </View>
      );
    },
    [
      isSelectionMode,
      isDeviceScanRunning,
      getFolderItemCount,
      handleOpenFolder,
      handleFolderAction,
      getMediaType,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      handleOpenMedia,
      handleRename,
      handleCopyRequest,
      handleMoveInPrivateRequest,
      handleRemove,
      handleEnterSelection,
      handleToggleSelect,
      isInTrash,
      handleDeletePermanently,
    ],
  );

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <DownloadsHeader
        isSelectionMode={isSelectionMode}
        selectedCount={selectedIds.size}
        allSelected={allSelected}
        canBulkMove={canBulkMove}
        canBulkMoveToPrivate={canBulkMoveToPrivate}
        currentFolderPath={currentFolderPath}
        gridDataLength={gridData.length}
        onCancelSelection={handleCancelSelection}
        onSelectAll={handleSelectAll}
        onBulkMove={() => setBulkMoveModalVisible(true)}
        onBulkMoveToPrivate={() => setBulkMoveToPrivateModalVisible(true)}
        onBulkDelete={handleBulkDelete}
        onBack={handleBackFolder}
        onActionsMenu={() => setActionsDialogVisible(true)}
      />

      {!isSelectionMode && (
        <FilterBar
          filterSummary={filterSummary}
          isFilterActive={isFilterActive}
          onOpenFilter={() => setFilterDialogVisible(true)}
          onClear={() => { setFilterType("all"); setLabelFilter([]); }}
        />
      )}

      {isDevicePath && (
        <View style={styles.deviceScanStatusRow}>
          <Text style={styles.deviceScanStatusText}>
            {isDeviceScanRunning
              ? "Device download scan is running..."
              : "Showing last scanned device download results"}
          </Text>
        </View>
      )}

      {gridData.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📥</Text>
          <Text style={styles.emptyText}>
            {isDeviceScanRunning
              ? "Scanning device folder..."
              : currentFolderPath
                ? "This folder is empty"
                : "No downloads yet"}
          </Text>
          <Text style={styles.emptySubtext}>
            {isDevicePath
              ? "Use Rescan to refresh files and folders from device storage"
              : currentFolderPath
                ? "Create a subfolder or move files here"
                : "Browse a page with videos and tap the download button"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={gridData}
          numColumns={2}
          keyExtractor={(item) =>
            item.type === "folder" ? `folder_${item.path}` : item.task.id
          }
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.listRow}
          extraData={isSelectionMode}
          renderItem={renderItem}
          viewabilityConfig={viewabilityConfigRef.current}
          onViewableItemsChanged={onViewableItemsChangedRef.current}
        />
      )}

      <RenameModal
        visible={!!renameTask}
        renameText={renameText}
        onChangeText={setRenameText}
        onCancel={closeRenameModal}
        onSubmit={submitRename}
      />

      <FolderDialog
        mode={folderDialogMode}
        folderNameText={folderNameText}
        onChangeText={setFolderNameText}
        onCancel={closeFolderDialog}
        onSubmit={submitFolderDialog}
      />

      <FolderPickerModal
        visible={!!copyTask}
        title={
          copyTask?.source === "device"
            ? "Copy file to private folder"
            : "Copy file to device download"
        }
        options={copyModalOptions}
        onClose={() => setCopyTask(null)}
      />

      <FolderPickerModal
        visible={!!moveTaskInPrivate}
        title="Move file to folder"
        options={privateFolderPickerOptions(handleMoveInPrivateToFolder)}
        onClose={() => setMoveTaskInPrivate(null)}
      />

      <FolderPickerModal
        visible={bulkMoveModalVisible}
        title={`Move ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""} to folder`}
        options={privateFolderPickerOptions(handleBulkMoveTo)}
        onClose={() => setBulkMoveModalVisible(false)}
      />

      <FolderPickerModal
        visible={bulkMoveToPrivateModalVisible}
        title={`Move ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""} to private folder`}
        options={privateFolderPickerOptions(handleBulkMoveToPrivate)}
        onClose={() => setBulkMoveToPrivateModalVisible(false)}
      />

      <PreviewModal
        task={previewTask}
        mediaType={previewTask ? getMediaType(previewTask) : "other"}
        onClose={() => setPreviewTask(null)}
        onEditVideo={async () => {
          const task = previewTask;
          setPreviewTask(null);
          if (task?.filePath) {
            const name = task.fileName || task.filePath.split('/').pop() || 'Video';
            await addOrUpdateProject(task.filePath, name, 0);
            (navigation as any).navigate('Trim', { videoUri: task.filePath, duration: 0 });
          }
        }}
      />

      <ActionsDropdown
        visible={actionsDialogVisible}
        isDevicePath={isDevicePath}
        isDeviceScanRunning={isDeviceScanRunning}
        sortKey={sortKey}
        onClose={() => setActionsDialogVisible(false)}
        onCreateFolder={() => { setActionsDialogVisible(false); openCreateFolder(); }}
        onRescan={() => { setActionsDialogVisible(false); handleRescanDevice(); }}
        onSortChange={applySortKey}
        onManageLabels={() => { setActionsDialogVisible(false); setManageLabelModalVisible(true); }}
      />

      <FilterDialog
        visible={filterDialogVisible}
        filterType={filterType}
        labelFilter={labelFilter}
        labelDefs={labelDefs}
        isFilterActive={isFilterActive}
        onFilterType={setFilterType}
        onLabelFilter={setLabelFilter}
        onClose={() => setFilterDialogVisible(false)}
        onClear={() => { setFilterType("all"); setLabelFilter([]); }}
      />

      <LabelPickerModal
        task={labelTaskTarget}
        fileLabels={fileLabels}
        labelDefs={labelDefs}
        newLabelText={manageLabelNewText}
        onChangeNewLabel={setManageLabelNewText}
        onToggle={handleToggleFileLabel}
        onAddLabel={handleAddLabelDef}
        onClose={() => setLabelTaskTarget(null)}
      />

      <ManageLabelsModal
        visible={manageLabelModalVisible}
        labelDefs={labelDefs}
        newLabelText={manageLabelNewText}
        onChangeNewLabel={setManageLabelNewText}
        onAddLabel={handleAddLabelDef}
        onDeleteLabel={handleDeleteLabelDef}
        onClose={() => setManageLabelModalVisible(false)}
      />

      <MoveProgressModal progress={moveProgress} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  listContent: {
    flexGrow: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  listRow: {
    justifyContent: "space-between",
  },
  gridItem: {
    width: "48.5%",
    marginBottom: 10,
  },
  deviceScanStatusRow: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  deviceScanStatusText: {
    fontSize: 12,
    color: "#4A6A8A",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#555",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    lineHeight: 20,
  },
});
