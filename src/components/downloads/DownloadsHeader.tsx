import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

const DEVICE_ROOT_PATH = "__device_download__";

type Props = {
  isSelectionMode: boolean;
  selectedCount: number;
  allSelected: boolean;
  canBulkMove: boolean;
  canBulkMoveToPrivate: boolean;
  currentFolderPath: string;
  gridDataLength: number;
  onCancelSelection: () => void;
  onSelectAll: () => void;
  onBulkMove: () => void;
  onBulkMoveToPrivate: () => void;
  onBulkDelete: () => void;
  onBack: () => void;
  onActionsMenu: () => void;
};

export default function DownloadsHeader({
  isSelectionMode,
  selectedCount,
  allSelected,
  canBulkMove,
  canBulkMoveToPrivate,
  currentFolderPath,
  gridDataLength,
  onCancelSelection,
  onSelectAll,
  onBulkMove,
  onBulkMoveToPrivate,
  onBulkDelete,
  onBack,
  onActionsMenu,
}: Props) {
  if (isSelectionMode) {
    return (
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={onCancelSelection}>
          <Text style={styles.iconBtnText}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pill} onPress={onSelectAll}>
          <Text style={styles.pillText}>
            {allSelected ? "Deselect all" : "Select all"}
          </Text>
        </TouchableOpacity>
        <View style={{ marginRight: "auto", marginLeft: 8 }}>
          <Text style={styles.title}>{selectedCount} selected</Text>
        </View>
        {canBulkMove && (
          <TouchableOpacity style={styles.pill} onPress={onBulkMove}>
            <Text style={styles.pillText}>Move</Text>
          </TouchableOpacity>
        )}
        {canBulkMoveToPrivate && (
          <TouchableOpacity style={styles.pill} onPress={onBulkMoveToPrivate}>
            <Text style={styles.pillText}>→ Private</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.pill, styles.pillDelete]}
          onPress={onBulkDelete}
        >
          <Text style={[styles.pillText, styles.pillDeleteText]}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.header}>
      {currentFolderPath ? (
        <View style={styles.backRow}>
          <TouchableOpacity style={styles.iconBtn} onPress={onBack}>
            <Text style={styles.iconBtnText}>←</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={{ marginRight: "auto" }}>
        <Text style={styles.title}>
          {(currentFolderPath || "Root").replace(
            DEVICE_ROOT_PATH,
            "Device Download",
          )}{" "}
          · {gridDataLength} item{gridDataLength !== 1 ? "s" : ""}
        </Text>
      </View>
      <TouchableOpacity style={styles.actionsBtn} onPress={onActionsMenu}>
        <Text style={styles.actionsBtnText}>⋯</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DDD",
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
  },
  iconBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  iconBtnText: {
    color: "#1F4E79",
    fontSize: 14,
    fontWeight: "600",
  },
  pill: {
    backgroundColor: "#E3F2FD",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillText: {
    color: "#1A73E8",
    fontSize: 12,
    fontWeight: "700",
  },
  pillDelete: {
    backgroundColor: "#FFEBEE",
    marginLeft: 8,
  },
  pillDeleteText: {
    color: "#C62828",
  },
  backRow: {
    paddingHorizontal: 4,
  },
  actionsBtn: {
    paddingHorizontal: 2,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionsBtnText: {
    fontSize: 18,
    color: "#444",
    fontWeight: "700",
    lineHeight: 18,
    transform: [{ rotate: "90deg" }],
  },
});
