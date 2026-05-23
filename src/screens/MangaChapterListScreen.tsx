import React, { useCallback } from 'react';
import {
  View, Text, FlatList, Alert, TouchableOpacity, StyleSheet, SafeAreaView, DeviceEventEmitter,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useManga } from '../store/mangaStore';
import ChapterItem from '../components/manga/ChapterItem';
import { useSettings } from '../store/settingsStore';
import { RootStackParamList } from '../types/videoEditor';

type Route = RouteProp<RootStackParamList, 'MangaChapters'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function MangaChapterListScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { getTitle, removeTitle, updateTitle, removeChapter } = useManga();
  const { themeColors: c } = useSettings();

  const manga = getTitle(route.params.mangaId);

  const handleDeleteChapter = useCallback((chapterId: string, chapterTitle: string) => {
    if (!manga) return;
    Alert.alert(`Delete "${chapterTitle}"?`, 'This will delete the downloaded images.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeChapter(manga.id, chapterId) },
    ]);
  }, [manga, removeChapter]);

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

  const handleMenuPress = () => {
    Alert.alert(manga.title, undefined, [
      { text: 'Delete All Chapters', style: 'destructive', onPress: handleDeleteManga },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleChapterPress = (chapterId: string) => {
    const chapter = manga.chapters.find(ch => ch.id === chapterId);
    if (chapter?.status === 'completed') {
      navigation.navigate('MangaReader', { mangaId: manga.id, chapterId });
    } else if (chapter?.status === 'failed') {
      Alert.alert('Retry download?', `Re-download Ch. ${chapter.chapterNumber}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', onPress: () => {
          DeviceEventEmitter.emit('MANGA_RETRY_CHAPTER', { mangaId: manga.id, chapterId, chapterUrl: chapter.url });
          navigation.goBack();
        }},
      ]);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: '#3b82f6' }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>{manga.title}</Text>
        <TouchableOpacity onPress={handleMenuPress} style={styles.menuBtn}>
          <Text style={[styles.menuText, { color: c.text }]}>⋮</Text>
        </TouchableOpacity>
      </View>

      {manga.chapters.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>No chapters downloaded yet.</Text>
        </View>
      ) : (
        <FlatList
          data={manga.chapters}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <ChapterItem
              chapter={item}
              onPress={() => handleChapterPress(item.id)}
              onDelete={() => handleDeleteChapter(item.id, `Ch. ${item.chapterNumber}`)}
            />
          )}
        />
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14 },
});
