import React from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { sharedStyles as s } from "./sharedStyles";

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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>Rename file</Text>
          <TextInput
            style={s.modalInput}
            value={renameText}
            onChangeText={onChangeText}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter new file name"
          />
          <View style={s.modalActions}>
            <TouchableOpacity style={s.modalBtn} onPress={onCancel}>
              <Text style={s.modalBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, s.modalPrimaryBtn]}
              onPress={onSubmit}
            >
              <Text style={[s.modalBtnText, s.modalPrimaryBtnText]}>
                Rename
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
