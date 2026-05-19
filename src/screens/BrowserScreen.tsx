import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, StatusBar, Alert, ActivityIndicator, AppState, BackHandler } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
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
import { useAdActions } from '../store/adStore';
import {
  useActiveTab,
  useActiveTabId,
  useIsTabsReady,
  useTabActions,
  useTabList,
} from '../store/tabStore';
import { DetectedVideo, HlsVariant } from '../types';
import Browser from '@/components/Browser';
import { VIDEO_DETECTOR_JS } from '../services/videoDetector';
import { AD_BLOCKER_JS } from '../services/adBlocker';
import { POPUP_BLOCKER_JS } from '../services/popupBlocker';
import PageErrorView, { PageError } from '../components/PageErrorView';
import PopupBlockedBanner from '../components/PopupBlockedBanner';
import CookieManager from '@react-native-cookies/cookies';

// Injected into the browser WebView when the user taps Preview on a stream.
// Posts the currentTime of the most-advanced playing video element.
const GET_VIDEO_TIME_JS = `(function(){try{var vids=document.querySelectorAll('video');var t=0;for(var i=0;i<vids.length;i++){if(vids[i].currentTime>t)t=vids[i].currentTime;}window.ReactNativeWebView.postMessage(JSON.stringify({type:'VIDEO_CURRENT_TIME',payload:{time:t}}));}catch(e){}})();true;`;

// Toggles fullscreen for the currently-playing video. Tries the top frame's
// own <video> elements first (existing CSS-positioning path); if none are
// playing, broadcasts to iframes via postMessage and — when an iframe replies
// that it has a playing video — makes that iframe element fullscreen (covers
// the WebView viewport). Restoration handles both paths.
const TOGGLE_FULLSCREEN_JS = `(function(){
  function rnLog(msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'DETECTOR_LOG', payload: msg})); } catch(_){}
  }
  function notifyChanged(active) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'VIDEO_FULLSCREEN_CHANGED', payload:{active:active}})); } catch(_){}
  }
  try {
    // 1. Restore path — iframe was fullscreen
    var fsIframe = document.querySelector('iframe[data-rn-fullscreen="1"]');
    if (fsIframe) {
      try { fsIframe.contentWindow.postMessage({ type: '__RN_FS_EXIT' }, '*'); } catch(_) {}
      // Un-hide everything we hid (restore the original style attribute
      // wholesale, since we may have written display:none with !important).
      var hidden = document.querySelectorAll('[data-rn-fs-hidden="1"]');
      for (var h = 0; h < hidden.length; h++) {
        hidden[h].style.cssText = hidden[h].dataset.rnFsOrigCssText || '';
        delete hidden[h].dataset.rnFsHidden;
        delete hidden[h].dataset.rnFsOrigCssText;
      }
      fsIframe.setAttribute('style', fsIframe.dataset.rnOrigStyle || '');
      delete fsIframe.dataset.rnFullscreen;
      delete fsIframe.dataset.rnOrigStyle;
      rnLog('[FULLSCREEN] iframe restored');
      notifyChanged(false);
      return;
    }
    // 2. Restore path — top-frame video was fullscreen
    var playing = document.querySelectorAll('.__rn-playing');
    if (playing.length > 0) {
      if (window.__rnVideoStateInterval) { clearInterval(window.__rnVideoStateInterval); window.__rnVideoStateInterval = null; }
      window.__removeVideoPlayingStyles && window.__removeVideoPlayingStyles();
      rnLog('[FULLSCREEN] top-frame video restored');
      notifyChanged(false);
      return;
    }
    // 3. Activate path — try top-frame videos
    var vids = document.querySelectorAll('video');
    rnLog('[FULLSCREEN] top-frame videos=' + vids.length);
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (!v.paused) {
        if (!v.dataset.rnOrigStyle) v.dataset.rnOrigStyle = v.getAttribute('style') || '';
        window.__rnPlayingParent = v.parentNode;
        window.__rnPlayingNextSibling = v.nextSibling;
        var backdrop = document.createElement('div');
        backdrop.id = '__rn-playing-backdrop';
        backdrop.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:100%!important;height:100%!important;z-index:9998!important;background:black!important;';
        v.dataset.rnOrigHadControls = v.hasAttribute('controls') ? '1' : '0';
        document.body.appendChild(backdrop);
        document.body.appendChild(v);
        v.removeAttribute('controls');
        v.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:100%!important;height:100%!important;z-index:9999!important;transform:none!important;';
        v.classList.add('__rn-playing');
        if (window.__rnVideoStateInterval) clearInterval(window.__rnVideoStateInterval);
        window.__rnVideoStateInterval = setInterval(function() {
          var el = document.querySelector('.__rn-playing');
          if (!el) { clearInterval(window.__rnVideoStateInterval); return; }
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'VIDEO_STATE',
              currentTime: el.currentTime || 0,
              duration: isFinite(el.duration) ? el.duration : 0,
              paused: el.paused,
              muted: el.muted,
            }));
          } catch(_) {}
        }, 250);
        rnLog('[FULLSCREEN] top-frame video[' + i + '] fullscreened');
        notifyChanged(true);
        return;
      }
    }
    // 4. Activate path — query iframes (with id so nested-iframe replies
    // can be mapped back to the top-level iframe).
    var iframes = document.querySelectorAll('iframe');
    rnLog('[FULLSCREEN] querying ' + iframes.length + ' iframe(s)');
    if (iframes.length === 0) return;
    var handled = false;
    var listener = function(e) {
      if (handled) return;
      if (!e.data || typeof e.data !== 'object' || e.data.type !== '__RN_FS_HAS_PLAYING') return;
      var id = e.data.id;
      if (typeof id !== 'number') return;
      var all = document.querySelectorAll('iframe');
      var iframe = all[id];
      if (!iframe) return;
      handled = true;
      window.removeEventListener('message', listener);
      // Hide every element that isn't an ancestor of the iframe. Start
      // with the iframe itself so its own direct siblings are hidden too.
      // Use setProperty(..., 'important') so page CSS with !important
      // cannot override our hide.
      var node = iframe;
      while (node && node.parentElement) {
        var siblings = node.parentElement.children;
        for (var s = 0; s < siblings.length; s++) {
          var sib = siblings[s];
          if (sib === node) continue;
          if (sib.dataset && sib.dataset.rnFsHidden === '1') continue;
          if (sib.dataset) {
            sib.dataset.rnFsHidden = '1';
            sib.dataset.rnFsOrigCssText = sib.style.cssText || '';
          }
          sib.style.setProperty('display', 'none', 'important');
        }
        node = node.parentElement;
        if (node === document.documentElement) break;
      }
      iframe.dataset.rnFullscreen = '1';
      iframe.dataset.rnOrigStyle = iframe.getAttribute('style') || '';
      iframe.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:100%!important;height:100%!important;z-index:2147483647!important;border:none!important;background:black!important;';
      rnLog('[FULLSCREEN] iframe[' + id + '] fullscreened');
      notifyChanged(true);
    };
    window.addEventListener('message', listener);
    for (var k = 0; k < iframes.length; k++) {
      try { iframes[k].contentWindow.postMessage({ type: '__RN_FS_QUERY', id: k }, '*'); } catch(_) {}
    }
    setTimeout(function() {
      if (!handled) {
        window.removeEventListener('message', listener);
        rnLog('[FULLSCREEN] no iframe responded');
      }
    }, 500);
  } catch(e) {
    rnLog('[FULLSCREEN] error: ' + e.message);
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
  const { requestDownload } = useAdActions();
  const { settings, pushHistory, setSetting } = useSettings();
  const injectedJavaScript = useMemo(() => {
    let js = VIDEO_DETECTOR_JS;
    console.log("settings.popupBlockEnabled", settings.popupBlockEnabled)
    if (settings.adBlockEnabled) js = AD_BLOCKER_JS + js;
    if (settings.popupBlockEnabled) js = POPUP_BLOCKER_JS + js;
    return js;
  }, [settings.adBlockEnabled, settings.popupBlockEnabled]);
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
  const [segmentBlobMap, setSegmentBlobMap] = useState<Record<string, Record<string, string>>>({});

  // Per-tab page-load state: progress bar + custom error page.
  interface LoadState { loading: boolean; progress: number; error: PageError | null; }
  const [loadStateMap, setLoadStateMap] = useState<Record<string, LoadState>>({});
  const updateLoadState = useCallback((tabId: string, partial: Partial<LoadState>) => {
    setLoadStateMap(prev => {
      const current = prev[tabId] ?? { loading: false, progress: 0, error: null };
      return { ...prev, [tabId]: { ...current, ...partial } };
    });
  }, []);

  const activeBlobMap = useRef<Map<string, { downloadId: string; pageTitle: string; totalSize: number; tabId: string }>>(new Map());

  // Parallel pipeline for blob *previews*: extracts the same captured bytes
  // via __extractBlobVideo, but writes them to cache (file://) instead of the
  // private downloads folder, then plays the temp file in the preview modal.
  // The extraction message handlers below check this map first so a blob being
  // previewed doesn't get treated as a download.
  const activeBlobPreviewMap = useRef<
    Map<string, { previewId: string; tabId: string; totalSize: number; video: DetectedVideo; cancelled?: boolean }>
  >(new Map());
  const previewTempFileRef = useRef<string | null>(null);

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
      // Block non-web schemes that Android dispatches via Intent to other apps
      // (intent://, fb://, twitter://, etc.). Without this, sites can force-open
      // popups in Chrome / Facebook / TikTok / etc. via Android's app links.
      const url = request.url;
      if (
        !url.startsWith('http://') &&
        !url.startsWith('https://') &&
        !url.startsWith('about:') &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:') &&
        !url.startsWith('file:') &&
        !url.startsWith('javascript:')
      ) {
        return false;
      }
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

  // Native popup handler: fires when window.open() is called from ANY frame
  // (including cross-origin iframes that our injected JS can't reach). Requires
  // setSupportMultipleWindows to be true (the default). The native side intercepts
  // the URL load in a temp WebView and dispatches this event without navigating.
  const handleOpenWindow = useCallback(
    (event: { nativeEvent: { targetUrl: string } }) => {
      if (!settings.popupBlockEnabled) return;
      const url = event.nativeEvent.targetUrl;
      if (url) setBlockedPopupUrl(url);
    },
    [settings.popupBlockEnabled, setBlockedPopupUrl],
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
  const activeSegmentBlob = segmentBlobMap[activeTabId] || {}
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

    setPreviewVideo(video);
  }, [activeTabId]);

  const handleToggleFullscreen = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(TOGGLE_FULLSCREEN_JS);
  }, [activeTabId]);

  // Each control tries the top-frame .__rn-playing video first. If none,
  // forwards the command via postMessage to the iframe that's currently
  // fullscreened (data-rn-fullscreen="1"); videoDetector inside the iframe
  // acts on its __rn-iframe-playing video (or forwards further to nested
  // iframes).
  const injectLiveTogglePlay = useCallback(() => {
    const sendTheData = `window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', payload: { src: v.src || v.currentSrc || '' } }));`
    webViewRefs.current[activeTabId]?.injectJavaScript(
      `(function(){var v=document.querySelector('.__rn-playing');if(v){${sendTheData};v.paused?v.play().catch(function(){}):v.pause();return;}var f=document.querySelector('iframe[data-rn-fullscreen="1"]');if(f){try{f.contentWindow.postMessage({type:'__RN_FS_TOGGLE_PLAY'},'*');}catch(_){}}})();true;`,
    );
  }, [activeTabId]);

  const injectLiveToggleMute = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      `(function(){var v=document.querySelector('.__rn-playing');if(v){v.muted=!v.muted;return;}var f=document.querySelector('iframe[data-rn-fullscreen="1"]');if(f){try{f.contentWindow.postMessage({type:'__RN_FS_TOGGLE_MUTE'},'*');}catch(_){}}})();true;`,
    );
  }, [activeTabId]);

  const injectLiveSeek = useCallback((time: number) => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      `(function(){var v=document.querySelector('.__rn-playing');if(v){v.currentTime=${time};return;}var f=document.querySelector('iframe[data-rn-fullscreen="1"]');if(f){try{f.contentWindow.postMessage({type:'__RN_FS_SEEK',time:${time}},'*');}catch(_){}}})();true;`,
    );
  }, [activeTabId]);

  const injectLiveSkipBack = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      `(function(){var v=document.querySelector('.__rn-playing');if(v){v.currentTime=Math.max(0,v.currentTime-10);return;}var f=document.querySelector('iframe[data-rn-fullscreen="1"]');if(f){try{f.contentWindow.postMessage({type:'__RN_FS_SKIP_BACK'},'*');}catch(_){}}})();true;`,
    );
  }, [activeTabId]);

  const injectLiveSkipForward = useCallback(() => {
    webViewRefs.current[activeTabId]?.injectJavaScript(
      `(function(){var v=document.querySelector('.__rn-playing');if(v){v.currentTime=Math.min(v.duration||0,v.currentTime+10);return;}var f=document.querySelector('iframe[data-rn-fullscreen="1"]');if(f){try{f.contentWindow.postMessage({type:'__RN_FS_SKIP_FORWARD'},'*');}catch(_){}}})();true;`,
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
            const indexExisting = existing.findIndex((v) => v.url === item.url);
            if (indexExisting !== -1) {
              existing[indexExisting] = item;
              return { ...prev, [tabId]: existing };
            }
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
          const filterLogs = ['[FULLSCREEN]'];
          const log = message.payload;
          if (typeof log === 'string' && filterLogs.some(f => log.includes(f))) {
            console.log('[Detector]', log);
          }
          break;
        case 'PAGE_INFO':
          break;
        case 'EXTRACTION_LINK_CLICK': {
          const { href } = message.payload;
          // console.log(`[BrowserScreen] EXTRACTION_LINK_CLICK on tab ${tabId}: ${href}`);
          // Park the extracting tab in the background, open link in a new tab.
          setTabHidden(tabId, true);
          addTab(href);
          break;
        }
        case 'M4S_BLOB_MATCH': {
          setSegmentBlobMap(prev => {
            const { m4sUrl, blobUrl } = message.payload
            const existing = prev[tabId] || {};
            existing[blobUrl] = m4sUrl;
            return { ...prev, [tabId]: existing }
          });
          // console.log("message.payload", message.payload)
        }
        case 'POPUP_BLOCKED': {
          const url: string = message.payload?.url;
          if (url) setBlockedPopupUrl(url);
          break;
        }
      }
    } catch (err) {
      // Ignore non-JSON messages from websites
    }
  }, [updateBlobProgress, completeBlobDownload, finalizeExtractionForTab, setTabHidden, addTab, setBlockedPopupUrl]);

  // Stable ref wrappers — Browser is memoized so its onMessage / onShouldStartLoad
  // props are frozen at mount. Reading through a ref ensures the latest handler
  // body is always invoked even when Browser doesn't re-render (e.g. hot-reload).
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;
  const stableHandleMessage = useCallback(
    (tabId: string) => (event: { nativeEvent: { data: string } }) =>
      handleMessageRef.current(tabId)(event),
    [],
  );

  const handleShouldStartLoadRef = useRef(handleShouldStartLoadWithRequest);
  handleShouldStartLoadRef.current = handleShouldStartLoadWithRequest;
  const stableHandleShouldStartLoad = useCallback(
    (tabId: string) => (request: ShouldStartLoadRequest) =>
      handleShouldStartLoadRef.current(tabId)(request),
    [],
  );

  const handleDownloadWithVariant = useCallback(
    (video: DetectedVideo, variant?: HlsVariant) => {
      requestDownload(() => {
        startDownload(video, variant);
        Alert.alert('Download Started', 'Check the Downloads tab for progress.');
      });
    },
    [startDownload, requestDownload],
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

  // Reset all per-tab video detection state for a tab. Called on refresh so the
  // banner/fullscreen/segment data doesn't leak across a page reload.
  const resetTabVideoState = useCallback((tabId: string) => {
    setDetectedVideosMap(prev => {
      if (!prev[tabId]) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setBannerDismissedMap(prev => {
      if (prev[tabId] === undefined) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setPlayingVideoUrlMap(prev => {
      if (prev[tabId] === undefined) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setSegmentBlobMap(prev => {
      if (prev[tabId] === undefined) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  // Stable wrappers so memoized children don't invalidate on every render.
  const handleGoBackActive = useCallback(() => { handleGoBack(activeTabId); }, [handleGoBack, activeTabId]);
  const handleGoForwardActive = useCallback(() => { handleGoForward(activeTabId); }, [handleGoForward, activeTabId]);
  const handleReloadActive = useCallback(() => {
    resetTabVideoState(activeTabId);
    webViewRefs.current[activeTabId]?.reload();
  }, [activeTabId, resetTabVideoState]);
  const handleRetryActive = useCallback(() => {
    resetTabVideoState(activeTabId);
    updateLoadState(activeTabId, { loading: true, progress: 0.05, error: null });
    webViewRefs.current[activeTabId]?.reload();
  }, [activeTabId, updateLoadState, resetTabVideoState]);

  const handleLoadStart = useCallback(
    (tabId: string) => () => {
      updateLoadState(tabId, { loading: true, progress: 0.05, error: null });
    },
    [updateLoadState],
  );
  const handleLoadProgress = useCallback(
    (tabId: string) => (progress: number) => {
      updateLoadState(tabId, { loading: progress < 1, progress });
    },
    [updateLoadState],
  );
  const handleLoadEnd = useCallback(
    (tabId: string) => () => {
      updateLoadState(tabId, { loading: false, progress: 1 });
    },
    [updateLoadState],
  );
  const handleLoadError = useCallback(
    (tabId: string) => (event: WebViewErrorEvent) => {
      const { url, description, code } = event.nativeEvent;
      // Ignore user-cancelled loads (e.g. a new navigation supersedes the previous one).
      if (code === -999 || code === -1) return;
      updateLoadState(tabId, {
        loading: false,
        progress: 0,
        error: { kind: 'network', url, code, description },
      });
    },
    [updateLoadState],
  );
  const handleHttpError = useCallback(
    (tabId: string) => (event: WebViewHttpErrorEvent) => {
      const { url, statusCode, description } = event.nativeEvent;
      if (statusCode < 400) return;
      // Ignore sub-resource errors (ads, images, etc.) — only fail on the main
      // frame URL so a loaded page isn't marked errored by a background request.
      const tab = getTabsSnapshot().find(t => t.id === tabId);
      if (tab && url !== tab.url && url !== tab.lastVisitedUrl) return;
      updateLoadState(tabId, {
        loading: false,
        progress: 0,
        error: { kind: 'http', url, code: statusCode, description },
      });
    },
    [updateLoadState, getTabsSnapshot],
  );

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
        setLoadStateMap(prev => { const next = { ...prev }; delete next[id]; return next; });
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

      {!isVideoPlaying && 
          <AddressBarContainer
            onNavigate={handleNavigate}
            onGoBack={handleGoBackActive}
            onGoForward={handleGoForwardActive}
            onReload={handleReloadActive}
          />}

      <View style={styles.webviewArea}>
        {tabs.find(t => t.id === activeTabId)?.url === 'about:home' && (
          <HomePage onNavigate={handleNavigate} />
        )}

        <WebViewList
          setWebViewRef={setWebViewRef}
          handleMessage={stableHandleMessage}
          handleNavigationStateChange={handleNavigationStateChange}
          handleShouldStartLoadWithRequest={stableHandleShouldStartLoad}
          handleLoadStart={handleLoadStart}
          handleLoadProgress={handleLoadProgress}
          handleLoadEnd={handleLoadEnd}
          handleLoadError={handleLoadError}
          handleHttpError={handleHttpError}
          handleOpenWindow={handleOpenWindow}
          injectedJavaScript={injectedJavaScript}
        />

        {(() => {
          const ls = loadStateMap[activeTabId];
          if (!ls?.loading || ls.progress >= 1) return null;
          return (
            <View pointerEvents="none" style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(2, ls.progress * 100)}%` }]} />
            </View>
          );
        })()}

        {loadStateMap[activeTabId]?.error && (
          <PageErrorView
            error={loadStateMap[activeTabId]!.error!}
            onRetry={handleRetryActive}
            onGoBack={handleGoBackActive}
            canGoBack={(tabs.find(t => t.id === activeTabId)?.historyIndex ?? 0) > 0}
          />
        )}

        <VideoDetectedBanner
          visible={!isVideoPlaying && !activeBannerDismissed}
          videos={activeDetectedVideos}
          playingUrl={activePlayingVideoUrl}
          segmentBlob={activeSegmentBlob}
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
            segmentBlob={activeSegmentBlob}
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
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4ECDC4',
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
  handleLoadStart: (tabId: string) => () => void;
  handleLoadProgress: (tabId: string) => (progress: number) => void;
  handleLoadEnd: (tabId: string) => () => void;
  handleLoadError: (tabId: string) => (event: WebViewErrorEvent) => void;
  handleHttpError: (tabId: string) => (event: WebViewHttpErrorEvent) => void;
  handleOpenWindow: (event: { nativeEvent: { targetUrl: string } }) => void;
  injectedJavaScript: string;
}

function WebViewListInner({
  setWebViewRef,
  handleMessage,
  handleNavigationStateChange,
  handleShouldStartLoadWithRequest,
  handleLoadStart,
  handleLoadProgress,
  handleLoadEnd,
  handleLoadError,
  handleHttpError,
  handleOpenWindow,
  injectedJavaScript,
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
              onLoadStart={handleLoadStart(tab.id)}
              onLoadProgress={handleLoadProgress(tab.id)}
              onLoadEnd={handleLoadEnd(tab.id)}
              onLoadError={handleLoadError(tab.id)}
              onHttpError={handleHttpError(tab.id)}
              onOpenWindow={handleOpenWindow}
              injectedJavaScript={injectedJavaScript}
            />
          </View>
        ))}
    </View>
  );
}
const WebViewList = React.memo(WebViewListInner);
