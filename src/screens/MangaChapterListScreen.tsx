import React, { useCallback, useMemo, useState } from 'react';
import { withErrorBoundary } from '../components/ErrorBoundary';
import {
  View, Text, FlatList, Alert, TouchableOpacity, StyleSheet, DeviceEventEmitter,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useManga } from '../store/mangaStore';
import ChapterItem from '../components/manga/ChapterItem';
import { useSettings } from '../store/settingsStore';
import { RootStackParamList } from '../types/videoEditor';

type Route = RouteProp<RootStackParamList, 'MangaChapters'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

function MangaChapterListScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { getTitle, removeTitle, updateTitle, removeChapter } = useManga();
  const { themeColors: c } = useSettings();

  const manga = getTitle(route.params.mangaId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;

  const lastReadChapter = useMemo(() => {
    if (!manga) return null;
    const readable = manga.chapters.filter(ch => ch.status === 'completed' && ch.lastReadAt);
    if (!readable.length) return null;
    return readable.reduce((a, b) => ((a.lastReadAt ?? 0) > (b.lastReadAt ?? 0) ? a : b));
  }, [manga]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectAll = useCallback(() => {
    if (!manga) return;
    setSelectedIds(new Set(manga.chapters.map(ch => ch.id)));
  }, [manga]);

  const handleDeleteChapter = useCallback((chapterId: string, chapterTitle: string) => {
    if (!manga) return;
    Alert.alert(`Delete "${chapterTitle}"?`, 'This will delete the downloaded images.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeChapter(manga.id, chapterId) },
    ]);
  }, [manga, removeChapter]);

  const handleRedownloadChapter = useCallback((chapterId: string, chapterNumber: string) => {
    if (!manga) return;
    const chapter = manga.chapters.find(ch => ch.id === chapterId);
    if (!chapter) return;
    Alert.alert('Redownload chapter?', `Re-download Ch. ${chapterNumber}? Existing files will be replaced.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Redownload', onPress: () => {
        DeviceEventEmitter.emit('MANGA_REDOWNLOAD_CHAPTER', {
          mangaId: manga.id, chapterId, chapterUrl: chapter.url,
        });
      }},
    ]);
  }, [manga]);

  if (!manga) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <Text style={{ color: c.text, padding: 16 }}>Manga not found.</Text>
      </SafeAreaView>
    );
  }

  const handleDeleteManga = () => {
    Alert.alert(`Delete "${manga.title}"?`, 'This will delete all downloaded chapters.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await removeTitle(manga.id);
        navigation.goBack();
      }},
    ]);
  };

  const failedChapters = manga.chapters.filter(ch => ch.status === 'failed');
  const queuedChapters = manga.chapters.filter(ch => ch.status === 'queued');

  const handleRetryAllFailed = () => {
    if (failedChapters.length === 0) return;
    Alert.alert(
      `Retry ${failedChapters.length} failed chapter(s)?`,
      'They will be queued and downloaded one by one.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry All', onPress: () => {
          failedChapters.forEach(ch => {
            DeviceEventEmitter.emit('MANGA_RETRY_CHAPTER', {
              mangaId: manga.id, chapterId: ch.id, chapterUrl: ch.url,
            });
          });
        }},
      ],
    );
  };

  const handleMenuPress = () => {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (failedChapters.length > 0) {
      options.push({ text: `Retry All Failed (${failedChapters.length})`, onPress: handleRetryAllFailed });
    }
    options.push({ text: 'Delete All Chapters', style: 'destructive', onPress: handleDeleteManga });
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(manga.title, undefined, options);
  };

  const handleChapterPress = (chapterId: string) => {
    if (selectionMode) {
      toggleSelect(chapterId);
      return;
    }
    const chapter = manga.chapters.find(ch => ch.id === chapterId);
    if (chapter?.status === 'completed') {
      navigation.navigate('MangaReader', { mangaId: manga.id, chapterId });
    } else if (chapter?.status === 'failed') {
      Alert.alert('Retry download?', `Re-download Ch. ${chapter.chapterNumber}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', onPress: () => {
          DeviceEventEmitter.emit('MANGA_RETRY_CHAPTER', { mangaId: manga.id, chapterId, chapterUrl: chapter.url });
        }},
      ]);
    }
  };

  const handleLongPress = (chapterId: string) => {
    if (!selectionMode) {
      setSelectedIds(new Set([chapterId]));
    }
  };

  const handleBulkRetry = () => {
    const failedSelected = manga.chapters.filter(
      ch => selectedIds.has(ch.id) && ch.status === 'failed',
    );
    if (failedSelected.length === 0) {
      Alert.alert('No failed chapters', 'Only failed chapters can be retried.');
      return;
    }
    Alert.alert(
      `Retry ${failedSelected.length} chapter(s)?`,
      'This will re-download the selected failed chapters.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', onPress: () => {
          failedSelected.forEach(ch => {
            DeviceEventEmitter.emit('MANGA_RETRY_CHAPTER', {
              mangaId: manga.id, chapterId: ch.id, chapterUrl: ch.url,
            });
          });
          clearSelection();
        }},
      ],
    );
  };

  const handleBulkRedownload = () => {
    const completedSelected = manga.chapters.filter(
      ch => selectedIds.has(ch.id) && ch.status === 'completed',
    );
    if (completedSelected.length === 0) {
      Alert.alert('No completed chapters', 'Only completed chapters can be redownloaded.');
      return;
    }
    Alert.alert(
      `Redownload ${completedSelected.length} chapter(s)?`,
      'Existing files will be deleted and chapters re-downloaded.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Redownload', onPress: () => {
          completedSelected.forEach(ch => {
            DeviceEventEmitter.emit('MANGA_REDOWNLOAD_CHAPTER', {
              mangaId: manga.id, chapterId: ch.id, chapterUrl: ch.url,
            });
          });
          clearSelection();
        }},
      ],
    );
  };

  const handleBulkDelete = () => {
    const deletable = manga.chapters.filter(
      ch => selectedIds.has(ch.id) && (ch.status === 'completed' || ch.status === 'failed'),
    );
    if (deletable.length === 0) {
      Alert.alert('Nothing to delete', 'Only completed or failed chapters can be deleted.');
      return;
    }
    Alert.alert(
      `Delete ${deletable.length} chapter(s)?`,
      'This will delete the selected chapters and their images.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          deletable.forEach(ch => removeChapter(manga.id, ch.id));
          clearSelection();
        }},
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        {selectionMode ? (
          <>
            <TouchableOpacity onPress={clearSelection} style={styles.backBtn}>
              <Text style={[styles.backText, { color: '#3b82f6' }]}>✕</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: c.text }]}>
              {selectedIds.size} selected
            </Text>
            <TouchableOpacity onPress={selectAll} style={styles.menuBtn}>
              <Text style={[styles.selectAllText, { color: '#3b82f6' }]}>All</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={[styles.backText, { color: '#3b82f6' }]}>← Back</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>{manga.title}</Text>
            <TouchableOpacity onPress={handleMenuPress} style={styles.menuBtn}>
              <Text style={[styles.menuText, { color: c.text }]}>⋮</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {!selectionMode && (failedChapters.length > 0 || queuedChapters.length > 0) && (
        <View style={[styles.retryAllBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          {queuedChapters.length > 0 && (
            <Text style={[styles.queueInfo, { color: c.textSecondary }]}>
              ⏳ {queuedChapters.length} chapter(s) in queue
            </Text>
          )}
          {failedChapters.length > 0 && (
            <TouchableOpacity style={styles.retryAllBtn} onPress={handleRetryAllFailed}>
              <Text style={styles.retryAllBtnText}>↻ Retry All Failed ({failedChapters.length})</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {manga.chapters.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>No chapters downloaded yet.</Text>
        </View>
      ) : (
        <FlatList
          data={manga.chapters}
          keyExtractor={item => item.id}
          extraData={selectedIds}
          contentContainerStyle={!selectionMode && lastReadChapter ? { paddingBottom: 70 } : undefined}
          renderItem={({ item }) => (
            <ChapterItem
              chapter={item}
              onPress={() => handleChapterPress(item.id)}
              onLongPress={() => handleLongPress(item.id)}
              onDelete={() => handleDeleteChapter(item.id, `Ch. ${item.chapterNumber}`)}
              onRedownload={() => handleRedownloadChapter(item.id, item.chapterNumber)}
              selected={selectedIds.has(item.id)}
              selectionMode={selectionMode}
            />
          )}
        />
      )}

      {selectionMode && (
        <View style={[styles.actionBar, { backgroundColor: c.surface, borderTopColor: c.border }]}>
          <TouchableOpacity style={[styles.actionBtn, styles.redownloadActionBtn]} onPress={handleBulkRedownload}>
            <Text style={styles.redownloadBtnText}>↻ Redownload</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.retryBtn]} onPress={handleBulkRetry}>
            <Text style={styles.retryBtnText}>↻ Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.deleteActionBtn]} onPress={handleBulkDelete}>
            <Text style={styles.deleteBtnText}>🗑 Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      {!selectionMode && lastReadChapter && (
        <TouchableOpacity
          style={[styles.continueBar, { backgroundColor: c.surface, borderTopColor: c.border }]}
          onPress={() => navigation.navigate('MangaReader', { mangaId: manga.id, chapterId: lastReadChapter.id })}
          activeOpacity={0.7}
        >
          <View style={styles.continueInfo}>
            <Text style={[styles.continueLabel, { color: c.textSecondary }]}>Continue Reading</Text>
            <Text style={[styles.continueChapter, { color: c.text }]} numberOfLines={1}>
              Ch. {lastReadChapter.chapterNumber}
              {lastReadChapter.title && lastReadChapter.title !== `Chapter ${lastReadChapter.chapterNumber}`
                ? ` — ${lastReadChapter.title}` : ''}
            </Text>
            <Text style={[styles.continueMeta, { color: c.textSecondary }]}>
              Page {lastReadChapter.readProgress + 1}
              {lastReadChapter.imageCount > 0 ? ` of ${lastReadChapter.imageCount}` : ''}
              {lastReadChapter.lastReadAt
                ? `  ·  ${new Date(lastReadChapter.lastReadAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
            </Text>
          </View>
          <Text style={[styles.continueArrow, { color: '#3b82f6' }]}>▶</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { paddingRight: 8 },
  backText: { fontSize: 15 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  menuBtn: { paddingLeft: 8 },
  menuText: { fontSize: 20 },
  selectAllText: { fontSize: 14, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14 },
  actionBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  actionBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  redownloadActionBtn: { backgroundColor: '#f59e0b' },
  redownloadBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  retryBtn: { backgroundColor: '#3b82f6' },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  deleteActionBtn: { backgroundColor: '#ef4444' },
  deleteBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  retryAllBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 8,
  },
  queueInfo: { fontSize: 12, flex: 1 },
  retryAllBtn: {
    backgroundColor: '#3b82f6', borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  retryAllBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  continueBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  continueInfo: { flex: 1, gap: 1 },
  continueLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  continueChapter: { fontSize: 14, fontWeight: '600' },
  continueMeta: { fontSize: 11 },
  continueArrow: { fontSize: 16, paddingLeft: 8 },
});

export default withErrorBoundary(MangaChapterListScreen);
