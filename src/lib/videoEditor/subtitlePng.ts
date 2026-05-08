import type { Segment } from '../../types/videoEditor';

/**
 * Returns an HTML page that renders each subtitle segment onto an HTML5 canvas
 * and posts each PNG back as a separate message:
 *   { type: 'png', id: number, png: string, index: number, total: number }
 *   { type: 'done' }
 *   { type: 'error', message: string }
 *
 * One PNG per message keeps each payload small enough for WebView's bridge.
 * Execution is deferred until window.ReactNativeWebView is ready so we don't
 * race the bridge injection on Android.
 */
export function buildSubtitleRenderHtml(
  segments: Segment[],
  videoWidth: number,
  videoHeight: number,
): string {
  const stripH = Math.max(60, Math.round(videoHeight * 0.13));
  const fontSize = Math.max(20, Math.round(videoHeight * 0.045));
  const segData = JSON.stringify(segments.map(s => ({ id: s.id, text: s.text })));

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;}body{background:transparent;overflow:hidden;}</style>
</head><body><script>
(function(){
  var segs = ${segData};
  var W = ${videoWidth};
  var SH = ${stripH};
  var FS = ${fontSize};

  function post(obj) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function whenReady(fn) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      fn();
    } else {
      setTimeout(function(){ whenReady(fn); }, 30);
    }
  }

  function renderOne(seg) {
    var c = document.createElement('canvas');
    c.width = W; c.height = SH;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, SH);

    ctx.font = 'bold ' + FS + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var lines = seg.text ? String(seg.text).split('\\n') : [''];
    var lineH = FS * 1.35;
    var totalTextH = lines.length * lineH;
    var maxW = 0;
    lines.forEach(function(l){ var m = ctx.measureText(l).width; if(m > maxW) maxW = m; });
    var pad = 24;
    var bw = Math.min(maxW + pad * 2, W - 40);
    var bh = totalTextH + 20;
    var bx = (W - bw) / 2;
    var by = (SH - bh) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill();
    } else {
      ctx.fillRect(bx, by, bw, bh);
    }

    ctx.fillStyle = 'white';
    var startY = by + 10 + lineH / 2;
    lines.forEach(function(line, i){
      ctx.fillText(line, W / 2, startY + i * lineH);
    });

    return c.toDataURL('image/png').split(',')[1];
  }

  function renderBlank() {
    var c = document.createElement('canvas');
    c.width = W; c.height = SH;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, SH);
    return c.toDataURL('image/png').split(',')[1];
  }

  whenReady(function(){
    try {
      var total = segs.length + 1;
      for (var i = 0; i < segs.length; i++) {
        var png = renderOne(segs[i]);
        post({ type: 'png', id: segs[i].id, png: png, index: i, total: total });
      }
      // Final blank PNG (id -1) used to fill gaps between subtitles
      post({ type: 'png', id: -1, png: renderBlank(), index: segs.length, total: total });
      post({ type: 'done' });
    } catch (e) {
      post({ type: 'error', message: (e && e.message) ? e.message : String(e) });
    }
  });
})();
</script></body></html>`;
}
