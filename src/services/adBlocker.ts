/**
 * JavaScript injected into the WebView to block ads.
 *
 * Strategy:
 * 1. CSS cosmetic filtering — hides common ad containers instantly.
 * 2. Network interception — blocks fetch/XHR to known ad domains.
 * 3. MutationObserver — removes dynamically-inserted ad elements.
 * 4. Popup / window.open blocking.
 */
export const AD_BLOCKER_JS = `
(function() {
  'use strict';

  // Prevent double-injection
  if (window.__AD_BLOCKER_INSTALLED__) return;
  window.__AD_BLOCKER_INSTALLED__ = true;

  // ── 1. Known ad domains (substring match) ──────────────────────────────────

  var AD_DOMAINS = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'google-analytics.com',
    'googletagmanager.com',
    'adservice.google.',
    'pagead2.googlesyndication.com',
    'ads.youtube.com',
    'ad.doubleclick.net',
    'facebook.com/tr',
    'connect.facebook.net/en_US/fbevents',
    'analytics.tiktok.com',
    'ads-api.twitter.com',
    'static.ads-twitter.com',
    'amazon-adsystem.com',
    'adnxs.com',
    'adsrvr.org',
    'criteo.com',
    'criteo.net',
    'outbrain.com',
    'taboola.com',
    'moatads.com',
    'serving-sys.com',
    'adcolony.com',
    'applovin.com',
    'mopub.com',
    'unity3d.com/ads',
    'unityads.unity3d.com',
    'inmobi.com',
    'chartboost.com',
    'pubmatic.com',
    'openx.net',
    'rubiconproject.com',
    'smartadserver.com',
    'indexww.com',
    'casalemedia.com',
    'advertising.com',
    'adform.net',
    'popads.net',
    'popcash.net',
    'propellerads.com',
    'mgid.com',
    'revcontent.com',
    'zergnet.com',
    'adroll.com',
    'mediavine.com',
    'ezoic.net',
    'adhigh.net',
    'adsterra.com',
    'trafficjunky.com',
    'exoclick.com',
    'juicyads.com',
    'clickadu.com',
  ];

  function isAdUrl(url) {
    if (!url) return false;
    var lower = url.toLowerCase();
    for (var i = 0; i < AD_DOMAINS.length; i++) {
      if (lower.indexOf(AD_DOMAINS[i]) !== -1) return true;
    }
    return false;
  }

  // ── 2. CSS cosmetic hiding ─────────────────────────────────────────────────

  var AD_SELECTORS = [
    // Google Ads
    'ins.adsbygoogle',
    '[id^="google_ads"]',
    '[id^="div-gpt-ad"]',
    '.adsbygoogle',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    // Generic ad containers
    '[class*="ad-banner"]',
    '[class*="ad-container"]',
    '[class*="ad-wrapper"]',
    '[class*="ad-slot"]',
    '[class*="ad-unit"]',
    '[id*="ad-banner"]',
    '[id*="ad-container"]',
    '[id*="ad-wrapper"]',
    '[data-ad]',
    '[data-ad-slot]',
    '[data-ad-client]',
    '[data-adunit]',
    // Outbrain / Taboola
    '.OUTBRAIN',
    '[class*="taboola"]',
    '[id*="taboola"]',
    '[id*="outbrain"]',
    // Popups / overlays
    '[class*="popup-ad"]',
    '[class*="interstitial-ad"]',
    '[class*="sticky-ad"]',
    '[class*="bottom-ad"]',
    '[class*="top-ad"]',
    // Common video ads
    '[class*="video-ad"]',
    '[class*="preroll"]',
    '[class*="midroll"]',
  ].join(',');

  try {
    var style = document.createElement('style');
    style.id = '__rn_adblock_css';
    style.textContent = AD_SELECTORS.split(',').map(function(s) {
      return s.trim() + '{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;pointer-events:none!important}';
    }).join('');
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}

  // ── 3. Network interception — XHR ──────────────────────────────────────────

  try {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (isAdUrl(url)) {
        // Point to a data URI that returns empty — prevents network error noise
        return origOpen.call(this, method, 'data:text/plain,');
      }
      return origOpen.apply(this, arguments);
    };
  } catch (e) {}

  // ── 4. Network interception — fetch ────────────────────────────────────────

  try {
    var origFetch = window.fetch;
    window.fetch = function(input) {
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (isAdUrl(url)) {
        return Promise.resolve(new Response('', { status: 200 }));
      }
      return origFetch.apply(this, arguments);
    };
  } catch (e) {}

  // ── 5. Block window.open for ad URLs ────────────────────────────────────────
  // Note: general popup blocking is handled by the separate popupBlocker service.
  // This only blocks window.open calls to known ad domains.

  try {
    var origWindowOpen = window.open;
    window.open = function(url) {
      if (isAdUrl(url)) return null;
      return origWindowOpen.apply(this, arguments);
    };
  } catch (e) {}

  // ── 6. MutationObserver — remove dynamically inserted ads ──────────────────

  function removeAds() {
    try {
      var ads = document.querySelectorAll(AD_SELECTORS);
      for (var i = 0; i < ads.length; i++) {
        ads[i].style.setProperty('display', 'none', 'important');
        ads[i].style.setProperty('visibility', 'hidden', 'important');
        ads[i].style.setProperty('height', '0', 'important');
      }
      // Also block ad iframes
      var iframes = document.querySelectorAll('iframe');
      for (var j = 0; j < iframes.length; j++) {
        var src = iframes[j].src || '';
        if (isAdUrl(src)) {
          iframes[j].style.setProperty('display', 'none', 'important');
          iframes[j].style.setProperty('height', '0', 'important');
        }
      }
    } catch (e) {}
  }

  // Initial pass
  if (document.body) {
    removeAds();
  }

  // Observe DOM for dynamically loaded ads
  try {
    var observer = new MutationObserver(function() {
      removeAds();
    });
    var startObserving = function() {
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.body) {
      startObserving();
    } else {
      document.addEventListener('DOMContentLoaded', startObserving);
    }
  } catch (e) {}

  // Periodic sweep for stubborn ads
  setInterval(removeAds, 2000);

})();
`;
