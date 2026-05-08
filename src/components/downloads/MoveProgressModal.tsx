import React from "react";
import {
  Modal,
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
} from "react-native";

type Props = {
  progress: { total: number; label: string } | null;
};

export default function MoveProgressModal({ progress }: Props) {
  return (
    <Modal
      visible={progress !== null}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color="#1A73E8" />
          <Text style={styles.label}>{progress?.label ?? "Working..."}</Text>
          <Text style={styles.sub}>
            {progress?.total ?? 0} item
            {(progress?.total ?? 0) !== 1 ? "s" : ""} · please wait
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    color: "#222",
    marginTop: 14,
    textAlign: "center",
  },
  sub: {
    fontSize: 12,
    color: "#666",
    marginTop: 6,
    textAlign: "center",
  },
});
