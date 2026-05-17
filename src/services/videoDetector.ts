/**
 * JavaScript code injected into the WebView to detect <video> elements
 * and extract their source URLs. Uses MutationObserver for dynamic content.
 */
export const MATCHING_M4S = `
  var m4sToBlob = {};
  var blobToM4s = {};

  function findPlayingBlobUrl() {
    try {
      var vids = document.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        var vsrc = v.currentSrc || v.src || '';
        if (vsrc.indexOf('blob:') === 0 && !v.paused && v.readyState > 0) {
          return vsrc;
        }
      }
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        var vsrc = v.currentSrc || v.src || '';
        if (vsrc.indexOf('blob:') === 0) {
          return vsrc;
        }
      }
    } catch(e) {}
    return '';
  }

  function trackM4sRequest(rawUrl) {
    var blobUrl = findPlayingBlobUrl();
    if (!blobUrl) return;
    var absUrl = rawUrl;
    try { absUrl = new URL(rawUrl, window.location.href).href; } catch(e) {}
    if (m4sToBlob[absUrl] === blobUrl) return;
    m4sToBlob[absUrl] = blobUrl;
    if (!blobToM4s[blobUrl]) blobToM4s[blobUrl] = [];
    if (blobToM4s[blobUrl].indexOf(absUrl) === -1) {
      blobToM4s[blobUrl].push(absUrl);
    }
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'M4S_BLOB_MATCH',
          payload: { m4sUrl: absUrl, blobUrl: blobUrl }
        }));
      }
    } catch(e) {}
  }

  window.__getM4sForBlob = function(blobUrl) {
    return blobToM4s[blobUrl] || [];
  };

  window.__getBlobForM4s = function(m4sUrl) {
    var abs = m4sUrl;
    try { abs = new URL(m4sUrl, window.location.href).href; } catch(e) {}
    return m4sToBlob[abs] || '';
  };
`

export const VIDEO_DETECTOR_JS = `
(function() {
  'use strict';
  
  ${MATCHING_M4S}
  // Prevent double-injection
  if (window.__VIDEO_DETECTOR_INSTALLED__) return;
  window.__VIDEO_DETECTOR_INSTALLED__ = true;

  // Cross-frame fullscreen coordination. The top frame broadcasts
  // __RN_FS_QUERY with an id identifying which top-level iframe was
  // queried. Each frame either replies (if it has a playing video)
  // directly to window.top — echoing the id so the top frame knows
  // which iframe to fullscreen — or forwards the query down to its
  // own child iframes (handling arbitrary nesting depth).
  try {
    window.addEventListener('message', function(e) {
      if (!e || !e.data || typeof e.data !== 'object') return;
      if (e.data.type !== '__RN_FS_QUERY') return;
      var queryId = e.data.id;
      var vids = document.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) {
        if (!vids[i].paused) {
          try { window.top.postMessage({ type: '__RN_FS_HAS_PLAYING', id: queryId }, '*'); } catch(_) {}
          return;
        }
      }
      var iframes = document.querySelectorAll('iframe');
      for (var j = 0; j < iframes.length; j++) {
        try { iframes[j].contentWindow.postMessage({ type: '__RN_FS_QUERY', id: queryId }, '*'); } catch(_) {}
      }
    });
  } catch(e) {}

  const SCAN_INTERVAL_MS = 500;
  const detectedUrls = new Set();
  var lastM3u8Url = '';

  // ---- Extraction guard (SPA click interceptor + visibility shield) ----
  // RN bumps __extractionGuardCount when a blob download starts and decrements
  // when it ends. While it's > 0:
  //   1. In-page anchor clicks that would navigate the top frame are
  //      intercepted in the capture phase, so the page's own click handlers
  //      (e.g. Twitter's pushState routing) never run and the video element
  //      stays mounted.
  //   2. document.hidden / visibilityState are forced to "visible" and
  //      visibilitychange events are swallowed. Without this, when the tab
  //      gets parked in the background after a click, Android WebView fires
  //      Page Visibility, the page pauses video playback, MSE buffering
  //      stops, and the extraction's waitForReady poll spins forever at the
  //      same byte count.
  window.__extractionGuardCount = window.__extractionGuardCount || 0;
  try {
    var __origHiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    var __origVisStateDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: function() {
        if ((window.__extractionGuardCount || 0) > 0) return false;
        return __origHiddenDesc && __origHiddenDesc.get
          ? __origHiddenDesc.get.call(document) : false;
      }
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: function() {
        if ((window.__extractionGuardCount || 0) > 0) return 'visible';
        return __origVisStateDesc && __origVisStateDesc.get
          ? __origVisStateDesc.get.call(document) : 'visible';
      }
    });
    document.addEventListener('visibilitychange', function(e) {
      if ((window.__extractionGuardCount || 0) > 0) {
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        e.stopPropagation();
      }
    }, true);
  } catch (err) {}
  try {
    document.addEventListener('click', function(e) {
      if ((window.__extractionGuardCount || 0) <= 0) return;
      var el = e.target;
      while (el && el.nodeType === 1) {
        if (el.tagName === 'A' && el.href) break;
        el = el.parentElement;
      }
      if (!el || !el.href) return;
      var href = el.href;
      try {
        var linkUrl = new URL(href, location.href);
        var curUrl = new URL(location.href);
        if (linkUrl.href === curUrl.href) return;
        if (linkUrl.origin === curUrl.origin &&
            linkUrl.pathname === curUrl.pathname &&
            linkUrl.search === curUrl.search) return; // hash-only
      } catch (err) {}
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'EXTRACTION_LINK_CLICK',
          payload: { href: href }
        }));
      } catch (err) {}
    }, true);
  } catch (err) {}

  // Keep video elements playing while extraction is active. A paused video
  // stops requesting MSE segments (Twitter's player pauses when out of view
  // or after another video starts playing). Muting prevents audio-focus
  // conflict with whatever's loading in the visible foreground tab.
  setInterval(function() {
    if ((window.__extractionGuardCount || 0) <= 0) return;
    try {
      var vids = document.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        try {
          v.muted = true;
          if (v.preload !== 'auto') v.preload = 'auto';
          if (v.paused && v.readyState > 0) {
            var p = v.play();
            if (p && typeof p.catch === 'function') p.catch(function(){});
          }
        } catch (err2) {}
      }
    } catch (err) {}
  }, 1000);
  // ---------------------------------------------------------------------

  function log(msg) {
    // console.log('[VideoDetector] ' + msg);
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'DETECTOR_LOG',
          payload: msg
        }));
      }
    } catch(e) {}
  }

  window.__removeVideoPlayingStyles = function() {
    try {
      var vids = document.querySelectorAll('.__rn-playing');
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        var parent = window.__rnPlayingParent;
        var sibling = window.__rnPlayingNextSibling;
        try { v.pause(); } catch(_) {}
        var backdrop = document.getElementById('__rn-playing-backdrop');
        if (backdrop) backdrop.parentNode.removeChild(backdrop);
        if (parent) {
          if (sibling && sibling.parentNode === parent) {
            parent.insertBefore(v, sibling);
          } else {
            parent.appendChild(v);
          }
          window.__rnPlayingParent = null;
          window.__rnPlayingNextSibling = null;
        }
        if (v.dataset.rnOrigHadControls === '0') v.removeAttribute('controls');
        v.setAttribute('style', v.dataset.rnOrigStyle || '');
        v.classList.remove('__rn-playing');
        delete v.dataset.rnOrigStyle;
      }
    } catch(e) {}
  };

  function classifyUrl(url) {
    if (!url) return 'unknown';
    var lower = url.toLowerCase();
    if (lower.startsWith('blob:')) return 'blob';
    if (lower.includes('.m3u8') || lower.includes('m3u8')) return 'hls';
    if (lower.includes('.mpd') || lower.includes('application/dash')) return 'dash';
    // .m4s files are DASH segment fragments — not standalone videos, skip them
    if (lower.includes('.m4s')) return 'unknown';
    if (lower.includes('.mp4') || lower.includes('video/mp4')) return 'mp4';
    if (lower.includes('.webm') || lower.includes('video/webm')) return 'webm';
    // x.com / Twitter video CDN often serves mp4 without .mp4 extension
    if (lower.includes('video.twimg.com') && !lower.includes('.m3u8')) return 'mp4';
    return 'unknown';
  }

  function isDownloadable(type) {
    return type === 'mp4' || type === 'webm';
  }

  function toAbsoluteUrl(url) {
    if (!url) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch(e) {
      return url;
    }
  }

  function extractVideoSources(videoEl) {
    var sources = [];

    // Direct src attribute
    if (videoEl.src && videoEl.src.trim() !== '') {
      sources.push(videoEl.src);
    }

    // currentSrc (the actually-playing source)
    if (videoEl.currentSrc && videoEl.currentSrc.trim() !== '') {
      sources.push(videoEl.currentSrc);
    }

    // <source> child elements
    var sourceEls = videoEl.querySelectorAll('source');
    for (var i = 0; i < sourceEls.length; i++) {
      if (sourceEls[i].src && sourceEls[i].src.trim() !== '') {
        sources.push(sourceEls[i].src);
      }
    }

    return sources;
  }

  function sendDetectedVideos(urls, source) {
    var newVideos = [];
    for (var i = 0; i < urls.length; i++) {
      var url = toAbsoluteUrl(urls[i]);
      if (!detectedUrls.has(url)) {
        detectedUrls.add(url);
        var type = classifyUrl(url);
        if (type === 'hls') lastM3u8Url = url;
        log('[DETECTED] (' + (source || 'scan') + ') type=' + type + ' url=' + url.substring(0, 150));
        newVideos.push({
          url: url,
          type: type,
          downloadable: isDownloadable(type),
          pageUrl: window.location.href,
          pageTitle: document.title,
          timestamp: Date.now(),
          cookies: document.cookie || ''
        });
      }
    }

    if (newVideos.length > 0 && window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      log('[SENDING] ' + newVideos.length + ' new video(s) to RN');
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'VIDEO_DETECTED',
        payload: newVideos
      }));
    }
  }
  
  // Parse M3U8 attribute string like: KEY="value",KEY2=value2
  function parseM3U8Attributes(attrStr) {
    var result = {};
    var pos = 0;
    var len = attrStr.length;
    while (pos < len) {
      // Skip whitespace and commas
      while (pos < len && (attrStr.charAt(pos) === ',' || attrStr.charAt(pos) === ' ')) pos++;
      if (pos >= len) break;
      // Read key
      var eqIdx = attrStr.indexOf('=', pos);
      if (eqIdx === -1) break;
      var key = attrStr.substring(pos, eqIdx).trim();
      pos = eqIdx + 1;
      // Read value (quoted or unquoted)
      var value = '';
      if (pos < len && attrStr.charAt(pos) === '"') {
        pos++; // skip opening quote
        var closeQuote = attrStr.indexOf('"', pos);
        if (closeQuote === -1) closeQuote = len;
        value = attrStr.substring(pos, closeQuote);
        pos = closeQuote + 1;
      } else {
        var commaIdx = attrStr.indexOf(',', pos);
        if (commaIdx === -1) commaIdx = len;
        value = attrStr.substring(pos, commaIdx).trim();
        pos = commaIdx;
      }
      result[key] = value;
    }
    return result;
  }
  // ==============================================
  
  // ===== M3U8 PLAYLIST PARSE (from intercepted responses) =====
  var m3u8Parsed = {};
  function parseM3U8Content(m3u8Url, text) {
    log('[M3U8] m3u8Url :' + JSON.stringify(m3u8Url) )
    if (!text || m3u8Parsed[m3u8Url]) return;
    m3u8Parsed[m3u8Url] = true;

    var isMaster = text.indexOf('#EXT-X-STREAM-INF') !== -1;
    var variants = [];
    var audioTracks = [];
    var subtitleTracks = [];

    if (isMaster) {
      // === MASTER PLAYLIST: parse variants and media tracks ===
      log('[M3U8] Parsing master playlist (' + text.length + ' chars) from ' + m3u8Url.substring(0, 100));
      var lines = text.split(String.fromCharCode(10));
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('#EXT-X-MEDIA:') === 0) {
          var mediaAttrs = parseM3U8Attributes(line.substring(13));
          var track = {
            type: mediaAttrs['TYPE'] || '',
            groupId: mediaAttrs['GROUP-ID'] || '',
            name: mediaAttrs['NAME'] || '',
            language: mediaAttrs['LANGUAGE'] || undefined,
            uri: mediaAttrs['URI'] || undefined,
            default: mediaAttrs['DEFAULT'] === 'YES',
            autoselect: mediaAttrs['AUTOSELECT'] === 'YES'
          };
          if (track.type === 'AUDIO') audioTracks.push(track);
          else if (track.type === 'SUBTITLES') subtitleTracks.push(track);
        }
        if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
          var attrs = parseM3U8Attributes(line.substring(18));
          var variantUri = '';
          for (var j = i + 1; j < lines.length; j++) {
            var nextLine = lines[j].trim();
            if (nextLine && nextLine.charAt(0) !== '#') {
              variantUri = nextLine;
              break;
            }
          }
          variants.push({
            bandwidth: parseInt(attrs['BANDWIDTH'] || '0', 10),
            averageBandwidth: attrs['AVERAGE-BANDWIDTH'] ? parseInt(attrs['AVERAGE-BANDWIDTH'], 10) : undefined,
            resolution: attrs['RESOLUTION'] || undefined,
            codecs: attrs['CODECS'] || undefined,
            audio: attrs['AUDIO'] || undefined,
            subtitles: attrs['SUBTITLES'] || undefined,
            uri: variantUri
          });
        }
      }
      log('[M3U8] Parsed master: ' + variants.length + ' variants, ' + audioTracks.length + ' audio, ' + subtitleTracks.length + ' subs');
    }

    var mediaSegments = [];
    var mediaTargetDuration = 0;
    var mediaSequence = 0;
    if (!isMaster) {
      // === MEDIA PLAYLIST: parse segment list ===
      log('[M3U8] Parsing media playlist (' + text.length + ' chars) from ' + m3u8Url.substring(0, 100));
      var mLines = text.split(String.fromCharCode(10));
      var pendingDuration = 0;
      for (var mi = 0; mi < mLines.length; mi++) {
        var mLine = mLines[mi].trim();
        if (mLine.indexOf('#EXT-X-TARGETDURATION:') === 0) {
          mediaTargetDuration = parseInt(mLine.substring(22), 10);
        } else if (mLine.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
          mediaSequence = parseInt(mLine.substring(22), 10);
        } else if (mLine.indexOf('#EXTINF:') === 0) {
          pendingDuration = parseFloat(mLine.substring(8));
        } else if (mLine && mLine.charAt(0) !== '#') {
          mediaSegments.push({ uri: mLine, duration: pendingDuration });
          pendingDuration = 0;
        }
      }
      log('[M3U8] Parsed media: ' + mediaSegments.length + ' segments, targetDuration=' + mediaTargetDuration + ', seq=' + mediaSequence);
    }

    // Send for master playlists with tracks/variants, or any media playlist
    if (variants.length > 0 || audioTracks.length > 0 || subtitleTracks.length > 0 || !isMaster) {
      lastM3u8Url = m3u8Url;
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'M3U8_INFO',
          payload: {
            url: m3u8Url,
            type: 'hls',
            pageUrl: window.location.href,
            pageTitle: document.title,
            timestamp: Date.now(),
            cookies: document.cookie || '',
            hlsInfo: {
              url: m3u8Url,
              isMaster: isMaster,
              variants: variants,
              audioTracks: audioTracks,
              subtitleTracks: subtitleTracks,
              mediaSegments: isMaster ? undefined : mediaSegments,
              mediaTargetDuration: isMaster ? undefined : mediaTargetDuration,
              mediaSequence: isMaster ? undefined : mediaSequence
            }
          }
        }));
      }
    }
  }

  function isM3U8Url(url) {
    return url && url.toLowerCase().indexOf('.m3u8') !== -1;
  }

  // Per-element loadedmetadata listener: fires when the browser confirms
  // currentSrc is actually playable. If the element's URL changed since it
  // was first detected (e.g. quality negotiation, redirect, signed-URL refresh),
  // report the updated URL and signal RN to replace the stale one.
  function attachVideoListeners(vEl) {
    if (vEl.__detectorAttached) return;
    vEl.__detectorAttached = true;
    vEl.addEventListener('loadedmetadata', function() {
      try {
        var cur = vEl.currentSrc;
        if (!cur || cur.trim() === '') return;
        var url = toAbsoluteUrl(cur);
        var prev = vEl.__detectorLastUrl || null;
        if (url === prev) return;
        vEl.__detectorLastUrl = url;
        var type = classifyUrl(url);
        if (type === 'unknown') return;
        if (!detectedUrls.has(url)) detectedUrls.add(url);
        var payload = {
          url: url, type: type, downloadable: isDownloadable(type),
          pageUrl: window.location.href, pageTitle: document.title,
          timestamp: Date.now(), cookies: document.cookie || ''
        };
        if (prev && prev !== url) payload.replacesUrl = prev;
        log('[SENDING] confirmed url=' + url.substring(0, 100) + (prev && prev !== url ? ' replaces=' + prev.substring(0, 80) : ''));
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'VIDEO_DETECTED',
          payload: [payload]
        }));
      } catch(e) {}
    });
    vEl.addEventListener('play', function() {
      var src = vEl.currentSrc || vEl.src || '';
      log('[VIDEO_PLAYING] src=' + src.substring(0, 120) + ' lastM3u8Url=' + lastM3u8Url.substring(0, 120));
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', payload: { src: src } }));
    });
    // If already playing when listener was attached (first-load race), report immediately
    if (!vEl.paused && (vEl.currentSrc || vEl.src)) {
      var src = vEl.currentSrc || vEl.src || '';
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', payload: { src: src } }));
    }
  }

  var scanCount = 0;
  function scanForVideos() {
    var videos = document.querySelectorAll('video');
    // Only log first scan or when videos found, to avoid flooding
    if (scanCount === 0 || videos.length > 0) {
      log('[SCAN #' + scanCount + '] Found ' + videos.length + ' <video> element(s) on page');
    }
    scanCount++;
    var allUrls = [];
    for (var i = 0; i < videos.length; i++) {
      var vEl = videos[i];
      var sources = extractVideoSources(vEl);
      allUrls = allUrls.concat(sources);
      if (!vEl.__detectorLastUrl) {
        var initSrc = vEl.currentSrc || vEl.src || '';
        if (initSrc) vEl.__detectorLastUrl = toAbsoluteUrl(initSrc);
      }
      attachVideoListeners(vEl);
    }

    // Also look for iframes that might contain videos (same-origin only)
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var j = 0; j < iframes.length; j++) {
        try {
          var iframeDoc = iframes[j].contentDocument || iframes[j].contentWindow.document;
          if (iframeDoc) {
            var iframeVideos = iframeDoc.querySelectorAll('video');
            for (var k = 0; k < iframeVideos.length; k++) {
              var iframeSources = extractVideoSources(iframeVideos[k]);
              allUrls = allUrls.concat(iframeSources);
            }
          }
        } catch(e) {
          // Cross-origin iframe — skip
        }
      }
    } catch(e) {}

    if (allUrls.length > 0) {
      sendDetectedVideos(allUrls, 'dom-scan');
    }
  }

  // Intercept XHR to detect video URLs in network requests
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string') {
      var lower = url.toLowerCase();
      if (lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.m3u8') ||
          lower.includes('.mpd') || lower.includes('application/dash') ||
          lower.includes('video/') || lower.includes('mime=video') ||
          lower.includes('video.twimg.com') || lower.includes('/ext_tw_video/')) {
          log('[XHR] Intercepted video URL: ' + url.substring(0, 150));
          sendDetectedVideos([toAbsoluteUrl(url)], 'xhr');
      }
      if (lower.includes('.m4s')) {
        trackM4sRequest(url);
      }
    }
    return origOpen.apply(this, arguments);
  };

  // Also intercept XHR responses for x.com API that return video variants
  var origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    xhr.addEventListener('load', function() {
      try {
        var xurl = xhr.responseURL || '';
        // Read M3U8 response bodies from the page's own requests
        if (isM3U8Url(xurl)) {
          var m3u8Body = typeof xhr.responseText === 'string' ? xhr.responseText : '';
          if (m3u8Body) parseM3U8Content(toAbsoluteUrl(xurl), m3u8Body);
        }
        if (xurl.includes('/TweetDetail') || xurl.includes('/TweetResultByRestId') ||
            xurl.includes('/UserTweets') || xurl.includes('/HomeTimeline') ||
            xurl.includes('/SearchTimeline') || xurl.includes('/ListLatestTweets') ||
            xurl.includes('/Bookmarks') || xurl.includes('/Likes') ||
            (xurl.includes('graphql') && (xurl.includes('Tweet') || xurl.includes('timeline') || xurl.includes('Timeline')))) {
          var body = typeof xhr.responseText === 'string' ? xhr.responseText : '';
          var videoUrls = extractVideoUrlsFromJson(body);
          if (videoUrls.length > 0) {
            log('[XHR RESPONSE] Found ' + videoUrls.length + ' video URL(s) in API response');
            sendDetectedVideos(videoUrls, 'xhr-api-response');
          }
        }
      } catch(e) {
        log('[XHR RESPONSE ERROR] ' + e.message);
      }
    });
    return origXhrSend.apply(this, arguments);
  };

  // Helper: extract video URLs from x.com/Twitter API JSON responses
  // Uses indexOf instead of regex to avoid escaping issues inside template literal
  function extractVideoUrlsFromJson(text) {
    var urls = [];
    var BSLASH = String.fromCharCode(92);  // backslash
    var QUOTE = String.fromCharCode(34);   // double quote
    var CDN = 'video.twimg.com';
    try {
      var pos = 0;
      while (true) {
        pos = text.indexOf(CDN, pos);
        if (pos === -1) break;
        // Walk backwards to find 'http'
        var start = text.lastIndexOf('http', pos);
        if (start === -1 || pos - start > 200) { pos++; continue; }
        // Walk forward to find end of URL (stop at unescaped quote, space, angle bracket)
        var end = pos + CDN.length;
        while (end < text.length) {
          var ch = text.charAt(end);
          if (ch === QUOTE || ch === ' ' || ch === '<' || ch === '>') break;
          // Skip escaped chars like \/ in JSON
          if (ch === BSLASH && end + 1 < text.length) {
            end += 2;
            continue;
          }
          end++;
        }
        var rawUrl = text.substring(start, end);
        // Unescape JSON-escaped forward slashes:  \/ -> /
        var escaped = BSLASH + '/';
        while (rawUrl.indexOf(escaped) !== -1) {
          rawUrl = rawUrl.split(escaped).join('/');
        }
        // Also unescape other JSON escapes
        var escaped2 = BSLASH + BSLASH;
        while (rawUrl.indexOf(escaped2) !== -1) {
          rawUrl = rawUrl.split(escaped2).join(BSLASH);
        }
        if (rawUrl.indexOf('.mp4') !== -1 && urls.indexOf(rawUrl) === -1) {
          urls.push(rawUrl);
          log('[JSON URL] ' + rawUrl.substring(0, 120));
        }
        pos = end;
      }
    } catch(e) {
      log('[extractVideoUrlsFromJson] Error: ' + e.message);
    }
    return urls;
  }

  // Intercept fetch to detect video URLs
  var origFetch = window.fetch;
  window.fetch = function(input) {
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (url) {
      var lower = url.toLowerCase();
      if (lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.m3u8') ||
          lower.includes('.mpd') || lower.includes('application/dash') ||
          lower.includes('video/') || lower.includes('mime=video') ||
          lower.includes('video.twimg.com') || lower.includes('/ext_tw_video/')) {
        // Skip individual DASH segment files (.m4s) — they're fragments, not full videos
        if (!lower.includes('.m4s')) {
          log('[FETCH] Intercepted video URL: ' + url.substring(0, 150));
          sendDetectedVideos([toAbsoluteUrl(url)], 'fetch');
        }
      }
      if (lower.includes('.m4s')) {
        trackM4sRequest(url);
      }
    }
    // Also inspect fetch responses for x.com API video data and M3U8 playlists
    var fetchPromise = origFetch.apply(this, arguments);
    var isM3U8 = isM3U8Url(url);
    var isXApi = url && (
      url.includes('/TweetDetail') || url.includes('/TweetResultByRestId') ||
      url.includes('/UserTweets') || url.includes('/HomeTimeline') ||
      url.includes('/SearchTimeline') || url.includes('/ListLatestTweets') ||
      url.includes('/Bookmarks') || url.includes('/Likes') ||
      (url.includes('graphql') && (url.includes('Tweet') || url.includes('timeline') || url.includes('Timeline'))) ||
      (url.includes('api') && url.includes('tweet')) ||
      url.includes('video.twimg.com')
    );
    if (isM3U8 || isXApi) {
      fetchPromise.then(function(response) {
        try {
          var cloned = response.clone();
          cloned.text().then(function(body) {
            // Parse M3U8 response body
            if (isM3U8 && body) {
              parseM3U8Content(toAbsoluteUrl(url), body);
            }
            if (isXApi) {
              var videoUrls = extractVideoUrlsFromJson(body);
              if (videoUrls.length > 0) {
                log('[FETCH RESPONSE] Found ' + videoUrls.length + ' video URL(s) in API response');
                sendDetectedVideos(videoUrls, 'fetch-api-response');
              }
            }
          }).catch(function(e) {});
        } catch(e) {}
      }).catch(function(e) {});
    }
    return fetchPromise;
  };

  log('[INIT] Network & MSE hooks installed (before content loaded)');

  // DOM-dependent code must wait for the document to be ready
  function onDomReady() {
    // Watch for DOM changes (dynamically added video elements)
    var observer = new MutationObserver(function(mutations) {
      var shouldScan = false;
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          for (var j = 0; j < mutation.addedNodes.length; j++) {
            var node = mutation.addedNodes[j];
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'VIDEO' || node.querySelector && node.querySelector('video')) {
                shouldScan = true;
                break;
              }
            }
          }
        }
        if (shouldScan) break;
      }
      if (shouldScan) {
        setTimeout(scanForVideos, 500);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // Initial scan
    log('[INIT] DOM ready, starting video scans on ' + window.location.href);
    scanForVideos();

    // Periodic rescan for SPAs and lazy-loaded content
    setInterval(scanForVideos, SCAN_INTERVAL_MS);

    // Notify RN that injection succeeded
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'PAGE_INFO',
      payload: {
        title: document.title,
        url: window.location.href
      }
    }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady);
  } else {
    onDomReady();
  }

  true; // Required to avoid silent failures
})();
`;
