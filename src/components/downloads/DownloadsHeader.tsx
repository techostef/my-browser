import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from "react-native";
import { useTranslation } from "../../i18n";

const DEVICE_ROOT_PATH = "__device_download__";

type Props = {
  isSelectionMode: boolean;
  selectedCount: number;
  allSelected: boolean;
  currentFolderPath: string;
  gridDataLength: number;
  onCancelSelection: () => void;
  onSelectAll: () => void;
  onBulkActionsMenu: () => void;
  onBack: () => void;
  onActionsMenu: () => void;
};

export default function DownloadsHeader({
  isSelectionMode,
  selectedCount,
  allSelected,
  currentFolderPath,
  gridDataLength,
  onCancelSelection,
  onSelectAll,
  onBulkActionsMenu,
  onBack,
  onActionsMenu,
}: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isSelectionMode) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onCancelSelection();
      return true;
    });
    return () => sub.remove();
  }, [isSelectionMode, onCancelSelection]);

  if (isSelectionMode) {
    return (
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={onCancelSelection}>
          <Text style={styles.iconBtnText}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pill} onPress={onSelectAll}>
          <Text style={styles.pillText}>
            {allSelected ? t('deselectAll') : t('selectAll')}
          </Text>
        </TouchableOpacity>
        <View style={{ marginRight: "auto", marginLeft: 8 }}>
          <Text style={styles.title}>{selectedCount} {t('selected')}</Text>
        </View>
        <TouchableOpacity style={styles.actionsBtn} onPress={onBulkActionsMenu}>
          <Text style={styles.actionsBtnText}>⋯</Text>
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
          {(currentFolderPath || t('root')).replace(
            DEVICE_ROOT_PATH,
            t('deviceDownload'),
          )}{" "}
          · {gridDataLength} {t('items')}
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
