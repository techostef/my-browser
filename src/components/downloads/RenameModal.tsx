import React from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { sharedStyles as s } from "./sharedStyles";
import { useTranslation } from "../../i18n";

type Props = {
  visible: boolean;
  renameText: string;
  onChangeText: (text: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export default function RenameModal({
  visible,
  renameText,
  onChangeText,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>{t('renameFile')}</Text>
          <TextInput
            style={s.modalInput}
            value={renameText}
            onChangeText={onChangeText}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('enterNewFileName')}
          />
          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalBtn} onPress={onCancel}>
              <Text style={s.modalBtnText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, s.modalPrimaryBtn]}
              onPress={onSubmit}
            >
              <Text style={[s.modalBtnText, s.modalPrimaryBtnText]}>
                {t('rename')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
