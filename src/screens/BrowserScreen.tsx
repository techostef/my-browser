import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, StatusBar, Alert, ActivityIndicator } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';

import AddressBar from '../components/AddressBar';
import TabBar from '../components/TabBar';
import VideoDetectedBanner from '../components/VideoDetectedBanner';
import VideoPreviewModal from '../components/VideoPreviewModal';
import { useDownloads } from '../store/downloadStore';
import { useTabs } from '../store/tabStore';
import { DetectedVideo } from '../types';
import Browser from '@/components/Browser';

export default function BrowserScreen() {
  const { tabs, activeTabId, activeTab, isReady, addTab, removeTab, setActiveTab, updateTab } = useTabs();

  // Per-tab WebView refs
  const webViewRefs = useRef<Record<string, WebView | null>>({});
  const isMounted = useRef(false);

  // Per-tab navigation state
  const canGoBackMap = useRef<Record<string, boolean>>({});
  const canGoForwardMap = useRef<Record<string, boolean>>({});

  // Per-tab video detection state
  const [detectedVideosMap, setDetectedVideosMap] = useState<Record<string, DetectedVideo[]>>({});
  const [bannerDismissedMap, setBannerDismissedMap] = useState<Record<string, boolean>>({});

  const { startDownload, createBlobTask, updateBlobProgress, completeBlobDownload } = useDownloads();

  // Keyed by blobUrl so multiple blob downloads from different tabs can run simultaneously.
  const blobChunksMap = useRef<Map<string, string[]>>(new Map());
  const activeBlobMap = useRef<Map<string, { downloadId: string; pageTitle: string; totalSize: number }>>(new Map());

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const activeDetectedVideos = detectedVideosMap[activeTabId] || [];
  const activeBannerDismissed = bannerDismissedMap[activeTabId] || false;

  // Video preview modal state
  const [previewVideo, setPreviewVideo] = useState<DetectedVideo | null>(null);

  const handleNavigate = useCallback((url: string) => {
    updateTab(activeTabId, { url, lastVisitedUrl: url });
    setDetectedVideosMap(prev => ({ ...prev, [activeTabId]: [] }));
    setBannerDismissedMap(prev => ({ ...prev, [activeTabId]: false }));
  }, [activeTabId, updateTab]);

  const handleNavigationStateChange = useCallback((tabId: string) => (navState: WebViewNavigation) => {
    canGoBackMap.current[tabId] = navState.canGoBack;
    canGoForwardMap.current[tabId] = navState.canGoForward;
    if (navState.url) {
      updateTab(tabId, { url: navState.url, lastVisitedUrl: navState.url, title: navState.title || undefined });
    }
  }, [updateTab]);

  const handleMessage = useCallback((tabId: string) => (event: { nativeEvent: { data: string } }) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      switch (message.type) {
        case 'VIDEO_DETECTED': {
          const newVideos: DetectedVideo[] = message.payload;
          setDetectedVideosMap(prev => {
            const existing = prev[tabId] || [];
            // Dedup on (url + type). Also upgrade an existing 'blob' entry to
            // 'blob-ready' when MSE finishes buffering for the same URL — without
            // this, the upgrade is dropped and the banner shows the URL as
            // non-downloadable.
            const existingKeys = new Set(existing.map(v => v.url + ':' + v.type));
            const incoming = newVideos.filter(v => !existingKeys.has(v.url + ':' + v.type));
            if (incoming.length === 0) {
              return prev;
            }
            const upgradedUrls = new Set(
              incoming.filter(v => v.type === 'blob-ready').map(v => v.url),
            );
            const filtered = existing.filter(
              v => !(v.type === 'blob' && upgradedUrls.has(v.url)),
            );
            console.log(`[BrowserScreen] Adding ${incoming.length} video(s) to tab ${tabId} (upgraded: ${upgradedUrls.size})`);
            return { ...prev, [tabId]: [...filtered, ...incoming] };
          });
          setBannerDismissedMap(prev => ({ ...prev, [tabId]: false }));
          break;
        }
        case 'DETECTOR_LOG':
          console.log(`[VideoDetector][tab:${tabId}] ${message.payload}`);
          break;
        case 'PAGE_INFO':
          console.log(`[BrowserScreen] PAGE_INFO: ${message.payload?.title}`);
          break;
        case 'BLOB_BUFFERING': {
          const { blobUrl, bytesBuffered } = message.payload;
          const info = activeBlobMap.current.get(blobUrl);
          if (info) {
            updateBlobProgress(info.downloadId, bytesBuffered, info.totalSize);
          }
          break;
        }
        case 'BLOB_DATA_START': {
          const { blobUrl, totalSize } = message.payload;
          console.log(`[BrowserScreen] BLOB_DATA_START: url=${blobUrl} size=${totalSize}`);
          blobChunksMap.current.set(blobUrl, []);
          const info = activeBlobMap.current.get(blobUrl);
          if (info) {
            info.totalSize = totalSize; // now we know the actual remuxed blob size
            updateBlobProgress(info.downloadId, 0, totalSize);
          }
          break;
        }
        case 'BLOB_DATA_CHUNK': {
          const { blobUrl, index, data } = message.payload;
          const chunks = blobChunksMap.current.get(blobUrl);
          if (chunks) {
            chunks.push(data);
            const info = activeBlobMap.current.get(blobUrl);
            if (info) {
              const CHUNK_BYTES = 768 * 1024;
              updateBlobProgress(info.downloadId, (index + 1) * CHUNK_BYTES, info.totalSize);
            }
          }
          break;
        }
        case 'BLOB_DATA_END': {
          const { blobUrl, totalChunks } = message.payload;
          console.log(`[BrowserScreen] BLOB_DATA_END: ${totalChunks} chunks for ${blobUrl}`);
          const chunks = blobChunksMap.current.get(blobUrl) || [];
          const info = activeBlobMap.current.get(blobUrl);
          blobChunksMap.current.delete(blobUrl);
          activeBlobMap.current.delete(blobUrl);
          if (info && chunks.length > 0) {
            completeBlobDownload(info.downloadId, info.pageTitle, chunks.join(''));
          }
          break;
        }
        case 'BLOB_DATA_ERROR': {
          const { blobUrl } = message.payload;
          console.error(`[BrowserScreen] BLOB_DATA_ERROR:`, message.payload);
          blobChunksMap.current.delete(blobUrl);
          activeBlobMap.current.delete(blobUrl);
          Alert.alert('Download Error', message.payload?.error || 'Failed to extract blob video data.');
          break;
        }
      }
    } catch (err) {
      // Ignore non-JSON messages from websites
    }
  }, [updateBlobProgress, completeBlobDownload]);

  const handleDownload = useCallback(
    (video: DetectedVideo) => {
      if (video.type === 'blob') {
        Alert.alert(
          'Blob URL',
          'This video uses a blob URL and cannot be downloaded directly. It may be DRM-protected or streamed.',
        );
        return;
      }
      if (video.type === 'blob-ready') {
        const webView = webViewRefs.current[activeTabId];
        if (!webView) {
          Alert.alert('Error', 'WebView not available for blob extraction.');
          return;
        }
        const downloadId = `blob_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const totalSize = video.blobSize || 0;
        // Add task to Downloads tab immediately — user can navigate away while buffering.
        createBlobTask(downloadId, video.pageTitle, totalSize);
        activeBlobMap.current.set(video.url, {
          downloadId,
          pageTitle: video.pageTitle,
          totalSize,
        });
        const escUrl = video.url.replace(/'/g, "\\'");
        webView.injectJavaScript(
          `window.__extractBlobVideo && window.__extractBlobVideo('${escUrl}', { waitForReady: true }); true;`,
        );
        Alert.alert('Download queued', 'Video is buffering. Track progress in the Downloads tab.');
        return;
      }
      if (video.type === 'hls') {
        Alert.alert(
          'HLS Stream',
          'This is an HLS (.m3u8) stream. Direct download is not supported. An FFmpeg-based solution would be needed.',
        );
        return;
      }
      startDownload(video);
      Alert.alert('Download Started', 'Check the Downloads tab for progress.');
    },
    [startDownload, activeTabId],
  );

  const handleLoadStart = useCallback((tabId: string) => () => {
    setDetectedVideosMap(prev => ({ ...prev, [tabId]: [] }));
    setBannerDismissedMap(prev => ({ ...prev, [tabId]: false }));
  }, []);

  const handleRemoveTab = useCallback((id: string) => {
    removeTab(id);
    // Clean up per-tab state
    delete webViewRefs.current[id];
    delete canGoBackMap.current[id];
    delete canGoForwardMap.current[id];
    setDetectedVideosMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setBannerDismissedMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [removeTab]);

  if (!isMounted.current) {
    return null
  }

  if (!isReady) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8F8F8" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4ECDC4" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F8F8" />

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={setActiveTab}
        onAddTab={() => addTab()}
        onRemoveTab={handleRemoveTab}
      />

      <AddressBar
        initialUrl={activeTab.url}
        onNavigate={handleNavigate}
        onGoBack={() => webViewRefs.current[activeTabId]?.goBack()}
        onGoForward={() => webViewRefs.current[activeTabId]?.goForward()}
        onReload={() => webViewRefs.current[activeTabId]?.reload()}
        canGoBack={canGoBackMap.current[activeTabId] || false}
        canGoForward={canGoForwardMap.current[activeTabId] || false}
        loading={false}
      />

      <View style={styles.webviewArea}>
        <View style={styles.webviewContainer}>
          {tabs.map(tab => (
            <View
              key={tab.id}
              style={[
                styles.webviewWrapper,
                tab.id !== activeTabId && styles.hiddenTab,
              ]}
              pointerEvents={tab.id === activeTabId ? 'auto' : 'none'}>
              <Browser
                webViewRef={(ref: WebView | null) => {
                  webViewRefs.current[tab.id] = ref;
                }}
                currentUrl={tab.url}
                handleMessage={handleMessage(tab.id)}
                handleNavigationStateChange={handleNavigationStateChange(tab.id)}
                handleLoadStart={handleLoadStart(tab.id)}
              />
            </View>
          ))}
        </View>

        {!activeBannerDismissed && (
          <VideoDetectedBanner
            videos={activeDetectedVideos}
            onPreview={setPreviewVideo}
            onDismiss={() => setBannerDismissedMap(prev => ({ ...prev, [activeTabId]: true }))}
          />
        )}
      </View>

      <VideoPreviewModal
        visible={previewVideo !== null}
        video={previewVideo}
        onDownload={handleDownload}
        onClose={() => setPreviewVideo(null)}
      />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  webviewArea: {
    flex: 1,
  },
  webviewContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  webviewWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  hiddenTab: {
    opacity: 0,
    zIndex: -1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
