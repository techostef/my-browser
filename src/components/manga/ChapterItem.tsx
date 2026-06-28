import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "../../i18n";
import { useSettings } from "../../store/settingsStore";
import { MangaChapter } from "../../types/manga";

interface Props {
  chapter: MangaChapter;
  onPress: () => void;
  onLongPress?: () => void;
  onDelete: () => void;
  onRedownload?: () => void;
  selected?: boolean;
  selectionMode?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ChapterItem({
  chapter,
  onPress,
  onLongPress,
  onDelete,
  onRedownload,
  selected,
  selectionMode,
}: Props) {
  const { themeColors: c } = useSettings();
  const { t } = useTranslation();

  const statusIcon = () => {
    if (selectionMode) {
      return (
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected && <Text style={styles.checkmark}>✓</Text>}
        </View>
      );
    }
    switch (chapter.status) {
      case "completed":
        return <Text style={styles.iconDone}>✓</Text>;
      case "downloading":
        return <ActivityIndicator size="small" color="#3b82f6" />;
      case "queued":
        return <Text style={styles.iconQueued}>⏳</Text>;
      case "failed":
        return <Text style={styles.iconFail}>✗</Text>;
      default:
        return (
          <Text style={[styles.iconPending, { color: c.textSecondary }]}>
            ○
          </Text>
        );
    }
  };

  const isReadable =
    chapter.status === "completed" || chapter.status === "failed";
  const canInteract = selectionMode || isReadable;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: selected ? c.border + "80" : c.surface,
          borderBottomColor: c.border,
        },
      ]}
    >
      <View style={styles.iconWrap}>{statusIcon()}</View>
      <TouchableOpacity
        style={styles.content}
        onPress={canInteract ? onPress : undefined}
        onLongPress={onLongPress}
        activeOpacity={0.7}
        delayLongPress={400}
      >
        <Text
          style={[
            styles.chapterTitle,
            { color: c.text },
            !isReadable && !selectionMode && { opacity: 0.5 },
          ]}
          numberOfLines={1}
        >
          {t("chapterLabel", { n: String(chapter.chapterNumber) })}
          {chapter.title && chapter.title !== `Chapter ${chapter.chapterNumber}`
            ? ` — ${chapter.title}`
            : ""}
        </Text>
        {chapter.status === "downloading" && (
          <>
            <Text style={[styles.meta, { color: c.textSecondary }]}>
              {chapter.imageCount > 0
                ? t("downloadingPages", {
                    downloaded: String(chapter.downloadedImages),
                    total: String(chapter.imageCount),
                  })
                : t("downloadingEllipsis")}
            </Text>
            <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
              <View
                style={[styles.progressFill, { flex: chapter.progress || 0 }]}
              />
              <View style={{ flex: 100 - (chapter.progress || 0) }} />
            </View>
          </>
        )}
        {chapter.status === "completed" && (
          <Text style={[styles.meta, { color: c.textSecondary }]}>
            {chapter.imageCount > 0
              ? t("chapterPages", { count: String(chapter.imageCount) })
              : ""}
            {chapter.sizeBytes ? `  ·  ${formatSize(chapter.sizeBytes)}` : ""}
            {chapter.downloadedAt
              ? `  ·  ${formatDate(chapter.downloadedAt)}`
              : ""}
          </Text>
        )}
        {chapter.status === "queued" && (
          <Text style={styles.queuedText}>{t("chapterQueued")}</Text>
        )}
        {chapter.status === "failed" && (
          <Text style={styles.failText}>{t("chapterFailed")}</Text>
        )}
      </TouchableOpacity>
      {!selectionMode && chapter.status === "completed" && (
        <View style={styles.actionsWrap}>
          {onRedownload && (
            <TouchableOpacity
              onPress={onRedownload}
              style={styles.redownloadBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.redownloadText}>↻</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={onDelete}
            style={styles.deleteBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.deleteText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: { width: 28, alignItems: "center" },
  iconDone: { fontSize: 16, color: "#34d399" },
  iconFail: { fontSize: 16, color: "#f87171" },
  iconQueued: { fontSize: 14 },
  iconPending: { fontSize: 16 },
  content: { flex: 1, gap: 4 },
  chapterTitle: { fontSize: 14 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    flexDirection: "row",
    overflow: "hidden",
  },
  progressFill: { height: 3, backgroundColor: "#3b82f6" },
  meta: { fontSize: 11 },
  queuedText: { fontSize: 11, color: "#3498db" },
  failText: { fontSize: 11, color: "#f87171" },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#94a3b8",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  checkmark: { fontSize: 12, color: "#fff", fontWeight: "700" },
  actionsWrap: { flexDirection: "row", alignItems: "center" },
  redownloadBtn: { paddingLeft: 12 },
  redownloadText: { fontSize: 16, color: "#3b82f6" },
  deleteBtn: { paddingLeft: 12 },
  deleteText: { fontSize: 14, color: "#94a3b8" },
});
