import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { MangaChapterInfo } from '../../types/manga';
import { useSettings } from '../../store/settingsStore';

interface Props {
  visible: boolean;
  loading: boolean;         // true while chapter list is being fetched
  error: string | null;     // non-null if chapter list fetch failed
  mangaTitle: string;
  chapters: MangaChapterInfo[];
  lastUpdated?: number;     // ms timestamp when chapter list was last fetched
  existingSizeBytes?: number; // total bytes already downloaded for this manga
  onConfirm: (selected: MangaChapterInfo[], title: string) => void;
  onCancel: () => void;
  onRetry: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function MangaDownloadModal({
  visible, loading, error, mangaTitle, chapters, lastUpdated, existingSizeBytes,
  onConfirm, onCancel, onRetry,
}: Props) {
  const { themeColors: c } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editedTitle, setEditedTitle] = useState(mangaTitle);

  useEffect(() => { setEditedTitle(mangaTitle); }, [mangaTitle]);

  // Pre-select all chapters when list loads
  useEffect(() => {
    if (chapters.length > 0) {
      setSelected(new Set(chapters.map(ch => ch.url)));
    }
  }, [chapters]);

  const toggle = (url: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(chapters.map(ch => ch.url)));
  const deselectAll = () => setSelected(new Set());

  const selectedChapters = chapters.filter(ch => selected.has(ch.url));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text style={[styles.headerTitle, { color: c.text }]}>Download Manga</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text style={[styles.cancelText, { color: c.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[styles.mangaTitle, { color: c.text, borderColor: c.border }]}
          value={editedTitle}
          onChangeText={setEditedTitle}
          placeholder="Manga title"
          placeholderTextColor={c.textSecondary}
        />

        {/* Loading */}
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text style={[styles.loadingText, { color: c.textSecondary }]}>Finding chapters…</Text>
          </View>
        )}

        {/* Error */}
        {!loading && error && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Chapter list */}
        0

        {!loading && !error && chapters.length === 0 && (
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: c.textSecondary }]}>No chapters found on this page.</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  cancelText: { fontSize: 15 },
  mangaTitle: {
    fontSize: 14, marginHorizontal: 16, marginVertical: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 8,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  loadingText: { fontSize: 14, marginTop: 8 },
  errorText: { fontSize: 14, color: '#f87171', textAlign: 'center' },
  retryBtn: { backgroundColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyText: { fontSize: 14, textAlign: 'center' },
  selectBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectBarLeft: { flex: 1, gap: 2 },
  countText: { fontSize: 13 },
  metaText: { fontSize: 11 },
  selectAllText: { fontSize: 13, color: '#3b82f6', fontWeight: '600' },
  list: { flex: 1 },
  chapterRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  chapterText: { flex: 1, fontSize: 14 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  downloadBtn: {
    backgroundColor: '#3b82f6', borderRadius: 10, paddingVertical: 14, alignItems: 'center',
  },
  downloadBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
