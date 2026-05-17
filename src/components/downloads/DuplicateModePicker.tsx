import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

export type DuplicateMode = "size" | "duration" | "both";

type Option = { value: DuplicateMode; label: string; hint: string };

const OPTIONS: Option[] = [
  { value: "size", label: "Size", hint: "Within ~1% of each other" },
  { value: "duration", label: "Duration", hint: "Same whole-second length" },
  { value: "both", label: "Size and duration", hint: "Duration matches and size within ~1%" },
];

type Props = {
  visible: boolean;
  mode: DuplicateMode;
  onChangeMode: (mode: DuplicateMode) => void;
  onCancel: () => void;
  onScan: () => void;
};

export default function DuplicateModePicker({
  visible,
  mode,
  onChangeMode,
  onCancel,
  onScan,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onCancel}
      >
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Find duplicate videos</Text>
          <Text style={styles.subtitle}>Match videos by:</Text>

          {OPTIONS.map((opt) => {
            const selected = mode === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={styles.optionRow}
                onPress={() => onChangeMode(opt.value)}
              >
                <View
                  style={[styles.radio, selected && styles.radioSelected]}
                >
                  {selected && <View style={styles.radioDot} />}
                </View>
                <View style={styles.optionTextWrap}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  <Text style={styles.optionHint}>{opt.hint}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.btnGhost} onPress={onCancel}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={onScan}>
              <Text style={styles.btnPrimaryText}>Scan</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
  },
  subtitle: {
    fontSize: 13,
    color: "#666",
    marginTop: 4,
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#BBB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  radioSelected: {
    borderColor: "#1A73E8",
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#1A73E8",
  },
  optionTextWrap: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#222",
  },
  optionHint: {
    fontSize: 12,
    color: "#888",
    marginTop: 1,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    gap: 8,
  },
  btnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnGhostText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
  },
  btnPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#1A73E8",
  },
  btnPrimaryText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFF",
  },
});
