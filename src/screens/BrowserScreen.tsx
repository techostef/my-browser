import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, StatusBar, Alert, ActivityIndicator, AppState, BackHandler } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';

import AddressBar from '../components/AddressBar';
import TabBarContainer from '../components/TabBarContainer';
import { useSettings } from '../store/settingsStore';
import VideoDetectedBanner from '../components/VideoDetectedBanner';
import VideoPreviewModal from '../components/VideoPreviewModal';
import VideoPlayerController from '../components/VideoPlayerController';
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

// Injected into the browser WebView when the user taps Preview on a stream.
// Posts the currentTime of the most-advanced playing video element.
const GET_VIDEO_TIME_JS = `(function(){try{var vids=document.querySelectorAll('video');var t=0;for(var i=0;i<vids.length;i++){if(vids[i].currentTime>t)t=vids[i].currentTime;}window.ReactNativeWebView.postMessage(JSON.stringify({type:'VIDEO_CURRENT_TIME',payload:{time:t}}));}catch(e){}})();true;`;

// Toggles the first actively-playing video between fullscreen (position:fixed)
// and its original position. Relies on __removeVideoPlayingStyles defined by
// videoDetector.ts when the script is injected.
const TOGGLE_FULLSCREEN_JS = `(function(){
  function rnLog(msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'DETECTOR_LOG', payload: msg})); } catch(_){}
  }
  try {
    var playing = document.querySelectorAll('.__rn-playing');
    rnLog('[FULLSCREEN] toggle — playing count=' + playing.length);
    if (playing.length > 0) {
      if (window.__rnVideoStateInterval) { clearInterval(window.__rnVideoStateInterval); window.__rnVideoStateInterval = null; }
      window.__removeVideoPlayingStyles && window.__removeVideoPlayingStyles();
      rnLog('[FULLSCREEN] restored original styles');
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'VIDEO_FULLSCREEN_CHANGED',payload:{active:false}}));
    } else {
      var vids = document.querySelectorAll('video');
      rnLog('[FULLSCREEN] total videos=' + vids.length);
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        rnLog('[FULLSCREEN] video[' + i + '] paused=' + v.paused + ' src=' + (v.currentSrc || v.src).substring(0, 80));
        if (!v.paused) {
          if (!v.dataset.rnOrigStyle) {
            v.dataset.rnOrigStyle = v.getAttribute('style') || '';
          }
          window.__rnPlayingParent = v.parentNode;
          window.__rnPlayingNextSibling = v.nextSibling;
          var backdrop = document.createElement('div');
          backdrop.id = '__rn-playing-backdrop';
          backdrop.style.setProperty('position', 'fixed', 'important');
          backdrop.style.setProperty('top', '0', 'important');
          backdrop.style.setProperty('left', '0', 'important');
          backdrop.style.setProperty('width', '100%', 'important');
          backdrop.style.setProperty('height', '100%', 'important');
          backdrop.style.setProperty('z-index', '9998', 'important');
          backdrop.style.setProperty('background', 'black', 'important');
          v.dataset.rnOrigHadControls = v.hasAttribute('controls') ? '1' : '0';
          document.body.appendChild(backdrop);
          document.body.appendChild(v);
          v.removeAttribute('controls');
          v.style.setProperty('position', 'fixed', 'important');
          v.style.setProperty('top', '0', 'important');
          v.style.setProperty('left', '0', 'important');
          v.style.setProperty('width', '100%', 'important');
          v.style.setProperty('height', '100%', 'important');
          v.style.setProperty('z-index', '9999', 'important');
          v.style.setProperty('transform', 'none', 'important');
          v.classList.add('__rn-playing');
          if (window.__rnVideoStateInterval) clearInterval(window.__rnVideoStateInterval);
          window.__rnVideoStateInterval = setInterval(function() {
            var el = document.querySelector('.__rn-playing');
            if (!el) { clearInterval(window.__rnVideoStateInterval); return; }
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'VIDEO_STATE',
              currentTime: el.currentTime || 0,
              duration: isFinite(el.duration) ? el.duration : 0,
              paused: el.paused,
              muted: el.muted,
            }));
          }, 250);
          rnLog('[FULLSCREEN] moved to body and applied fullscreen to video[' + i + ']');
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'VIDEO_FULLSCREEN_CHANGED',payload:{active:true}}));
          break;
        }
      }
    }
  } catch(e) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'DETECTOR_LOG', payload: '[FULLSCREEN] error: ' + e.message})); } catch(_){}
  }
})(); true;`;

export default function BrowserScreen() {
  // Subscribe ONLY to the narrow slices BrowserScreen itself needs. Heavy
  // state (tabs array, activeTab fields, download progress) is read inside
  // memoized child components below, so title updates and download-progress
  // ticks no longer re-render this screen.
  const isReady = useIsTabsReady();
  const activeTabId = useActiveTabId();
  const tabs = useTabList();
  const { addTab, removeTab, updateTab, setTabHidden, pushUrl, replaceUrl, navigateHistory, getTabsSnapshot } = useTabActions();
  const { startDownload, createBlobTask, updateBlobProgress, completeBlobDownload } = useDownloadActions();
  const { pushHistory } = useSettings();
  const previousUrl = useRef('');

  // Per-tab WebView refs
  const webViewRefs = useRef<Record<string, WebView | null>>({});

  // Used to hold a stream preview request while we wait for the current
  // playback time to come back from the browser WebView.
  const pendingPreviewVideoRef = useRef<DetectedVideo | null>(null);
  const pendingPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-tab video detection state
  const [detectedVideosMap, setDetectedVideosMap] = useState<Record<string, DetectedVideo[]>>({});
  const [bannerDismissedMap, setBannerDismissedMap] = useState<Record<string, boolean>>({});

  // Keyed by blobUrl so multiple blob downloads from different tabs can run simultaneously.
  const blobChunksMap = useRef<Map<string, string[]>>(new Map());
  const activeBlobMap = useRef<Map<string, { downloadId: string; pageTitle: string; totalSize: number; tabId: string }>>(new Map());

  // Parallel pipeline for blob *previews*: extracts the same captured bytes
  // via __extractBlobVideo, but writes them to cache (file://) instead of the
  // private downloads folder, then plays the temp file in the preview modal.
  // The extraction message handlers below check this map first so a blob being
  // previewed doesn't get treated as a download.
  const blobPreviewChunksMap = useRef<Map<string, string[]>>(new Map());
  const activeBlobPreviewMap = useRef<
    Map<string, { previewId: string; tabId: string; totalSize: number; video: DetectedVideo; cancelled?: boolean }>
  >(new Map());
  const previewTempFileRef = useRef<string | null>(null);
  const [blobPreviewProgress, setBlobPreviewProgress] = useState<
    { bytesReceived: number; totalBytes: number } | null
  >(null);
  const [blobPreviewError, setBlobPreviewError] = useState<string | null>(null);

  // Set to true before any programmatic navigation (back/forward/address-bar) so
  // handleNavigationStateChange knows not to push the resulting URL to history again.
  const isHistoryNavRef = useRef<Record<string, boolean>>({});

  const tabHasActiveExtraction = useCallback((tabId: string) => {
    for (const info of activeBlobMap.current.values()) {
      if (info.tabId === tabId) return true;
    }
    for (const info of activeBlobPreviewMap.current.values()) {
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
    for (const info of activeBlobPreviewMap.current.values()) {
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
  const activeTab = useActiveTab();
  const navbarTitle = activeDetectedVideos[0]?.pageTitle || activeTab?.title || 'Video';

  // Video preview modal state
  const [previewVideo, setPreviewVideo] = useState<DetectedVideo | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  // Live video state — driven by VIDEO_STATE messages while fullscreen is active
  const [liveCurrentTime, setLiveCurrentTime] = useState(0);
  const [liveDuration, setLiveDuration] = useState(0);
  const [liveIsPaused, setLiveIsPaused] = useState(false);
  const [liveIsMuted, setLiveIsMuted] = useState(false);

  // For DASH/HLS streams, capture the browser's current playback position before
  // opening the preview so the modal can seek to the same spot.
  const handlePreviewVideo = useCallback((video: DetectedVideo) => {
    if (video.type === 'dash' || video.type === 'hls') {
      pendingPreviewVideoRef.current = video;
      if (pendingPreviewTimerRef.current) clearTimeout(pendingPreviewTimerRef.current);
      webViewRefs.current[activeTabId]?.injectJavaScript(GET_VIDEO_TIME_JS);
      // Fallback: open with startTime=0 if no reply within 400ms
      pendingPreviewTimerRef.current = setTimeout(() => {
        if (pendingPreviewVideoRef.current === video) {
          pendingPreviewVideoRef.current = null;
          pendingPreviewTimerRef.current = null;
          setPreviewVideo(video);
        }
      }, 400);
      return;
    }

    if (video.type === 'blob-ready') {
      // Already extracting this blob (download or another preview) — just open
      // modal in extracting state and let messages drive the UI.
      const alreadyExtracting =
        activeBlobMap.current.has(video.url) ||
        activeBlobPreviewMap.current.has(video.url);
      if (alreadyExtracting) {
        setBlobPreviewError(
          'This blob is already being extracted. Wait for it to finish, then try Preview again.',
        );
        setPreviewVideo(video);
        return;
      }
      const webView = webViewRefs.current[activeTabId];
      if (!webView) {
        setBlobPreviewError('Browser tab is not available for extraction.');
        setPreviewVideo(video);
        return;
      }
      const previewId = `preview_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      activeBlobPreviewMap.current.set(video.url, {
        previewId,
        tabId: activeTabId,
        totalSize: video.blobSize || 0,
        video,
      });
      setBlobPreviewError(null);
      setBlobPreviewProgress({
        bytesReceived: 0,
        totalBytes: video.blobSize || 0,
      });
      setPreviewVideo(video);
      const escUrl = video.url.replace(/'/g, "\\'");
      webView.injectJavaScript(
        `window.__extractionGuardCount = (window.__extractionGuardCount||0) + 1; window.__extractBlobVideo && window.__extractBlobVideo('${escUrl}', { waitForReady: true }); true;`,
      );
      return;
    }

    if (video.type === 'blob') {
      // Raw blob URL with no captured bytes yet — just open the modal which
      // shows a "still buffering" message.
      setBlobPreviewError(null);
      setBlobPreviewProgress(null);
      setPreviewVideo(video);
      return;
    }

    setPreviewVideo(video);
  }, [activeTabId]);

  const handleToggleFullscreen = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(TOGGLE_FULLSCREEN_JS);
  }, [activeTabId]);

  const injectLiveTogglePlay = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      "(function(){var v=document.querySelector('.__rn-playing');if(v){v.paused?v.play().catch(function(){}):v.pause();}})();true;",
    );
  }, [activeTabId]);

  const injectLiveToggleMute = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      "(function(){var v=document.querySelector('.__rn-playing');if(v)v.muted=!v.muted;})();true;",
    );
  }, [activeTabId]);

  const injectLiveSeek = useCallback((time: number) => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      `(function(){var v=document.querySelector('.__rn-playing');if(v)v.currentTime=${time};})();true;`,
    );
  }, [activeTabId]);

  const injectLiveSkipBack = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      "(function(){var v=document.querySelector('.__rn-playing');if(v)v.currentTime=Math.max(0,v.currentTime-10);})();true;",
    );
  }, [activeTabId]);

  const injectLiveSkipForward = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      "(function(){var v=document.querySelector('.__rn-playing');if(v)v.currentTime=Math.min(v.duration||0,v.currentTime+10);})();true;",
    );
  }, [activeTabId]);

  const handleClosePreview = useCallback(() => {
    // If extraction is still in flight, mark it cancelled so the END handler
    // skips writing to disk but still decrements the page's guard counter.
    for (const info of activeBlobPreviewMap.current.values()) {
      info.cancelled = true;
    }
    setPreviewVideo(null);
    setIsVideoPlaying(false);
    setBlobPreviewProgress(null);
    setBlobPreviewError(null);
    const REMOVE_JS = `if(window.__rnVideoStateInterval){clearInterval(window.__rnVideoStateInterval);window.__rnVideoStateInterval=null;} window.__removeVideoPlayingStyles && window.__removeVideoPlayingStyles(); true;`;
    Object.values(webViewRefs.current).forEach(ref => ref?.injectJavaScript(REMOVE_JS));
    const tempPath = previewTempFileRef.current;
    previewTempFileRef.current = null;
    if (tempPath) {
      FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
    }
  }, []);

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
    isHistoryNavRef.current[activeTabId] = true;
    pushUrl(activeTabId, url);
    // setDetectedVideosMap(prev => ({ ...prev, [activeTabId]: [] }));
    setBannerDismissedMap(prev => ({ ...prev, [activeTabId]: false }));
    injectNavigation(activeTabId, url);
  }, [activeTabId, pushUrl, tabHasActiveExtraction, setTabHidden, addTab, injectNavigation, getTabsSnapshot, getBaseUrl]);

  const handleGoBack = useCallback((tabId: string): boolean => {
    const tab = getTabsSnapshot().find(t => t.id === tabId);
    if (!tab || tab.historyIndex <= 0) return false;
    isHistoryNavRef.current[tabId] = true;
    navigateHistory(tabId, -1);
    webViewRefs.current[tabId]?.goBack();
    return true;
  }, [navigateHistory, getTabsSnapshot]);

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

  useEffect(() => {
    if (!isVideoPlaying) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleToggleFullscreen();
      return true;
    });
    return () => sub.remove();
  }, [isVideoPlaying, handleToggleFullscreen]);

  const handleGoForward = useCallback((tabId: string) => {
    const tab = getTabsSnapshot().find(t => t.id === tabId);
    if (!tab || tab.historyIndex >= tab.urlHistory.length - 1) return;
    isHistoryNavRef.current[tabId] = true;
    navigateHistory(tabId, 1);
    webViewRefs.current[tabId]?.goForward();
  }, [navigateHistory, getTabsSnapshot]);

  const handleNavigationStateChange = useCallback((tabId: string) => (navState: WebViewNavigation) => {
    if (!navState.url) return;

    if (isHistoryNavRef.current[tabId]) {
      // Programmatic navigation (back/forward/address-bar) already updated the
      // history stack — just sync the title and clear the flag.
      isHistoryNavRef.current[tabId] = false;
      if (navState.title) updateTab(tabId, { title: navState.title });
      previousUrl.current = navState.url;
      return;
    }

    // Determine whether this navigation is a genuine page change or just a
    // query/hash/case variation of the current page. Compare bases against the
    // URL at the current history position (not the stale `previousUrl` ref)
    // and normalize case so e.g. `/mediaViewer` and `/mediaviewer` collapse.
    const tab = getTabsSnapshot().find(t => t.id === tabId);
    const currentHistoryUrl = tab?.urlHistory[tab.historyIndex] ?? '';
    const nextBase = getBaseUrl(navState.url).toLowerCase();
    const currentBase = getBaseUrl(currentHistoryUrl).toLowerCase();

    if (nextBase === currentBase) {
      replaceUrl(tabId, navState.url, navState.title || undefined);
    } else {
      pushUrl(tabId, navState.url, navState.title || undefined);
      if (!tab?.incognito) {
        pushHistory({ url: navState.url, title: navState.title || navState.url });
      }
    }
    previousUrl.current = navState.url;
  }, [updateTab, pushUrl, replaceUrl, getTabsSnapshot, getBaseUrl, pushHistory]);

  const handleMessage = useCallback((tabId: string) => (event: { nativeEvent: { data: string } }) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      switch (message.type) {
        case 'VIDEO_DETECTED': {
          setBannerDismissedMap(prev => ({ ...prev, [tabId]: false }));
          break;
        }
        case 'M3U8_INFO': {
          const item = message.payload;
          setDetectedVideosMap(prev => {
            const existing = prev[tabId] || [];
            return { ...prev, [tabId]: [...existing, item] };
          });
          setBannerDismissedMap(prev => ({ ...prev, [tabId]: false }));
          break;
        }
        case 'VIDEO_CURRENT_TIME': {
          const pending = pendingPreviewVideoRef.current;
          if (pending) {
            if (pendingPreviewTimerRef.current) clearTimeout(pendingPreviewTimerRef.current);
            pendingPreviewTimerRef.current = null;
            pendingPreviewVideoRef.current = null;
            setPreviewVideo({ ...pending, startTime: message.payload?.time || 0 });
          }
          break;
        }
        case 'VIDEO_FULLSCREEN_CHANGED': {
          const active = message.payload?.active === true;
          setIsVideoPlaying(active);
          if (!active) {
            setLiveCurrentTime(0);
            setLiveDuration(0);
            setLiveIsPaused(false);
            setLiveIsMuted(false);
            setBannerDismissedMap(prev => ({ ...prev, [tabId]: false }));
          }
          break;
        }
        case 'VIDEO_STATE': {
          setLiveCurrentTime(message.currentTime);
          setLiveDuration(message.duration);
          setLiveIsPaused(message.paused);
          setLiveIsMuted(message.muted);
          break;
        }
        case 'DETECTOR_LOG':
          const filterLogs = ['[M3U8]'];
          const log = message.payload;
          if (typeof log === 'string' && filterLogs.some(f => log.includes(f))) {
            // console.log('[Detector]', log);
          }
          break;
        case 'PAGE_INFO':
          break;
        case 'BLOB_BUFFERING': {
          const { blobUrl, bytesBuffered } = message.payload;
          const previewInfo = activeBlobPreviewMap.current.get(blobUrl);
          if (previewInfo) {
            setBlobPreviewProgress({
              bytesReceived: bytesBuffered,
              totalBytes: previewInfo.totalSize,
            });
            break;
          }
          const info = activeBlobMap.current.get(blobUrl);
          if (info) {
            updateBlobProgress(info.downloadId, bytesBuffered, info.totalSize);
          }
          break;
        }
        case 'BLOB_DATA_START': {
          const { blobUrl, totalSize } = message.payload;
          const previewInfo = activeBlobPreviewMap.current.get(blobUrl);
          if (previewInfo) {
            blobPreviewChunksMap.current.set(blobUrl, []);
            previewInfo.totalSize = totalSize;
            setBlobPreviewProgress({ bytesReceived: 0, totalBytes: totalSize });
            break;
          }
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
          const previewInfo = activeBlobPreviewMap.current.get(blobUrl);
          if (previewInfo) {
            const chunks = blobPreviewChunksMap.current.get(blobUrl);
            if (chunks) {
              chunks.push(data);
              const CHUNK_BYTES = 768 * 1024;
              setBlobPreviewProgress({
                bytesReceived: Math.min((index + 1) * CHUNK_BYTES, previewInfo.totalSize),
                totalBytes: previewInfo.totalSize,
              });
            }
            break;
          }
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
          const { blobUrl } = message.payload;
          const previewInfo = activeBlobPreviewMap.current.get(blobUrl);
          if (previewInfo) {
            const chunks = blobPreviewChunksMap.current.get(blobUrl) || [];
            const wasCancelled = !!previewInfo.cancelled;
            blobPreviewChunksMap.current.delete(blobUrl);
            activeBlobPreviewMap.current.delete(blobUrl);
            webViewRefs.current[previewInfo.tabId]?.injectJavaScript(
              'window.__extractionGuardCount = Math.max(0, (window.__extractionGuardCount||0) - 1); true;',
            );
            finalizeExtractionForTab(previewInfo.tabId);
            if (wasCancelled) break;
            if (chunks.length === 0) {
              setBlobPreviewError('No video data was captured.');
              break;
            }
            const cacheDir = FileSystem.cacheDirectory;
            if (!cacheDir) {
              setBlobPreviewError('No cache directory available.');
              break;
            }
            const tempPath = `${cacheDir}preview_${previewInfo.previewId}.mp4`;
            previewTempFileRef.current = tempPath;
            FileSystem.writeAsStringAsync(tempPath, chunks.join(''), {
              encoding: FileSystem.EncodingType.Base64,
            })
              .then(() => {
                setBlobPreviewProgress(null);
                setPreviewVideo(prev =>
                  prev && prev.url === previewInfo.video.url
                    ? { ...prev, localUri: tempPath }
                    : prev,
                );
              })
              .catch(err => {
                console.warn('[BrowserScreen] preview write failed:', err);
                setBlobPreviewError(err?.message || 'Failed to save preview file.');
              });
            break;
          }
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
          const previewInfo = activeBlobPreviewMap.current.get(blobUrl);
          if (previewInfo) {
            blobPreviewChunksMap.current.delete(blobUrl);
            activeBlobPreviewMap.current.delete(blobUrl);
            webViewRefs.current[previewInfo.tabId]?.injectJavaScript(
              'window.__extractionGuardCount = Math.max(0, (window.__extractionGuardCount||0) - 1); true;',
            );
            finalizeExtractionForTab(previewInfo.tabId);
            setBlobPreviewError(message.payload?.error || 'Failed to extract blob video data.');
            break;
          }
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
          // console.log(`[BrowserScreen] EXTRACTION_LINK_CLICK on tab ${tabId}: ${href}`);
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
      if (video.type === 'dash') {
        Alert.alert(
          'DASH Stream',
          'DASH streams cannot be downloaded directly. Use Preview to watch it.',
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

  // const handleLoadStart = useCallback((tabId: string) => () => {
  //   setDetectedVideosMap(prev => {
  //     const existing = prev[tabId];
  //     // Avoid re-renders when there's nothing to clear.
  //     if (!existing || existing.length === 0) return prev;
  //     return { ...prev, [tabId]: [] };
  //   });
  //   setBannerDismissedMap(prev => {
  //     if (prev[tabId] === false || prev[tabId] === undefined) return prev;
  //     return { ...prev, [tabId]: false };
  //   });
  // }, []);

  // Stable wrappers so memoized children don't invalidate on every render.
  const handleGoBackActive = useCallback(() => { handleGoBack(activeTabId); }, [handleGoBack, activeTabId]);
  const handleGoForwardActive = useCallback(() => { handleGoForward(activeTabId); }, [handleGoForward, activeTabId]);
  const handleReloadActive = useCallback(() => { webViewRefs.current[activeTabId]?.reload(); }, [activeTabId]);
  const setWebViewRef = useCallback((tabId: string, ref: WebView | null) => {
    webViewRefs.current[tabId] = ref;
  }, []);

  // Clean up local refs/state when tabs are removed from the store.
  useEffect(() => {
    const tabIds = new Set(tabs.map(t => t.id));
    for (const id of Object.keys(webViewRefs.current)) {
      if (!tabIds.has(id)) {
        delete webViewRefs.current[id];
        delete isHistoryNavRef.current[id];
        setDetectedVideosMap(prev => { const next = { ...prev }; delete next[id]; return next; });
        setBannerDismissedMap(prev => { const next = { ...prev }; delete next[id]; return next; });
      }
    }
  }, [tabs]);

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
          handleShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
        />

        <VideoDetectedBanner
          visible={!isVideoPlaying && !activeBannerDismissed}
          videos={activeDetectedVideos}
          onPreview={handlePreviewVideo}
          onOpenInTab={(video) => addTab(video.url)}
          onDismiss={() => setBannerDismissedMap(prev => ({ ...prev, [activeTabId]: true }))}
          onToggleFullscreen={handleToggleFullscreen}
        />

        {isVideoPlaying && (
          <VideoPlayerController
            headerTitle={navbarTitle}
            onMinimize={handleToggleFullscreen}
            currentTime={liveCurrentTime}
            duration={liveDuration}
            isPaused={liveIsPaused}
            isMuted={liveIsMuted}
            onTogglePlay={injectLiveTogglePlay}
            onToggleMute={injectLiveToggleMute}
            onSeek={injectLiveSeek}
            onSkipBack={injectLiveSkipBack}
            onSkipForward={injectLiveSkipForward}
          />
        )}
      </View>

      <VideoPreviewModal
        visible={previewVideo !== null}
        video={previewVideo}
        onDownload={handleDownload}
        onClose={handleClosePreview}
        blobPreviewProgress={blobPreviewProgress}
        blobPreviewError={blobPreviewError}
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
      tabTrigger={<TabBarContainer />}
    />
  );
}
const AddressBarContainer = React.memo(AddressBarContainerInner);

interface WebViewListProps {
  setWebViewRef: (tabId: string, ref: WebView | null) => void;
  handleMessage: (tabId: string) => (event: { nativeEvent: { data: string } }) => void;
  handleNavigationStateChange: (tabId: string) => (navState: WebViewNavigation) => void;
  handleShouldStartLoadWithRequest: (tabId: string) => (request: ShouldStartLoadRequest) => boolean;
}

function WebViewListInner({
  setWebViewRef,
  handleMessage,
  handleNavigationStateChange,
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
            handleShouldStartLoadWithRequest={handleShouldStartLoadWithRequest(tab.id)}
          />
        </View>
      ))}
    </View>
  );
}
const WebViewList = React.memo(WebViewListInner);
