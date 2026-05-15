/**
 * JavaScript code injected into the WebView to detect <video> elements
 * and extract their source URLs. Uses MutationObserver for dynamic content.
 */
export const VIDEO_DETECTOR_JS = `
(function() {
  'use strict';

  // Prevent double-injection
  if (window.__VIDEO_DETECTOR_INSTALLED__) return;
  window.__VIDEO_DETECTOR_INSTALLED__ = true;

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
      var m3u8 = src.startsWith('blob:') ? lastM3u8Url : '';
      log('[VIDEO_PLAYING] src=' + src.substring(0, 120) + ' lastM3u8Url=' + lastM3u8Url.substring(0, 120));
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', payload: { src: src, m3u8Url: m3u8 } }));
    });
    // If already playing when listener was attached (first-load race), report immediately
    if (!vEl.paused && (vEl.currentSrc || vEl.src)) {
      var src = vEl.currentSrc || vEl.src || '';
      var m3u8 = src.startsWith('blob:') ? lastM3u8Url : '';
      log('[VIDEO_PLAYING already] src=' + src.substring(0, 120) + ' lastM3u8Url=' + lastM3u8Url.substring(0, 120));
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', payload: { src: src, m3u8Url: m3u8 } }));
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

  // ===== fMP4 REMUXER: merge separate audio & video tracks =====
  function ru32(d, o) { return ((d[o] << 24) | (d[o+1] << 16) | (d[o+2] << 8) | d[o+3]) >>> 0; }
  function wu32(d, o, v) { d[o]=(v>>>24)&0xFF; d[o+1]=(v>>>16)&0xFF; d[o+2]=(v>>>8)&0xFF; d[o+3]=v&0xFF; }
  function btype(d, o) { return String.fromCharCode(d[o], d[o+1], d[o+2], d[o+3]); }
  function wtype(d, o, s) { d[o]=s.charCodeAt(0); d[o+1]=s.charCodeAt(1); d[o+2]=s.charCodeAt(2); d[o+3]=s.charCodeAt(3); }

  function findBox(d, type, start, end) {
    var o = start || 0;
    var e = end || d.length;
    while (o + 8 <= e) {
      var sz = ru32(d, o);
      if (sz < 8 || o + sz > e) break;
      if (btype(d, o + 4) === type) return { o: o, s: sz };
      o += sz;
    }
    return null;
  }

  function findAllBoxes(d, type, start, end) {
    var result = [];
    var o = start || 0;
    var e = end || d.length;
    while (o + 8 <= e) {
      var sz = ru32(d, o);
      if (sz < 8 || o + sz > e) break;
      if (btype(d, o + 4) === type) result.push({ o: o, s: sz });
      o += sz;
    }
    return result;
  }

  function splitInitMedia(chunks) {
    var initParts = [];
    var media = [];
    for (var i = 0; i < chunks.length; i++) {
      var d = new Uint8Array(chunks[i]);
      if (d.length < 8) { media.push(chunks[i]); continue; }
      // Parse each top-level box in this chunk separately
      // ftyp and moov go to init; everything else (moof, mdat, styp, sidx) goes to media
      var hasInit = false;
      var mediaParts = [];
      var o = 0;
      while (o + 8 <= d.length) {
        var bsz = ru32(d, o);
        if (bsz < 8 || o + bsz > d.length) break;
        var bt = btype(d, o + 4);
        if (bt === 'ftyp' || bt === 'moov') {
          initParts.push(d.slice(o, o + bsz));
          hasInit = true;
        } else {
          mediaParts.push({ o: o, s: bsz });
        }
        o += bsz;
      }
      // Collect non-init boxes from this chunk as media
      if (mediaParts.length > 0) {
        if (mediaParts.length === 1 && !hasInit) {
          // Whole chunk is one media segment, use original buffer (no copy)
          media.push(chunks[i]);
        } else {
          // Extract media boxes into a new buffer
          var mLen = 0;
          for (var j = 0; j < mediaParts.length; j++) mLen += mediaParts[j].s;
          var mBuf = new Uint8Array(mLen);
          var mOff = 0;
          for (var j = 0; j < mediaParts.length; j++) {
            mBuf.set(d.subarray(mediaParts[j].o, mediaParts[j].o + mediaParts[j].s), mOff);
            mOff += mediaParts[j].s;
          }
          media.push(mBuf.buffer);
        }
      }
    }
    log('[SPLIT] initParts=' + initParts.length + ' mediaSegs=' + media.length + ' (from ' + chunks.length + ' chunks)');
    if (initParts.length === 0) return { init: null, media: chunks };
    var total = 0;
    for (var i = 0; i < initParts.length; i++) total += initParts[i].length;
    var init = new Uint8Array(total);
    var off = 0;
    for (var i = 0; i < initParts.length; i++) { init.set(initParts[i], off); off += initParts[i].length; }
    return { init: init, media: media };
  }

  function setTrackIdInTkhd(d, moovOff, moovSz, newId) {
    var trak = findBox(d, 'trak', moovOff + 8, moovOff + moovSz);
    if (!trak) return;
    var tkhd = findBox(d, 'tkhd', trak.o + 8, trak.o + trak.s);
    if (!tkhd) return;
    var ver = d[tkhd.o + 8];
    wu32(d, tkhd.o + (ver === 0 ? 20 : 28), newId);
  }

  function setTrackIdInTrex(d, moovOff, moovSz, newId) {
    var mvex = findBox(d, 'mvex', moovOff + 8, moovOff + moovSz);
    if (!mvex) return;
    var trex = findBox(d, 'trex', mvex.o + 8, mvex.o + mvex.s);
    if (!trex) return;
    wu32(d, trex.o + 12, newId);
  }

  function fixMoofTrackId(buf, newId) {
    var d = new Uint8Array(buf.slice(0));
    var moof = findBox(d, 'moof', 0, d.length);
    if (!moof) return d.buffer;
    var trafs = findAllBoxes(d, 'traf', moof.o + 8, moof.o + moof.s);
    for (var i = 0; i < trafs.length; i++) {
      var tfhd = findBox(d, 'tfhd', trafs[i].o + 8, trafs[i].o + trafs[i].s);
      if (tfhd) wu32(d, tfhd.o + 12, newId);
    }
    return d.buffer;
  }

  // Read tfdt (base media decode time) from a media segment buffer
  function getTfdt(buf) {
    var d = new Uint8Array(buf);
    var moof = findBox(d, 'moof', 0, d.length);
    if (!moof) return -1;
    var traf = findBox(d, 'traf', moof.o + 8, moof.o + moof.s);
    if (!traf) return -1;
    var tfdt = findBox(d, 'tfdt', traf.o + 8, traf.o + traf.s);
    if (!tfdt) return -1;
    var ver = d[tfdt.o + 8];
    if (ver === 0) return ru32(d, tfdt.o + 12);
    return ru32(d, tfdt.o + 12) * 4294967296 + ru32(d, tfdt.o + 16);
  }

  // Write tfdt value into a media segment buffer (modifies in place)
  function setTfdt(buf, val) {
    var d = new Uint8Array(buf);
    var moof = findBox(d, 'moof', 0, d.length);
    if (!moof) return;
    var traf = findBox(d, 'traf', moof.o + 8, moof.o + moof.s);
    if (!traf) return;
    var tfdt = findBox(d, 'tfdt', traf.o + 8, traf.o + traf.s);
    if (!tfdt) return;
    var ver = d[tfdt.o + 8];
    if (ver === 0) {
      wu32(d, tfdt.o + 12, val >>> 0);
    } else {
      wu32(d, tfdt.o + 12, (val / 4294967296) >>> 0);
      wu32(d, tfdt.o + 16, val >>> 0);
    }
  }

  // Set mfhd sequence_number in a media segment buffer (modifies in place)
  function setMfhdSeqNum(buf, num) {
    var d = new Uint8Array(buf);
    var moof = findBox(d, 'moof', 0, d.length);
    if (!moof) return;
    var mfhd = findBox(d, 'mfhd', moof.o + 8, moof.o + moof.s);
    if (!mfhd) return;
    wu32(d, mfhd.o + 12, num);
  }

  // Read mvhd timescale
  function getMvhdTimescale(d, off) {
    var ver = d[off + 8];
    return ver === 0 ? ru32(d, off + 20) : ru32(d, off + 28);
  }

  // Set mvhd duration (in mvhd timescale units)
  function setMvhdDuration(d, off, dur) {
    var ver = d[off + 8];
    if (ver === 0) {
      wu32(d, off + 24, dur >>> 0);
    } else {
      wu32(d, off + 32, (dur / 4294967296) >>> 0);
      wu32(d, off + 36, dur >>> 0);
    }
  }

  // Rename any top-level 'edts' box inside a trak Uint8Array to 'free', so
  // its edit-list (elst) is ignored by demuxers. After we rebase tfdt and
  // recompute durations, the original elst no longer matches the data and
  // typically introduces unwanted gaps or skips.
  function stripEdtsInTrak(d) {
    var o = 8; // skip the trak header
    while (o + 8 <= d.length) {
      var sz = ru32(d, o);
      if (sz < 8 || o + sz > d.length) break;
      if (btype(d, o + 4) === 'edts') {
        wtype(d, o + 4, 'free');
      }
      o += sz;
    }
  }

  // Read mdhd timescale from a trak Uint8Array
  function getMdhdTimescale(d) {
    var mdia = findBox(d, 'mdia', 8, d.length);
    if (!mdia) return 0;
    var mdhd = findBox(d, 'mdhd', mdia.o + 8, mdia.o + mdia.s);
    if (!mdhd) return 0;
    var ver = d[mdhd.o + 8];
    return ver === 0 ? ru32(d, mdhd.o + 20) : ru32(d, mdhd.o + 28);
  }

  // Set durations in tkhd and mdhd inside a trak Uint8Array
  // tkhdDur is in mvhd timescale, mdhdDur is in mdhd timescale
  function setDurationsInTrak(d, tkhdDur, mdhdDur) {
    var tkhd = findBox(d, 'tkhd', 8, d.length);
    if (tkhd) {
      var ver = d[tkhd.o + 8];
      if (ver === 0) { wu32(d, tkhd.o + 28, tkhdDur >>> 0); }
      else { wu32(d, tkhd.o + 36, (tkhdDur / 4294967296) >>> 0); wu32(d, tkhd.o + 40, tkhdDur >>> 0); }
    }
    var mdia = findBox(d, 'mdia', 8, d.length);
    if (mdia) {
      var mdhd = findBox(d, 'mdhd', mdia.o + 8, mdia.o + mdia.s);
      if (mdhd) {
        var ver2 = d[mdhd.o + 8];
        if (ver2 === 0) { wu32(d, mdhd.o + 24, mdhdDur >>> 0); }
        else { wu32(d, mdhd.o + 32, (mdhdDur / 4294967296) >>> 0); wu32(d, mdhd.o + 36, mdhdDur >>> 0); }
      }
    }
  }

  // Set duration in mehd (Movie Extends Header) if present
  function setMehdDuration(d, mvexOff, mvexSz, dur) {
    var mehd = findBox(d, 'mehd', mvexOff + 8, mvexOff + mvexSz);
    if (mehd) {
      var ver = d[mehd.o + 8];
      if (ver === 0) { wu32(d, mehd.o + 12, dur >>> 0); }
      else { wu32(d, mehd.o + 12, (dur / 4294967296) >>> 0); wu32(d, mehd.o + 16, dur >>> 0); }
    }
  }

  // Patch tfhd.base_data_offset in a moof+mdat buffer so it correctly points
  // to the moof's absolute byte position in the reassembled file. When the
  // original streaming segments are rearranged, any stored absolute offset is
  // wrong, causing the player to read sample data from the wrong position —
  // which breaks random access / seeking.
  function fixTfhdBaseDataOffset(buf, absoluteMoofOffset) {
    var d = new Uint8Array(buf);
    var moof = findBox(d, 'moof', 0, d.length);
    if (!moof) return;
    var trafs = findAllBoxes(d, 'traf', moof.o + 8, moof.o + moof.s);
    for (var ti = 0; ti < trafs.length; ti++) {
      var tfhd = findBox(d, 'tfhd', trafs[ti].o + 8, trafs[ti].o + trafs[ti].s);
      if (!tfhd) continue;
      var flags = (d[tfhd.o + 9] << 16) | (d[tfhd.o + 10] << 8) | d[tfhd.o + 11];
      if (!(flags & 0x000001)) continue; // base-data-offset not present in this tfhd
      // tfhd layout: size(4) + 'tfhd'(4) + version(1) + flags(3) + track_ID(4) = 16 bytes
      // base_data_offset(8) starts at offset 16 from the box start.
      var hi = Math.floor(absoluteMoofOffset / 4294967296);
      var lo = absoluteMoofOffset >>> 0;
      d[tfhd.o + 16] = (hi >>> 24) & 0xFF;
      d[tfhd.o + 17] = (hi >>> 16) & 0xFF;
      d[tfhd.o + 18] = (hi >>> 8) & 0xFF;
      d[tfhd.o + 19] = hi & 0xFF;
      d[tfhd.o + 20] = (lo >>> 24) & 0xFF;
      d[tfhd.o + 21] = (lo >>> 16) & 0xFF;
      d[tfhd.o + 22] = (lo >>> 8) & 0xFF;
      d[tfhd.o + 23] = lo & 0xFF;
    }
  }

  // Build an mfra (Movie Fragment Random Access) box at the end of the file.
  // Players use this to quickly locate the moof for any requested seek time
  // without scanning the entire file. Each interleaved element must have a
  // moofOffset property (absolute byte offset from file start) already set.
  function buildMfra(interleaved, vTimescale, aTimescale) {
    var vEntries = [];
    var aEntries = [];
    for (var i = 0; i < interleaved.length; i++) {
      var frag = interleaved[i];
      var d = new Uint8Array(frag.buf);
      var moof = findBox(d, 'moof', 0, d.length);
      if (!moof) continue;
      var traf = findBox(d, 'traf', moof.o + 8, moof.o + moof.s);
      if (!traf) continue;
      var tfdtBox = findBox(d, 'tfdt', traf.o + 8, traf.o + traf.s);
      var time = 0;
      if (tfdtBox) {
        var ver = d[tfdtBox.o + 8];
        time = ver === 0 ? ru32(d, tfdtBox.o + 12)
                        : ru32(d, tfdtBox.o + 12) * 4294967296 + ru32(d, tfdtBox.o + 16);
      }
      if (frag.kind === 0) vEntries.push({ time: time, moofOffset: frag.moofOffset });
      else                 aEntries.push({ time: time, moofOffset: frag.moofOffset });
    }

    function buildTfra(trackId, entries) {
      if (entries.length === 0) return null;
      // FullBox(12) + track_ID(4) + entry_count(4) + N * (time32 + offset32 + 3 × 1) = 20 + N*11
      var totalSize = 20 + entries.length * 11;
      var box = new Uint8Array(totalSize);
      wu32(box, 0, totalSize); wtype(box, 4, 'tfra');
      // version=0 (32-bit fields), flags bits 0-5 = 0 → each count field is 1 byte
      box[8] = 0; box[9] = 0; box[10] = 0; box[11] = 0;
      wu32(box, 12, trackId);
      wu32(box, 16, entries.length);
      var off = 20;
      for (var j = 0; j < entries.length; j++) {
        wu32(box, off, entries[j].time >>> 0);        off += 4;
        wu32(box, off, entries[j].moofOffset >>> 0);  off += 4;
        box[off] = 1; off++; // traf_number (1-based)
        box[off] = 1; off++; // trun_number
        box[off] = 1; off++; // sample_number
      }
      return box;
    }

    var tfras = [];
    var vTfra = buildTfra(1, vEntries); if (vTfra) tfras.push(vTfra);
    var aTfra = buildTfra(2, aEntries); if (aTfra) tfras.push(aTfra);

    var tfraBytes = 0;
    for (var i = 0; i < tfras.length; i++) tfraBytes += tfras[i].length;
    // mfra header(8) + tfras + mfro FullBox(16)
    var mfroSize = 16;
    var mfraTotalSize = 8 + tfraBytes + mfroSize;

    var mfra = new Uint8Array(mfraTotalSize);
    wu32(mfra, 0, mfraTotalSize); wtype(mfra, 4, 'mfra');
    var off = 8;
    for (var i = 0; i < tfras.length; i++) { mfra.set(tfras[i], off); off += tfras[i].length; }
    // mfro: last box in mfra, last box in file — players read its 'size' field to locate mfra
    wu32(mfra, off, mfroSize); wtype(mfra, off + 4, 'mfro');
    mfra[off + 8] = 0; mfra[off + 9] = 0; mfra[off + 10] = 0; mfra[off + 11] = 0; // ver+flags
    wu32(mfra, off + 12, mfraTotalSize); // size = total mfra box size (used by player to seek back)
    return mfra;
  }

  // Compute duration from rebased media segments: max tfdt + estimated last segment duration
  function computeDurationFromSegments(segments) {
    if (segments.length === 0) return 0;
    var maxTfdt = 0;
    var prevTfdt = -1;
    var lastSegDur = 0;
    for (var i = 0; i < segments.length; i++) {
      var t = getTfdt(segments[i]);
      if (t < 0) continue;
      if (t > maxTfdt) maxTfdt = t;
      if (prevTfdt >= 0 && t > prevTfdt) {
        lastSegDur = t - prevTfdt; // use gap between consecutive segments as estimate
      }
      prevTfdt = t;
    }
    // Add one segment duration so the last segment's content is included
    return maxTfdt + (lastSegDur > 0 ? lastSegDur : 0);
  }

  function buildBox(type, contents) {
    var totalLen = 8;
    for (var i = 0; i < contents.length; i++) totalLen += contents[i].length;
    var box = new Uint8Array(totalLen);
    wu32(box, 0, totalLen);
    wtype(box, 4, type);
    var off = 8;
    for (var i = 0; i < contents.length; i++) { box.set(contents[i], off); off += contents[i].length; }
    return box;
  }

  function remuxTracks(videoChunks, audioChunks) {
    var vs = splitInitMedia(videoChunks);
    var as = splitInitMedia(audioChunks);
    if (!vs.init || !as.init) {
      log('[REMUX] Missing init segment, video-only fallback');
      return null;
    }
    var vInit = new Uint8Array(vs.init);
    var aInit = new Uint8Array(as.init);

    var vMoov = findBox(vInit, 'moov', 0, vInit.length);
    var vFtyp = findBox(vInit, 'ftyp', 0, vInit.length);
    var aMoov = findBox(aInit, 'moov', 0, aInit.length);
    if (!vMoov || !aMoov) {
      log('[REMUX] Cannot find moov, video-only fallback');
      return null;
    }

    // Set video track_id=1, audio track_id=2
    setTrackIdInTkhd(vInit, vMoov.o, vMoov.s, 1);
    setTrackIdInTrex(vInit, vMoov.o, vMoov.s, 1);
    setTrackIdInTkhd(aInit, aMoov.o, aMoov.s, 2);
    setTrackIdInTrex(aInit, aMoov.o, aMoov.s, 2);

    // Extract child boxes from each moov
    var vMvhd = findBox(vInit, 'mvhd', vMoov.o + 8, vMoov.o + vMoov.s);
    var vTrak = findBox(vInit, 'trak', vMoov.o + 8, vMoov.o + vMoov.s);
    var vMvex = findBox(vInit, 'mvex', vMoov.o + 8, vMoov.o + vMoov.s);
    var aTrak = findBox(aInit, 'trak', aMoov.o + 8, aMoov.o + aMoov.s);
    var aMvex = findBox(aInit, 'mvex', aMoov.o + 8, aMoov.o + aMoov.s);

    if (!vMvhd || !vTrak || !aTrak) {
      log('[REMUX] Missing required boxes, video-only fallback');
      return null;
    }

    // Extract mvhd and traks for modification
    var mvhdData = vInit.slice(vMvhd.o, vMvhd.o + vMvhd.s);
    wu32(mvhdData, mvhdData.length - 4, 3); // next_track_ID=3
    var mvhdTS = getMvhdTimescale(mvhdData, 0);

    var vTrakData = vInit.slice(vTrak.o, vTrak.o + vTrak.s);
    var aTrakData = aInit.slice(aTrak.o, aTrak.o + aTrak.s);
    stripEdtsInTrak(vTrakData);
    stripEdtsInTrak(aTrakData);
    var vMdhdTS = getMdhdTimescale(vTrakData);
    var aMdhdTS = getMdhdTimescale(aTrakData);
    log('[REMUX] Timescales: mvhd=' + mvhdTS + ' vMdhd=' + vMdhdTS + ' aMdhd=' + aMdhdTS);

    // Build combined mvex
    var mvexChildren = [];
    if (vMvex) {
      var o = vMvex.o + 8;
      while (o + 8 <= vMvex.o + vMvex.s) {
        var sz = ru32(vInit, o);
        if (sz < 8) break;
        mvexChildren.push(vInit.slice(o, o + sz));
        o += sz;
      }
    }
    if (aMvex) {
      var o2 = aMvex.o + 8;
      while (o2 + 8 <= aMvex.o + aMvex.s) {
        var sz2 = ru32(aInit, o2);
        if (sz2 < 8) break;
        mvexChildren.push(aInit.slice(o2, o2 + sz2));
        o2 += sz2;
      }
    }
    // Fix track IDs in media segments
    var fixedV = [];
    for (var i = 0; i < vs.media.length; i++) fixedV.push(fixMoofTrackId(vs.media[i], 1));
    var fixedA = [];
    for (var i = 0; i < as.media.length; i++) fixedA.push(fixMoofTrackId(as.media[i], 2));

    if (fixedV.length === 0) {
      log('[REMUX] No video media segments found, falling back');
      return null;
    }

    // Rebase tfdt to a common zero. Convert each track's earliest tfdt to
    // seconds (using its own mdhd timescale) and pick the smaller as global t=0.
    // Whichever track started first now starts at 0; the other keeps its
    // original positive offset, preserving A/V alignment. Per-track independent
    // rebasing breaks alignment when the two tracks' first captured segments
    // don't have the same presentation time.
    var vMinTfdt = Infinity;
    for (var i = 0; i < fixedV.length; i++) {
      var t = getTfdt(fixedV[i]);
      if (t >= 0 && t < vMinTfdt) vMinTfdt = t;
    }
    var aMinTfdt = Infinity;
    for (var i = 0; i < fixedA.length; i++) {
      var t2 = getTfdt(fixedA[i]);
      if (t2 >= 0 && t2 < aMinTfdt) aMinTfdt = t2;
    }
    var vMinSec = (vMinTfdt < Infinity && vMdhdTS > 0) ? vMinTfdt / vMdhdTS : Infinity;
    var aMinSec = (aMinTfdt < Infinity && aMdhdTS > 0) ? aMinTfdt / aMdhdTS : Infinity;
    var globalMinSec = Math.min(vMinSec, aMinSec);
    if (globalMinSec > 0 && globalMinSec < Infinity) {
      var vRebase = vMdhdTS > 0 ? Math.round(globalMinSec * vMdhdTS) : 0;
      var aRebase = aMdhdTS > 0 ? Math.round(globalMinSec * aMdhdTS) : 0;
      log('[REMUX] Rebasing by ' + globalMinSec.toFixed(3) + 's (v=' + vRebase + ' a=' + aRebase + ')');
      for (var i = 0; i < fixedV.length; i++) {
        var tv = getTfdt(fixedV[i]);
        if (tv >= 0) setTfdt(fixedV[i], Math.max(0, tv - vRebase));
      }
      for (var i = 0; i < fixedA.length; i++) {
        var ta = getTfdt(fixedA[i]);
        if (ta >= 0) setTfdt(fixedA[i], Math.max(0, ta - aRebase));
      }
    }

    // Renumber mfhd sequence numbers per-track (each track numbered 1..N).
    // mfhd.sequence_number is per-track, monotonically increasing within that
    // track. Globally-unique numbering across tracks confuses some demuxers.
    for (var i = 0; i < fixedV.length; i++) { setMfhdSeqNum(fixedV[i], i + 1); }
    for (var i = 0; i < fixedA.length; i++) { setMfhdSeqNum(fixedA[i], i + 1); }

    // Compute actual duration from rebased segments (in each track's timescale)
    var vDurInMdhd = computeDurationFromSegments(fixedV);
    var aDurInMdhd = computeDurationFromSegments(fixedA);
    // Convert to mvhd timescale for mvhd and tkhd
    var vDurInMvhd = vMdhdTS > 0 ? Math.round(vDurInMdhd * mvhdTS / vMdhdTS) : vDurInMdhd;
    var aDurInMvhd = aMdhdTS > 0 ? Math.round(aDurInMdhd * mvhdTS / aMdhdTS) : aDurInMdhd;
    var movieDur = Math.max(vDurInMvhd, aDurInMvhd);
    log('[REMUX] Duration: vMdhd=' + vDurInMdhd + ' aMdhd=' + aDurInMdhd + ' movie=' + movieDur + ' (~' + (mvhdTS > 0 ? Math.round(movieDur / mvhdTS) : '?') + 's)');

    // Set actual durations
    setMvhdDuration(mvhdData, 0, movieDur);
    setDurationsInTrak(vTrakData, vDurInMvhd, vDurInMdhd);
    setDurationsInTrak(aTrakData, aDurInMvhd, aDurInMdhd);

    // Build moov with correct durations
    var mvexBox = buildBox('mvex', mvexChildren);
    setMehdDuration(mvexBox, 0, mvexBox.length, movieDur);
    var moovBox = buildBox('moov', [mvhdData, vTrakData, aTrakData, mvexBox]);

    // Interleave video & audio fragments by presentation time (tfdt / mdhd
    // timescale, in seconds). Many hardware decoders glitch when given all
    // video fragments before all audio fragments — interleaved order matches
    // what real fMP4 producers emit.
    var interleaved = [];
    for (var i = 0; i < fixedV.length; i++) {
      var tvi = getTfdt(fixedV[i]);
      interleaved.push({
        buf: fixedV[i],
        sec: tvi >= 0 && vMdhdTS > 0 ? tvi / vMdhdTS : Number.MAX_VALUE,
        kind: 0, // video sorts before audio on tie
      });
    }
    for (var i = 0; i < fixedA.length; i++) {
      var tai = getTfdt(fixedA[i]);
      interleaved.push({
        buf: fixedA[i],
        sec: tai >= 0 && aMdhdTS > 0 ? tai / aMdhdTS : Number.MAX_VALUE,
        kind: 1,
      });
    }
    interleaved.sort(function(a, b) {
      if (a.sec !== b.sec) return a.sec - b.sec;
      return a.kind - b.kind;
    });

    // Compute absolute byte offsets for each fragment, fix tfhd.base_data_offset,
    // then build an mfra seek table.
    var ftypSz = vFtyp ? vFtyp.s : 0;
    var cumOff = ftypSz + moovBox.length;
    for (var i = 0; i < interleaved.length; i++) {
      interleaved[i].moofOffset = cumOff;
      fixTfhdBaseDataOffset(interleaved[i].buf, cumOff);
      cumOff += interleaved[i].buf.byteLength;
    }
    var mfraBox = buildMfra(interleaved, vMdhdTS, aMdhdTS);

    // Build final: [ftyp][moov][interleaved fragments...][mfra]
    var parts = [];
    if (vFtyp) parts.push(vInit.slice(vFtyp.o, vFtyp.o + vFtyp.s).buffer);
    parts.push(moovBox.buffer);
    for (var i = 0; i < interleaved.length; i++) parts.push(interleaved[i].buf);
    parts.push(mfraBox.buffer);

    var totalSz = 0;
    for (var i = 0; i < parts.length; i++) totalSz += parts[i].byteLength;
    log('[REMUX] OK: moov=' + moovBox.length + ' vSegs=' + fixedV.length + ' aSegs=' + fixedA.length + ' totalSize=' + totalSz);
    return new Blob(parts, { type: 'video/mp4' });
  }

  // Callable from RN via injectJavaScript.
  // opts.waitForReady=true polls until MSE.sourceended fires (or the user
  // cancels via __cancelBlobWait), then extracts. Without waiting, only the
  // bytes already buffered into the SourceBuffer are captured — typically a
  // small forward-buffer window, not the full video.
  var blobWaitCancel = {};
  window.__cancelBlobWait = function(blobUrl) {
    blobWaitCancel[blobUrl] = true;
  };
  window.__extractBlobVideo = function(blobUrl, opts) {
    opts = opts || {};
    var entry = blobStore[blobUrl];
    if (!entry) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'BLOB_DATA_ERROR',
        payload: { blobUrl: blobUrl, error: 'No data found for this blob URL' }
      }));
      return;
    }

    if (opts.waitForReady && !entry.ready && !entry.blob) {
      blobWaitCancel[blobUrl] = false;
      var pollMs = 500;
      var sentReady = false;
      function waitTick() {
        var e = blobStore[blobUrl];
        if (!e) return;
        var done = !!e.ready || blobWaitCancel[blobUrl];
        if (!sentReady) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'BLOB_BUFFERING',
            payload: { blobUrl: blobUrl, bytesBuffered: e.totalBytes, ready: !!e.ready, cancelled: !!blobWaitCancel[blobUrl] }
          }));
        }
        if (done) {
          sentReady = true;
          delete blobWaitCancel[blobUrl];
          doExtract();
        } else {
          setTimeout(waitTick, pollMs);
        }
      }
      waitTick();
      return;
    }

    doExtract();

    function doExtract() {
    var blob;
    // Log collection state for debugging
    var vCount = entry.videoChunks ? entry.videoChunks.length : 0;
    var aCount = entry.audioChunks ? entry.audioChunks.length : 0;
    var vBytes = 0;
    for (var ci = 0; ci < vCount; ci++) vBytes += (entry.videoChunks[ci].byteLength || 0);
    var aBytes = 0;
    for (var ci2 = 0; ci2 < aCount; ci2++) aBytes += (entry.audioChunks[ci2].byteLength || 0);
    log('[EXTRACT] videoChunks=' + vCount + ' (' + vBytes + ' bytes) audioChunks=' + aCount + ' (' + aBytes + ' bytes)');

    if (entry.blob) {
      blob = entry.blob;
    } else if (entry.videoChunks && entry.videoChunks.length > 0) {
      // Try remuxing audio + video together
      if (entry.audioChunks && entry.audioChunks.length > 0) {
        log('[BLOB] Remuxing ' + entry.videoChunks.length + ' video + ' + entry.audioChunks.length + ' audio chunks');
        blob = remuxTracks(entry.videoChunks, entry.audioChunks);
      }
      // Fallback: video-only with proper splitting, rebasing, and duration fix
      if (!blob) {
        log('[BLOB] Using video-only fallback');
        var fbSplit = splitInitMedia(entry.videoChunks);
        if (fbSplit.init && fbSplit.media.length > 0) {
          var fbInit = new Uint8Array(fbSplit.init);
          var fbMoov = findBox(fbInit, 'moov', 0, fbInit.length);
          var fbFtyp = findBox(fbInit, 'ftyp', 0, fbInit.length);
          // Rebase tfdt timestamps to 0
          var fbMinTfdt = Infinity;
          for (var fi = 0; fi < fbSplit.media.length; fi++) {
            var ft = getTfdt(fbSplit.media[fi]);
            if (ft >= 0 && ft < fbMinTfdt) fbMinTfdt = ft;
          }
          if (fbMinTfdt > 0 && fbMinTfdt < Infinity) {
            log('[FALLBACK] Rebasing tfdt by -' + fbMinTfdt);
            for (var fi2 = 0; fi2 < fbSplit.media.length; fi2++) {
              var ft2 = getTfdt(fbSplit.media[fi2]);
              if (ft2 >= 0) setTfdt(fbSplit.media[fi2], ft2 - fbMinTfdt);
            }
          }
          // Renumber sequence numbers
          for (var fi3 = 0; fi3 < fbSplit.media.length; fi3++) {
            setMfhdSeqNum(fbSplit.media[fi3], fi3 + 1);
          }
          // Compute and set actual duration
          if (fbMoov) {
            var fbMvhd = findBox(fbInit, 'mvhd', fbMoov.o + 8, fbMoov.o + fbMoov.s);
            var fbTrak = findBox(fbInit, 'trak', fbMoov.o + 8, fbMoov.o + fbMoov.s);
            if (fbMvhd && fbTrak) {
              var fbMvhdTS = getMvhdTimescale(fbInit, fbMvhd.o);
              var fbTrakView = fbInit.subarray(fbTrak.o, fbTrak.o + fbTrak.s);
              stripEdtsInTrak(fbTrakView);
              var fbMdhdTS = getMdhdTimescale(fbTrakView);
              var fbDurMdhd = computeDurationFromSegments(fbSplit.media);
              var fbDurMvhd = fbMdhdTS > 0 ? Math.round(fbDurMdhd * fbMvhdTS / fbMdhdTS) : fbDurMdhd;
              log('[FALLBACK] Duration: mdhd=' + fbDurMdhd + ' mvhd=' + fbDurMvhd + ' (~' + (fbMvhdTS > 0 ? Math.round(fbDurMvhd / fbMvhdTS) : '?') + 's)');
              setMvhdDuration(fbInit, fbMvhd.o, fbDurMvhd);
              setDurationsInTrak(fbTrakView, fbDurMvhd, fbDurMdhd);
            }
            var fbMvex2 = findBox(fbInit, 'mvex', fbMoov.o + 8, fbMoov.o + fbMoov.s);
            if (fbMvex2) {
              var fbMvhdForMehd = findBox(fbInit, 'mvhd', fbMoov.o + 8, fbMoov.o + fbMoov.s);
              var fbMehdDur = fbMvhdForMehd ? ru32(fbInit, fbMvhdForMehd.o + (fbInit[fbMvhdForMehd.o + 8] === 0 ? 24 : 32)) : 0;
              setMehdDuration(fbInit, fbMvex2.o, fbMvex2.s, fbMehdDur);
            }
          }
          // Fix tfhd offsets and build mfra for the fallback video-only output.
          var fbFtypSz = fbFtyp ? fbFtyp.s : 0;
          var fbMoovSz = fbMoov ? fbMoov.s : 0;
          var fbCumOff = fbFtypSz + fbMoovSz;
          var fbFakeInterleaved = [];
          for (var fi4 = 0; fi4 < fbSplit.media.length; fi4++) {
            fixTfhdBaseDataOffset(fbSplit.media[fi4], fbCumOff);
            fbFakeInterleaved.push({ buf: fbSplit.media[fi4], moofOffset: fbCumOff, kind: 0 });
            fbCumOff += fbSplit.media[fi4].byteLength;
          }
          var fbMfra = buildMfra(fbFakeInterleaved, fbMdhdTS, 0);

          // Build output
          var fbParts = [];
          if (fbFtyp) fbParts.push(fbInit.slice(fbFtyp.o, fbFtyp.o + fbFtyp.s).buffer);
          if (fbMoov) fbParts.push(fbInit.slice(fbMoov.o, fbMoov.o + fbMoov.s).buffer);
          for (var fi5 = 0; fi5 < fbSplit.media.length; fi5++) fbParts.push(fbSplit.media[fi5]);
          fbParts.push(fbMfra.buffer);
          blob = new Blob(fbParts, { type: 'video/mp4' });
          log('[FALLBACK] Built: ' + fbSplit.media.length + ' segments, size=' + blob.size);
        } else {
          // Last resort: raw concatenation
          blob = new Blob(entry.videoChunks, { type: 'video/mp4' });
        }
      }
    } else {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'BLOB_DATA_ERROR',
        payload: { blobUrl: blobUrl, error: 'No chunks collected yet' }
      }));
      return;
    }

    log('[BLOB] Extracting: size=' + blob.size + ' type=' + blob.type);
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'BLOB_DATA_START',
      payload: { blobUrl: blobUrl, totalSize: blob.size, mimeType: blob.type }
    }));

    var CHUNK = 768 * 1024;
    var offset = 0;
    var idx = 0;
    function next() {
      if (offset >= blob.size) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'BLOB_DATA_END',
          payload: { blobUrl: blobUrl, totalChunks: idx }
        }));
        return;
      }
      var sl = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
      var reader = new FileReader();
      reader.onload = function() {
        var dataUrl = reader.result || '';
        var commaPos = dataUrl.indexOf(',');
        var b64 = commaPos !== -1 ? dataUrl.substring(commaPos + 1) : '';
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'BLOB_DATA_CHUNK',
          payload: { blobUrl: blobUrl, index: idx, data: b64 }
        }));
        idx++;
        offset += CHUNK;
        setTimeout(next, 10);
      };
      reader.onerror = function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'BLOB_DATA_ERROR',
          payload: { blobUrl: blobUrl, error: 'FileReader error at chunk ' + idx }
        }));
      };
      reader.readAsDataURL(sl);
    }
    next();
    }
  };

  // Log that hooks are installed (runs before page JS)
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
