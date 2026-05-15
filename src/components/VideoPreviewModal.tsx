import React, { useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { DetectedVideo } from '../types';
import VideoPlayerController from './VideoPlayerController';

const TAG = '[VideoPreview]';

interface Props {
  visible: boolean;
  video: DetectedVideo | null;
  onDownload: (video: DetectedVideo) => void;
  onClose: () => void;
}

const IS_USE_LOG = true;

function buildPlayerHtml(videoUrl: string, videoType: string): string {
  const mimeType = videoType === 'webm' ? 'video/webm' : 'video/mp4';
  const scriptLog = `
<script>
    var debugEl = document.getElementById('debugLog');
    function log(msg) {
      ${IS_USE_LOG ? `
        var ts = new Date().toISOString().substr(11, 12);
        var line = ts + ' ' + msg;
        debugEl.innerHTML += line + '<br>';
        debugEl.scrollTop = debugEl.scrollHeight;
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOG', message: line}));
      ` : ''}
    }

    log('[INIT] Video URL: ${videoUrl.replace(/'/g, "\\'").substring(0, 200)}');
    log('[INIT] MIME type: ${mimeType}');
    log('[INIT] Page cookies available: ' + (document.cookie ? 'yes' : 'none'));

    var v = document.getElementById('player');

    v.addEventListener('loadstart', function() { log('[EVENT] loadstart'); });
    v.addEventListener('loadedmetadata', function() {
      log('[EVENT] loadedmetadata — duration=' + v.duration + ' videoWidth=' + v.videoWidth + 'x' + v.videoHeight);
    });
    v.addEventListener('loadeddata', function() {
      log('[EVENT] loadeddata — readyState=' + v.readyState);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOADED'}));
    });
    v.addEventListener('canplay', function() { log('[EVENT] canplay'); });
    v.addEventListener('playing', function() { log('[EVENT] playing'); });
    v.addEventListener('waiting', function() { log('[EVENT] waiting'); });
    v.addEventListener('stalled', function() { log('[EVENT] stalled — network may be blocked'); });
    v.addEventListener('suspend', function() { log('[EVENT] suspend'); });
    v.addEventListener('abort', function() { log('[EVENT] abort'); });

    v.addEventListener('error', function(e) {
      var code = v.error ? v.error.code : 'N/A';
      var msg = v.error ? v.error.message : 'Unknown error';
      var codeNames = {1:'MEDIA_ERR_ABORTED',2:'MEDIA_ERR_NETWORK',3:'MEDIA_ERR_DECODE',4:'MEDIA_ERR_SRC_NOT_SUPPORTED'};
      var codeName = codeNames[code] || 'UNKNOWN';
      log('[ERROR] code=' + code + ' (' + codeName + ') msg=' + msg);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR', message: codeName + ': ' + msg, code: code}));
      document.querySelector('.wrapper').innerHTML =
        '<div class="error"><h2>Unable to play video</h2>'
        + '<p>Error: ' + codeName + '</p>'
        + '<p>' + msg + '</p>'
        + '<p style="margin-top:12px;font-size:12px;color:#666">URL: ${videoUrl.replace(/'/g, "\\'").substring(0, 120)}...</p></div>';
    });

    var src = v.querySelector('source');
    if (src) {
      src.addEventListener('error', function(e) {
        log('[SOURCE ERROR] The <source> element failed to load');
      });
    }

    // Also try fetch to check if URL is accessible
    fetch('${videoUrl.replace(/'/g, "\\'")}', { method: 'HEAD', mode: 'no-cors' })
      .then(function(r) { log('[FETCH HEAD] status=' + r.status + ' type=' + r.type); })
      .catch(function(e) { log('[FETCH HEAD ERROR] ' + e.message); });
  </script>  
`
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; background:#000; overflow:hidden; }
    .wrapper {
      width:100%; height:100%;
      display:flex; align-items:center; justify-content:center;
    }
    video {
      max-width:100%; max-height:100%;
      background:#000;
    }
    .error {
      color:#fff; text-align:center; padding:24px; font-family:sans-serif;
    }
    .error h2 { margin-bottom:8px; color:#ff6b6b; }
    .error p { color:#999; font-size:14px; word-break:break-all; }
    .debug {
      position:fixed; bottom:0; left:0; right:0;
      background:rgba(0,0,0,0.85); color:#0f0; font-size:11px;
      font-family:monospace; padding:8px; max-height:30vh;
      overflow-y:auto; z-index:999;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <video id="player" autoplay playsinline>
      <source src="${videoUrl}" type="${mimeType}">
    </video>
  </div>
  <div id="debugLog" class="debug"></div>
  ${scriptLog}
  <script>
    var debugEl = document.getElementById('debugLog');
    function log(msg) {
      ${IS_USE_LOG ? `
      var ts = new Date().toISOString().substr(11, 12);
      var line = ts + ' ' + msg;
      debugEl.innerHTML += line + '<br>';
      debugEl.scrollTop = debugEl.scrollHeight;
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOG', message: line}));
      ` : ''}
    }

    log('[INIT] Video URL: ${videoUrl.replace(/'/g, "\\'").substring(0, 200)}');
    log('[INIT] MIME type: ${mimeType}');
    log('[INIT] Page cookies available: ' + (document.cookie ? 'yes' : 'none'));

    var v = document.getElementById('player');

    v.addEventListener('loadstart', function() { log('[EVENT] loadstart'); });
    v.addEventListener('loadedmetadata', function() {
      log('[EVENT] loadedmetadata — duration=' + v.duration + ' videoWidth=' + v.videoWidth + 'x' + v.videoHeight);
    });
    v.addEventListener('loadeddata', function() {
      log('[EVENT] loadeddata — readyState=' + v.readyState);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOADED'}));
    });
    v.addEventListener('canplay', function() { log('[EVENT] canplay'); });
    v.addEventListener('playing', function() { log('[EVENT] playing'); });
    v.addEventListener('waiting', function() { log('[EVENT] waiting'); });
    v.addEventListener('stalled', function() { log('[EVENT] stalled — network may be blocked'); });
    v.addEventListener('suspend', function() { log('[EVENT] suspend'); });
    v.addEventListener('abort', function() { log('[EVENT] abort'); });

    v.addEventListener('error', function(e) {
      var code = v.error ? v.error.code : 'N/A';
      var msg = v.error ? v.error.message : 'Unknown error';
      var codeNames = {1:'MEDIA_ERR_ABORTED',2:'MEDIA_ERR_NETWORK',3:'MEDIA_ERR_DECODE',4:'MEDIA_ERR_SRC_NOT_SUPPORTED'};
      var codeName = codeNames[code] || 'UNKNOWN';
      log('[ERROR] code=' + code + ' (' + codeName + ') msg=' + msg);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR', message: codeName + ': ' + msg, code: code}));
      document.querySelector('.wrapper').innerHTML =
        '<div class="error"><h2>Unable to play video</h2>'
        + '<p>Error: ' + codeName + '</p>'
        + '<p>' + msg + '</p>'
        + '<p style="margin-top:12px;font-size:12px;color:#666">URL: ${videoUrl.replace(/'/g, "\\'").substring(0, 120)}...</p></div>';
    });

    var src = v.querySelector('source');
    if (src) {
      src.addEventListener('error', function(e) {
        log('[SOURCE ERROR] The <source> element failed to load');
        log('[SOURCE ERROR] ' + JSON.stringify(e));
      });
    }

    // Also try fetch to check if URL is accessible
    fetch('${videoUrl.replace(/'/g, "\\'")}', { method: 'HEAD', mode: 'no-cors' })
      .then(function(r) { log('[FETCH HEAD] status=' + r.status + ' type=' + r.type); })
      .catch(function(e) { log('[FETCH HEAD ERROR] ' + e.message); });

    setInterval(function() {
      var v = document.getElementById('player');
      if (!v) return;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'VIDEO_STATE',
        currentTime: v.currentTime || 0,
        duration: isFinite(v.duration) ? v.duration : 0,
        paused: v.paused,
        muted: v.muted,
      }));
    }, 250);
  </script>
</body>
</html>`;
}

function buildDashPlayerHtml(videoUrl: string, startTime: number): string {
  const escapedUrl = videoUrl.replace(/'/g, "\\'");
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; background:#000; overflow:hidden; }
    .wrapper { width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
    video { max-width:100%; max-height:100%; background:#000; }
    .error { color:#fff; text-align:center; padding:24px; font-family:sans-serif; }
    .error h2 { margin-bottom:8px; color:#ff6b6b; }
    .error p { color:#999; font-size:14px; word-break:break-all; }
  </style>
  <script src="https://cdn.dashjs.org/latest/dash.all.min.js"></script>
</head>
<body>
  <div class="wrapper">
    <video id="player" autoplay playsinline></video>
  </div>
  <script>
    var videoUrl = '${escapedUrl}';
    var v = document.getElementById('player');

    v.addEventListener('loadeddata', function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOADED'}));
    });
    v.addEventListener('error', function() {
      var code = v.error ? v.error.code : 'N/A';
      var msg = v.error ? v.error.message : 'Unknown';
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR', message: msg, code: code}));
    });

    setInterval(function() {
      var v = document.getElementById('player');
      if (!v) return;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'VIDEO_STATE',
        currentTime: v.currentTime || 0,
        duration: isFinite(v.duration) ? v.duration : 0,
        paused: v.paused,
        muted: v.muted,
      }));
    }, 250);

    if (typeof dashjs !== 'undefined') {
      var player = dashjs.MediaPlayer().create();
      player.initialize(v, videoUrl, true);
      if (${startTime} > 0) {
        player.on(dashjs.MediaPlayer.events['PLAYBACK_METADATA_LOADED'], function() {
          player.seek(${startTime});
        });
      }
      player.on(dashjs.MediaPlayer.events['ERROR'], function(e) {
        var detail = e.error ? (e.error.message || e.error.code || JSON.stringify(e.error)) : 'Unknown';
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR', message: 'DASH: ' + detail}));
        document.querySelector('.wrapper').innerHTML =
          '<div class="error"><h2>Unable to play DASH stream</h2>'
          + '<p>' + detail + '</p>'
          + '<p style="margin-top:12px;font-size:12px;color:#666">' + videoUrl.substring(0, 120) + '</p></div>';
      });
    } else {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR', message:'dash.js unavailable'}));
      document.querySelector('.wrapper').innerHTML =
        '<div class="error"><h2>DASH Not Supported</h2><p>Could not load dash.js player.</p></div>';
    }
  </script>
</body>
</html>`;
}

function buildHlsPlayerHtml(videoUrl: string, startTime: number): string {
  const escapedUrl = videoUrl.replace(/'/g, "\\'");
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; background:#000; overflow:hidden; }
    .wrapper {
      width:100%; height:100%;
      display:flex; align-items:center; justify-content:center;
    }
    video {
      max-width:100%; max-height:100%;
      background:#000;
    }
    .error {
      color:#fff; text-align:center; padding:24px; font-family:sans-serif;
    }
    .error h2 { margin-bottom:8px; color:#ff6b6b; }
    .error p { color:#999; font-size:14px; word-break:break-all; }
    .debug {
      position:fixed; bottom:0; left:0; right:0;
      background:rgba(0,0,0,0.85); color:#0f0; font-size:11px;
      font-family:monospace; padding:8px; max-height:30vh;
      overflow-y:auto; z-index:999;
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
</head>
<body>
  <div class="wrapper">
    <video id="player" autoplay playsinline></video>
  </div>
  <div id="debugLog" class="debug"></div>
  <script>
    var debugEl = document.getElementById('debugLog');
    function log(msg) {
      ${IS_USE_LOG ? `
      var ts = new Date().toISOString().substr(11, 12);
      var line = ts + ' ' + msg;
      debugEl.innerHTML += line + '<br>';
      debugEl.scrollTop = debugEl.scrollHeight;
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOG', message: line}));
      ` : ''}
    }

    var videoUrl = '${escapedUrl}';
    log('[INIT] HLS URL: ' + videoUrl.substring(0, 200));

    var v = document.getElementById('player');

    v.addEventListener('loadedmetadata', function() {
      log('[EVENT] loadedmetadata — duration=' + v.duration + ' ' + v.videoWidth + 'x' + v.videoHeight);
    });
    v.addEventListener('loadeddata', function() {
      log('[EVENT] loadeddata — readyState=' + v.readyState);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOADED'}));
    });
    v.addEventListener('canplay', function() { log('[EVENT] canplay'); });
    v.addEventListener('playing', function() { log('[EVENT] playing'); });
    v.addEventListener('waiting', function() { log('[EVENT] waiting'); });
    v.addEventListener('error', function() {
      var code = v.error ? v.error.code : 'N/A';
      var msg = v.error ? v.error.message : 'Unknown';
      log('[ERROR] code=' + code + ' msg=' + msg);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR', message: msg, code: code}));
    });

    if (Hls.isSupported()) {
      log('[HLS.js] Supported — attaching');
      var hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: false,
      });
      hls.loadSource(videoUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
        log('[HLS.js] Manifest parsed — ' + data.levels.length + ' quality level(s)');
        if (${startTime} > 0) v.currentTime = ${startTime};
        v.play().catch(function(e) { log('[HLS.js] Autoplay blocked: ' + e.message); });
      });
      hls.on(Hls.Events.ERROR, function(event, data) {
        log('[HLS.js ERROR] type=' + data.type + ' details=' + data.details + ' fatal=' + data.fatal);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              log('[HLS.js] Network error — trying to recover');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              log('[HLS.js] Media error — trying to recover');
              hls.recoverMediaError();
              break;
            default:
              log('[HLS.js] Fatal error — cannot recover');
              hls.destroy();
              window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR', message: 'HLS fatal: ' + data.details}));
              document.querySelector('.wrapper').innerHTML =
                '<div class="error"><h2>Unable to play HLS stream</h2>'
                + '<p>' + data.details + '</p>'
                + '<p style="margin-top:12px;font-size:12px;color:#666">URL: ' + videoUrl.substring(0, 120) + '...</p></div>';
              break;
          }
        }
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      log('[HLS] Native HLS support — setting src directly');
      v.src = videoUrl;
      v.addEventListener('loadedmetadata', function() {
        if (${startTime} > 0) v.currentTime = ${startTime};
        v.play().catch(function(e) { log('[HLS] Autoplay blocked: ' + e.message); });
      });
    } else {
      log('[HLS] Not supported in this environment');
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'ERROR', message: 'HLS not supported'}));
      document.querySelector('.wrapper').innerHTML =
        '<div class="error"><h2>HLS Not Supported</h2><p>This browser does not support HLS playback.</p></div>';
    }

    setInterval(function() {
      var v = document.getElementById('player');
      if (!v) return;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'VIDEO_STATE',
        currentTime: v.currentTime || 0,
        duration: isFinite(v.duration) ? v.duration : 0,
        paused: v.paused,
        muted: v.muted,
      }));
    }, 250);
  </script>
</body>
</html>`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function VideoPreviewModal({
  visible,
  video,
  onDownload,
  onClose,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Video playback state — driven by VIDEO_STATE messages from the HTML player
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoIsPaused, setVideoIsPaused] = useState(true);
  const [videoIsMuted, setVideoIsMuted] = useState(false);

  const injectTogglePlay = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      "(function(){var v=document.getElementById('player');if(v){v.paused?v.play().catch(function(){}):v.pause();}})();true;",
    );
  }, []);

  const injectToggleMute = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      "(function(){var v=document.getElementById('player');if(v)v.muted=!v.muted;})();true;",
    );
  }, []);

  const injectSeek = useCallback((time: number) => {
    webViewRef.current?.injectJavaScript(
      `(function(){var v=document.getElementById('player');if(v)v.currentTime=${time};})();true;`,
    );
  }, []);

  const injectSkipBack = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      "(function(){var v=document.getElementById('player');if(v)v.currentTime=Math.max(0,v.currentTime-10);})();true;",
    );
  }, []);

  const injectSkipForward = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      "(function(){var v=document.getElementById('player');if(v)v.currentTime=Math.min(v.duration||0,v.currentTime+10);})();true;",
    );
  }, []);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'LOG') {
        // console.log(`${TAG} [Player] ${msg.message}`);
      } else if (msg.type === 'LOADED') {
        setIsLoading(false);
        setHasError(false);
      } else if (msg.type === 'ERROR') {
        console.error(`${TAG} Video playback error: code=${msg.code} msg=${msg.message}`);
        setIsLoading(false);
        setHasError(true);
      } else if (msg.type === 'VIDEO_STATE') {
        setVideoCurrentTime(msg.currentTime);
        setVideoDuration(msg.duration);
        setVideoIsPaused(msg.paused);
        setVideoIsMuted(msg.muted);
      }
    } catch (e) {
      console.warn(`${TAG} Non-JSON message from player:`, event.nativeEvent.data);
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (video) {
      onDownload(video);
      onClose();
    }
  }, [video, onDownload, onClose]);

  const handleClose = useCallback(() => {
    setIsLoading(true);
    setHasError(false);
    setVideoDuration(0);
    setVideoCurrentTime(0);
    setVideoIsPaused(true);
    setVideoIsMuted(false);
    onClose();
  }, [onClose]);

  if (!video) return null;

  const blobNeedsExtraction =
    (video.type === 'blob' || video.type === 'blob-ready') && !video.localUri;
  const startTime = video.startTime ?? 0;
  // For blob types we play the extracted file from cache (file://...). For
  // everything else we use the original URL.
  const playbackUrl = video.localUri ? video.localUri : video.url;
  const playbackType = video.localUri
    ? (video.type === 'webm' ? 'webm' : 'mp4')
    : video.type;
  const html = playbackType === 'hls'
    ? buildHlsPlayerHtml(playbackUrl, startTime)
    : playbackType === 'dash'
      ? buildDashPlayerHtml(playbackUrl, startTime)
      : buildPlayerHtml(playbackUrl, playbackType);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={handleClose}>
      <View style={styles.container}>
        <StatusBar hidden />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerType}>{video.type.toUpperCase()}</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {video.pageTitle || 'Video Preview'}
            </Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        {/* Video Player via WebView */}
        <View style={styles.videoContainer}>
          <>
            {isLoading && !hasError && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#4ECDC4" />
                <Text style={styles.loadingText}>Loading video...</Text>
              </View>
            )}

            <WebView
              ref={webViewRef}
              source={{
                html,
                // For locally-extracted blob previews, the HTML must share
                // the file:// origin with the video file so the <video> tag
                // is allowed to load it. For remote URLs, keep the original
                // page origin so cookies/CORS continue to work.
                baseUrl: video.localUri
                  ? video.localUri.replace(/[^/]+$/, '')
                  : video.pageUrl,
              }}
              style={styles.webview}
              onMessage={handleMessage}
              onError={(syntheticEvent) => {
                const { nativeEvent } = syntheticEvent;
                console.error(`${TAG} WebView onError:`, nativeEvent);
                setHasError(true);
                setIsLoading(false);
              }}
              onHttpError={(syntheticEvent) => {
                const { nativeEvent } = syntheticEvent;
                console.error(`${TAG} WebView HTTP error: status=${nativeEvent.statusCode} url=${nativeEvent.url}`);
              }}
              onLoadEnd={() => {
                // console.log(`${TAG} WebView HTML loaded`);
              }}
              javaScriptEnabled
              domStorageEnabled
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback
              mixedContentMode="always"
              allowsFullscreenVideo
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              originWhitelist={['*']}
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              allowsProtectedMedia
              userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            />

            {!hasError && (
              <VideoPlayerController
                currentTime={videoCurrentTime}
                duration={videoDuration}
                isPaused={videoIsPaused}
                isMuted={videoIsMuted}
                onTogglePlay={injectTogglePlay}
                onToggleMute={injectToggleMute}
                onSeek={injectSeek}
                onSkipBack={injectSkipBack}
                onSkipForward={injectSkipForward}
              />
            )}
          </>
        </View>

        {/* Bottom Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.downloadBtn} onPress={handleDownload}>
            <Text style={styles.downloadBtnText}>↓ Download Video</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  headerType: {
    backgroundColor: '#4ECDC4',
    color: '#1A1A2E',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    color: '#CCC',
    fontSize: 14,
  },
  headerSpacer: {
    width: 36,
  },
  videoContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  loadingText: {
    color: '#999',
    fontSize: 14,
    marginTop: 12,
  },
  actions: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 32,
  },
  downloadBtn: {
    backgroundColor: '#4ECDC4',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  downloadBtnText: {
    color: '#1A1A2E',
    fontWeight: '700',
    fontSize: 16,
  },
  blobUnsupported: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  blobIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  blobTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  blobBody: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
