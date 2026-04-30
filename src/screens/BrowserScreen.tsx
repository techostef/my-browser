import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, StatusBar, Alert, ActivityIndicator } from 'react-native';
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

  const { startDownload, startBlobDownload } = useDownloads();

  // Blob extraction state
  const blobChunksRef = useRef<string[]>([]);
  const activeBlobRef = useRef<{ blobUrl: string; pageTitle: string; totalSize: number } | null>(null);

  // Buffering progress (shown while MSE is still receiving chunks before extraction)
  const [bufferingState, setBufferingState] = useState<{
    blobUrl: string;
    bytesBuffered: number;
    totalSize: number;
    ready: boolean;
  } | null>(null);

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
          const { blobUrl, bytesBuffered, ready } = message.payload;
          const info = activeBlobRef.current;
          if (info && info.blobUrl === blobUrl) {
            setBufferingState({
              blobUrl,
              bytesBuffered,
              totalSize: info.totalSize,
              ready: !!ready,
            });
          }
          break;
        }
        case 'BLOB_DATA_START': {
          const { blobUrl, totalSize, mimeType } = message.payload;
          console.log(`[BrowserScreen] BLOB_DATA_START: url=${blobUrl} size=${totalSize} mime=${mimeType}`);
          blobChunksRef.current = [];
          setBufferingState(null);
          break;
        }
        case 'BLOB_DATA_CHUNK': {
          const { index, data } = message.payload;
          blobChunksRef.current.push(data);
          if (index % 10 === 0) {
            console.log(`[BrowserScreen] BLOB_DATA_CHUNK #${index} received (${data.length} chars)`);
          }
          break;
        }
        case 'BLOB_DATA_END': {
          const { totalChunks } = message.payload;
          console.log(`[BrowserScreen] BLOB_DATA_END: ${totalChunks} chunks received`);
          const fullBase64 = blobChunksRef.current.join('');
          blobChunksRef.current = [];
          const info = activeBlobRef.current;
          if (info && fullBase64.length > 0) {
            console.log(`[BrowserScreen] Saving blob: ${fullBase64.length} base64 chars for "${info.pageTitle}"`);
            startBlobDownload(info.pageTitle, fullBase64);
            Alert.alert('Download Started', 'Blob video is being saved. Check the Downloads tab.');
          } else {
            Alert.alert('Error', 'No blob data was received.');
          }
          activeBlobRef.current = null;
          break;
        }
        case 'BLOB_DATA_ERROR': {
          console.error(`[BrowserScreen] BLOB_DATA_ERROR:`, message.payload);
          blobChunksRef.current = [];
          activeBlobRef.current = null;
          setBufferingState(null);
          Alert.alert('Blob Error', message.payload?.error || 'Failed to extract blob video data.');
          break;
        }
      }
    } catch (err) {
      // Ignore non-JSON messages from websites
    } 
  }, [startBlobDownload]);

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
        console.log(`[BrowserScreen] Starting blob extraction for: ${video.url}`);
        activeBlobRef.current = {
          blobUrl: video.url,
          pageTitle: video.pageTitle,
          totalSize: video.blobSize || 0,
        };
        const webView = webViewRefs.current[activeTabId];
        if (webView) {
          const escUrl = video.url.replace(/'/g, "\\'");
          // waitForReady=true: poll until MSE.sourceended fires (or user
          // taps Finish). Without this we capture only the current forward-
          // buffer (~30s) instead of the full video.
          const js = `window.__extractBlobVideo && window.__extractBlobVideo('${escUrl}', { waitForReady: true })`;
          webView.injectJavaScript(js + '; true;');
          setBufferingState({
            blobUrl: video.url,
            bytesBuffered: 0,
            totalSize: video.blobSize || 0,
            ready: false,
          });
        } else {
          Alert.alert('Error', 'WebView not available for blob extraction.');
        }
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

  const handleFinishBuffering = useCallback(() => {
    if (!bufferingState) return;
    const webView = webViewRefs.current[activeTabId];
    if (webView) {
      const escUrl = bufferingState.blobUrl.replace(/'/g, "\\'");
      webView.injectJavaScript(`window.__cancelBlobWait && window.__cancelBlobWait('${escUrl}'); true;`);
    }
  }, [bufferingState, activeTabId]);

  const handleCancelBuffering = useCallback(() => {
    handleFinishBuffering();
    activeBlobRef.current = null;
    setBufferingState(null);
  }, [handleFinishBuffering]);

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

      <Modal
        visible={bufferingState !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelBuffering}>
        <View style={styles.modalBackdrop}>
          <View style={styles.bufferingCard}>
            <Text style={styles.bufferingTitle}>Buffering video…</Text>
            <Text style={styles.bufferingHint}>
              Keep the page open and let the video play. Tap Finish to save what's buffered so far.
            </Text>
            <ActivityIndicator size="small" color="#4ECDC4" style={{ marginVertical: 12 }} />
            <Text style={styles.bufferingBytes}>
              {formatMB(bufferingState?.bytesBuffered || 0)} buffered
              {bufferingState?.ready ? ' · stream ended' : ''}
            </Text>
            <View style={styles.bufferingButtons}>
              <TouchableOpacity style={styles.bufferingBtnSecondary} onPress={handleCancelBuffering}>
                <Text style={styles.bufferingBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bufferingBtnPrimary} onPress={handleFinishBuffering}>
                <Text style={styles.bufferingBtnPrimaryText}>Finish & save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  bufferingCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 20,
    alignItems: 'stretch',
  },
  bufferingTitle: {
    color: '#4ECDC4',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  bufferingHint: {
    color: '#CCC',
    fontSize: 12,
    lineHeight: 16,
  },
  bufferingBytes: {
    color: '#FFF',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  bufferingButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  bufferingBtnSecondary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  bufferingBtnSecondaryText: {
    color: '#CCC',
    fontSize: 13,
    fontWeight: '600',
  },
  bufferingBtnPrimary: {
    backgroundColor: '#4ECDC4',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  bufferingBtnPrimaryText: {
    color: '#1A1A2E',
    fontSize: 13,
    fontWeight: '700',
  },
});
