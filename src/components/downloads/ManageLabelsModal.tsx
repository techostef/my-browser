import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from "react-native";
import { sharedStyles as s } from "./sharedStyles";
import { useTranslation } from "../../i18n";

type Props = {
  visible: boolean;
  labelDefs: string[];
  newLabelText: string;
  onChangeNewLabel: (text: string) => void;
  onAddLabel: (name: string) => void;
  onDeleteLabel: (label: string) => void;
  onClose: () => void;
};

export default function ManageLabelsModal({
  visible,
  labelDefs,
  newLabelText,
  onChangeNewLabel,
  onAddLabel,
  onDeleteLabel,
  onClose,
}: Props) {
  const { t } = useTranslation();

  function handleAdd() {
    onAddLabel(newLabelText);
    onChangeNewLabel("");
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={s.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={s.modalCard} onPress={() => {}}>
          <Text style={s.modalTitle}>{t('manageLabels')}</Text>
          {labelDefs.length === 0 && (
            <Text style={s.labelPickerEmpty}>{t('noLabelsYet')}</Text>
          )}
          {labelDefs.map((lbl) => (
            <View key={lbl} style={styles.row}>
              <Text style={styles.labelName}>{lbl}</Text>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => onDeleteLabel(lbl)}
              >
                <Text style={styles.deleteText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={s.labelPickerAddRow}>
            <TextInput
              style={s.labelPickerInput}
              placeholder={t('newLabel')}
              value={newLabelText}
              onChangeText={onChangeNewLabel}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleAdd}
            />
            <TouchableOpacity style={s.labelPickerAddBtn} onPress={handleAdd}>
              <Text style={s.labelPickerAddBtnText}>{t('add')}</Text>
            </TouchableOpacity>
          </View>
          <View style={s.modalActions}>
            <TouchableOpacity
              style={[s.modalBtn, s.modalPrimaryBtn]}
              onPress={onClose}
            >
              <Text style={[s.modalBtnText, s.modalPrimaryBtnText]}>{t('done')}</Text>
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
    gap: 8,
  },
  labelName: {
    flex: 1,
    fontSize: 14,
    color: "#222",
    fontWeight: "600",
  },
  deleteBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFEBEE",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: {
    color: "#C62828",
    fontSize: 12,
    fontWeight: "700",
  },
});
