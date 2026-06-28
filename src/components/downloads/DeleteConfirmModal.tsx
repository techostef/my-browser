import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "../../i18n";
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
  const { t } = useTranslation();
  const isMany = count > 1;
  const title = isMany ? t("deleteItems", { count }) : t("deleteItem");
  const message = permanent
    ? isMany
      ? t("deleteForeverPlural")
      : t("deleteForeverSingle")
    : isMany
      ? t("moveToTrashPlural")
      : t("moveToTrashSingle");

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
            <Text style={styles.checkLabel}>
              {t("deletePermanentlyCheckbox")}
            </Text>
          </TouchableOpacity>

          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalBtn} onPress={onCancel}>
              <Text style={s.modalBtnText}>{t("cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, styles.deleteBtn]}
              onPress={onConfirm}
            >
              <Text style={[s.modalBtnText, styles.deleteBtnText]}>
                {t("delete")}
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
