import React, { useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSearchHistory } from "../hooks/useSearchHistory";
import { useTranslation } from "../i18n";
import { Shortcut, useSettings, useThemeColors } from "../store/settingsStore";

const SHORTCUT_SIZE = 64;

function faviconLetter(shortcut: Shortcut): string {
  if (shortcut.emoji) return shortcut.emoji;
  return shortcut.title.charAt(0).toUpperCase();
}

function faviconBg(url: string): string {
  const colors = [
    "#E8F4FD",
    "#FEF3C7",
    "#D1FAE5",
    "#FCE7F3",
    "#EDE9FE",
    "#FEE2E2",
    "#DBEAFE",
  ];
  let hash = 0;
  for (let i = 0; i < url.length; i++)
    hash = url.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

interface Props {
  onNavigate: (url: string) => void;
}

export default function HomePage({ onNavigate }: Props) {
  const { settings, history, searchUrl, addShortcut, removeShortcut } =
    useSettings();
  const c = useThemeColors();
  const { t } = useTranslation();
  const { history: searchHistory, saveEntry, deleteEntry } = useSearchHistory();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolveUrl = (input: string): string => {
    if (/^https?:\/\//i.test(input)) return input;
    if (/^[\w-]+(\.[\w-]+)+/.test(input)) return `https://${input}`;
    return searchUrl(input);
  };

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    saveEntry(q);
    const url = resolveUrl(q);
    setQuery("");
    setFocused(false);
    onNavigate(url);
  };

  const handlePickHistory = (item: string) => {
    setQuery("");
    setFocused(false);
    onNavigate(resolveUrl(item.trim()));
  };

  const filteredHistory = focused
    ? (query.trim()
        ? searchHistory.filter((h) =>
            h.toLowerCase().includes(query.toLowerCase()),
          )
        : searchHistory
      ).slice(0, 10)
    : [];

  const handleAddShortcut = () => {
    setAddUrl("");
    setAddModalVisible(true);
  };

  const handleConfirmShortcut = () => {
    const trimmed = addUrl.trim();
    if (!trimmed) return;
    let finalUrl = trimmed;
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = "https://" + finalUrl;
    const title = finalUrl.replace(/^https?:\/\//, "").split("/")[0];
    addShortcut({ title, url: finalUrl });
    setAddModalVisible(false);
    setAddUrl("");
  };

  const handleLongPressShortcut = (shortcut: Shortcut) => {
    Alert.alert(shortcut.title, shortcut.url, [
      { text: t("open"), onPress: () => onNavigate(shortcut.url) },
      {
        text: t("remove"),
        style: "destructive",
        onPress: () => removeShortcut(shortcut.id),
      },
      { text: t("cancel"), style: "cancel" },
    ]);
  };

  const engineName = settings.searchEngine;
  const recentHistory = history.slice(0, 8);

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: c.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Search engine logo */}
        <View style={styles.logoWrap}>
          <Text style={[styles.logoText, { color: c.text }]}>{engineName}</Text>
        </View>

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: c.inputBackground,
                borderColor: c.inputBorder,
              },
            ]}
          >
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={[styles.searchInput, { color: c.text }]}
              placeholder={t("searchOrType", { engine: engineName })}
              placeholderTextColor={c.textSecondary}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              onFocus={() => {
                if (blurTimeoutRef.current)
                  clearTimeout(blurTimeoutRef.current);
                setFocused(true);
              }}
              onBlur={() => {
                blurTimeoutRef.current = setTimeout(
                  () => setFocused(false),
                  200,
                );
              }}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.clearBtn, { color: c.textSecondary }]}>
                  ✕
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {filteredHistory.length > 0 && (
            <View
              style={[
                styles.dropdown,
                {
                  backgroundColor: c.inputBackground,
                  borderColor: c.inputBorder,
                },
              ]}
            >
              <FlatList
                data={filteredHistory}
                keyExtractor={(item, idx) => `${item}_${idx}`}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <View style={styles.historyDropdownRow}>
                    <TouchableOpacity
                      style={styles.historyDropdownItem}
                      onPress={() => handlePickHistory(item)}
                    >
                      <Text
                        style={[styles.historyDropdownText, { color: c.text }]}
                        numberOfLines={1}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.historyDropdownDelete}
                      onPress={() => deleteEntry(item)}
                    >
                      <Text
                        style={[
                          styles.historyDropdownDeleteText,
                          { color: c.textSecondary },
                        ]}
                      >
                        ✕
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            </View>
          )}
        </View>

        {/* Shortcuts */}
        <View style={styles.shortcutsGrid}>
          {settings.shortcuts.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.shortcutItem}
              onPress={() => onNavigate(s.url)}
              onLongPress={() => handleLongPressShortcut(s)}
              activeOpacity={0.75}
            >
              <View
                style={[
                  styles.shortcutIcon,
                  { backgroundColor: faviconBg(s.url) },
                ]}
              >
                <Text style={styles.shortcutEmoji}>{faviconLetter(s)}</Text>
              </View>
              <Text
                style={[styles.shortcutLabel, { color: c.textSecondary }]}
                numberOfLines={1}
              >
                {s.title}
              </Text>
            </TouchableOpacity>
          ))}

          {/* Add shortcut button */}
          <TouchableOpacity
            style={styles.shortcutItem}
            onPress={handleAddShortcut}
            activeOpacity={0.75}
          >
            <View
              style={[
                styles.shortcutIcon,
                styles.shortcutAddIcon,
                { backgroundColor: c.surfaceSecondary, borderColor: c.border },
              ]}
            >
              <Text
                style={[styles.shortcutAddText, { color: c.textSecondary }]}
              >
                +
              </Text>
            </View>
            <Text style={[styles.shortcutLabel, { color: c.textSecondary }]}>
              {t("addShortcut")}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Recent history */}
        {recentHistory.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>
              {t("recent")}
            </Text>
            {recentHistory.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={[styles.historyRow, { borderBottomColor: c.border }]}
                onPress={() => onNavigate(entry.url)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.historyIconWrap,
                    { backgroundColor: c.surfaceSecondary },
                  ]}
                >
                  <Text style={styles.historyIcon}>🕐</Text>
                </View>
                <View style={styles.historyText}>
                  <Text
                    style={[styles.historyTitle, { color: c.text }]}
                    numberOfLines={1}
                  >
                    {entry.title}
                  </Text>
                  <Text
                    style={[styles.historyUrl, { color: c.textSecondary }]}
                    numberOfLines={1}
                  >
                    {entry.url.replace(/^https?:\/\//, "")}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add Shortcut Modal */}
      <Modal
        visible={addModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalKAV}
          behavior={Platform.OS === "ios" ? "padding" : "padding"}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setAddModalVisible(false)}
          >
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>{t("addShortcut")}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="https://example.com"
                placeholderTextColor="#9CA3AF"
                value={addUrl}
                onChangeText={setAddUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={handleConfirmShortcut}
                autoFocus
              />
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setAddModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>{t("cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalAddBtn}
                  onPress={handleConfirmShortcut}
                >
                  <Text style={styles.modalAddText}>{t("add")}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFF",
  },
  content: {
    paddingTop: 40,
    paddingBottom: 32,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  logoWrap: {
    marginBottom: 24,
  },
  logoText: {
    fontSize: 44,
    fontWeight: "700",
    color: "#4B5563",
    letterSpacing: -1,
  },
  searchWrap: {
    width: "100%",
    position: "relative",
    marginBottom: 32,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    paddingHorizontal: 16,
    backgroundColor: "#FFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  dropdown: {
    position: "absolute",
    top: 52,
    left: 0,
    right: 0,
    maxHeight: 280,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    zIndex: 999,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  historyDropdownRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  historyDropdownItem: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  historyDropdownText: {
    fontSize: 14,
  },
  historyDropdownDelete: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  historyDropdownDeleteText: {
    fontSize: 13,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
  },
  clearBtn: {
    fontSize: 12,
    color: "#9CA3AF",
    fontWeight: "600",
    padding: 4,
  },
  shortcutsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%",
    gap: 16,
    justifyContent: "flex-start",
    marginBottom: 32,
  },
  shortcutItem: {
    width: SHORTCUT_SIZE,
    alignItems: "center",
    gap: 6,
  },
  shortcutIcon: {
    width: SHORTCUT_SIZE,
    height: SHORTCUT_SIZE,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutEmoji: {
    fontSize: 26,
  },
  shortcutAddIcon: {
    backgroundColor: "#F3F4F6",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
  },
  shortcutAddText: {
    fontSize: 26,
    color: "#9CA3AF",
    lineHeight: 30,
  },
  shortcutLabel: {
    fontSize: 11,
    color: "#6B7280",
    textAlign: "center",
    maxWidth: SHORTCUT_SIZE,
  },
  section: {
    width: "100%",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9CA3AF",
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F3F4F6",
    gap: 12,
  },
  historyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
  },
  historyIcon: {
    fontSize: 16,
  },
  historyText: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "500",
  },
  historyUrl: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 1,
  },
  modalKAV: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    backgroundColor: "#FFF",
    borderRadius: 14,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#F9FAFB",
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
  },
  modalAddBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#1A73E8",
    alignItems: "center",
  },
  modalAddText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFF",
  },
});
