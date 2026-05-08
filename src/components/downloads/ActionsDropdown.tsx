import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { SortKey } from "./types";

const SORT_OPTIONS: [SortKey, string][] = [
  ["name_asc", "Name A → Z"],
  ["name_desc", "Name Z → A"],
  ["date_newest", "Date (newest first)"],
  ["date_oldest", "Date (oldest first)"],
  ["size_largest", "Size (largest first)"],
  ["size_smallest", "Size (smallest first)"],
  ["duration_longest", "Duration (longest first)"],
  ["duration_shortest", "Duration (shortest first)"],
  ["type", "File type"],
];

type Props = {
  visible: boolean;
  isDevicePath: boolean;
  isDeviceScanRunning: boolean;
  sortKey: SortKey;
  onClose: () => void;
  onCreateFolder: () => void;
  onRescan: () => void;
  onSortChange: (key: SortKey) => void;
  onManageLabels: () => void;
};

export default function ActionsDropdown({
  visible,
  isDevicePath,
  isDeviceScanRunning,
  sortKey,
  onClose,
  onCreateFolder,
  onRescan,
  onSortChange,
  onManageLabels,
}: Props) {
  const [page, setPage] = useState<"main" | "sort">("main");

  function close() {
    setPage("main");
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={close}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.dropdown}
          onPress={() => {}}
        >
          {page === "main" ? (
            <>
              {!isDevicePath && (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => {
                    close();
                    onCreateFolder();
                  }}
                >
                  <Text style={styles.icon}>📁</Text>
                  <Text style={styles.label}>New folder</Text>
                </TouchableOpacity>
              )}
              {isDevicePath && (
                <TouchableOpacity
                  style={[styles.row, isDeviceScanRunning && styles.rowDisabled]}
                  disabled={isDeviceScanRunning}
                  onPress={() => {
                    close();
                    onRescan();
                  }}
                >
                  <Text style={styles.icon}>🔄</Text>
                  <Text style={styles.label}>
                    {isDeviceScanRunning ? "Scanning..." : "Rescan device"}
                  </Text>
                </TouchableOpacity>
              )}
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => setPage("sort")}
              >
                <Text style={styles.icon}>↕️</Text>
                <Text style={styles.label}>Sort</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  close();
                  onManageLabels();
                }}
              >
                <Text style={styles.icon}>🏷</Text>
                <Text style={styles.label}>Manage labels</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={styles.row}
                onPress={() => setPage("main")}
              >
                <Text style={styles.icon}>‹</Text>
                <Text style={[styles.label, { fontWeight: "700" }]}>
                  Sort by
                </Text>
              </TouchableOpacity>
              <View style={styles.divider} />
              {SORT_OPTIONS.map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={styles.row}
                  onPress={() => {
                    onSortChange(key);
                    close();
                  }}
                >
                  <Text style={styles.icon}>{sortKey === key ? "✓" : "  "}</Text>
                  <Text
                    style={[
                      styles.label,
                      sortKey === key && styles.labelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  dropdown: {
    position: "absolute",
    top: 56,
    right: 12,
    width: 240,
    backgroundColor: "#FFF",
    borderRadius: 8,
    paddingVertical: 4,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  icon: {
    fontSize: 16,
    width: 28,
    color: "#444",
  },
  label: {
    flex: 1,
    fontSize: 14,
    color: "#222",
  },
  labelActive: {
    color: "#1A73E8",
    fontWeight: "700",
  },
  chevron: {
    fontSize: 20,
    color: "#999",
    lineHeight: 20,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E0E0E0",
    marginVertical: 4,
    marginHorizontal: 16,
  },
});
