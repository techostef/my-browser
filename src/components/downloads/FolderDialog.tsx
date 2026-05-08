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
  mode: "create" | "rename" | null;
  folderNameText: string;
  onChangeText: (text: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export default function FolderDialog({
  mode,
  folderNameText,
  onChangeText,
  onCancel,
  onSubmit,
}: Props) {
  return (
    <Modal
      visible={!!mode}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>
            {mode === "create" ? "Create folder" : "Rename folder"}
          </Text>
          <TextInput
            style={s.modalInput}
            value={folderNameText}
            onChangeText={onChangeText}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Folder name"
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
                {mode === "create" ? "Create" : "Save"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
