import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { sharedStyles as s } from "./sharedStyles";

type Props = {
  visible: boolean;
  count: number;
  permanent: boolean;
  onTogglePermanent: () => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteConfirmModal({
  visible,
  count,
  permanent,
  onTogglePermanent,
  onCancel,
  onConfirm,
}: Props) {
  const isMany = count > 1;
  const title = isMany ? `Delete ${count} items` : "Delete item";
  const message = permanent
    ? isMany
      ? "These files will be deleted forever and cannot be recovered."
      : "This file will be deleted forever and cannot be recovered."
    : isMany
      ? "Selected files will be moved to Trash."
      : "This file will be moved to Trash.";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <TouchableOpacity
            style={styles.checkRow}
            onPress={onTogglePermanent}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, permanent && styles.checkboxOn]}>
              {permanent && (
                <Ionicons name="checkmark" size={14} color="#FFF" />
              )}
            </View>
            <Text style={styles.checkLabel}>Delete permanently</Text>
          </TouchableOpacity>

          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalBtn} onPress={onCancel}>
              <Text style={s.modalBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, styles.deleteBtn]}
              onPress={onConfirm}
            >
              <Text style={[s.modalBtnText, styles.deleteBtnText]}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  message: {
    fontSize: 14,
    color: "#555",
    marginBottom: 14,
    lineHeight: 20,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#BBB",
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  checkboxOn: {
    backgroundColor: "#D93025",
    borderColor: "#D93025",
  },
  checkLabel: {
    fontSize: 14,
    color: "#222",
    fontWeight: "500",
  },
  deleteBtn: {
    backgroundColor: "#D93025",
  },
  deleteBtnText: {
    color: "#FFF",
  },
});
