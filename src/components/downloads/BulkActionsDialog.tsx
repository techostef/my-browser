import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";

type Props = {
  visible: boolean;
  canBulkMove: boolean;
  canBulkMoveToPrivate: boolean;
  onClose: () => void;
  onBulkMove: () => void;
  onBulkMoveToDevice: () => void;
  onBulkMoveToPrivate: () => void;
  onBulkDelete: () => void;
};

export default function BulkActionsDialog({
  visible,
  canBulkMove,
  canBulkMoveToPrivate,
  onClose,
  onBulkMove,
  onBulkMoveToDevice,
  onBulkMoveToPrivate,
  onBulkDelete,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.dialog}>
          <Text style={styles.title}>Bulk Actions</Text>
          
          {canBulkMove && (
            <>
              <TouchableOpacity
                style={styles.option}
                onPress={() => {
                  onClose();
                  onBulkMove();
                }}
              >
                <Text style={styles.optionText}>📁 Move to Private Folder</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.option}
                onPress={() => {
                  onClose();
                  onBulkMoveToDevice();
                }}
              >
                <Text style={styles.optionText}>📱 Move to Device Download</Text>
              </TouchableOpacity>
            </>
          )}

          {canBulkMoveToPrivate && (
            <TouchableOpacity
              style={styles.option}
              onPress={() => {
                onClose();
                onBulkMoveToPrivate();
              }}
            >
              <Text style={styles.optionText}>📁 Move to Private Folder</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.option, styles.deleteOption]}
            onPress={() => {
              onClose();
              onBulkDelete();
            }}
          >
            <Text style={[styles.optionText, styles.deleteText]}>🗑 Delete</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  dialog: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    width: "80%",
    maxWidth: 320,
    paddingVertical: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
  },
  optionText: {
    fontSize: 15,
    color: "#333",
    fontWeight: "500",
  },
  deleteOption: {
    borderBottomWidth: 0,
  },
  deleteText: {
    color: "#C62828",
  },
  cancelBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  cancelText: {
    fontSize: 15,
    color: "#1A73E8",
    fontWeight: "600",
    textAlign: "center",
  },
});
