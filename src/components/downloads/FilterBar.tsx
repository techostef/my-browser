import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTranslation } from "../../i18n";

type Props = {
  filterSummary: string;
  isFilterActive: boolean;
  onOpenFilter: () => void;
  onClear: () => void;
};

export default function FilterBar({
  filterSummary,
  isFilterActive,
  onOpenFilter,
  onClear,
}: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        style={[styles.btn, isFilterActive && styles.btnActive]}
        onPress={onOpenFilter}
      >
        <Text style={[styles.btnText, isFilterActive && styles.btnTextActive]}>
          ▼ {filterSummary}
        </Text>
      </TouchableOpacity>
      {isFilterActive && (
        <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
          <Text style={styles.clearText}>✕ {t('clear')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DDD",
    gap: 8,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#F0F0F0",
  },
  btnActive: {
    backgroundColor: "#E3F2FD",
  },
  btnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
  },
  btnTextActive: {
    color: "#1A73E8",
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#FFEBEE",
  },
  clearText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#C62828",
  },
});
