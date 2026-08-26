import { type RefObject, useCallback, useRef, useState } from "react";
import type { WebView } from "react-native-webview";
import { SEEK_SECS, type VideoController } from "./types";

const TAG = "[VideoPreview]";

/**
 * Drives an HTML5 `<video id="player">` living inside a WebView, and mirrors
 * its state back into React from the `VIDEO_STATE` heartbeat the page sends.
 */
export function useWebViewController(webViewRef: RefObject<WebView | null>): {
  controller: VideoController;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  isLoading: boolean;
  hasError: boolean;
  reset: () => void;
} {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [isMuted, setIsMuted] = useState(false);

  // Seek echo suppression: right after we seek, the page keeps reporting the
  // pre-seek position for a moment. Accepting those would snap the thumb back
  // under the user's finger, so we ignore positions far from the target until
  // the page catches up (or 1.5s passes).
  const seekTsRef = useRef(0);
  const seekTargetRef = useRef(0);

  const inject = useCallback(
    (script: string) => {
      webViewRef.current?.injectJavaScript(
        `(function(){var v=document.getElementById('player');if(v){${script}}})();true;`,
      );
    },
    [webViewRef],
  );

  const togglePlay = useCallback(() => {
    inject("v.paused?v.play().catch(function(){}):v.pause();");
  }, [inject]);

  const toggleMute = useCallback(() => {
    inject("v.muted=!v.muted;");
  }, [inject]);

  const seek = useCallback(
    (seconds: number) => {
      seekTsRef.current = Date.now();
      seekTargetRef.current = seconds;
      setCurrentTime(seconds);
      inject(`v.currentTime=${seconds};`);
    },
    [inject],
  );

  const skipBack = useCallback(() => {
    inject(`v.currentTime=Math.max(0,v.currentTime-${SEEK_SECS});`);
  }, [inject]);

  const skipForward = useCallback(() => {
    inject(`v.currentTime=Math.min(v.duration||0,v.currentTime+${SEEK_SECS});`);
  }, [inject]);

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "LOG") {
        // Page-side diagnostics; kept quiet unless actively debugging.
      } else if (msg.type === "LOADED") {
        setIsLoading(false);
        setHasError(false);
      } else if (msg.type === "ERROR") {
        console.error(`${TAG} Video playback error: code=${msg.code} msg=${msg.message}`);
        setIsLoading(false);
        setHasError(true);
      } else if (msg.type === "VIDEO_STATE") {
        const seekAge = Date.now() - seekTsRef.current;
        const diff = Math.abs(msg.currentTime - seekTargetRef.current);
        const isStaleSeekEcho = seekAge < 1500 && diff > 2;
        if (!isStaleSeekEcho) setCurrentTime(msg.currentTime);
        setDuration(msg.duration);
        setIsPaused(msg.paused);
        setIsMuted(msg.muted);
      }
    } catch {
      console.warn(`${TAG} Non-JSON message from player:`, event.nativeEvent.data);
    }
  }, []);

  const reset = useCallback(() => {
    setIsLoading(true);
    setHasError(false);
    setCurrentTime(0);
    setDuration(0);
    setIsPaused(true);
    setIsMuted(false);
    seekTsRef.current = 0;
    seekTargetRef.current = 0;
  }, []);

  const controller: VideoController = {
    currentTime,
    duration,
    isPaused,
    isMuted,
    isBuffering: isLoading,
    togglePlay,
    toggleMute,
    seek,
    skipBack,
    skipForward,
  };

  return { controller, onMessage, isLoading, hasError, reset };
}
