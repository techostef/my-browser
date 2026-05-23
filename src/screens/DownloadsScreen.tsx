import { withErrorBoundary } from '../components/ErrorBoundary';
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
  TouchableOpacity,
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
import DuplicateModePicker, { DuplicateMode } from "../components/downloads/DuplicateModePicker";
import DuplicatesModal from "../components/downloads/DuplicatesModal";
import DeleteConfirmModal from "../components/downloads/DeleteConfirmModal";
import { AdBanner } from '../components/AdBanner';

const DEVICE_ROOT_PATH = "__device_download__";
const TRASH_FOLDER_PATH = "__trash__";

function DownloadsScreen() {
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
  const [duplicatePickerVisible, setDuplicatePickerVisible] = useState(false);
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("both");
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[] } | null>(null);
  const [deletePermanent, setDeletePermanent] = useState(false);
  const [hiddenFileIds, setHiddenFileIds] = useState<Set<string>>(new Set());
  const [hiddenFolderPaths, setHiddenFolderPaths] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  // ── refs ───────────────────────────────────────────────────────────────────
  const currentFolderPathRef = useRef(currentFolderPath);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const fileLabelsRef = useRef(fileLabels);
  fileLabelsRef.current = fileLabels;
  const hiddenFileIdsRef = useRef(hiddenFileIds);
  hiddenFileIdsRef.current = hiddenFileIds;
  const hiddenFolderPathsRef = useRef(hiddenFolderPaths);
  hiddenFolderPathsRef.current = hiddenFolderPaths;
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

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem("@hidden_files_v1"),
      AsyncStorage.getItem("@hidden_folders_v1"),
      AsyncStorage.getItem("@show_hidden_v1"),
    ]).then(([files, folders, show]) => {
      if (files) setHiddenFileIds(new Set(JSON.parse(files)));
      if (folders) setHiddenFolderPaths(new Set(JSON.parse(folders)));
      if (show === "1") setShowHidden(true);
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

  // ── hide helpers ───────────────────────────────────────────────────────────
  const persistHiddenFiles = (next: Set<string>) => {
    AsyncStorage.setItem("@hidden_files_v1", JSON.stringify(Array.from(next)));
  };
  const persistHiddenFolders = (next: Set<string>) => {
    AsyncStorage.setItem("@hidden_folders_v1", JSON.stringify(Array.from(next)));
  };

  const toggleHideFile = useCallback((id: string) => {
    setHiddenFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistHiddenFiles(next);
      return next;
    });
  }, []);

  const toggleHideFolder = useCallback((folderPath: string) => {
    setHiddenFolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      persistHiddenFolders(next);
      return next;
    });
  }, []);

  const toggleShowHidden = useCallback(() => {
    setShowHidden((prev) => {
      const next = !prev;
      AsyncStorage.setItem("@show_hidden_v1", next ? "1" : "0");
      return next;
    });
  }, []);

  const migrateHidden = useCallback((idMapping: Record<string, string>) => {
    setHiddenFileIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const [oldId, newId] of Object.entries(idMapping)) {
        if (next.has(oldId)) {
          next.delete(oldId);
          next.add(newId);
          changed = true;
        }
      }
      if (!changed) return prev;
      persistHiddenFiles(next);
      return next;
    });
  }, []);

  const cleanupHidden = useCallback((id: string) => {
    setHiddenFileIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      persistHiddenFiles(next);
      return next;
    });
  }, []);

  const renameHiddenFolder = useCallback((oldPath: string, newPath: string) => {
    setHiddenFolderPaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (p === oldPath) {
          next.add(newPath);
          changed = true;
        } else if (p.startsWith(`${oldPath}/`)) {
          next.add(`${newPath}${p.substring(oldPath.length)}`);
          changed = true;
        } else {
          next.add(p);
        }
      }
      if (!changed) return prev;
      persistHiddenFolders(next);
      return next;
    });
  }, []);

  const removeHiddenFolder = useCallback((folderPath: string) => {
    setHiddenFolderPaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (p === folderPath || p.startsWith(`${folderPath}/`)) {
          changed = true;
        } else {
          next.add(p);
        }
      }
      if (!changed) return prev;
      persistHiddenFolders(next);
      return next;
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
    const isRename = folderDialogMode === "rename";
    const renamedFrom = activeFolderPath;
    const parentPath = renamedFrom.includes("/")
      ? renamedFrom.substring(0, renamedFrom.lastIndexOf("/"))
      : "";
    const renamedTo = isRename
      ? parentPath
        ? `${parentPath}/${trimmed}`
        : trimmed
      : nextPath;
    const action = isRename
      ? renameFolder(renamedFrom, trimmed)
      : createFolder(nextPath);

    action
      .then(() => {
        if (isRename && renamedFrom !== renamedTo) {
          renameHiddenFolder(renamedFrom, renamedTo);
        }
      })
      .catch((err) => {
        Alert.alert(
          "Folder error",
          err instanceof Error ? err.message : "Unable to update folder",
        );
      })
      .finally(closeFolderDialog);
  }, [activeFolderPath, closeFolderDialog, createFolder, currentFolderPath, folderDialogMode, folderNameText, renameFolder, renameHiddenFolder]);

  const runDeleteFolder = useCallback(
    (folderPath: string, force = false) => {
      deleteFolder(folderPath, force)
        .then(() => removeHiddenFolder(folderPath))
        .catch((err) => {
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
    [deleteFolder, removeHiddenFolder],
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
      const isHidden = hiddenFolderPaths.has(folderPath);
      Alert.alert(folderName, "Folder options", [
        { text: "Rename", onPress: () => openRenameFolder(folderPath) },
        {
          text: isHidden ? "Unhide" : "Hide",
          onPress: () => toggleHideFolder(folderPath),
        },
        { text: "Delete", style: "destructive", onPress: () => handleDeleteFolder(folderPath) },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [handleDeleteFolder, openRenameFolder, hiddenFolderPaths, toggleHideFolder],
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
      .then((newId) => {
        if (newId) {
          migrateLabels({ [oldId]: newId });
          migrateHidden({ [oldId]: newId });
        }
      })
      .catch((err) => { console.warn("Rename failed:", err); })
      .finally(closeRenameModal);
  }, [closeRenameModal, renameDownload, renameTask, renameText, migrateLabels, migrateHidden]);

  // ── remove / delete ────────────────────────────────────────────────────────
  const handleRemove = useCallback(
    (id: string) => {
      setDeletePermanent(false);
      setDeleteConfirm({ ids: [id] });
    },
    [],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.ids;
    const permanent = deletePermanent;
    setDeleteConfirm(null);
    setDeletePermanent(false);
    setSelectedIds(new Set());

    if (permanent) {
      ids.forEach((id) => {
        deleteFromTrash(id);
        cleanupLabels(id);
        cleanupHidden(id);
      });
    } else {
      Promise.all(ids.map((id) => removeDownload(id))).then((results) => {
        const mapping: Record<string, string> = {};
        for (let i = 0; i < ids.length; i++) {
          const newId = results[i];
          if (newId) mapping[ids[i]] = newId;
        }
        if (Object.keys(mapping).length > 0) {
          migrateLabels(mapping);
          migrateHidden(mapping);
        }
      });
    }
  }, [deleteConfirm, deletePermanent, deleteFromTrash, cleanupLabels, cleanupHidden, removeDownload, migrateLabels, migrateHidden]);

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
              cleanupHidden(id);
            },
          },
        ],
      );
    },
    [deleteFromTrash, cleanupLabels, cleanupHidden],
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
      const task = copyTask;
      setCopyTask(null);
      const target = task.source === "private" ? DEVICE_DOWNLOAD_MOVE_TARGET : folderName;
      moveDownloadToFolder(task.id, target)
        .catch((err) => {
          Alert.alert("Copy error", err instanceof Error ? err.message : "Unable to move file");
        });
    },
    [copyTask, moveDownloadToFolder],
  );

  const handleMoveInPrivateToFolder = useCallback(
    (folderName?: string | null) => {
      if (!moveTaskInPrivate) return;
      const taskId = moveTaskInPrivate.id;
      setMoveTaskInPrivate(null);
      moveDownloadToFolder(taskId, folderName)
        .then((newId) => {
          if (newId) {
            migrateLabels({ [taskId]: newId });
            migrateHidden({ [taskId]: newId });
          }
        })
        .catch((err) => {
          Alert.alert("Move error", err instanceof Error ? err.message : "Unable to move file");
        });
    },
    [moveDownloadToFolder, moveTaskInPrivate, migrateLabels, migrateHidden],
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
    if (selectedIds.size === 0) return;
    setDeletePermanent(false);
    setDeleteConfirm({ ids: Array.from(selectedIds) });
  }, [selectedIds]);

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
        .then((idMapping) => {
          if (Object.keys(idMapping).length > 0) {
            migrateLabels(idMapping);
            migrateHidden(idMapping);
          }
        })
        .catch((err) => {
          Alert.alert("Move error", err instanceof Error ? err.message : "Unable to move some files");
        })
        .finally(() => setMoveProgress(null));
    },
    [bulkMoveDownloadsToFolder, selectedIds, migrateLabels, migrateHidden],
  );

  const handleBulkMoveToPrivate = useCallback(
    (folderPath?: string | null) => {
      const ids = Array.from(selectedIds);
      setBulkMoveToPrivateModalVisible(false);
      setSelectedIds(new Set());
      setMoveProgress({ total: ids.length, label: "Moving to private folder..." });
      bulkMoveDownloadsToFolder(ids, folderPath ?? null)
        .then((idMapping) => {
          if (Object.keys(idMapping).length > 0) {
            migrateLabels(idMapping);
            migrateHidden(idMapping);
          }
        })
        .catch((err) => {
          Alert.alert("Move error", err instanceof Error ? err.message : "Unable to move some files");
        })
        .finally(() => setMoveProgress(null));
    },
    [bulkMoveDownloadsToFolder, selectedIds, migrateLabels, migrateHidden],
  );

  // ── duplicates ─────────────────────────────────────────────────────────────
  const handleOpenDuplicatePicker = useCallback(() => {
    setDuplicatePickerVisible(true);
  }, []);

  const handleStartDuplicateScan = useCallback(() => {
    setDuplicatePickerVisible(false);
    setDuplicatesOpen(true);
  }, []);

  const handleDeleteDuplicates = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      Promise.all(ids.map((id) => removeDownload(id))).then((results) => {
        const mapping: Record<string, string> = {};
        for (let i = 0; i < ids.length; i++) {
          const newId = results[i];
          if (newId) mapping[ids[i]] = newId;
        }
        if (Object.keys(mapping).length > 0) {
          migrateLabels(mapping);
          migrateHidden(mapping);
        }
      });
    },
    [removeDownload, migrateLabels, migrateHidden],
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
          .filter((fp) => showHidden || !hiddenFolderPaths.has(fp))
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
  }, [isDevicePath, folders, currentFolderPath, deviceFolders, currentDeviceFolderPath, showHidden, hiddenFolderPaths]);

  const visibleDownloads = useMemo(
    () =>
      downloads.filter((task) => {
        if (task.status !== "completed") return currentFolderPath === "";
        if (task.source === "device") {
          if (!isDevicePath) return false;
          return (task.folderPath || "") === currentDeviceFolderPath;
        }
        if (isDevicePath) return false;
        if (!showHidden && hiddenFileIds.has(task.id)) return false;
        return (task.folderPath || "") === currentFolderPath;
      }),
    [downloads, currentFolderPath, isDevicePath, currentDeviceFolderPath, showHidden, hiddenFileIds],
  );

  const sortedFiles = useMemo(() => {
    const files = visibleDownloads
      .filter((task) => filterType === "all" || getMediaType(task) === filterType)
      .filter((task) => labelFilter.length === 0 || labelFilter.every((lbl) => (fileLabels[task.id] || []).includes(lbl)))
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

  // Preview navigation: prev/next walks through the same sorted list the grid
  // shows, but only over previewable media (skips "other" file types).
  const playableTasks = useMemo(
    () =>
      sortedFiles
        .map((f) => f.task)
        .filter(
          (t) =>
            t.status === "completed" &&
            !!t.filePath &&
            getMediaType(t) !== "other",
        ),
    [sortedFiles, getMediaType],
  );
  const previewIdx = previewTask
    ? playableTasks.findIndex((t) => t.id === previewTask.id)
    : -1;
  const handlePreviewPrev = useCallback(() => {
    if (previewIdx > 0) setPreviewTask(playableTasks[previewIdx - 1]);
  }, [previewIdx, playableTasks]);
  const handlePreviewNext = useCallback(() => {
    if (previewIdx >= 0 && previewIdx < playableTasks.length - 1) {
      setPreviewTask(playableTasks[previewIdx + 1]);
    }
  }, [previewIdx, playableTasks]);
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
    return parts.length > 0 ? parts.join(" · ") : "Filter All";
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
              isHidden={
                item.source === "private" &&
                hiddenFolderPathsRef.current.has(item.path)
              }
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
            isHidden={hiddenFileIdsRef.current.has(item.task.id)}
            onToggleHide={
              item.task.source !== "device" ? toggleHideFile : undefined
            }
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
      toggleHideFile,
    ],
  );

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {!isSelectionMode && !currentFolderPath && (
        <View style={styles.screenBackRow}>
          <TouchableOpacity
            onPress={() => (navigation as any).navigate('Browser')}
            style={styles.screenBackBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.screenBackText}>{'‹'} Browser</Text>
          </TouchableOpacity>
        </View>
      )}
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
          extraData={`${isSelectionMode}|${hiddenFileIds.size}|${hiddenFolderPaths.size}|${showHidden}`}
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
        onPrev={handlePreviewPrev}
        onNext={handlePreviewNext}
        hasPrev={previewIdx > 0}
        hasNext={previewIdx >= 0 && previewIdx < playableTasks.length - 1}
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
        showHidden={showHidden}
        onToggleShowHidden={toggleShowHidden}
        onClose={() => setActionsDialogVisible(false)}
        onCreateFolder={() => { setActionsDialogVisible(false); openCreateFolder(); }}
        onRescan={() => { setActionsDialogVisible(false); handleRescanDevice(); }}
        onSortChange={applySortKey}
        onManageLabels={() => { setActionsDialogVisible(false); setManageLabelModalVisible(true); }}
        onFindDuplicates={handleOpenDuplicatePicker}
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

      <DuplicateModePicker
        visible={duplicatePickerVisible}
        mode={duplicateMode}
        onChangeMode={setDuplicateMode}
        onCancel={() => setDuplicatePickerVisible(false)}
        onScan={handleStartDuplicateScan}
      />

      <DuplicatesModal
        visible={duplicatesOpen}
        mode={duplicateMode}
        downloads={downloads}
        onClose={() => setDuplicatesOpen(false)}
        onDelete={handleDeleteDuplicates}
      />

      <DeleteConfirmModal
        visible={!!deleteConfirm}
        count={deleteConfirm?.ids.length ?? 0}
        permanent={deletePermanent}
        onTogglePermanent={() => setDeletePermanent((v) => !v)}
        onCancel={() => { setDeleteConfirm(null); setDeletePermanent(false); }}
        onConfirm={handleConfirmDelete}
      />

      <AdBanner />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  screenBackRow: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: "#FFF",
  },
  screenBackBtn: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingRight: 8,
  },
  screenBackText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1F4E79",
  },
  listContent: {
    flexGrow: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    paddingBottom: 60,
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

export default withErrorBoundary(DownloadsScreen);
