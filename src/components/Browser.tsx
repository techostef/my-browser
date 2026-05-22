import React, { useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView, WebViewNavigation } from "react-native-webview";
import {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewOpenWindowEvent,
} from "react-native-webview/lib/WebViewTypes";

interface Props {
  webViewRef: React.RefObject<WebView> | ((ref: WebView | null) => void);
  currentUrl: string;
  injectedJavaScript: string;
  handleMessage: (event: any) => void;
  handleNavigationStateChange: (navState: WebViewNavigation) => void;
  handleShouldStartLoadWithRequest?: (request: ShouldStartLoadRequest) => boolean;
  onOpenWindow?: (event: WebViewOpenWindowEvent) => void;
  onLoadStart?: () => void;
  onLoadProgress?: (progress: number) => void;
  onLoadEnd?: () => void;
  onLoadError?: (event: WebViewErrorEvent) => void;
  onHttpError?: (event: WebViewHttpErrorEvent) => void;
}

const Browser = ({
  webViewRef,
  currentUrl,
  injectedJavaScript,
  handleMessage,
  handleNavigationStateChange,
  handleShouldStartLoadWithRequest,
  onOpenWindow,
  onLoadStart,
  onLoadProgress,
  onLoadEnd,
  onLoadError,
  onHttpError,
}: Props) => {
  // source is frozen at mount — all navigation after that is handled
  // imperatively via injectNavigation / goBack / goForward.
  const initialUrl = useRef(currentUrl);
  const source = useMemo(() => ({ uri: initialUrl.current }), []);
  return (
    <WebView
      ref={webViewRef as any}
      source={source}
      style={styles.webview}
      injectedJavaScriptBeforeContentLoaded={injectedJavaScript}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
      onMessage={handleMessage}
      onNavigationStateChange={handleNavigationStateChange}
      onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
      onOpenWindow={onOpenWindow}
      onLoadStart={onLoadStart}
      onLoadProgress={({ nativeEvent }) => onLoadProgress?.(nativeEvent.progress)}
      onLoadEnd={onLoadEnd}
      onError={onLoadError}
      onHttpError={onHttpError}
      renderError={() => <></>}
      javaScriptEnabled
      domStorageEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      mixedContentMode="compatibility"
      cacheEnabled
      userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFF",
  },
  webview: {
    flex: 1,
  },
});


// Re-render only when injectedJavaScript changes (settings toggled). All other
// prop changes (onMessage, navState callbacks, currentUrl) are handled via refs
// or imperative WebView calls so frozen closures are intentional.
export default React.memo(Browser, (prev, next) => prev.injectedJavaScript === next.injectedJavaScript);
