/**
 * JavaScript injected into the WebView to intercept popup/new-tab attempts.
 *
 * Intercepts:
 * 1. window.open() calls
 * 2. <a target="_blank"> link clicks
 *
 * Instead of opening a new window/tab, posts a POPUP_BLOCKED message to RN
 * with the target URL so the native side can show a notification banner.
 */
export const POPUP_BLOCKER_JS = `
(function() {
  'use strict';

  if (window.__POPUP_BLOCKER_INSTALLED__) return;
  window.__POPUP_BLOCKER_INSTALLED__ = true;

  function postPopupBlocked(url) {
    try {
      if (!url) return;
      // Resolve relative URLs
      var resolved = url;
      try { resolved = new URL(url, location.href).href; } catch(e) {}
      // Don't block same-page anchors
      try {
        var cur = new URL(location.href);
        var tgt = new URL(resolved);
        if (cur.origin === tgt.origin && cur.pathname === tgt.pathname && tgt.hash) return;
      } catch(e) {}
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'POPUP_BLOCKED',
        payload: { url: resolved }
      }));
    } catch(e) {}
  }

  // ── 1. Intercept window.open ───────────────────────────────────────────────

  try {
    var origOpen = window.open;
    window.open = function(url, target, features) {
      if (url) {
        postPopupBlocked(url);
      }
      return null;
    };
  } catch(e) {}

  // ── 2. Intercept target="_blank" link clicks ───────────────────────────────

  try {
    document.addEventListener('click', function(e) {
      var el = e.target;
      while (el && el.nodeType === 1) {
        if (el.tagName === 'A') break;
        el = el.parentElement;
      }
      if (!el || el.tagName !== 'A') return;
      var target = (el.getAttribute('target') || '').toLowerCase();
      if (target === '_blank' || target === '_new') {
        var href = el.href;
        if (!href) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        postPopupBlocked(href);
      }
    }, true);
  } catch(e) {}

})();
`;
