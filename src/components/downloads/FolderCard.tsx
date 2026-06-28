import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "../../i18n";
import { FolderGridItem } from "./types";

type Props = {
  item: FolderGridItem;
  itemCount: number;
  isDeviceScanRunning: boolean;
  isHidden?: boolean;
  onOpen: () => void;
  onAction?: () => void;
};

export default function FolderCard({
  item,
  itemCount,
  isDeviceScanRunning,
  isHidden = false,
  onOpen,
  onAction,
}: Props) {
  const { t } = useTranslation();

  return (
    <View style={[styles.folderCard, isHidden && styles.cardHidden]}>
      {isHidden ? (
        <View style={styles.hiddenBadge}>
          <Text style={styles.hiddenBadgeText}>🚫</Text>
        </View>
      ) : null}
      <TouchableOpacity style={styles.folderCardBody} onPress={onOpen}>
        <Text style={styles.folderIcon}>📁</Text>
        <Text style={styles.folderName} numberOfLines={1}>
          {item.name}
        </Text>
      </TouchableOpacity>
      <View style={{ display: "flex", flexDirection: "row" }}>
        <Text style={styles.folderMeta} numberOfLines={1}>
          {item.isDeviceRoot && isDeviceScanRunning
            ? t("scanning")
            : `${itemCount} ${t("items")} · ${t("tapToOpen")}`}
        </Text>
        {item.source === "private" && onAction ? (
          <TouchableOpacity style={styles.folderMenuBtn} onPress={onAction}>
            <Text style={styles.folderMenuText}>⋯</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={{ height: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  folderCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  folderCardBody: {
    height: 120,
    borderRadius: 10,
    backgroundColor: "#E8F0FE",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  folderIcon: {
    fontSize: 34,
    marginBottom: 8,
  },
  folderName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2B2B2B",
  },
  folderMeta: {
    fontSize: 10,
    color: "#6A6A6A",
    marginTop: 8,
    paddingVertical: 8,
  },
  folderMenuBtn: {
    marginLeft: "auto",
    marginTop: 8,
    alignSelf: "flex-end",
    width: 20,
    height: 30,
    paddingRight: 4,
    borderRadius: 8,
    backgroundColor: "#F2F2F2",
    alignItems: "center",
    justifyContent: "center",
  },
  folderMenuText: {
    fontSize: 18,
    lineHeight: 18,
    color: "#444",
    marginTop: -4,
    transform: [{ rotate: "90deg" }],
  },
  cardHidden: {
    opacity: 0.55,
  },
  hiddenBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  hiddenBadgeText: {
    fontSize: 12,
  },
});
