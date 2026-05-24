import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withErrorBoundary } from '../components/ErrorBoundary';
import {
  View, Text, FlatList, Image as RNImage, TouchableOpacity,
  Dimensions, StyleSheet, StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as FileSystem from 'expo-file-system/legacy';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated';
import { useManga } from '../store/mangaStore';
import { RootStackParamList } from '../types/videoEditor';

type Route = RouteProp<RootStackParamList, 'MangaReader'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function MangaPage({ uri, onPress }: { uri: string; onPress: () => void }) {
  const [height, setHeight] = useState(SCREEN_WIDTH * 1.5);

  useEffect(() => {
    RNImage.getSize(
      uri,
      (w: number, h: number) => { if (w > 0) setHeight((h / w) * SCREEN_WIDTH); },
      () => { setHeight(SCREEN_WIDTH * 1.5); },
    );
  }, [uri]);

  return (
    <TouchableOpacity activeOpacity={1} onPress={onPress}>
      <Image
        source={{ uri }}
        style={{ width: SCREEN_WIDTH, height }}
        contentFit="contain"
      />
    </TouchableOpacity>
  );
}

function MangaReaderScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { getTitle, updateChapter } = useManga();

  const { mangaId, chapterId } = route.params;
  const manga = getTitle(mangaId);
  const chapter = manga?.chapters.find(c => c.id === chapterId);

  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const flatListRef = useRef<FlatList>(null);
  const saveProgressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Zoom & pan shared values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  const clampTranslate = (tx: number, ty: number, s: number) => {
    'worklet';
    const maxX = ((s - 1) * SCREEN_WIDTH) / 2;
    const maxY = ((s - 1) * SCREEN_HEIGHT) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, tx)),
      y: Math.min(maxY, Math.max(-maxY, ty)),
    };
  };

  const enableScroll = (enabled: boolean) => { setScrollEnabled(enabled); };

  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      focalX.value = e.focalX;
      focalY.value = e.focalY;
    })
    .onUpdate((e) => {
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, savedScale.value * e.scale));
      scale.value = newScale;

      if (newScale > 1) {
        const dx = (focalX.value - SCREEN_WIDTH / 2) * (1 - e.scale);
        const dy = (focalY.value - SCREEN_HEIGHT / 2) * (1 - e.scale);
        const clamped = clampTranslate(savedTranslateX.value + dx, savedTranslateY.value + dy, newScale);
        translateX.value = clamped.x;
        translateY.value = clamped.y;
      }
      runOnJS(enableScroll)(newScale <= 1);
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(enableScroll)(true);
      } else {
        savedScale.value = scale.value;
        const clamped = clampTranslate(translateX.value, translateY.value, scale.value);
        translateX.value = clamped.x;
        translateY.value = clamped.y;
        savedTranslateX.value = clamped.x;
        savedTranslateY.value = clamped.y;
      }
    });

  const panGesture = Gesture.Pan()
    .minPointers(2)
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      const clamped = clampTranslate(
        savedTranslateX.value + e.translationX,
        savedTranslateY.value + e.translationY,
        scale.value,
      );
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        // Zoom out
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(enableScroll)(true);
      } else {
        // Zoom in to 2.5x at tap point
        const targetScale = 2.5;
        const tx = (SCREEN_WIDTH / 2 - e.x) * (targetScale - 1);
        const ty = (SCREEN_HEIGHT / 2 - e.y) * (targetScale - 1);
        const clamped = clampTranslate(tx, ty, targetScale);
        scale.value = withTiming(targetScale);
        translateX.value = withTiming(clamped.x);
        translateY.value = withTiming(clamped.y);
        savedScale.value = targetScale;
        savedTranslateX.value = clamped.x;
        savedTranslateY.value = clamped.y;
        runOnJS(enableScroll)(false);
      }
    });

  const composed = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture),
    [],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Load pages from folder
  useEffect(() => {
    if (!chapter?.folderPath) return;
    FileSystem.readDirectoryAsync(chapter.folderPath).then(files => {
      const sorted = files
        .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
        .sort();
      setPages(sorted.map(f => `${chapter.folderPath}${f}`));
    }).catch(() => setPages([]));
  }, [chapter?.folderPath]);

  // Scroll to last read position
  useEffect(() => {
    if (pages.length > 0 && chapter && chapter.readProgress > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: Math.min(chapter.readProgress, pages.length - 1), animated: false });
      }, 100);
    }
  }, [pages.length]);

  const handleViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const idx = viewableItems[viewableItems.length - 1].index ?? 0;
      setCurrentPage(idx);
      // Debounce saving read progress
      if (saveProgressTimer.current) clearTimeout(saveProgressTimer.current);
      saveProgressTimer.current = setTimeout(() => {
        updateChapter(mangaId, chapterId, { readProgress: idx, lastReadAt: Date.now() });
      }, 1000);
    }
  }, [mangaId, chapterId, updateChapter]);

  // Adjacent chapter navigation
  const chapterIndex = manga?.chapters.findIndex(c => c.id === chapterId) ?? -1;
  const prevChapter = chapterIndex > 0 ? manga?.chapters[chapterIndex - 1] : undefined;
  const nextChapter = manga && chapterIndex >= 0 && chapterIndex < manga.chapters.length - 1
    ? manga.chapters[chapterIndex + 1] : undefined;

  const goToChapter = (targetChapterId: string) => {
    navigation.replace('MangaReader', { mangaId, chapterId: targetChapterId });
  };

  if (!chapter) return null;

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Header (auto-hide on scroll) */}
      {headerVisible && (
        <SafeAreaView style={styles.header} edges={['top']}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Ch. {chapter.chapterNumber}
          </Text>
          <Text style={styles.pageCounter}>{currentPage + 1} / {pages.length}</Text>
        </SafeAreaView>
      )}

      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.zoomContainer, animatedStyle]}>
          <FlatList
            ref={flatListRef}
            data={pages}
            keyExtractor={item => item}
            scrollEnabled={scrollEnabled}
            renderItem={({ item }) => (
              <MangaPage uri={item} onPress={() => setHeaderVisible(v => !v)} />
            )}
            onViewableItemsChanged={handleViewableItemsChanged}
            viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
              }, 300);
            }}
            ListFooterComponent={() => (
              <View style={styles.footer}>
                {prevChapter?.status === 'completed' && (
                  <TouchableOpacity style={styles.navBtn} onPress={() => goToChapter(prevChapter.id)}>
                    <Text style={styles.navBtnText}>← Ch. {prevChapter.chapterNumber}</Text>
                  </TouchableOpacity>
                )}
                {nextChapter?.status === 'completed' && (
                  <TouchableOpacity style={styles.navBtn} onPress={() => goToChapter(nextChapter.id)}>
                    <Text style={styles.navBtnText}>Ch. {nextChapter.chapterNumber} →</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  zoomContainer: { flex: 1 },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  backBtn: { paddingRight: 10 },
  backText: { color: '#60a5fa', fontSize: 15 },
  headerTitle: { flex: 1, color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  pageCounter: { color: '#94a3b8', fontSize: 13 },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between',
    padding: 16, gap: 10,
  },
  navBtn: {
    flex: 1, backgroundColor: '#1e293b', borderRadius: 8,
    paddingVertical: 12, alignItems: 'center',
  },
  navBtnText: { color: '#60a5fa', fontSize: 14, fontWeight: '600' },
});

export default withErrorBoundary(MangaReaderScreen);
