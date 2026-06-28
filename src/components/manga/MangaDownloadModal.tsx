import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "../../i18n";
import { useSettings } from "../../store/settingsStore";
import { MangaChapterInfo } from "../../types/manga";

interface Props {
  visible: boolean;
  loading: boolean;
  error: string | null;
  mangaTitle: string;
  chapters: MangaChapterInfo[];
  onConfirm: (selected: MangaChapterInfo[], title: string) => void;
  onCancel: () => void;
  onRetry: () => void;
}

/** Parse range string like "1-50, 55, 60-100" into a Set of chapter numbers */
function parseRange(input: string, allNumbers: string[]): Set<string> {
  const result = new Set<string>();
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const rangeParts = part.split("-").map((s) => s.trim());
    if (rangeParts.length === 2) {
      const start = parseFloat(rangeParts[0]);
      const end = parseFloat(rangeParts[1]);
      if (!isNaN(start) && !isNaN(end)) {
        for (const num of allNumbers) {
          const n = parseFloat(num);
          if (n >= Math.min(start, end) && n <= Math.max(start, end)) {
            result.add(num);
          }
        }
      }
    } else {
      const n = rangeParts[0];
      if (allNumbers.includes(n)) result.add(n);
    }
  }
  return result;
}

export default function MangaDownloadModal({
  visible,
  loading,
  error,
  mangaTitle,
  chapters,
  onConfirm,
  onCancel,
  onRetry,
}: Props) {
  const { themeColors: c } = useSettings();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editedTitle, setEditedTitle] = useState(mangaTitle);
  const [rangeText, setRangeText] = useState("");

  useEffect(() => {
    setEditedTitle(mangaTitle);
  }, [mangaTitle]);

  const allChapterNumbers = useMemo(
    () => chapters.map((ch) => ch.chapterNumber),
    [chapters],
  );

  // Pre-select all chapters when list loads
  useEffect(() => {
    if (chapters.length > 0) {
      setSelected(new Set(chapters.map((ch) => ch.url)));
      setRangeText("");
    }
  }, [chapters]);

  const toggle = useCallback((url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }, []);

  const selectAll = () => {
    setSelected(new Set(chapters.map((ch) => ch.url)));
    setRangeText("");
  };
  const deselectAll = () => {
    setSelected(new Set());
    setRangeText("");
  };

  const applyRange = () => {
    if (!rangeText.trim()) return;
    const nums = parseRange(rangeText, allChapterNumbers);
    const urls = new Set(
      chapters.filter((ch) => nums.has(ch.chapterNumber)).map((ch) => ch.url),
    );
    setSelected(urls);
  };

  const selectedChapters = useMemo(
    () => chapters.filter((ch) => selected.has(ch.url)),
    [chapters, selected],
  );

  const renderChapter = useCallback(
    ({ item }: { item: MangaChapterInfo }) => {
      const isSelected = selected.has(item.url);
      return (
        <TouchableOpacity
          style={[styles.chapterRow, { borderBottomColor: c.border }]}
          onPress={() => toggle(item.url)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.checkbox,
              { borderColor: c.border },
              isSelected && styles.checkboxSelected,
            ]}
          >
            {isSelected && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text
            style={[styles.chapterText, { color: c.text }]}
            numberOfLines={1}
          >
            Ch. {item.chapterNumber}
            {item.title ? ` — ${item.title}` : ""}
          </Text>
        </TouchableOpacity>
      );
    },
    [selected, c, toggle],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <SafeAreaView
        style={[styles.container, { backgroundColor: c.background }]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text style={[styles.headerTitle, { color: c.text }]}>
            {t("downloadManga")}
          </Text>
          <TouchableOpacity onPress={onCancel}>
            <Text style={[styles.cancelText, { color: c.textSecondary }]}>
              {t("cancel")}
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[styles.mangaTitle, { color: c.text, borderColor: c.border }]}
          value={editedTitle}
          onChangeText={setEditedTitle}
          placeholder={t("mangaTitlePlaceholder")}
          placeholderTextColor={c.textSecondary}
        />

        {/* Loading */}
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text style={[styles.loadingText, { color: c.textSecondary }]}>
              {t("findingChapters")}
            </Text>
          </View>
        )}

        {/* Error */}
        {!loading && error && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
              <Text style={styles.retryText}>{t("retry")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Chapter list */}
        {!loading && !error && chapters.length > 0 && (
          <>
            {/* Range input */}
            <View style={[styles.rangeBar, { borderBottomColor: c.border }]}>
              <TextInput
                style={[
                  styles.rangeInput,
                  { color: c.text, borderColor: c.border },
                ]}
                value={rangeText}
                onChangeText={setRangeText}
                placeholder="e.g. 1-50, 55, 60-100"
                placeholderTextColor={c.textSecondary}
                keyboardType="default"
                returnKeyType="done"
                onSubmitEditing={applyRange}
              />
              <TouchableOpacity style={styles.applyBtn} onPress={applyRange}>
                <Text style={styles.applyBtnText}>{t("apply")}</Text>
              </TouchableOpacity>
            </View>

            {/* Select bar */}
            <View style={[styles.selectBar, { borderBottomColor: c.border }]}>
              <View style={styles.selectBarLeft}>
                <Text style={[styles.countText, { color: c.text }]}>
                  {t("chaptersSelected", {
                    selected: String(selectedChapters.length),
                    total: String(chapters.length),
                  })}
                </Text>
              </View>
              <TouchableOpacity
                onPress={
                  selected.size === chapters.length ? deselectAll : selectAll
                }
              >
                <Text style={styles.selectAllText}>
                  {selected.size === chapters.length
                    ? t("deselectAll")
                    : t("selectAll")}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Chapter list (FlatList for performance) */}
            <FlatList
              data={chapters}
              keyExtractor={(item) => item.url}
              renderItem={renderChapter}
              extraData={selected}
              style={styles.list}
              initialNumToRender={30}
              maxToRenderPerBatch={20}
              windowSize={10}
            />

            {/* Footer */}
            <View style={[styles.footer, { borderTopColor: c.border }]}>
              <TouchableOpacity
                style={[
                  styles.downloadBtn,
                  selectedChapters.length === 0 && { opacity: 0.4 },
                ]}
                onPress={() =>
                  selectedChapters.length > 0 &&
                  onConfirm(selectedChapters, editedTitle.trim() || mangaTitle)
                }
                disabled={selectedChapters.length === 0}
              >
                <Text style={styles.downloadBtnText}>
                  {t("downloadChapters", {
                    count: String(selectedChapters.length),
                    s: selectedChapters.length !== 1 ? "s" : "",
                  })}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {!loading && !error && chapters.length === 0 && (
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: c.textSecondary }]}>
              {t("noChaptersFound")}
            </Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  cancelText: { fontSize: 15 },
  mangaTitle: {
    fontSize: 14,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  loadingText: { fontSize: 14, marginTop: 8 },
  errorText: { fontSize: 14, color: "#f87171", textAlign: "center" },
  retryBtn: {
    backgroundColor: "#3b82f6",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: { color: "#fff", fontWeight: "600" },
  emptyText: { fontSize: 14, textAlign: "center" },
  rangeBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rangeInput: {
    flex: 1,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
  },
  applyBtn: {
    backgroundColor: "#3b82f6",
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  applyBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  selectBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectBarLeft: { flex: 1, gap: 2 },
  countText: { fontSize: 13 },
  selectAllText: { fontSize: 13, color: "#3b82f6", fontWeight: "600" },
  list: { flex: 1 },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: { backgroundColor: "#3b82f6", borderColor: "#3b82f6" },
  checkmark: { color: "#fff", fontSize: 12, fontWeight: "700" },
  chapterText: { flex: 1, fontSize: 14 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  downloadBtn: {
    backgroundColor: "#3b82f6",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  downloadBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
