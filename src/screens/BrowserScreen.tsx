import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, StatusBar, Alert, ActivityIndicator, AppState, BackHandler } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';

import AddressBar from '../components/AddressBar';
import HomePage from '../components/HomePage';
import TabBarContainer from '../components/TabBarContainer';
import { useSettings, useThemeColors } from '../store/settingsStore';
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
import { DetectedVideo, HlsVariant } from '../types';
import Browser from '@/components/Browser';
import PopupBlockedBanner from '../components/PopupBlockedBanner';
import CookieManager from '@react-native-cookies/cookies';

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
  const { settings, pushHistory, setSetting } = useSettings();
  const previousUrl = useRef('');
  const navigation = useNavigation();

  // Per-tab WebView refs
  const webViewRefs = useRef<Record<string, WebView | null>>({});
  const webViewCanGoBackRef = useRef<Record<string, boolean>>({});
  const webViewCanGoForwardRef = useRef<Record<string, boolean>>({});

  // Used to hold a stream preview request while we wait for the current
  // playback time to come back from the browser WebView.
  const pendingPreviewVideoRef = useRef<DetectedVideo | null>(null);
  const pendingPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-tab video detection state
  const [detectedVideosMap, setDetectedVideosMap] = useState<Record<string, DetectedVideo[]>>({});
  const [bannerDismissedMap, setBannerDismissedMap] = useState<Record<string, boolean>>({});
  const [playingVideoUrlMap, setPlayingVideoUrlMap] = useState<Record<string, string>>({});

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

  // Popup blocker state
  const [blockedPopupUrl, setBlockedPopupUrl] = useState<string | null>(null);

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
  const activePlayingVideoUrl = playingVideoUrlMap[activeTabId] || '';
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
    const prevUrl = tab.urlHistory[tab.historyIndex - 1];
    isHistoryNavRef.current[tabId] = true;
    navigateHistory(tabId, -1);
    const webView = webViewRefs.current[tabId];
    if (webView && webViewCanGoBackRef.current[tabId]) {
      webView.goBack();
    } else {
      // Restored tabs have no native WebView history, fall back to href injection.
      injectNavigation(tabId, prevUrl);
    }
    return true;
  }, [navigateHistory, getTabsSnapshot, injectNavigation]);

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

  // Hide the bottom tab bar while a video is in fullscreen, restore on exit.
  // BrowserScreen is registered as a Tab.Screen, so its own navigation is
  // the bottom-tab navigation — setOptions there sets per-screen tab options.
  useEffect(() => {
    if (isVideoPlaying) {
      (navigation as any).setOptions({ tabBarStyle: { display: 'none' } });
      return () => {
        (navigation as any).setOptions({ tabBarStyle: undefined });
      };
    }
  }, [isVideoPlaying, navigation]);

  const handleGoForward = useCallback((tabId: string) => {
    const tab = getTabsSnapshot().find(t => t.id === tabId);
    if (!tab || tab.historyIndex >= tab.urlHistory.length - 1) return;
    const nextUrl = tab.urlHistory[tab.historyIndex + 1];
    isHistoryNavRef.current[tabId] = true;
    navigateHistory(tabId, 1);
    const webView = webViewRefs.current[tabId];
    if (webView && webViewCanGoForwardRef.current[tabId]) {
      webView.goForward();
    } else {
      injectNavigation(tabId, nextUrl);
    }
  }, [navigateHistory, getTabsSnapshot, injectNavigation]);

  const handleNavigationStateChange = useCallback((tabId: string) => (navState: WebViewNavigation) => {
    if (!navState.url) return;
    webViewCanGoBackRef.current[tabId] = navState.canGoBack ?? false;
    webViewCanGoForwardRef.current[tabId] = navState.canGoForward ?? false;

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
          const items: DetectedVideo[] = message.payload || [];
          if (items.length > 0) {
            setDetectedVideosMap(prev => {
              const existing = prev[tabId] || [];
              const existingUrls = new Set(existing.map(v => v.url));
              const newItems = items.filter(v => !existingUrls.has(v.url));
              return newItems.length > 0 ? { ...prev, [tabId]: [...existing, ...newItems] } : prev;
            });
          }
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
        case 'VIDEO_PLAYING': {
          const src: string = message.payload?.src || '';
          const m3u8Url: string = message.payload?.m3u8Url || '';
          const matchUrl = m3u8Url || src;
          if (matchUrl) {
            setPlayingVideoUrlMap(prev => ({ ...prev, [tabId]: matchUrl }));
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
          const filterLogs = ['[VIDEO_PLAYING]'];
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
        case 'POPUP_BLOCKED': {
          const popupUrl: string = message.payload?.url || '';
          if (popupUrl) {
            setBlockedPopupUrl(popupUrl);
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

  const handleDownloadWithVariant = useCallback(
    (video: DetectedVideo, variant?: HlsVariant) => {
      startDownload(video, variant);
      Alert.alert('Download Started', 'Check the Downloads tab for progress.');
    },
    [startDownload],
  );


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
        delete webViewCanGoBackRef.current[id];
        delete webViewCanGoForwardRef.current[id];
        setDetectedVideosMap(prev => { const next = { ...prev }; delete next[id]; return next; });
        setBannerDismissedMap(prev => { const next = { ...prev }; delete next[id]; return next; });
      }
    }
  }, [tabs]);

  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const barStyle = c.background === '#000000' || c.background === '#1C1C1E' ? 'light-content' : 'dark-content';

  if (!isReady) {
    return (
      <View style={[styles.container, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <StatusBar barStyle={barStyle} backgroundColor={c.addressBar} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4ECDC4" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: insets.top, marginBottom: -15 }]}>
      <StatusBar barStyle={barStyle} backgroundColor={c.addressBar} />

      <AddressBarContainer
        onNavigate={handleNavigate}
        onGoBack={handleGoBackActive}
        onGoForward={handleGoForwardActive}
        onReload={handleReloadActive}
      />

      <View style={styles.webviewArea}>
        {tabs.find(t => t.id === activeTabId)?.url === 'about:home' && (
          <HomePage onNavigate={handleNavigate} />
        )}

        <WebViewList
          setWebViewRef={setWebViewRef}
          handleMessage={handleMessage}
          handleNavigationStateChange={handleNavigationStateChange}
          handleShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          adBlockEnabled={settings.adBlockEnabled}
          popupBlockEnabled={settings.popupBlockEnabled}
        />

        <VideoDetectedBanner
          visible={!isVideoPlaying && !activeBannerDismissed}
          videos={activeDetectedVideos}
          playingUrl={activePlayingVideoUrl}
          position={settings.videoBannerPosition}
          onPreview={handlePreviewVideo}
          onDownload={handleDownloadWithVariant}
          onDismiss={() => setBannerDismissedMap(prev => ({ ...prev, [activeTabId]: true }))}
          onToggleFullscreen={handleToggleFullscreen}
          onChangePosition={(position) => setSetting('videoBannerPosition', position)}
        />

        {isVideoPlaying && (
          <VideoPlayerController
            headerTitle={navbarTitle}
            onMinimize={handleToggleFullscreen}
            playingUrl={activePlayingVideoUrl}
            videos={activeDetectedVideos}
            onDownloadVariant={handleDownloadWithVariant}
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

      {blockedPopupUrl && (
        <PopupBlockedBanner
          url={blockedPopupUrl}
          onAllow={() => {
            const url = blockedPopupUrl;
            setBlockedPopupUrl(null);
            addTab(url);
          }}
          onDismiss={() => setBlockedPopupUrl(null)}
        />
      )}

      <VideoPreviewModal
        visible={previewVideo !== null}
        video={previewVideo}
        onDownload={handleDownload}
        onClose={handleClosePreview}
        blobPreviewProgress={blobPreviewProgress}
        blobPreviewError={blobPreviewError}
      />

    </View>
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
  const { bookmarks, addBookmark, removeBookmark } = useSettings();

  const currentBookmark = bookmarks.find((b) => b.url === activeTab.url);

  const handleToggleBookmark = useCallback(() => {
    if (currentBookmark) {
      removeBookmark(currentBookmark.id);
    } else {
      addBookmark({ title: activeTab.title || activeTab.url, url: activeTab.url });
    }
  }, [currentBookmark, activeTab, addBookmark, removeBookmark]);

  const showBookmark = activeTab.url !== 'about:home';

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
      isBookmarked={!!currentBookmark}
      onToggleBookmark={showBookmark ? handleToggleBookmark : undefined}
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
  adBlockEnabled: boolean;
  popupBlockEnabled: boolean;
}

function WebViewListInner({
  setWebViewRef,
  handleMessage,
  handleNavigationStateChange,
  handleShouldStartLoadWithRequest,
  adBlockEnabled,
  popupBlockEnabled,
}: WebViewListProps) {
  const tabs = useTabList();
  const activeTabId = useActiveTabId();
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Tabs whose WebView has been mounted at least once. Starts with just the
  // active tab so background tabs are not loaded on startup.
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(
    () => new Set(activeTabId ? [activeTabId] : []),
  );

  useEffect(() => {
    if (!activeTabId) return;
    setMountedTabIds(prev => {
      if (prev.has(activeTabId)) return prev;
      const next = new Set(prev);
      next.add(activeTabId);
      return next;
    });
  }, [activeTabId]);

  // True once cookies have been saved + cleared and incognito WebViews can mount.
  const [incognitoReady, setIncognitoReady] = useState(false);
  // True while regular tabs must stay unmounted (cookies cleared globally for incognito).
  // Without this, switching to a regular tab during an incognito session would show
  // the page running with no cookies — i.e. logged-out, even though session cookies
  // were saved and will be restored when incognito closes.
  const [regularTabsHidden, setRegularTabsHidden] = useState(false);
  // Saved cookies: { origin → [ {name, value} ] }
  // Only name+value are stored — the library uses the origin's host as domain,
  // avoiding null-domain issues that cause silent set() failures on Android.
  const savedCookiesRef = useRef<Record<string, Array<{ name: string; value: string }>> | null>(null);

  const incognitoCount = tabs.filter(t => t.incognito && !t.hidden).length;

  useEffect(() => {
    const hasIncognito = incognitoCount > 0;
    const hadIncognito = savedCookiesRef.current !== null;

    if (hasIncognito && !hadIncognito) {
      // Collect every unique origin visited by regular tabs so we can snapshot
      // their cookies. getAll() is iOS-only; on Android we fetch per-origin.
      const origins = new Set<string>();
      tabsRef.current.forEach(tab => {
        if (!tab.incognito) {
          (tab.urlHistory ?? [tab.url]).forEach(u => {
            try {
              const { origin } = new URL(u);
              if (origin && origin !== 'null') origins.add(origin);
            } catch {}
          });
        }
      });

      const originList = [...origins];
      // console.log('[Incognito] >>> SAVE START — scanning origins:', originList);
      // allSettled so one failing origin doesn't abort the whole save.
      Promise.allSettled(originList.map(o => CookieManager.get(o, false)))
        .then(results => {
          const saved: Record<string, Array<{ name: string; value: string }>> = {};
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
              const cookieNames = Object.keys(r.value);
              // console.log('[Incognito] get(', originList[i], ') →', cookieNames.length, 'cookies:', cookieNames);
              const pairs = Object.values(r.value)
                .filter(c => c.name && c.value)
                .map(c => ({ name: c.name, value: c.value }));
              if (pairs.length > 0) saved[originList[i]] = pairs;
            } else {
              console.warn('[Incognito] get(', originList[i], ') REJECTED:', r.reason);
            }
          });
          const total = Object.values(saved).reduce((s, c) => s + c.length, 0);
          if (total === 0 && originList.length > 0) {
            // console.warn('[Incognito] !!! 0 cookies captured. The native patch is not in the build. Run: npx expo run:android');
          } else {
            // console.log('[Incognito] SAVED', total, 'cookies across', Object.keys(saved).length, 'origins');
          }
          savedCookiesRef.current = saved;
          return CookieManager.clearAll(false);
        })
        .then(() => {
          // console.log('[Incognito] clearAll done — incognito WebView can mount, regular tabs hidden');
          setIncognitoReady(true);
          setRegularTabsHidden(true);
        })
        .catch((e: unknown) => {
          // console.warn('[Incognito] save pipeline failed:', e);
          savedCookiesRef.current = {};
          setIncognitoReady(true);
          setRegularTabsHidden(true);
        });
    } else if (!hasIncognito && hadIncognito) {
      // Last incognito tab closed: restore regular cookies directly.
      // We use setFromResponse (raw Set-Cookie string) instead of set() because
      // set() unconditionally adds a Domain attribute, and Chromium rejects
      // __Host- prefixed cookies that carry a Domain. Building the Set-Cookie
      // header ourselves lets us omit Domain (making cookies host-only) and
      // include Secure for __Host-/__Secure- prefixes — both required by spec.
      setIncognitoReady(false);
      const saved = savedCookiesRef.current!;
      savedCookiesRef.current = null;
      const totalToRestore = Object.values(saved).reduce((s, c) => s + c.length, 0);
      // console.log('[Incognito] >>> RESTORE START —', totalToRestore, 'cookies across', Object.keys(saved).length, 'origins');
      const buildSetCookie = (origin: string, name: string, value: string): string => {
        const parts = [`${name}=${value}`, 'Path=/'];
        if (origin.startsWith('https://')) parts.push('Secure');
        return parts.join('; ');
      };
      Promise.all(
        Object.entries(saved).flatMap(([origin, cookies]) =>
          cookies.map(cookie =>
            CookieManager.setFromResponse(origin, buildSetCookie(origin, cookie.name, cookie.value))
              .then(success => {
                // if (!success) console.warn('[Incognito] REJECTED', cookie.name, 'on', origin);
                return success;
              })
              .catch((e: unknown) => {
                // console.warn('[Incognito] failed to restore', cookie.name, 'on', origin, e);
                return false;
              }),
          ),
        ),
      )
        .then(results => {
          const ok = results.filter(r => r === true).length;
          // console.log('[Incognito] RESTORE done —', ok, '/', results.length, 'cookies accepted');
          return CookieManager.flush();
        })
        .then(() => {
          // console.log('[Incognito] flush done — regular tabs can remount');
          setRegularTabsHidden(false);
        })
        .catch((e: unknown) => {
          // console.warn('[Incognito] restore pipeline failed:', e);
          setRegularTabsHidden(false);
        });
    }
  }, [incognitoCount]);

  return (
    <View style={styles.webviewContainer}>
      {tabs
        .filter(tab => {
          if (tab.url === 'about:home') return false;
          // Defer mounting until the tab is first activated.
          if (!mountedTabIds.has(tab.id)) return false;
          // Incognito tab: only mount once cookies have been saved + cleared.
          if (tab.incognito) return incognitoReady;
          // Regular tab: keep unmounted while the global cookie jar is wiped
          // for an incognito session, otherwise the WebView would run with no
          // cookies and show a logged-out state.
          return !regularTabsHidden;
        })
        .map(tab => (
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
              adBlockEnabled={adBlockEnabled}
              popupBlockEnabled={popupBlockEnabled}
            />
          </View>
        ))}
    </View>
  );
}
const WebViewList = React.memo(WebViewListInner);
