import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "../../i18n";
import { sharedStyles as s } from "./sharedStyles";

type Props = {
  visible: boolean;
  count: number;
  fileName?: string;
  onCancel: () => void;
  onReplace: () => void;
  onKeepBoth: () => void;
};

export default function FileConflictModal({
  visible,
  count,
  fileName,
  onCancel,
  onReplace,
  onKeepBoth,
}: Props) {
  const { t } = useTranslation();
  const isMany = count > 1;
  const title = isMany
    ? t("filesExistTitle", { count: String(count) })
    : t("fileExistsTitle");
  const message = !isMany && fileName ? fileName : t("fileConflictMessage");

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
          <Text style={styles.message} numberOfLines={3}>
            {message}
          </Text>

          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalBtn} onPress={onCancel}>
              <Text style={s.modalBtnText}>{t("cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalBtn} onPress={onKeepBoth}>
              <Text style={s.modalBtnText}>{t("keepBoth")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, styles.replaceBtn]}
              onPress={onReplace}
            >
              <Text style={[s.modalBtnText, styles.replaceBtnText]}>
                {t("replace")}
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
    marginBottom: 4,
    lineHeight: 20,
  },
  replaceBtn: {
    backgroundColor: "#D93025",
  },
  replaceBtnText: {
    color: "#FFF",
  },
});
