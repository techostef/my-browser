import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Video, ResizeMode } from "expo-av";
import { DownloadTask } from "../../types";
import { DownloadMediaType } from "../DownloadItem";

type Props = {
  task: DownloadTask | null;
  mediaType: DownloadMediaType;
  onClose: () => void;
  onEditVideo?: () => void;
};

export default function PreviewModal({ task, mediaType, onClose, onEditVideo }: Props) {
  return (
    <Modal
      visible={!!task}
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.previewContainer} edges={["top"]}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle} numberOfLines={1}>
            {task?.fileName || "Media preview"}
          </Text>
          {mediaType === 'video' && onEditVideo && (
            <TouchableOpacity style={styles.editBtn} onPress={onEditVideo}>
              <Text style={styles.editBtnText}>✂️ Edit</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.previewCloseBtn} onPress={onClose}>
            <Text style={styles.previewCloseText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.previewBody}>
          {task?.filePath && mediaType === "image" && (
            <Image
              source={{ uri: task.filePath }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}
          {task?.filePath &&
            (mediaType === "video" || mediaType === "audio") && (
              <Video
                source={{ uri: task.filePath }}
                style={
                  mediaType === "audio"
                    ? styles.previewAudio
                    : styles.previewVideo
                }
                useNativeControls
                shouldPlay
                resizeMode={ResizeMode.CONTAIN}
              />
            )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  previewContainer: {
    flex: 1,
    backgroundColor: "#111",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2E2E2E",
  },
  previewTitle: {
    flex: 1,
    fontSize: 14,
    color: "#FFF",
    marginRight: 12,
    fontWeight: "600",
  },
  editBtn: {
    backgroundColor: "#6c63ff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  editBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
  previewCloseBtn: {
    backgroundColor: "#2B2B2B",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewCloseText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
  previewBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewVideo: {
    width: "100%",
    height: "70%",
  },
  previewAudio: {
    width: "100%",
    height: 90,
  },
});
