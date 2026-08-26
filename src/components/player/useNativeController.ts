/** biome-ignore-all lint/correctness/useExhaustiveDependencies: effects intentionally re-run only on source change */
import { useVideoPlayer } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import { SEEK_SECS, type VideoController } from "./types";

/** How long to keep trusting our own seek target over the player's report. */
const SEEK_SETTLE_MS = 3000;
const SEEK_CONVERGE_SECS = 0.5;

/**
 * Drives expo-video and exposes it as a `VideoController`.
 *
 * expo-video reports seconds natively, so nothing is converted here — the
 * whole player stack speaks seconds.
 */
export function useNativeController(uri: string | null): {
  controller: VideoController;
  player: ReturnType<typeof useVideoPlayer>;
} {
  const player = useVideoPlayer(uri ? { uri } : null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);

  // While a seek is in flight we hold our own target as the truth: expo-video
  // keeps reporting the old position until it lands, and it briefly reports
  // playing=false, which would otherwise flash the controls back on every seek.
  const seekTargetSecRef = useRef<number | null>(null);
  const seekStartedAtRef = useRef(0);
  const durationRef = useRef(0);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(true);
    setIsPaused(false);
    setIsMuted(false);
    seekTargetSecRef.current = null;
    if (uri) {
      player.replace({ uri });
      player.play();
    }
  }, [uri]);

  useEffect(() => {
    let active = true;

    const statusSub = player.addListener("statusChange", ({ status }) => {
      if (!active) return;
      setIsBuffering(status === "loading");
      if (status === "readyToPlay") {
        try {
          setDuration(player.duration);
        } catch {}
      }
    });

    const playingSub = player.addListener("playingChange", ({ isPlaying }) => {
      if (!active) return;
      if (seekTargetSecRef.current !== null) return;
      setIsPaused(!isPlaying);
    });

    const interval = setInterval(() => {
      if (!active) return;
      try {
        const pos = player.currentTime;
        if (seekTargetSecRef.current !== null) {
          const elapsed = Date.now() - seekStartedAtRef.current;
          const diff = Math.abs(pos - seekTargetSecRef.current);
          if (diff < SEEK_CONVERGE_SECS || elapsed >= SEEK_SETTLE_MS) {
            seekTargetSecRef.current = null;
            setCurrentTime(pos);
            setIsPaused(!player.playing);
          }
          return;
        }
        setCurrentTime(pos);
        if (player.duration > 0) setDuration(player.duration);
      } catch {}
    }, 250);

    return () => {
      active = false;
      statusSub.remove();
      playingSub.remove();
      clearInterval(interval);
    };
  }, [player]);

  const seek = useCallback(
    (seconds: number) => {
      try {
        const dur = player.duration > 0 ? player.duration : durationRef.current;
        const target = dur > 0 ? Math.max(0, Math.min(dur, seconds)) : Math.max(0, seconds);
        seekTargetSecRef.current = target;
        seekStartedAtRef.current = Date.now();
        player.currentTime = target;
        setCurrentTime(target);
      } catch {}
    },
    [player],
  );

  const seekBy = useCallback(
    (deltaSec: number) => {
      try {
        const raw = player.currentTime;
        const cur = typeof raw === "number" && !Number.isNaN(raw) ? raw : currentTime;
        seek(cur + deltaSec);
      } catch {}
    },
    [player, seek, currentTime],
  );

  const togglePlay = useCallback(() => {
    if (player.playing) {
      player.pause();
    } else {
      // Restarting from the very end otherwise leaves the video frozen there.
      const dur = player.duration;
      const cur = player.currentTime;
      if (dur > 0 && cur >= dur - 0.05) player.currentTime = 0;
      player.play();
    }
  }, [player]);

  const toggleMute = useCallback(() => {
    const next = !player.muted;
    player.muted = next;
    setIsMuted(next);
  }, [player]);

  const skipBack = useCallback(() => seekBy(-SEEK_SECS), [seekBy]);
  const skipForward = useCallback(() => seekBy(SEEK_SECS), [seekBy]);

  const controller: VideoController = {
    currentTime,
    duration,
    isPaused,
    isMuted,
    isBuffering,
    togglePlay,
    toggleMute,
    seek,
    skipBack,
    skipForward,
  };

  return { controller, player };
}
