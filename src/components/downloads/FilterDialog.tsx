import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { sharedStyles as s } from "./sharedStyles";
import { FilterType } from "./types";
import { useTranslation } from "../../i18n";
import { TranslationKey } from "../../i18n/translations";

const TYPE_OPTIONS: { value: FilterType; labelKey: TranslationKey; icon: string }[] = [
  { value: "all", labelKey: "filterAll", icon: "🗂️" },
  { value: "video", labelKey: "video", icon: "🎬" },
  { value: "audio", labelKey: "audio", icon: "🎵" },
  { value: "image", labelKey: "image", icon: "🖼️" },
  { value: "other", labelKey: "other", icon: "📄" },
];

type Props = {
  visible: boolean;
  filterType: FilterType;
  labelFilter: string[];
  labelDefs: string[];
  isFilterActive: boolean;
  onFilterType: (f: FilterType) => void;
  onLabelFilter: (labels: string[]) => void;
  onClose: () => void;
  onClear: () => void;
};

export default function FilterDialog({
  visible,
  filterType,
  labelFilter,
  labelDefs,
  isFilterActive,
  onFilterType,
  onLabelFilter,
  onClose,
  onClear,
}: Props) {
  const { t } = useTranslation();

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
          <Text style={s.modalTitle}>{t('filter')}</Text>
          <Text style={styles.section}>{t('type')}</Text>
          <View style={styles.chips}>
            {TYPE_OPTIONS.map(({ value, labelKey, icon }) => {
              const active = filterType === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => onFilterType(value)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {icon} {t(labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {labelDefs.length > 0 && (
            <>
              <Text style={styles.section}>{t('labels')}</Text>
              <View style={styles.chips}>
                {labelDefs.map((lbl) => {
                  const active = labelFilter.includes(lbl);
                  return (
                    <TouchableOpacity
                      key={lbl}
                      style={[styles.chip, active && styles.chipLabelActive]}
                      onPress={() =>
                        onLabelFilter(
                          active
                            ? labelFilter.filter((l) => l !== lbl)
                            : [...labelFilter, lbl],
                        )
                      }
                    >
                      <Text
                        style={[styles.chipText, active && styles.chipTextActive]}
                      >
                        🏷 {lbl}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
          <View style={s.modalActions}>
            {isFilterActive && (
              <TouchableOpacity style={s.modalBtn} onPress={onClear}>
                <Text style={s.modalBtnText}>{t('clear')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.modalBtn, s.modalPrimaryBtn]}
              onPress={onClose}
            >
              <Text style={[s.modalBtnText, s.modalPrimaryBtnText]}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: 11,
    fontWeight: "700",
    color: "#999",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#F0F0F0",
  },
  chipActive: {
    backgroundColor: "#1A73E8",
  },
  chipLabelActive: {
    backgroundColor: "#FF9800",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
  },
  chipTextActive: {
    color: "#FFF",
  },
});
