import React from "react";
import { Modal, View, Text, TouchableOpacity, ScrollView } from "react-native";
import { sharedStyles as s } from "./sharedStyles";

export type FolderPickerOption = {
  label: string;
  depth?: number;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  title: string;
  options: FolderPickerOption[];
  onClose: () => void;
};

export default function FolderPickerModal({
  visible,
  title,
  options,
  onClose,
}: Props) {
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
          <Text style={s.modalTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={s.moveOptions}>
            {options.map((opt, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  s.moveOptionBtn,
                  opt.depth !== undefined && opt.depth > 0
                    ? s.moveTreeOptionBtn
                    : undefined,
                ]}
                onPress={opt.onPress}
              >
                {opt.depth !== undefined && opt.depth > 0 ? (
                  <View style={{ width: opt.depth * 16 }} />
                ) : null}
                <Text style={s.moveOptionText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
