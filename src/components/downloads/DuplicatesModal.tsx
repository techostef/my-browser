import * as VideoThumbnails from "expo-video-thumbnails";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "../../i18n";
import { DownloadTask } from "../../types";
import { DuplicateMode } from "./DuplicateModePicker";

type Props = {
  visible: boolean;
  mode: DuplicateMode;
  downloads: DownloadTask[];
  onClose: () => void;
  onDelete: (ids: string[]) => void;
};

type Group = {
  key: string;
  sizeMin: number;
  sizeMax: number;
  durationMs: number;
  files: DownloadTask[];
};

const SIZE_TOLERANCE = 0.005;

const thumbCache = new Map<string, string>();

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(ms: number): string {
  if (!ms) return "";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isVideoFile(task: DownloadTask): boolean {
  const source = (task.fileName || task.filePath || task.url || "")
    .toLowerCase()
    .split("?")[0]
    .split("#")[0];
  const ext = source.split(".").pop() || "";
  return ["mp4", "mov", "mkv", "webm", "avi", "m4v", "3gp"].includes(ext);
}

function finalizeGroup(
  files: DownloadTask[],
  keyPrefix: string,
  index: number,
): Group | null {
  if (files.length < 2) return null;
  const sorted = files
    .slice()
    .sort((a, b) => (a.fileName || "").localeCompare(b.fileName || ""));
  let sizeMin = Infinity;
  let sizeMax = 0;
  for (const f of sorted) {
    if (f.totalBytes < sizeMin) sizeMin = f.totalBytes;
    if (f.totalBytes > sizeMax) sizeMax = f.totalBytes;
  }
  return {
    key: `${keyPrefix}:${index}`,
    sizeMin: sizeMin === Infinity ? 0 : sizeMin,
    sizeMax,
    durationMs: sorted[0].duration ?? 0,
    files: sorted,
  };
}

function clusterBySize(items: DownloadTask[], keyPrefix: string): Group[] {
  const sorted = items.slice().sort((a, b) => a.totalBytes - b.totalBytes);
  const groups: Group[] = [];
  let bucket: DownloadTask[] = [];
  let anchor = 0;
  let bucketIdx = 0;
  for (const t of sorted) {
    if (bucket.length === 0) {
      bucket = [t];
      anchor = t.totalBytes;
      continue;
    }
    if (t.totalBytes <= anchor * (1 + SIZE_TOLERANCE)) {
      bucket.push(t);
    } else {
      const g = finalizeGroup(bucket, keyPrefix, bucketIdx++);
      if (g) groups.push(g);
      bucket = [t];
      anchor = t.totalBytes;
    }
  }
  const g = finalizeGroup(bucket, keyPrefix, bucketIdx++);
  if (g) groups.push(g);
  return groups;
}

function computeGroups(
  downloads: DownloadTask[],
  mode: DuplicateMode,
): Group[] {
  const candidates: DownloadTask[] = [];
  for (const t of downloads) {
    if (t.status !== "completed") continue;
    if (t.source === "device") continue;
    if (!t.filePath) continue;
    if (!isVideoFile(t)) continue;

    const sizeOk = t.totalBytes > 0;
    const durSec = t.duration ? Math.floor(t.duration / 1000) : 0;
    const durOk = durSec > 0;

    if (mode === "size" && !sizeOk) continue;
    if (mode === "duration" && !durOk) continue;
    if (mode === "both" && (!sizeOk || !durOk)) continue;

    candidates.push(t);
  }

  let groups: Group[] = [];

  if (mode === "size") {
    groups = clusterBySize(candidates, "s");
  } else if (mode === "duration") {
    const buckets = new Map<number, DownloadTask[]>();
    for (const t of candidates) {
      const sec = Math.floor((t.duration ?? 0) / 1000);
      const arr = buckets.get(sec);
      if (arr) arr.push(t);
      else buckets.set(sec, [t]);
    }
    let idx = 0;
    for (const [, files] of buckets) {
      const g = finalizeGroup(files, "d", idx++);
      if (g) groups.push(g);
    }
  } else {
    const buckets = new Map<number, DownloadTask[]>();
    for (const t of candidates) {
      const sec = Math.floor((t.duration ?? 0) / 1000);
      const arr = buckets.get(sec);
      if (arr) arr.push(t);
      else buckets.set(sec, [t]);
    }
    let secIdx = 0;
    for (const [sec, files] of buckets) {
      if (files.length < 2) continue;
      const sub = clusterBySize(files, `b${sec}_${secIdx++}`);
      groups.push(...sub);
    }
  }

  groups.sort((a, b) => b.files.length - a.files.length);
  return groups;
}

export default function DuplicatesModal({
  visible,
  mode,
  downloads,
  onClose,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const groups = useMemo(
    () => computeGroups(downloads, mode),
    [downloads, mode],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    const preselect = new Set<string>();
    for (const g of groups) {
      for (let i = 1; i < g.files.length; i++) {
        preselect.add(g.files[i].id);
      }
    }
    setSelectedIds(preselect);
  }, [visible, groups]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllButFirst(g: Group) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < g.files.length; i++) {
        if (i === 0) next.delete(g.files[i].id);
        else next.add(g.files[i].id);
      }
      return next;
    });
  }

  function clearAll() {
    setSelectedIds(new Set());
  }

  function handleDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    Alert.alert(
      t("moveToTrashTitle", {
        count: ids.length,
        s: ids.length !== 1 ? "s" : "",
      }),
      t("moveToTrashDesc"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("delete"),
          style: "destructive",
          onPress: () => {
            onDelete(ids);
            setSelectedIds(new Set());
            onClose();
          },
        },
      ],
    );
  }

  const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);
  const selectedCount = selectedIds.size;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{t("duplicates")}</Text>
            <Text style={styles.subtitle}>
              {groups.length === 0
                ? t("noGroups")
                : `${groups.length} ${t("group")}${groups.length !== 1 ? "s" : ""} · ${totalFiles} ${t("items")}`}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.deleteBtn,
              selectedCount === 0 && styles.deleteBtnDisabled,
            ]}
            disabled={selectedCount === 0}
            onPress={handleDelete}
          >
            <Text
              style={[
                styles.deleteBtnText,
                selectedCount === 0 && styles.deleteBtnTextDisabled,
              ]}
            >
              {t("delete")} ({selectedCount})
            </Text>
          </TouchableOpacity>
        </View>

        {groups.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎉</Text>
            <Text style={styles.emptyText}>{t("noDuplicatesFound")}</Text>
          </View>
        ) : (
          <>
            <View style={styles.toolbar}>
              <Text style={styles.toolbarHint}>
                {selectedCount} {t("selected")}
              </Text>
              <TouchableOpacity
                style={[
                  styles.toolbarBtn,
                  selectedCount === 0 && styles.toolbarBtnDisabled,
                ]}
                disabled={selectedCount === 0}
                onPress={clearAll}
              >
                <Text
                  style={[
                    styles.toolbarBtnText,
                    selectedCount === 0 && styles.toolbarBtnTextDisabled,
                  ]}
                >
                  {t("clearAll")}
                </Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={groups}
              keyExtractor={(g) => g.key}
              contentContainerStyle={styles.listContent}
              renderItem={({ item, index }) => (
                <GroupCard
                  group={item}
                  index={index}
                  selectedIds={selectedIds}
                  onToggle={toggle}
                  onSelectAllButFirst={() => selectAllButFirst(item)}
                  t={t}
                />
              )}
            />
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

type GroupCardProps = {
  group: Group;
  index: number;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAllButFirst: () => void;
  t: (key: any, params?: Record<string, string | number>) => string;
};

function GroupCard({
  group,
  index,
  selectedIds,
  onToggle,
  onSelectAllButFirst,
  t,
}: GroupCardProps) {
  const sizeLabel =
    group.sizeMin === group.sizeMax
      ? formatBytes(group.sizeMin)
      : `${formatBytes(group.sizeMin)} – ${formatBytes(group.sizeMax)}`;
  const durLabel = formatDuration(group.durationMs);
  const meta = [sizeLabel, durLabel].filter(Boolean).join(" · ");

  return (
    <View style={styles.groupCard}>
      <View style={styles.groupHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupTitle}>
            {t("group")} {index + 1} · {group.files.length} {t("items")}
          </Text>
          {!!meta && <Text style={styles.groupMeta}>{meta}</Text>}
        </View>
        <TouchableOpacity
          onPress={onSelectAllButFirst}
          style={styles.helperBtn}
        >
          <Text style={styles.helperBtnText}>{t("allButFirst")}</Text>
        </TouchableOpacity>
      </View>

      {group.files.map((file) => (
        <FileRow
          key={file.id}
          file={file}
          selected={selectedIds.has(file.id)}
          onToggle={() => onToggle(file.id)}
        />
      ))}
    </View>
  );
}

type FileRowProps = {
  file: DownloadTask;
  selected: boolean;
  onToggle: () => void;
};

function FileRow({ file, selected, onToggle }: FileRowProps) {
  const [thumb, setThumb] = useState<string | null>(
    file.filePath ? (thumbCache.get(file.filePath) ?? null) : null,
  );

  useEffect(() => {
    let alive = true;
    if (!file.filePath) return;
    if (thumbCache.has(file.filePath)) {
      setThumb(thumbCache.get(file.filePath) ?? null);
      return;
    }
    VideoThumbnails.getThumbnailAsync(file.filePath, { time: 1000 })
      .then((result) => {
        if (!alive || !result?.uri) return;
        thumbCache.set(file.filePath, result.uri);
        setThumb(result.uri);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file.filePath]);

  const folderLabel = file.folderPath ? file.folderPath : "Root"; // Root here is a folder name fallback, not UI text
  const fileSize = formatBytes(file.totalBytes);

  return (
    <TouchableOpacity
      style={styles.fileRow}
      activeOpacity={0.7}
      onPress={onToggle}
    >
      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
        {selected && <Text style={styles.checkboxCheck}>✓</Text>}
      </View>

      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Text style={styles.thumbIcon}>🎬</Text>
        </View>
      )}

      <View style={styles.fileText}>
        <Text style={styles.fileName} numberOfLines={1}>
          {file.fileName || file.filePath.split("/").pop() || "video"}
        </Text>
        <Text style={styles.fileMeta} numberOfLines={1}>
          {fileSize ? `${fileSize} · ` : ""}📂 {folderLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#FFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    fontSize: 28,
    color: "#444",
    lineHeight: 28,
  },
  titleWrap: {
    flex: 1,
    marginLeft: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
  },
  subtitle: {
    fontSize: 12,
    color: "#888",
    marginTop: 1,
  },
  deleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#E74C3C",
  },
  deleteBtnDisabled: {
    backgroundColor: "#EEE",
  },
  deleteBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFF",
  },
  deleteBtnTextDisabled: {
    color: "#AAA",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "600",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#FFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
  },
  toolbarHint: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
  },
  toolbarBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#F0F4FA",
  },
  toolbarBtnDisabled: {
    backgroundColor: "#F2F2F2",
  },
  toolbarBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1A73E8",
  },
  toolbarBtnTextDisabled: {
    color: "#AAA",
  },
  listContent: {
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  groupCard: {
    backgroundColor: "#FFF",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 6,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#222",
  },
  groupMeta: {
    fontSize: 11,
    color: "#777",
    marginTop: 1,
  },
  helperBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#F0F4FA",
  },
  helperBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#1A73E8",
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#BBB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  checkboxSelected: {
    backgroundColor: "#1A73E8",
    borderColor: "#1A73E8",
  },
  checkboxCheck: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 16,
  },
  thumb: {
    width: 56,
    height: 42,
    borderRadius: 6,
    backgroundColor: "#E8ECF1",
    marginRight: 10,
  },
  thumbFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  thumbIcon: {
    fontSize: 20,
  },
  fileText: {
    flex: 1,
  },
  fileName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#222",
  },
  fileMeta: {
    fontSize: 11,
    color: "#888",
    marginTop: 1,
  },
});
