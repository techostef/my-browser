/**
 * Injected into the LIVE WebView to detect manga index URL.
 * Posts: { type: 'MANGA_DETECTION', payload: MangaDetectionResult }
 */
export const MANGA_INDEX_DETECTOR_JS = `
(function() {
  try {
    var result = { found: false };

    // Common selectors for manga chapter page images
    var imgSelectors = ['.reading-content img', '.page-break img', '#readerarea img', '.chapter-content img'];
    var hasImages = imgSelectors.some(function(sel) {
      return document.querySelector(sel) !== null;
    });

    if (!hasImages) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MANGA_DETECTION', payload: result }));
      return;
    }

    // Try to find the series index URL via breadcrumbs / title links
    var indexUrl = null;
    var mangaTitle = null;

    // mangaread.org / mangadex-style: breadcrumb a tags
    var breadcrumbs = document.querySelectorAll('.breadcrumb a, .wp-breadcrumb a, nav.breadcrumb a');
    for (var i = 0; i < breadcrumbs.length; i++) {
      var href = breadcrumbs[i].href;
      var text = (breadcrumbs[i].textContent || '').trim();
      // Series page URLs typically don't end with /chapter-N/
      if (href && !/chapter/i.test(href) && /manga|series|comic/i.test(href)) {
        indexUrl = href;
        mangaTitle = text || null;
        break;
      }
    }

    // Fallback: look for a link whose text matches the page <h1> or nearby heading
    if (!indexUrl) {
      var heading = document.querySelector('h1, h2, .series-title, .manga-title');
      var headingText = heading ? (heading.textContent || '').trim() : '';
      if (headingText) {
        var links = document.querySelectorAll('a');
        for (var j = 0; j < links.length; j++) {
          var lhref = links[j].href;
          var ltext = (links[j].textContent || '').trim();
          if (lhref && ltext && ltext === headingText && /manga|series|comic/i.test(lhref)) {
            indexUrl = lhref;
            mangaTitle = ltext;
            break;
          }
        }
      }
    }

    // Fallback: strip last path segment (chapter slug) to get series URL
    if (!indexUrl) {
      try {
        var url = new URL(window.location.href);
        var parts = url.pathname.replace(/\\/$/, '').split('/');
        // Remove last segment (chapter slug) — series URL is one level up
        if (parts.length > 2) {
          parts.pop();
          indexUrl = url.origin + parts.join('/') + '/';
        }
      } catch(e) {}
    }

    if (indexUrl) {
      result.found = true;
      result.indexUrl = indexUrl;
      result.chapterPageUrl = window.location.href;
      result.mangaTitle = mangaTitle || document.title.replace(/chapter.*/i, '').trim();
    }

    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MANGA_DETECTION', payload: result }));
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MANGA_DETECTION', payload: { found: false } }));
  }
})(); true;
`;

/**
 * Injected into the BACKGROUND WebView after loading the manga index page.
 * Posts: { type: 'MANGA_CHAPTER_LIST', payload: MangaChapterInfo[] }
 * Chapters are sorted oldest first (ascending chapter number).
 */
export const MANGA_CHAPTER_LIST_EXTRACTOR_JS = `
(function() {
  function parseChapterNum(href) {
    var m = href.match(/\\/chapter-([\\w-]+)\\//i);
    if (!m) return null;
    var parts = m[1].split('-');
    var main = parts[0];
    var sub = parts[1] && /^\\d+$/.test(parts[1]) ? parts[1] : null;
    return sub ? main + '.' + sub : main;
  }

  function extract() {
    try {
      var chapters = [];
      var seen = {};

      function addItem(href, text) {
        if (!href || seen[href]) return;
        seen[href] = true;
        var num = parseChapterNum(href);
        if (!num) { var tm = text.match(/[\\d.]+/); num = tm ? tm[0] : String(chapters.length + 1); }
        chapters.push({ chapterNumber: num, title: text || 'Chapter ' + num, url: href });
      }

      // mangaread.org / WP Manga reader: chapter select dropdown (populated on chapter pages)
      var selectOpts = document.querySelectorAll(
        'select.single-chapter-select option[data-redirect], .selectpicker_chapter option[data-redirect]'
      );
      if (selectOpts.length > 0) {
        selectOpts.forEach(function(opt) {
          addItem(
            opt.getAttribute('data-redirect') || '',
            (opt.textContent || '').trim().replace(/\\s+/g, ' ')
          );
        });
      }

      // WP Manga index page: li.wp-manga-chapter list
      if (chapters.length === 0) {
        var listItems = document.querySelectorAll(
          'li.wp-manga-chapter a, .chapter-list li a, .chapters li a, ul.row-content-chapter li a, .chapter-item a'
        );
        listItems.forEach(function(el) {
          addItem(el.href || '', (el.textContent || '').trim().replace(/\\s+/g, ' '));
        });
      }

      chapters.sort(function(a, b) { return parseFloat(a.chapterNumber) - parseFloat(b.chapterNumber); });
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MANGA_CHAPTER_LIST', payload: chapters }));
    } catch(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MANGA_CHAPTER_LIST', payload: [] }));
    }
  }

  // Click the mobile nav button (mangaread.org) to load the chapter select, then extract
  var navBtn = document.querySelector('.mobile-nav-btn, i.icon.ion-md-menu');
  if (navBtn) {
    navBtn.click();
    setTimeout(extract, 800);
  } else {
    extract();
  }
})(); true;
`;

/**
 * Injected into the BACKGROUND WebView after loading a chapter page.
 * Waits up to 5s for images to appear, then posts:
 * { type: 'MANGA_PAGE_IMAGES', payload: string[] }  (absolute image URLs)
 */
export const MANGA_PAGE_IMAGES_EXTRACTOR_JS = `
(function() {
  function extract() {
    var selectors = [
      '.reading-content img',
      '.page-break img',
      '#readerarea img',
      '.chapter-content img',
      '.images-content img',
    ];
    var imgs = [];
    var seen = {};
    selectors.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(img) {
        var src = img.dataset.src || img.dataset.lazySrc || img.src || '';
        src = src.trim();
        if (src && !seen[src] && /^https?:\\/\\//i.test(src)) {
          seen[src] = true;
          imgs.push(src);
        }
      });
    });
    return imgs;
  }

  var attempts = 0;
  var maxAttempts = 25; // 25 x 200ms = 5s
  function tryExtract() {
    var imgs = extract();
    if (imgs.length > 0 || attempts >= maxAttempts) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MANGA_PAGE_IMAGES', payload: imgs }));
    } else {
      attempts++;
      setTimeout(tryExtract, 200);
    }
  }
  tryExtract();
})(); true;
`;
