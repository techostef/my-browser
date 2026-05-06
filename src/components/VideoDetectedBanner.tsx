import React, { useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from "react-native";
import { DetectedVideo } from "../types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

interface Props {
  videos: DetectedVideo[];
  visible?: boolean;
  onPreview: (video: DetectedVideo) => void;
  onOpenInTab: (video: DetectedVideo) => void;
  onDismiss: () => void;
  onToggleFullscreen?: () => void;
}

interface VideoValidationResult {
  isValid: boolean;
  status?: number;
  contentType?: string;
  size?: number | null;
  canPlay?: boolean;
  videoWidth?: string;
  duration?: number | null;
  error?: string;
}

function extractResolutionFromUrl(url: string): string | undefined {
  const match = url.match(/(\d{2,4})x(\d{2,4})/);

  if (!match) return undefined;

  return `${match[1]}x${match[2]}`;
}

async function validateMp4Video(url: string): Promise<VideoValidationResult> {
  try {
    // 1. Basic validation
    if (!url || !url.startsWith("http")) {
      return { isValid: false, error: "Invalid URL" };
    }
    // 2. HEAD request (fast check)
    const response = await fetch(url, {
      method: "HEAD",
    });

    const status = response.status;

    if (!response.ok) {
      return {
        isValid: false,
        status,
        error: "URL not reachable",
      };
    }

    // 3. Get headers
    const contentType = response.headers.get("content-type");
    const contentLength = response.headers.get("content-length");

    const size = contentLength ? parseInt(contentLength, 10) : null;

    // 4. Validate it's actually video/mp4
    const isMp4 =
      contentType?.includes("video/mp4") || url.toLowerCase().includes(".mp4");

    const videoWidth = extractResolutionFromUrl(url);

    if (!isMp4) {
      return {
        isValid: false,
        status,
        contentType: contentType || undefined,
        videoWidth,
        size,
        error: "Not an MP4 video",
      };
    }

    return {
      isValid: true,
      status,
      contentType: contentType || undefined,
      videoWidth,
      size,
      canPlay: undefined, // will be determined later
      duration: undefined,
    };
  } catch (err: any) {
    return {
      isValid: false,
      error: err.message || "Unknown error",
    };
  }
}

export default function VideoDetectedBanner({
  videos,
  visible = true,
  onPreview,
  onOpenInTab,
  onDismiss,
  onToggleFullscreen,
}: Props) {
  if (videos.length === 0) return null;
  const isMounted = React.useRef(false);
  const validationCache = React.useRef<Map<string, VideoValidationResult>>(new Map());

  const downloadableTypes = ["blob-ready", "hls", "dash", "mp4", "webm"];
  const downloadableVideos = videos.filter((v) =>
    downloadableTypes.includes(v.type),
  );
  const downloadableUrls = downloadableVideos.map((v) => v.url).join(",");
  const [filteredVideos, setFilteredVideos] = React.useState<DetectedVideo[]>(
    [],
  );
  const [isDetailVisible, setIsDetailVisible] = React.useState(false);

  const handleValidateVideos = async () => {
    // const results = await Promise.all(
    //   downloadableVideos.map(async (video) => {
    //     if (video.type !== "mp4") return video;

    //     const cached = validationCache.current.get(video.url);
    //     if (cached) return { ...video, ...cached };

    //     const validation = await validateMp4Video(video.url);
    //     validationCache.current.set(video.url, validation);
    //     return { ...video, ...validation };
    //   }),
    // );

    // const filtered = results.filter((item) => {
    //   if (item.type === "mp4") {
    //     return false;
    //     // return item.isValid !== false;
    //   }
    //   if (item.type === "hls") {
    //     return !!item.hlsInfo;
    //   }
    //   return true;
    // });

    // const seenVariants = new Set<string>();
    // const hlsItems = filtered.filter((item) => item.type === "hls" && item.hlsInfo);
    // const nonHlsItems = filtered.filter((item) => item.type !== "hls" || !item.hlsInfo);
    // hlsItems.sort((a, b) => (b.hlsInfo!.variants.length - a.hlsInfo!.variants.length));
    // const deduped = [
    //   ...nonHlsItems,
    //   ...hlsItems.filter((item) => {
    //     const filenames = item.hlsInfo!.variants.map((v) => v.uri.split("/").pop() ?? v.uri);
    //     if (filenames.every((f) => seenVariants.has(f))) return false;
    //     filenames.forEach((f) => seenVariants.add(f));
    //     return true;
    //   }),
    // ];

    setFilteredVideos(videos);
  };

  useEffect(() => {
    isMounted.current = true;

    handleValidateVideos();

    return () => {
      isMounted.current = false;
    };
  }, [downloadableUrls]);

  if (!isMounted.current) {
    return null;
  }

  const handlePreviewFromDetail = (video: DetectedVideo) => {
    setIsDetailVisible(false);
    onPreview(video);
  };

  const handleOpenInTabFromDetail = (video: DetectedVideo) => {
    setIsDetailVisible(false);
    onOpenInTab(video);
  };

  console.log(
    "filteredVideos",
    JSON.stringify(
      videos.filter((video) => video.hlsInfo).map((video) => video),
      null,
      4,
    ),
  );

  if (videos.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, !visible && { display: "none" }]}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {filteredVideos.length} video{filteredVideos.length > 1 ? "s" : ""}{" "}
          detected
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => {
              onToggleFullscreen?.();
            }}
            style={styles.previewHeaderBtn}
          >
            <Text style={styles.previewHeaderBtnText}>▶ Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIsDetailVisible(true)}
            style={styles.detailsBtn}
          >
            <Text style={styles.detailsBtnText}>Details</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

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
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.videoRow}
                    activeOpacity={0.7}
                    onPress={() => handlePreviewFromDetail(item)}
                  >
                    <View style={styles.videoInfo}>
                      <Text style={styles.videoType}>
                        {item.type === "blob-ready"
                          ? "BLOB"
                          : item.type === "hls"
                            ? "M3U8"
                            : item.type.toUpperCase()}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.videoUrl} numberOfLines={1}>
                          {item.type === "blob-ready"
                            ? `${item.pageTitle || "Video"} (${formatSize(item.blobSize || 0)})`
                            : item.type === "hls"
                              ? `${item.pageTitle || "HLS Stream"}`
                              : item.type === "dash"
                                ? `${item.pageTitle || "DASH Stream"}`
                                : item.videoWidth || item.pageTitle || "Video"}
                        </Text>
                        {item.hlsInfo && item.hlsInfo.variants.length > 0 && (
                          <Text style={styles.hlsVariantText} numberOfLines={1}>
                            {item.hlsInfo.variants
                              .filter((v) => v.resolution)
                              .map((v) => v.resolution)
                              .join(" | ")}
                            {item.hlsInfo.audioTracks.length > 0
                              ? ` · ${item.hlsInfo.audioTracks.length} audio`
                              : ""}
                            {item.hlsInfo.subtitleTracks.length > 0
                              ? ` · ${item.hlsInfo.subtitleTracks.length} subs`
                              : ""}
                          </Text>
                        )}
                      </View>
                    </View>
                    {(item.type === "hls" || item.type === "dash") && (
                      <TouchableOpacity
                        style={styles.openTabBtn}
                        onPress={() => handleOpenInTabFromDetail(item)}
                      >
                        <Text style={styles.openTabBtnText}>🔗 Tab</Text>
                      </TouchableOpacity>
                    )}
                    <View style={styles.previewBtn}>
                      <Text style={styles.previewBtnText}>▶ Preview</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  No downloadable videos found
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* {nonDownloadable.length > 0 && (
        <View style={styles.warningRow}>
          <Text style={styles.warningText}>
            {nonDownloadable.length} video{nonDownloadable.length > 1 ? 's' : ''}{' '}
            ({nonDownloadable.map(v => v.type).join(', ')}) — not directly
            downloadable
          </Text>
        </View>
      )} */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: "#1A1A2E",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: {
    color: "#4ECDC4",
    fontSize: 14,
    fontWeight: "700",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  previewHeaderBtn: {
    backgroundColor: "#4ECDC4",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
  },
  previewHeaderBtnText: {
    color: "#1A1A2E",
    fontSize: 12,
    fontWeight: "700",
  },
  detailsBtn: {
    backgroundColor: "rgba(78,205,196,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4ECDC4",
    marginRight: 8,
  },
  detailsBtnText: {
    color: "#4ECDC4",
    fontSize: 12,
    fontWeight: "700",
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    color: "#FFF",
    fontSize: 14,
  },
  summaryText: {
    color: "#AAA",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  modalContent: {
    backgroundColor: "#1A1A2E",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#333",
    overflow: "hidden",
    maxHeight: "75%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  modalTitle: {
    color: "#4ECDC4",
    fontSize: 14,
    fontWeight: "700",
  },
  list: {
    maxHeight: 420,
  },
  videoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#333",
  },
  videoInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 8,
  },
  videoType: {
    backgroundColor: "#4ECDC4",
    color: "#1A1A2E",
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
    overflow: "hidden",
  },
  videoUrl: {
    flex: 1,
    color: "#CCC",
    fontSize: 12,
  },
  previewBtn: {
    backgroundColor: "#4ECDC4",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  previewBtnText: {
    color: "#1A1A2E",
    fontWeight: "700",
    fontSize: 12,
  },
  warningRow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  openTabBtn: {
    backgroundColor: "#F9A825",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 6,
  },
  openTabBtnText: {
    color: "#1A1A2E",
    fontWeight: "700",
    fontSize: 12,
  },
  warningText: {
    color: "#F9A825",
    fontSize: 11,
    fontStyle: "italic",
  },
  emptyState: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyStateText: {
    color: "#AAA",
    fontSize: 13,
  },
  hlsVariantText: {
    color: "#8AB4F8",
    fontSize: 10,
    marginTop: 2,
  },
});
