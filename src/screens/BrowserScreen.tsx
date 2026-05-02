import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, StatusBar, Alert, ActivityIndicator, AppState, BackHandler } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import AddressBar from '../components/AddressBar';
import TabBar from '../components/TabBar';
import VideoDetectedBanner from '../components/VideoDetectedBanner';
import VideoPreviewModal from '../components/VideoPreviewModal';
import { useDownloadActions } from '../store/downloadStore';
import {
  useActiveTab,
  useActiveTabId,
  useIsTabsReady,
  useTabActions,
  useTabList,
} from '../store/tabStore';
import { DetectedVideo } from '../types';
import Browser from '@/components/Browser';

export default function BrowserScreen() {
  // Subscribe ONLY to the narrow slices BrowserScreen itself needs. Heavy
  // state (tabs array, activeTab fields, download progress) is read inside
  // memoized child components below, so title updates and download-progress
  // ticks no longer re-render this screen.
  const isReady = useIsTabsReady();
  const activeTabId = useActiveTabId();
  const { addTab, removeTab, setActiveTab, updateTab, setTabHidden, pushUrl, navigateHistory, getTabsSnapshot } = useTabActions();
  const { startDownload, createBlobTask, updateBlobProgress, completeBlobDownload } = useDownloadActions();
  const previousUrl = useRef('');

  // Per-tab WebView refs
  const webViewRefs = useRef<Record<string, WebView | null>>({});

  // Per-tab video detection state
  const [detectedVideosMap, setDetectedVideosMap] = useState<Record<string, DetectedVideo[]>>({});
  const [bannerDismissedMap, setBannerDismissedMap] = useState<Record<string, boolean>>({});

  // Keyed by blobUrl so multiple blob downloads from different tabs can run simultaneously.
  const blobChunksMap = useRef<Map<string, string[]>>(new Map());
  const activeBlobMap = useRef<Map<string, { downloadId: string; pageTitle: string; totalSize: number; tabId: string }>>(new Map());

  // Set to true before any programmatic navigation (back/forward/address-bar) so
  // handleNavigationStateChange knows not to push the resulting URL to history again.
  const isHistoryNavRef = useRef<Record<string, boolean>>({});

  const tabHasActiveExtraction = useCallback((tabId: string) => {
    for (const info of activeBlobMap.current.values()) {
      if (info.tabId === tabId) return true;
    }
    return false;
  }, []);

  // Browser is memoized with `() => true`, so the WebView's onMessage and
  // onShouldStartLoadWithRequest closures are frozen at first mount. We read
  // the latest tabs through `getTabsSnapshot()` from the actions context so
  // callbacks stay stable without subscribing to the tab list.

  // Inject a video play() kick into every tab that currently has an active
  // extraction. Called when the app returns from background (AppState) or when
  // the Browser screen regains focus after the user visits the Downloads tab.
  // The video keep-alive setInterval already runs in the page, but JavaScript
  // is throttled/suspended when the WebView's view is detached or the app goes
  // into the background — so the interval may miss ticks. This explicit kick fires
  // from the RN side the moment JS can run again.
  const kickExtractingTabs = useCallback(() => {
    const KICK_JS = `(function(){try{var vs=document.querySelectorAll('video');for(var i=0;i<vs.length;i++){var v=vs[i];v.muted=true;if(v.paused&&v.readyState>0){var p=v.play();if(p&&typeof p.catch==='function')p.catch(function(){});}}}catch(e){}})();true;`;
    const seen = new Set<string>();
    for (const info of activeBlobMap.current.values()) {
      if (seen.has(info.tabId)) continue;
      seen.add(info.tabId);
      webViewRefs.current[info.tabId]?.injectJavaScript(KICK_JS);
    }
  }, []);

  // Kick when app returns from background (handles app minimize/restore).
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') kickExtractingTabs();
    });
    return () => sub.remove();
  }, [kickExtractingTabs]);

  // Kick when Browser screen regains focus (handles Downloads tab switch).
  useFocusEffect(
    useCallback(() => {
      kickExtractingTabs();
    }, [kickExtractingTabs]),
  );

  // Stable interceptor for in-page link clicks. When extraction is active on
  // a tab, top-frame navigations away from its current URL are cancelled and
  // re-opened in a new tab — this preserves the page that owns the blob.
  const handleShouldStartLoadWithRequest = useCallback(
    (tabId: string) => (request: ShouldStartLoadRequest) => {
      if (!request.isTopFrame) return true;
      if (!tabHasActiveExtraction(tabId)) return true;
      const tab = getTabsSnapshot().find(t => t.id === tabId);
      if (!tab) return true;
      // Allow same-document loads (initial load, reloads, hash changes) so the
      // current page can keep running its extraction script.
      if (request.url === tab.url || request.url === tab.lastVisitedUrl) return true;
      // Top-frame nav away from the extracting page → park the tab in the
      // background and open the new URL in a fresh visible tab.
      setTabHidden(tabId, true);
      addTab(request.url);
      return false;
    },
    [tabHasActiveExtraction, setTabHidden, addTab, getTabsSnapshot],
  );

  const finalizeExtractionForTab = useCallback(
    (tabId: string) => {
      if (tabHasActiveExtraction(tabId)) return;
      const tab = getTabsSnapshot().find(t => t.id === tabId);
      if (tab?.hidden) {
        // Hidden background-extraction tab: extraction is done, drop it.
        removeTab(tabId);
        delete webViewRefs.current[tabId];
        setDetectedVideosMap(prev => {
          const next = { ...prev };
          delete next[tabId];
          return next;
        });
        setBannerDismissedMap(prev => {
          const next = { ...prev };
          delete next[tabId];
          return next;
        });
      }
    },
    [removeTab, tabHasActiveExtraction, getTabsSnapshot],
  );

  const activeDetectedVideos = detectedVideosMap[activeTabId] || [];
  const activeBannerDismissed = bannerDismissedMap[activeTabId] || false;

  // Video preview modal state
  const [previewVideo, setPreviewVideo] = useState<DetectedVideo | null>(null);

  // Inject a URL into the (memoized) WebView without causing a React re-render.
  const injectNavigation = useCallback((tabId: string, url: string) => {
    const esc = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    webViewRefs.current[tabId]?.injectJavaScript(`window.location.href='${esc}'; true;`);
  }, []);

  const getBaseUrl = useCallback((url: string) => {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`; // ignore search + hash
    } catch {
      return url;
    }
  }, []);

  const handleNavigate = useCallback((url: string) => {
    if (tabHasActiveExtraction(activeTabId)) {
      // Park the extracting tab in the background so its WebView and
      // __extractBlobVideo script keep running, then open the new URL in a
      // fresh tab. The hidden tab self-removes when extraction completes.
      setTabHidden(activeTabId, true);
      addTab(url);
      return;
    }
    const active = getTabsSnapshot().find(t => t.id === activeTabId);
    const currentBase = getBaseUrl(url);
    const previousBase = active ? getBaseUrl(active.url) : '';
    console.log("navState.url", url)
    console.log("activeTab.url", active?.url)
    console.log("currentBase", currentBase)
    console.log("previousBase", previousBase)
    isHistoryNavRef.current[activeTabId] = true;
    pushUrl(activeTabId, url);
    setDetectedVideosMap(prev => ({ ...prev, [activeTabId]: [] }));
    setBannerDismissedMap(prev => ({ ...prev, [activeTabId]: false }));
    injectNavigation(activeTabId, url);
  }, [activeTabId, pushUrl, tabHasActiveExtraction, setTabHidden, addTab, injectNavigation, getTabsSnapshot, getBaseUrl]);

  const handleGoBack = useCallback((tabId: string): boolean => {
    const tab = getTabsSnapshot().find(t => t.id === tabId);
    if (!tab || tab.historyIndex <= 0) return false;
    const prevUrl = tab.urlHistory[tab.historyIndex - 1];
    isHistoryNavRef.current[tabId] = true;
    navigateHistory(tabId, -1);
    injectNavigation(tabId, prevUrl);
    return true;
  }, [navigateHistory, injectNavigation, getTabsSnapshot]);

  // Hardware back: navigate browser history first, then fall back to default
  // (which exits the app at the root). Without this, Android's back button
  // immediately closes the app even when the active tab has prior pages.
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        return handleGoBack(activeTabIdRef.current);
      });
      return () => sub.remove();
    }, [handleGoBack]),
  );

  const handleGoForward = useCallback((tabId: string) => {
    const tab = getTabsSnapshot().find(t => t.id === tabId);
    if (!tab || tab.historyIndex >= tab.urlHistory.length - 1) return;
    const nextUrl = tab.urlHistory[tab.historyIndex + 1];
    isHistoryNavRef.current[tabId] = true;
    navigateHistory(tabId, 1);
    injectNavigation(tabId, nextUrl);
  }, [navigateHistory, injectNavigation, getTabsSnapshot]);

  const handleNavigationStateChange = useCallback((tabId: string) => (navState: WebViewNavigation) => {
    // console.log("handleNavigationStateChange url", navState.url);
    // console.log("handleNavigationStateChange activeTab", previousUrl.current);
    // // const currentBase = getBaseUrl(navState.url);
    // // const previousBase = getBaseUrl(previousUrl.current);
    // // console.log("currentBase", currentBase)
    // // console.log("previousBase", previousBase)
    previousUrl.current = navState.url;
    if (!navState.url) return;

    if (isHistoryNavRef.current[tabId]) {
      // Programmatic navigation (back/forward/address-bar) already updated the
      // history stack — just sync the title and clear the flag.
      isHistoryNavRef.current[tabId] = false;
      if (navState.title) updateTab(tabId, { title: navState.title });
      return;
    }

    // User-initiated navigation (link click, SPA route, redirect) — push to history.
    pushUrl(tabId, navState.url, navState.title || undefined);
  }, [updateTab, pushUrl]);

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
            return { ...prev, [tabId]: [...filtered, ...incoming] };
          });
          setBannerDismissedMap(prev => ({ ...prev, [tabId]: false }));
          break;
        }
        case 'DETECTOR_LOG':
          break;
        case 'PAGE_INFO':
          break;
        case 'BLOB_BUFFERING': {
          const { blobUrl, bytesBuffered } = message.payload;
          const info = activeBlobMap.current.get(blobUrl);
          if (info) {
            console.log(`[BrowserScreen] BLOB_BUFFERING: url=${blobUrl} bytes=${bytesBuffered}/${info.totalSize}`);
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
            info.totalSize = totalSize;
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
          if (info) {
            webViewRefs.current[info.tabId]?.injectJavaScript(
              'window.__extractionGuardCount = Math.max(0, (window.__extractionGuardCount||0) - 1); true;',
            );
            finalizeExtractionForTab(info.tabId);
          }
          break;
        }
        case 'BLOB_DATA_ERROR': {
          const { blobUrl } = message.payload;
          console.error(`[BrowserScreen] BLOB_DATA_ERROR:`, message.payload);
          const info = activeBlobMap.current.get(blobUrl);
          blobChunksMap.current.delete(blobUrl);
          activeBlobMap.current.delete(blobUrl);
          Alert.alert('Download Error', message.payload?.error || 'Failed to extract blob video data.');
          if (info) {
            webViewRefs.current[info.tabId]?.injectJavaScript(
              'window.__extractionGuardCount = Math.max(0, (window.__extractionGuardCount||0) - 1); true;',
            );
            finalizeExtractionForTab(info.tabId);
          }
          break;
        }
        case 'EXTRACTION_LINK_CLICK': {
          const { href } = message.payload;
          console.log(`[BrowserScreen] EXTRACTION_LINK_CLICK on tab ${tabId}: ${href}`);
          // Park the extracting tab in the background, open link in a new tab.
          setTabHidden(tabId, true);
          addTab(href);
          break;
        }
      }
    } catch (err) {
      // Ignore non-JSON messages from websites
    }
  }, [updateBlobProgress, completeBlobDownload, finalizeExtractionForTab, setTabHidden, addTab]);

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
          tabId: activeTabId,
        });
        const escUrl = video.url.replace(/'/g, "\\'");
        // Bump the in-page guard counter so the click interceptor is armed
        // before extraction starts. Decremented when extraction ends.
        webViewRefs.current[activeTabId]?.injectJavaScript(
          `window.__extractionGuardCount = (window.__extractionGuardCount||0) + 1; window.__extractBlobVideo && window.__extractBlobVideo('${escUrl}', { waitForReady: true }); true;`,
        );
        Alert.alert('Download queued', 'Video is buffering. Track progress in the Downloads tab.');
        return;
      }
      startDownload(video);
      Alert.alert('Download Started', 'Check the Downloads tab for progress.');
    },
    [startDownload, activeTabId],
  );

  const handleLoadStart = useCallback((tabId: string) => () => {
    setDetectedVideosMap(prev => {
      const existing = prev[tabId];
      // Avoid re-renders when there's nothing to clear.
      if (!existing || existing.length === 0) return prev;
      return { ...prev, [tabId]: [] };
    });
    setBannerDismissedMap(prev => {
      if (prev[tabId] === false || prev[tabId] === undefined) return prev;
      return { ...prev, [tabId]: false };
    });
  }, []);

  // Stable wrappers so memoized children don't invalidate on every render.
  const handleAddTab = useCallback(() => addTab(), [addTab]);
  const handleGoBackActive = useCallback(() => { handleGoBack(activeTabId); }, [handleGoBack, activeTabId]);
  const handleGoForwardActive = useCallback(() => { handleGoForward(activeTabId); }, [handleGoForward, activeTabId]);
  const handleReloadActive = useCallback(() => { webViewRefs.current[activeTabId]?.reload(); }, [activeTabId]);
  const setWebViewRef = useCallback((tabId: string, ref: WebView | null) => {
    webViewRefs.current[tabId] = ref;
  }, []);

  const handleRemoveTab = useCallback((id: string) => {
    removeTab(id);
    delete webViewRefs.current[id];
    delete isHistoryNavRef.current[id];
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

  console.log("Render Screen BrowserScreen")

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F8F8" />

      <TabBarContainer
        onSwitchTab={setActiveTab}
        onAddTab={handleAddTab}
        onRemoveTab={handleRemoveTab}
      />

      <AddressBarContainer
        onNavigate={handleNavigate}
        onGoBack={handleGoBackActive}
        onGoForward={handleGoForwardActive}
        onReload={handleReloadActive}
      />

      <View style={styles.webviewArea}>
        <WebViewList
          setWebViewRef={setWebViewRef}
          handleMessage={handleMessage}
          handleNavigationStateChange={handleNavigationStateChange}
          handleLoadStart={handleLoadStart}
          handleShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
        />

        {!activeBannerDismissed && (
          <VideoDetectedBanner
            videos={activeDetectedVideos}
            onPreview={setPreviewVideo}
            onOpenInTab={(video) => addTab(video.url)}
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

// ----------------------------------------------------------------------------
// Child containers — each subscribes only to the state slice it actually needs
// so title updates / tab-list mutations don't re-render the parent BrowserScreen.
// ----------------------------------------------------------------------------

interface TabBarContainerProps {
  onSwitchTab: (id: string) => void;
  onAddTab: () => void;
  onRemoveTab: (id: string) => void;
}

function TabBarContainerInner({ onSwitchTab, onAddTab, onRemoveTab }: TabBarContainerProps) {
  const tabs = useTabList();
  const activeTabId = useActiveTabId();
  return (
    <TabBar
      tabs={tabs}
      activeTabId={activeTabId}
      onSwitchTab={onSwitchTab}
      onAddTab={onAddTab}
      onRemoveTab={onRemoveTab}
    />
  );
}
const TabBarContainer = React.memo(TabBarContainerInner);

interface AddressBarContainerProps {
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
}

function AddressBarContainerInner({ onNavigate, onGoBack, onGoForward, onReload }: AddressBarContainerProps) {
  const activeTab = useActiveTab();
  return (
    <AddressBar
      initialUrl={activeTab.url}
      onNavigate={onNavigate}
      onGoBack={onGoBack}
      onGoForward={onGoForward}
      onReload={onReload}
      canGoBack={activeTab.historyIndex > 0}
      canGoForward={activeTab.historyIndex < activeTab.urlHistory.length - 1}
      loading={false}
    />
  );
}
const AddressBarContainer = React.memo(AddressBarContainerInner);

interface WebViewListProps {
  setWebViewRef: (tabId: string, ref: WebView | null) => void;
  handleMessage: (tabId: string) => (event: { nativeEvent: { data: string } }) => void;
  handleNavigationStateChange: (tabId: string) => (navState: WebViewNavigation) => void;
  handleLoadStart: (tabId: string) => () => void;
  handleShouldStartLoadWithRequest: (tabId: string) => (request: ShouldStartLoadRequest) => boolean;
}

function WebViewListInner({
  setWebViewRef,
  handleMessage,
  handleNavigationStateChange,
  handleLoadStart,
  handleShouldStartLoadWithRequest,
}: WebViewListProps) {
  const tabs = useTabList();
  const activeTabId = useActiveTabId();
  return (
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
            webViewRef={(ref: WebView | null) => setWebViewRef(tab.id, ref)}
            currentUrl={tab.url}
            handleMessage={handleMessage(tab.id)}
            handleNavigationStateChange={handleNavigationStateChange(tab.id)}
            handleLoadStart={handleLoadStart(tab.id)}
            handleShouldStartLoadWithRequest={handleShouldStartLoadWithRequest(tab.id)}
          />
        </View>
      ))}
    </View>
  );
}
const WebViewList = React.memo(WebViewListInner);
