import React, { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Animated,
  Pressable,
} from "react-native";
import { DetectedVideo, HlsVariant } from "../types";

function formatBandwidth(bps: number): string {
  if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + " Mbps";
  return (bps / 1_000).toFixed(0) + " Kbps";
}

interface Props {
  videos: DetectedVideo[];
  visible?: boolean;
  playingUrl?: string;
  onPreview: (video: DetectedVideo) => void;
  onDownload: (video: DetectedVideo, variant?: HlsVariant) => void;
  onDismiss: () => void;
  onToggleFullscreen?: () => void;
  onSeekForward?: (seconds: number) => void;
  onSeekBackward?: (seconds: number) => void;
}

function isPlayingVideo(video: DetectedVideo, playingUrl: string): boolean {
  const lastSegment = playingUrl.split("/").pop();
  if (lastSegment && video.hlsInfo?.isMaster) {
    if (video.hlsInfo.variants) {
      return video.hlsInfo.variants.some((v) => v.uri.includes(lastSegment));
    }
  }
  return false;
}

const SEEK_SECONDS = 10;
const DOUBLE_TAP_MS = 300;

export default function VideoDetectedBanner({
  videos,
  visible = true,
  playingUrl = "",
  onPreview,
  onDownload,
  onDismiss,
  onToggleFullscreen,
  onSeekForward,
  onSeekBackward,
}: Props) {
  const [isDetailVisible, setIsDetailVisible] = React.useState(false);
  const [filteredVideos, setFilteredVideos] = React.useState<DetectedVideo[]>([]);

  const lastLeftTap = useRef(0);
  const lastRightTap = useRef(0);
  const leftOpacity = useRef(new Animated.Value(0)).current;
  const rightOpacity = useRef(new Animated.Value(0)).current;
  const leftScale = useRef(new Animated.Value(0.75)).current;
  const rightScale = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    setFilteredVideos(videos.filter((v) => isPlayingVideo(v, playingUrl)));
  }, [videos, playingUrl]);

  const flashIndicator = (opacity: Animated.Value, scale: Animated.Value) => {
    opacity.stopAnimation();
    scale.stopAnimation();
    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.delay(650),
        Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.spring(scale, { toValue: 1, speed: 24, bounciness: 6, useNativeDriver: true }),
        Animated.delay(750),
        Animated.timing(scale, { toValue: 0.75, duration: 200, useNativeDriver: true }),
      ]),
    ]).start();
  };

  const handleLeftTap = () => {
    const now = Date.now();
    if (now - lastLeftTap.current < DOUBLE_TAP_MS) {
      onSeekBackward?.(SEEK_SECONDS);
      flashIndicator(leftOpacity, leftScale);
      lastLeftTap.current = 0;
    } else {
      lastLeftTap.current = now;
    }
  };

  const handleRightTap = () => {
    const now = Date.now();
    if (now - lastRightTap.current < DOUBLE_TAP_MS) {
      onSeekForward?.(SEEK_SECONDS);
      flashIndicator(rightOpacity, rightScale);
      lastRightTap.current = 0;
    } else {
      lastRightTap.current = now;
    }
  };

  const handlePreviewFromDetail = (video: DetectedVideo) => {
    setIsDetailVisible(false);
    onPreview(video);
  };

  const handleDownloadVariant = (video: DetectedVideo, variant?: HlsVariant) => {
    setIsDetailVisible(false);
    onDownload(video, variant);
  };


  if (filteredVideos.length === 0) return null;

  return (
    <View
      style={[styles.overlay, !visible && { display: "none" }]}
      pointerEvents="box-none"
    >
      {/* ── Banner header ── */}
      <View style={styles.banner}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.liveDot} />
            <Text style={styles.title}>
              {filteredVideos.length} video{filteredVideos.length > 1 ? "s" : ""} detected
            </Text>
          </View>

          <View style={styles.headerActions}>
            {/* Preview */}
            <TouchableOpacity
              onPress={() => onToggleFullscreen?.()}
              style={[styles.actionBtn, styles.actionBtnTeal]}
            >
              <Text style={styles.actionBtnText}>▶</Text>
            </TouchableOpacity>

            {/* Details list */}
            <TouchableOpacity
              onPress={() => setIsDetailVisible(true)}
              style={[styles.actionBtn, styles.actionBtnGhost]}
            >
              <Text style={[styles.actionBtnText, styles.actionBtnTextMuted]}>☰</Text>
            </TouchableOpacity>

            {/* Dismiss */}
            <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Seek zones (transparent, below banner) ── */}
      <View style={styles.seekRow} pointerEvents="box-none">
        {/* Left → backward */}
        <Pressable style={styles.seekZone} onPress={handleLeftTap}>
          <Animated.View
            style={[
              styles.seekIndicator,
              { opacity: leftOpacity, transform: [{ scale: leftScale }] },
            ]}
          >
            <Text style={styles.seekIcon}>{"◀◀"}</Text>
            <Text style={styles.seekLabel}>-{SEEK_SECONDS}s</Text>
          </Animated.View>
        </Pressable>

        {/* Centre → pass through to WebView */}
        <View style={styles.seekMiddle} pointerEvents="none" />

        {/* Right → forward */}
        <Pressable style={styles.seekZone} onPress={handleRightTap}>
          <Animated.View
            style={[
              styles.seekIndicator,
              { opacity: rightOpacity, transform: [{ scale: rightScale }] },
            ]}
          >
            <Text style={styles.seekIcon}>{"▶▶"}</Text>
            <Text style={styles.seekLabel}>+{SEEK_SECONDS}s</Text>
          </Animated.View>
        </Pressable>
      </View>

      {/* ── Details modal ── */}
      <Modal
        visible={isDetailVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsDetailVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Detected Videos</Text>
              <TouchableOpacity
                onPress={() => setIsDetailVisible(false)}
                style={styles.closeBtn}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {filteredVideos.length > 0 ? (
              <FlatList
                data={filteredVideos}
                keyExtractor={(item, index) => `${item.url}-${index}`}
                style={styles.list}
                renderItem={({ item }) => {
                  const hasVariants =
                    item.type === "hls" &&
                    item.hlsInfo &&
                    item.hlsInfo.variants.length > 0;
                  return (
                    <View
                      style={[
                        styles.videoCard,
                        isPlayingVideo(item, playingUrl) && styles.videoCardPlaying,
                      ]}
                    >
                      <View style={styles.videoInfo}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.videoUrl} numberOfLines={1}>
                            {item.type === "hls"
                              ? item.pageTitle || "HLS Stream"
                              : item.type === "dash"
                              ? item.pageTitle || "DASH Stream"
                              : item.videoWidth || item.pageTitle || "Video"}
                          </Text>
                        </View>
                      </View>

                      {hasVariants ? (
                        <View style={styles.variantList}>
                          {item.hlsInfo!.variants.map((variant, vi) => (
                            <View key={vi} style={styles.variantRow}>
                              <View style={styles.variantInfo}>
                                <Text style={styles.variantResolution}>
                                  {variant.resolution || "Unknown"}
                                </Text>
                                <Text style={styles.variantBandwidth}>
                                  {formatBandwidth(variant.bandwidth)}
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={styles.downloadVariantBtn}
                                onPress={() => handleDownloadVariant(item, variant)}
                              >
                                <Text style={styles.downloadVariantBtnText}>↓ Download</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                          <TouchableOpacity
                            style={styles.previewBtnRow}
                            onPress={() => handlePreviewFromDetail(item)}
                          >
                            <Text style={styles.previewBtnRowText}>▶ Preview</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View />
                      )}
                    </View>
                  );
                }}
              />
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No downloadable videos found</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  /* Full-screen transparent wrapper */
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },

  /* ── Banner ── */
  banner: {
    backgroundColor: "#1A1A2E",
    borderBottomWidth: 1,
    borderBottomColor: "#2A2A45",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#4ECDC4",
  },
  title: {
    color: "#D0D0D0",
    fontSize: 13,
    fontWeight: "600",
  },

  /* Header action buttons */
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  actionBtnTeal: {
    backgroundColor: "rgba(78,205,196,0.18)",
    borderColor: "rgba(78,205,196,0.45)",
  },
  actionBtnOrange: {
    backgroundColor: "rgba(255,160,50,0.16)",
    borderColor: "rgba(255,160,50,0.5)",
  },
  actionBtnGhost: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  actionBtnText: {
    color: "#4ECDC4",
    fontSize: 14,
    fontWeight: "700",
  },
  actionBtnTextOrange: {
    color: "#FFA032",
  },
  actionBtnTextMuted: {
    color: "#888",
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    color: "#888",
    fontSize: 13,
  },

  /* ── Seek zones ── */
  seekRow: {
    flexDirection: "row",
    height: 168,
  },
  seekZone: {
    flex: 3,
    justifyContent: "center",
    alignItems: "center",
  },
  seekMiddle: {
    flex: 4,
  },
  seekIndicator: {
    backgroundColor: "rgba(10,10,24,0.72)",
    borderRadius: 44,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(78,205,196,0.35)",
  },
  seekIcon: {
    color: "#FFFFFF",
    fontSize: 20,
    lineHeight: 24,
  },
  seekLabel: {
    color: "#4ECDC4",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 5,
    letterSpacing: 0.3,
  },

  /* ── Details modal ── */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  modalContent: {
    backgroundColor: "#1A1A2E",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A2A45",
    overflow: "hidden",
    maxHeight: "75%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#2A2A45",
  },
  modalTitle: {
    color: "#4ECDC4",
    fontSize: 14,
    fontWeight: "700",
  },
  list: {
    maxHeight: 420,
  },
  videoCard: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2A2A45",
  },
  videoCardPlaying: {
    backgroundColor: "rgba(99,179,237,0.12)",
    borderLeftWidth: 3,
    borderLeftColor: "#63b3ed",
  },
  videoInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  videoUrl: {
    flex: 1,
    color: "#BBBBBB",
    fontSize: 12,
  },
  variantList: {
    marginTop: 2,
  },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2A2A3E",
  },
  variantInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  variantResolution: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
    minWidth: 80,
  },
  variantBandwidth: {
    color: "#8AB4F8",
    fontSize: 11,
  },
  downloadVariantBtn: {
    backgroundColor: "#4ECDC4",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  downloadVariantBtnText: {
    color: "#1A1A2E",
    fontWeight: "700",
    fontSize: 12,
  },
  previewBtnRow: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#4ECDC4",
  },
  previewBtnRowText: {
    color: "#4ECDC4",
    fontSize: 12,
    fontWeight: "700",
  },
  emptyState: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyStateText: {
    color: "#888",
    fontSize: 13,
  },
});
