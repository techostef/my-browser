import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

interface MangaBgWebViewContextValue {
  loadBgWebView: (url: string, extractorScript: string, timeoutMs?: number) => Promise<any>;
  clearBgWebView: () => void;
}

const MangaBgWebViewContext = createContext<MangaBgWebViewContextValue | null>(null);

const BLANK = { uri: 'about:blank' };

export function MangaBgWebViewProvider({ children }: { children: React.ReactNode }) {
  const [bgWebViewUrl, setBgWebViewUrl] = useState<string | null>(null);
  const [bgWebViewKey, setBgWebViewKey] = useState(0);
  const bgPendingRef = useRef<{
    script: string;
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const bgWebViewRef = useRef<any>(null);

  const loadBgWebView = useCallback((url: string, extractorScript: string, timeoutMs = 30000): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (bgPendingRef.current) {
        clearTimeout(bgPendingRef.current.timer);
      }
      const timer = setTimeout(() => {
        bgPendingRef.current = null;
        reject(new Error('Timeout loading manga page'));
      }, timeoutMs);
      bgPendingRef.current = { script: extractorScript, resolve, reject, timer };
      setBgWebViewKey(k => k + 1);
      setBgWebViewUrl(url);
    });
  }, []);

  const clearBgWebView = useCallback(() => {
    setBgWebViewUrl(null);
  }, []);

  const handleLoadEnd = useCallback(() => {
    const pending = bgPendingRef.current;
    if (!pending) return;
    bgWebViewRef.current?.injectJavaScript(pending.script);
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      const pending = bgPendingRef.current;
      if (!pending) return;
      if (data.type === 'MANGA_CHAPTER_LIST' || data.type === 'MANGA_PAGE_IMAGES') {
        clearTimeout(pending.timer);
        bgPendingRef.current = null;
        pending.resolve(data.payload);
      }
    } catch {}
  }, []);

  return (
    <MangaBgWebViewContext.Provider value={{ loadBgWebView, clearBgWebView }}>
      {children}
      {/*
        absoluteFill + pointerEvents=none isolates the WebView in its own layer.
        It is always mounted so the layout never shifts when loading starts or stops.
        The WebView is placed far off-screen (-500,-500) so it is never visible.
      */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none" collapsable={false}>
        <WebView
          key={bgWebViewKey}
          ref={bgWebViewRef}
          source={bgWebViewUrl ? { uri: bgWebViewUrl } : BLANK}
          style={styles.hiddenWebView}
          onLoadEnd={handleLoadEnd}
          onMessage={handleMessage}
          javaScriptEnabled
        />
      </View>
    </MangaBgWebViewContext.Provider>
  );
}

export function useMangaBgWebView() {
  const ctx = useContext(MangaBgWebViewContext);
  if (!ctx) throw new Error('useMangaBgWebView must be used inside MangaBgWebViewProvider');
  return ctx;
}

const styles = StyleSheet.create({
  hiddenWebView: { position: 'absolute', top: -500, left: -500, width: 1, height: 1, opacity: 0 },
});
