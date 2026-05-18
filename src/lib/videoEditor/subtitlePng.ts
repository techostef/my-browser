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
  const fontSize = Math.max(20, Math.round(videoHeight * 0.045));
  const segData = JSON.stringify(segments.map(s => ({ id: s.id, text: s.text })));

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;}body{background:transparent;overflow:hidden;}</style>
</head><body><script>
(function(){
  var segs = ${segData};
  var W = ${videoWidth};
  var FS = ${fontSize};
  var PAD = 24;
  var LINE_H = FS * 1.35;
  // Wrap budget: ~75% of canvas width so subtitles never reach the edge.
  var MAX_TEXT_W = Math.max(40, Math.round(W * 0.75) - PAD * 2);
  // Hard char-count ceiling per line as a backup when measureText is broken.
  var MAX_CHARS = Math.max(8, Math.floor(MAX_TEXT_W / (FS * 0.6)));

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

  // Pessimistic width: max of measureText and a char-count estimate, so we
  // wrap eagerly when WebView reports a smaller width than actual paint.
  function measureW(ctx, s) {
    if (!s) return 0;
    var m = ctx.measureText(s).width;
    var estimate = s.length * FS * 0.6;
    if (m > 0 && isFinite(m)) return Math.max(m, estimate);
    return estimate;
  }

  function fitsLine(ctx, s, maxTextW) {
    if (!s) return true;
    return measureW(ctx, s) <= maxTextW && s.length <= MAX_CHARS;
  }

  function wrapLine(ctx, text, maxTextW) {
    if (!text) return [''];

    var words = String(text).split(' ');
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w === '') continue;
      var candidate = cur ? cur + ' ' + w : w;
      if (fitsLine(ctx, candidate, maxTextW)) {
        cur = candidate;
        continue;
      }
      if (cur) { lines.push(cur); cur = ''; }
      if (fitsLine(ctx, w, maxTextW)) {
        cur = w;
      } else {
        var piece = '';
        for (var k = 0; k < w.length; k++) {
          var ch = w.charAt(k);
          if (fitsLine(ctx, piece + ch, maxTextW)) {
            piece += ch;
          } else {
            if (piece) lines.push(piece);
            piece = ch;
          }
        }
        cur = piece;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function wrapSegText(ctx, text) {
    var rawLines = text ? String(text).split('\\n') : [''];
    var out = [];
    for (var li = 0; li < rawLines.length; li++) {
      var wrapped = wrapLine(ctx, rawLines[li], MAX_TEXT_W);
      for (var wi = 0; wi < wrapped.length; wi++) out.push(wrapped[wi]);
    }
    return out;
  }

  // First pass: determine the tallest PNG needed across all segments so every
  // PNG shares the same height (concat demuxer needs uniform dimensions).
  function computeStripHeight() {
    var probe = document.createElement('canvas').getContext('2d');
    probe.font = 'bold ' + FS + 'px sans-serif';
    probe.textAlign = 'center';
    probe.textBaseline = 'middle';
    var maxLines = 1;
    for (var i = 0; i < segs.length; i++) {
      var n = wrapSegText(probe, segs[i].text).length;
      if (n > maxLines) maxLines = n;
    }
    return Math.max(60, Math.ceil(maxLines * LINE_H + 30));
  }

  var SH = computeStripHeight();

  function renderOne(seg) {
    var c = document.createElement('canvas');
    c.width = W; c.height = SH;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, SH);

    ctx.font = 'bold ' + FS + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var lines = wrapSegText(ctx, seg.text);
    var totalTextH = lines.length * LINE_H;
    var maxW = 0;
    lines.forEach(function(l){ var m = measureW(ctx, l); if(m > maxW) maxW = m; });
    var bw = Math.min(maxW + PAD * 2, W - 40);
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
    var startY = by + 10 + LINE_H / 2;
    lines.forEach(function(line, i){
      ctx.fillText(line, W / 2, startY + i * LINE_H);
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
