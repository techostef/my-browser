import React from "react";
import { StyleSheet } from "react-native";
import { WebView, WebViewNavigation } from "react-native-webview";

import { VIDEO_DETECTOR_JS } from "../services/videoDetector";

interface Props {
  webViewRef: React.RefObject<WebView> | ((ref: WebView | null) => void);
  currentUrl: string;
  handleMessage: (event: any) => void;
  handleNavigationStateChange: (navState: WebViewNavigation) => void;
  handleLoadStart: () => void;
}

const Browser = ({ webViewRef, currentUrl, handleMessage, handleNavigationStateChange, handleLoadStart }: Props) =>{
  console.log('Render Component Browser:', currentUrl);
  return (
    <WebView
      ref={webViewRef as any}
      source={{ uri: currentUrl }}
      style={styles.webview}
      injectedJavaScriptBeforeContentLoaded={VIDEO_DETECTOR_JS}
      onMessage={handleMessage}
      onNavigationStateChange={handleNavigationStateChange}
      onLoadStart={handleLoadStart}
      // onLoadEnd={() => setLoading(false)}
      javaScriptEnabled
      domStorageEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
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