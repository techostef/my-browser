import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "../i18n";
import { installUpdate } from "../services/appUpdate";
import { useSettings } from "../store/settingsStore";

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function UpdateReadyBanner({ visible, onDismiss }: Props) {
  const { themeColors } = useSettings();
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <SafeAreaView
      edges={["top"]}
      style={[
        styles.wrap,
        {
          backgroundColor: themeColors.surface,
          borderBottomColor: themeColors.border,
        },
      ]}
    >
      <View style={styles.row}>
        <Text
          style={[styles.message, { color: themeColors.text }]}
          numberOfLines={2}
        >
          {t("updateReady")}
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              installUpdate();
            }}
            style={[styles.btn, { backgroundColor: themeColors.tabBarActive }]}
          >
            <Text style={styles.btnText}>{t("restart")}</Text>
          </Pressable>
          <Pressable
            onPress={onDismiss}
            style={[styles.dismiss, { borderColor: themeColors.border }]}
            hitSlop={8}
          >
            <Text
              style={[styles.dismissText, { color: themeColors.textSecondary }]}
            >
              ×
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  dismiss: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  dismissText: {
    fontSize: 18,
    lineHeight: 18,
    fontWeight: "600",
  },
});
