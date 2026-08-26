/**
 * HTML documents for the WebView playback engine.
 *
 * Each document exposes the same contract to React Native, which is what
 * `useWebViewController` drives:
 *   - a `<video id="player">` element that can be driven via injectJavaScript
 *   - postMessage of `{type:'LOADED'}`, `{type:'ERROR'}`, `{type:'LOG'}`
 *   - postMessage of `{type:'VIDEO_STATE', currentTime, duration, paused, muted}`
 *     every 250ms
 */

const IS_USE_LOG = true;

const BASE_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#000; overflow:hidden; }
  .wrapper { width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
  video { max-width:100%; max-height:100%; background:#000; }
  .error { color:#fff; text-align:center; padding:24px; font-family:sans-serif; }
  .error h2 { margin-bottom:8px; color:#ff6b6b; }
  .error p { color:#999; font-size:14px; word-break:break-all; }
  .debug {
    position:fixed; bottom:0; left:0; right:0;
    background:rgba(0,0,0,0.85); color:#0f0; font-size:11px;
    font-family:monospace; padding:8px; max-height:30vh;
    overflow-y:auto; z-index:999;
  }
`;

/** `log(msg)` — mirrors to the on-page debug pane and to RN. No-op when logging is off. */
const LOG_FN = `
  var debugEl = document.getElementById('debugLog');
  function log(msg) {
    ${
      IS_USE_LOG
        ? `
    var ts = new Date().toISOString().substr(11, 12);
    var line = ts + ' ' + msg;
    debugEl.innerHTML += line + '<br>';
    debugEl.scrollTop = debugEl.scrollHeight;
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOG', message: line}));
    `
        : ""
    }
  }
`;

/** Heartbeat that keeps the native controls in sync with the page. */
const STATE_POLL = `
  setInterval(function() {
    var p = document.getElementById('player');
    if (!p) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'VIDEO_STATE',
      currentTime: p.currentTime || 0,
      duration: isFinite(p.duration) ? p.duration : 0,
      paused: p.paused,
      muted: p.muted,
    }));
  }, 250);
`;

const escapeQuotes = (url: string) => url.replace(/'/g, "\\'");

/** Progressive playback (mp4 / webm / anything the platform decodes directly). */
export function buildProgressivePlayerHtml(videoUrl: string, videoType: string): string {
  const mimeType = videoType === "webm" ? "video/webm" : "video/mp4";
  const escapedUrl = escapeQuotes(videoUrl);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <style>${BASE_CSS}</style>
</head>
<body>
  <div class="wrapper">
    <video id="player" autoplay playsinline>
      <source src="${videoUrl}" type="${mimeType}">
    </video>
  </div>
  <div id="debugLog" class="debug"></div>
  <script>
    ${LOG_FN}

    log('[INIT] Video URL: ${escapedUrl.substring(0, 200)}');
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

    v.addEventListener('error', function() {
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
        + '<p style="margin-top:12px;font-size:12px;color:#666">URL: ${escapedUrl.substring(0, 120)}...</p></div>';
    });

    var src = v.querySelector('source');
    if (src) {
      src.addEventListener('error', function(e) {
        log('[SOURCE ERROR] The <source> element failed to load');
        log('[SOURCE ERROR] ' + JSON.stringify(e));
      });
    }

    // Probe the URL separately — tells apart "decoder refused it" from
    // "the request never got through".
    fetch('${escapedUrl}', { method: 'HEAD', mode: 'no-cors' })
      .then(function(r) { log('[FETCH HEAD] status=' + r.status + ' type=' + r.type); })
      .catch(function(e) { log('[FETCH HEAD ERROR] ' + e.message); });

    ${STATE_POLL}
  </script>
</body>
</html>`;
}

/** MPEG-DASH via dash.js. */
export function buildDashPlayerHtml(videoUrl: string, startTime: number): string {
  const escapedUrl = escapeQuotes(videoUrl);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <style>${BASE_CSS}</style>
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

    ${STATE_POLL}

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

/** HLS via hls.js, falling back to native HLS where the platform has it. */
export function buildHlsPlayerHtml(videoUrl: string, startTime: number): string {
  const escapedUrl = escapeQuotes(videoUrl);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <style>${BASE_CSS}</style>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
</head>
<body>
  <div class="wrapper">
    <video id="player" autoplay playsinline></video>
  </div>
  <div id="debugLog" class="debug"></div>
  <script>
    ${LOG_FN}

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

    ${STATE_POLL}
  </script>
</body>
</html>`;
}
