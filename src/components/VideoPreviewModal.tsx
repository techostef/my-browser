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

const TAG = '[VideoPreview]';

interface Props {
  visible: boolean;
  video: DetectedVideo | null;
  onDownload: (video: DetectedVideo) => void;
  onClose: () => void;
}

function buildPlayerHtml(videoUrl: string, videoType: string): string {
  const mimeType = videoType === 'webm' ? 'video/webm' : 'video/mp4';
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
    <video id="player" controls autoplay playsinline crossorigin="anonymous">
      <source src="${videoUrl}" type="${mimeType}">
    </video>
  </div>
  <div id="debugLog" class="debug"></div>
  <script>
    var debugEl = document.getElementById('debugLog');
    function log(msg) {
      var ts = new Date().toISOString().substr(11, 12);
      var line = ts + ' ' + msg;
      debugEl.innerHTML += line + '<br>';
      debugEl.scrollTop = debugEl.scrollHeight;
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOG', message: line}));
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
</body>
</html>`;
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

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'LOG') {
        console.log(`${TAG} [Player] ${msg.message}`);
      } else if (msg.type === 'LOADED') {
        console.log(`${TAG} Video loaded successfully`);
        setIsLoading(false);
        setHasError(false);
      } else if (msg.type === 'ERROR') {
        console.error(`${TAG} Video playback error: code=${msg.code} msg=${msg.message}`);
        setIsLoading(false);
        setHasError(true);
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
    onClose();
  }, [onClose]);

  if (!video) return null;

  console.log(`${TAG} Rendering preview for video:`, {
    url: video.url.substring(0, 150),
    type: video.type,
    pageUrl: video.pageUrl,
  });

  const html = buildPlayerHtml(video.url, video.type);

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
          {isLoading && !hasError && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#4ECDC4" />
              <Text style={styles.loadingText}>Loading video...</Text>
            </View>
          )}

          <WebView
            ref={webViewRef}
            source={{ html, baseUrl: video.pageUrl }}
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
              console.log(`${TAG} WebView HTML loaded`);
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
            allowsProtectedMedia
            userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
          />
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
});
