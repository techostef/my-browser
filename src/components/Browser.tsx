import React from "react";
import { StyleSheet } from "react-native";
import { WebView, WebViewNavigation } from "react-native-webview";
import { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";

import { VIDEO_DETECTOR_JS } from "../services/videoDetector";
import { AD_BLOCKER_JS } from "../services/adBlocker";
import { POPUP_BLOCKER_JS } from "../services/popupBlocker";

interface Props {
  webViewRef: React.RefObject<WebView> | ((ref: WebView | null) => void);
  currentUrl: string;
  handleMessage: (event: any) => void;
  handleNavigationStateChange: (navState: WebViewNavigation) => void;
  handleShouldStartLoadWithRequest?: (request: ShouldStartLoadRequest) => boolean;
  adBlockEnabled?: boolean;
  popupBlockEnabled?: boolean;
  onLoadStart?: () => void;
  onLoadProgress?: (progress: number) => void;
  onLoadEnd?: () => void;
}

const Browser = ({
  webViewRef,
  currentUrl,
  handleMessage,
  handleNavigationStateChange,
  handleShouldStartLoadWithRequest,
  adBlockEnabled,
  popupBlockEnabled,
  onLoadStart,
  onLoadProgress,
  onLoadEnd,
}: Props) => {
  console.log('Render Component Browser:', currentUrl);
  let injectedJS = VIDEO_DETECTOR_JS;
  if (adBlockEnabled) injectedJS = AD_BLOCKER_JS + injectedJS;
  if (popupBlockEnabled) injectedJS = POPUP_BLOCKER_JS + injectedJS;
  return (
    <WebView
      ref={webViewRef as any}
      source={{ uri: currentUrl }}
      style={styles.webview}
      injectedJavaScriptBeforeContentLoaded={injectedJS}
      onMessage={handleMessage}
      onNavigationStateChange={handleNavigationStateChange}
      onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
      onLoadStart={onLoadStart}
      onLoadProgress={({ nativeEvent }) => onLoadProgress?.(nativeEvent.progress)}
      onLoadEnd={onLoadEnd}
      javaScriptEnabled
      domStorageEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      mixedContentMode="compatibility"
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


export default React.memo(Browser, () => true);