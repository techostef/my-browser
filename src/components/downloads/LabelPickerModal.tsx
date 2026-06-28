import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "../../i18n";
import { DownloadTask } from "../../types";
import { sharedStyles as s } from "./sharedStyles";

type Props = {
  task: DownloadTask | null;
  fileLabels: Record<string, string[]>;
  labelDefs: string[];
  newLabelText: string;
  onChangeNewLabel: (text: string) => void;
  onToggle: (taskId: string, label: string) => void;
  onAddLabel: (name: string) => void;
  onClose: () => void;
};

export default function LabelPickerModal({
  task,
  fileLabels,
  labelDefs,
  newLabelText,
  onChangeNewLabel,
  onToggle,
  onAddLabel,
  onClose,
}: Props) {
  const { t } = useTranslation();

  function handleAdd() {
    onAddLabel(newLabelText);
    onChangeNewLabel("");
  }

  return (
    <Modal
      visible={!!task}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={s.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={s.modalCard}
          onPress={() => {}}
        >
          <Text style={s.modalTitle}>🏷 {t("labels")}</Text>
          {labelDefs.length === 0 && (
            <Text style={s.labelPickerEmpty}>{t("noLabelsYet")}</Text>
          )}
          {labelDefs.map((lbl) => {
            const checked = (fileLabels[task?.id ?? ""] || []).includes(lbl);
            return (
              <TouchableOpacity
                key={lbl}
                style={styles.row}
                onPress={() => task && onToggle(task.id, lbl)}
              >
                <View style={[styles.check, checked && styles.checkActive]}>
                  {checked && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <Text style={styles.labelName}>{lbl}</Text>
              </TouchableOpacity>
            );
          })}
          <View style={s.labelPickerAddRow}>
            <TextInput
              style={s.labelPickerInput}
              placeholder={t("newLabel")}
              value={newLabelText}
              onChangeText={onChangeNewLabel}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleAdd}
            />
            <TouchableOpacity style={s.labelPickerAddBtn} onPress={handleAdd}>
              <Text style={s.labelPickerAddBtnText}>{t("add")}</Text>
            </TouchableOpacity>
          </View>
          <View style={s.modalActions}>
            <TouchableOpacity
              style={[s.modalBtn, s.modalPrimaryBtn]}
              onPress={onClose}
            >
              <Text style={[s.modalBtnText, s.modalPrimaryBtnText]}>
                {t("done")}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#1A73E8",
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  checkActive: {
    backgroundColor: "#1A73E8",
  },
  checkMark: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 14,
  },
  labelName: {
    fontSize: 14,
    color: "#222",
    fontWeight: "600",
  },
});
