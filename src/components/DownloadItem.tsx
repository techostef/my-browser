import React, { memo, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Modal,
} from "react-native";
import * as VideoThumbnails from "expo-video-thumbnails";
import { DownloadTask } from "../types";

export type DownloadMediaType = "image" | "video" | "audio" | "other";

interface Props {
  task: DownloadTask;
  mediaType: DownloadMediaType;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onOpenMedia: (task: DownloadTask) => void;
  onRename: (task: DownloadTask) => void;
  onMove?: (task: DownloadTask) => void;
  onMoveInPrivate?: (task: DownloadTask) => void;
  onRemove?: (id: string) => void;
  onDeletePermanently?: (id: string) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onLongPress?: (task: DownloadTask) => void;
  onSelect?: (task: DownloadTask) => void;
  labels?: string[];
  onLabel?: (task: DownloadTask) => void;
}

const videoThumbnailCache = new Map<string, string>();

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getStatusColor(status: DownloadTask["status"]): string {
  switch (status) {
    case "downloading":
      return "#4ECDC4";
    case "completed":
      return "#2ECC71";
    case "paused":
      return "#F39C12";
    case "failed":
      return "#E74C3C";
    case "cancelled":
      return "#95A5A6";
    case "queued":
      return "#3498DB";
    default:
      return "#95A5A6";
  }
}

const DownloadItem = memo(function DownloadItem({
  task,
  mediaType,
  onPause,
  onResume,
  onCancel,
  onOpenMedia,
  onRename,
  onMove,
  onMoveInPrivate,
  onRemove,
  onDeletePermanently,
  isSelectionMode = false,
  isSelected = false,
  onLongPress,
  onSelect,
  labels,
  onLabel,
}: Props) {
  const statusColor = getStatusColor(task.status);
  const isPlayableMedia =
    task.status === "completed" && !!task.filePath && mediaType !== "other";
  const canMoveCompletedFile = task.status === "completed" && !!task.filePath;
  const canMovePrivateFile =
    task.source !== "device" && task.status === "completed" && !!task.filePath;
  const canManageCompletedFile =
    task.source !== "device" &&
    (task.status === "completed" ||
      task.status === "failed" ||
      task.status === "cancelled");
  const [videoThumbnailUri, setVideoThumbnailUri] = useState<string | null>(
    null,
  );
  const [actionsVisible, setActionsVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const justEnteredSelectionRef = useRef(false);
  const sizeBytes =
    task.totalBytes > 0 ? task.totalBytes : task.bytesDownloaded;

  useEffect(() => {
    let isMounted = true;

    if (
      mediaType !== "video" ||
      !task.filePath ||
      task.status !== "completed"
    ) {
      setVideoThumbnailUri(null);
      return () => {
        isMounted = false;
      };
    }

    const cached = videoThumbnailCache.get(task.filePath);
    if (cached) {
      setVideoThumbnailUri(cached);
      return () => {
        isMounted = false;
      };
    }

    VideoThumbnails.getThumbnailAsync(task.filePath, { time: 1000 })
      .then((result) => {
        if (!isMounted || !result?.uri) {
          return;
        }
        videoThumbnailCache.set(task.filePath, result.uri);
        setVideoThumbnailUri(result.uri);
      })
      .catch((err) => {
        console.warn("Failed to create video thumbnail:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [mediaType, task.filePath, task.status]);

  return (
    <TouchableOpacity
      activeOpacity={isSelectionMode ? 0.7 : 1}
      onPress={
        isSelectionMode
          ? () => {
              if (justEnteredSelectionRef.current) {
                justEnteredSelectionRef.current = false;
                return;
              }
              onSelect?.(task);
            }
          : undefined
      }
      onLongPress={
        !isSelectionMode
          ? () => {
              justEnteredSelectionRef.current = true;
              onLongPress?.(task);
            }
          : undefined
      }
      delayLongPress={300}
      style={[styles.container]}
    >
      {isSelectionMode && (
        <View
          style={[
            styles.selectionOverlay,
            isSelected && styles.selectionOverlayChecked,
          ]}
        >
          <Text style={styles.selectionCheck}>{isSelected ? "✓" : ""}</Text>
        </View>
      )}
      <TouchableOpacity
        style={styles.thumbnailWrap}
        disabled={!isPlayableMedia || isSelectionMode}
        onPress={
          isSelectionMode
            ? () => {
                if (justEnteredSelectionRef.current) {
                  justEnteredSelectionRef.current = false;
                  return;
                }
                onSelect?.(task);
              }
            : () => onOpenMedia(task)
        }
        onLongPress={
          !isSelectionMode
            ? () => {
                justEnteredSelectionRef.current = true;
                onLongPress?.(task);
              }
            : undefined
        }
      >
        {mediaType === "image" && task.filePath ? (
          <Image
            source={{ uri: task.filePath }}
            style={styles.thumbnailImage}
          />
        ) : mediaType === "video" && videoThumbnailUri ? (
          <Image
            source={{ uri: videoThumbnailUri }}
            style={styles.thumbnailImage}
          />
        ) : (
          <View style={styles.thumbnailFallback}>
            <Text style={styles.thumbnailIcon}>
              {mediaType === "video"
                ? "🎬"
                : mediaType === "audio"
                  ? "🎵"
                  : "📄"}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {(task.status === "downloading" || task.status === "paused") && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBg}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${task.progress}%`,
                  backgroundColor: statusColor,
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {task.progress}% · {formatBytes(task.bytesDownloaded)}
            {task.totalBytes > 0 ? ` / ${formatBytes(task.totalBytes)}` : ""}
          </Text>
        </View>
      )}

      <View style={styles.bottomRow}>
        <View style={styles.infoSection}>
          <Text style={styles.fileName} numberOfLines={1}>
            {task.fileName || task.url.split("/").pop() || "video"}
          </Text>
          <Text style={styles.fileSize} numberOfLines={1}>
            {formatBytes(sizeBytes)}{task.duration ? ` · ${formatDuration(task.duration)}` : ''}
          </Text>
        </View>

        {!isSelectionMode && (
          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => setActionsVisible(true)}
          >
            <Text style={styles.menuBtnText}>⋯</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.labelRow}>
        {labels?.map(label => (
          <View key={label} style={styles.labelPill}>
            <Text style={styles.labelPillText}>{label}</Text>
          </View>
        ))}
      </View>

      <Modal
        visible={actionsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setActionsVisible(false)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setActionsVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.dialogCard}
            onPress={() => {}}
          >
            <View style={styles.actions}>
              {task.status === "downloading" && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.pauseBtn]}
                  onPress={() => {
                    onPause(task.id);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={styles.actionBtnText}>⏸ Pause</Text>
                </TouchableOpacity>
              )}
              {task.status === "paused" && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.resumeBtn]}
                  onPress={() => {
                    onResume(task.id);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={styles.actionBtnText}>▶ Resume</Text>
                </TouchableOpacity>
              )}
              {(task.status === "downloading" ||
                task.status === "paused" ||
                task.status === "queued") && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.cancelBtn]}
                  onPress={() => {
                    onCancel(task.id);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={styles.actionBtnText}>✕ Cancel</Text>
                </TouchableOpacity>
              )}
              {canMoveCompletedFile && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.moveBtn]}
                  onPress={() => {
                    onMove?.(task);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={styles.actionBtnText}>
                    {task.source === "device"
                      ? "📁 Copy to Private"
                      : "📁 Copy to Device Download"}
                  </Text>
                </TouchableOpacity>
              )}
              {canMovePrivateFile && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.moveBtn]}
                  onPress={() => {
                    onMoveInPrivate?.(task);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={styles.actionBtnText}>📂 Move to Folder</Text>
                </TouchableOpacity>
              )}
              {canManageCompletedFile && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.renameBtn]}
                  onPress={() => {
                    onRename(task);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={styles.actionBtnText}>✏ Rename</Text>
                </TouchableOpacity>
              )}
              {canManageCompletedFile && onLabel && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.labelBtn]}
                  onPress={() => {
                    onLabel(task);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={styles.actionBtnText}>🏷 Label</Text>
                </TouchableOpacity>
              )}
              {canManageCompletedFile && onRemove && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.removeBtn]}
                  onPress={() => {
                    onRemove(task.id);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={styles.actionBtnText}>🗑 Move to Trash</Text>
                </TouchableOpacity>
              )}
              {canManageCompletedFile && onDeletePermanently && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.deletePermanentlyBtn]}
                  onPress={() => {
                    onDeletePermanently(task.id);
                    setActionsVisible(false);
                  }}
                >
                  <Text style={[styles.actionBtnText, styles.deletePermanentlyText]}>🗑 Delete Permanently</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, styles.infoBtn]}
                onPress={() => {
                  setActionsVisible(false);
                  setInfoVisible(true);
                }}
              >
                <Text style={styles.actionBtnText}>ℹ Info</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={infoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoVisible(false)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setInfoVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.dialogCard}
            onPress={() => {}}
          >
            <Text style={styles.infoTitle}>File info</Text>
            <View style={styles.infoRows}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Name</Text>
                <Text style={styles.infoValue}>{task.fileName || "—"}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Status</Text>
                <Text style={styles.infoValue}>{task.status}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Size</Text>
                <Text style={styles.infoValue}>
                  {task.totalBytes > 0
                    ? formatBytes(task.totalBytes)
                    : task.bytesDownloaded > 0
                      ? formatBytes(task.bytesDownloaded)
                      : "—"}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Source</Text>
                <Text style={styles.infoValue}>{task.source ?? "private"}</Text>
              </View>
              {task.folderPath ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Folder</Text>
                  <Text style={styles.infoValue}>{task.folderPath}</Text>
                </View>
              ) : null}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Added</Text>
                <Text style={styles.infoValue}>
                  {new Date(task.createdAt).toLocaleString()}
                </Text>
              </View>
              {task.pageTitle ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Page</Text>
                  <Text style={styles.infoValue} numberOfLines={2}>
                    {task.pageTitle}
                  </Text>
                </View>
              ) : null}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>URL</Text>
                <Text style={styles.infoValue} numberOfLines={3}>
                  {task.url}
                </Text>
              </View>
              {task.filePath ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Path</Text>
                  <Text style={styles.infoValue} numberOfLines={3}>
                    {task.filePath}
                  </Text>
                </View>
              ) : null}
              {task.error ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Error</Text>
                  <Text style={[styles.infoValue, styles.infoError]}>
                    {task.error}
                  </Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </TouchableOpacity>
  );
});

export default DownloadItem;

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  thumbnailWrap: {
    width: "100%",
    height: 120,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#EFEFEF",
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
  },
  thumbnailFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8ECF1",
  },
  thumbnailIcon: {
    fontSize: 30,
  },
  progressContainer: {
    marginTop: 8,
  },
  progressBg: {
    height: 6,
    backgroundColor: "#E8E8E8",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 10,
    color: "#888",
    marginTop: 3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    color: "#FFF",
    fontSize: 9,
    fontWeight: "700",
  },
  pageTitle: {
    fontSize: 11,
    color: "#888",
    marginLeft: 8,
    flex: 1,
  },
  errorText: {
    color: "#E74C3C",
    fontSize: 10,
    marginLeft: 8,
    flex: 1,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  infoSection: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
  fileSize: {
    fontSize: 11,
    color: "#888",
    marginTop: 1,
  },
  fileFolder: {
    fontSize: 10,
    color: "#999",
    marginTop: 2,
  },
  menuBtn: {
    paddingRight: 4,
    width: 20,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#F2F2F2",
    alignItems: "center",
    justifyContent: "center",
  },
  menuBtnText: {
    fontSize: 18,
    lineHeight: 18,
    color: "#444",
    marginTop: -4,
    transform: [{ rotate: "90deg" }],
  },
  actions: {
    gap: 8,
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  dialogCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
  },
  actionBtn: {
    width: "100%",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#222",
  },
  pauseBtn: {
    backgroundColor: "#FFF3E0",
  },
  resumeBtn: {
    backgroundColor: "#E8F5E9",
  },
  cancelBtn: {
    backgroundColor: "#FFEBEE",
  },
  openBtn: {
    backgroundColor: "#E8F5E9",
  },
  moveBtn: {
    backgroundColor: "#EFE7FF",
  },
  renameBtn: {
    backgroundColor: "#E3F2FD",
  },
  removeBtn: {
    backgroundColor: "#F5F5F5",
  },
  deletePermanentlyBtn: {
    backgroundColor: "#FFEBEE",
  },
  deletePermanentlyText: {
    color: "#C62828",
  },
  selectionOverlay: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#2196F3",
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  selectionOverlayChecked: {
    backgroundColor: "#2196F3",
  },
  selectionCheck: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 16,
  },
  infoBtn: {
    backgroundColor: "#E8F4FD",
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#222",
    marginBottom: 12,
  },
  infoRows: {
    gap: 8,
  },
  infoRow: {
    flexDirection: "row",
    gap: 8,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#888",
    width: 56,
    paddingTop: 1,
  },
  infoValue: {
    fontSize: 12,
    color: "#222",
    flex: 1,
  },
  infoError: {
    color: "#C62828",
  },
  labelRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 5,
    height: 16
  },
  labelPill: {
    backgroundColor: "#E3F2FD",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  labelPillText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#1565C0",
  },
  labelBtn: {
    backgroundColor: "#FFF8E1",
  },
});
