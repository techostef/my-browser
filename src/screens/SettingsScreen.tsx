import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
  SectionList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSettings, useThemeColors, HistoryEntry } from "../store/settingsStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type RowItem =
  | { kind: "nav"; label: string; value?: string; onPress: () => void }
  | { kind: "toggle"; label: string; value: boolean; onToggle: (v: boolean) => void }
  | { kind: "info"; label: string; value: string };

interface Section {
  title: string;
  data: RowItem[];
}

// ─── Shared header ────────────────────────────────────────────────────────────

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const c = useThemeColors();
  return (
    <View style={[s.screenHeader, { backgroundColor: c.surfaceSecondary, borderBottomColor: c.border }]}>
      <TouchableOpacity onPress={onBack} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={s.backBtnText}>{"‹"} Settings</Text>
      </TouchableOpacity>
      <Text style={[s.screenHeaderTitle, { color: c.text }]}>{title}</Text>
      <View style={s.backBtn} />
    </View>
  );
}

// ─── Sub-screens ──────────────────────────────────────────────────────────────

function SearchEngineScreen({ onBack }: { onBack: () => void }) {
  const { settings, setSetting } = useSettings();
  const c = useThemeColors();
  const engines = ["Google", "Bing", "DuckDuckGo", "Yahoo", "Brave Search", "Ecosia"];
  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.surfaceSecondary }]} edges={["top"]}>
      <ScreenHeader title="Search Engine" onBack={onBack} />
      <ScrollView>
        {engines.map((e) => (
          <TouchableOpacity key={e} style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]} onPress={() => setSetting("searchEngine", e)}>
            <Text style={[s.rowLabel, { color: c.text }]}>{e}</Text>
            {settings.searchEngine === e && <Text style={s.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function LanguageScreen({ onBack }: { onBack: () => void }) {
  const { settings, setSetting } = useSettings();
  const c = useThemeColors();
  const languages = ["English", "Spanish", "French", "German", "Japanese", "Korean", "Chinese (Simplified)", "Arabic", "Portuguese", "Russian"];
  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.surfaceSecondary }]} edges={["top"]}>
      <ScreenHeader title="Language" onBack={onBack} />
      <ScrollView>
        {languages.map((l) => (
          <TouchableOpacity key={l} style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]} onPress={() => setSetting("language", l)}>
            <Text style={[s.rowLabel, { color: c.text }]}>{l}</Text>
            {settings.language === l && <Text style={s.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function HistoryScreen({ onBack }: { onBack: () => void }) {
  const { history, clearHistory } = useSettings();
  const c = useThemeColors();

  const confirmClear = () =>
    Alert.alert("Clear History", "Are you sure you want to clear all browsing history?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: clearHistory },
    ]);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.surfaceSecondary }]} edges={["top"]}>
      <ScreenHeader title="History" onBack={onBack} />
      <ScrollView>
        {history.length === 0 ? (
          <Text style={[s.emptyText, { color: c.textSecondary }]}>No history yet.</Text>
        ) : (
          history.map((item: HistoryEntry) => (
            <View key={item.id} style={[s.historyRow, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
              <View style={[s.historyIcon, { backgroundColor: c.surfaceSecondary }]}>
                <Text style={s.historyIconText}>🌐</Text>
              </View>
              <View style={s.historyText}>
                <Text style={[s.historyTitle, { color: c.text }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[s.historyUrl, { color: c.textSecondary }]} numberOfLines={1}>{item.url}</Text>
              </View>
              <Text style={[s.historyTime, { color: c.textSecondary }]}>{formatTime(item.timestamp)}</Text>
            </View>
          ))
        )}
        {history.length > 0 && (
          <TouchableOpacity style={[s.dangerBtn, { backgroundColor: c.surface }]} onPress={confirmClear}>
            <Text style={s.dangerBtnText}>Clear History</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BookmarksScreen({ onBack }: { onBack: () => void }) {
  const c = useThemeColors();
  const [bookmarks] = useState([
    { id: "1", title: "Google", url: "https://google.com" },
    { id: "2", title: "GitHub", url: "https://github.com" },
    { id: "3", title: "YouTube", url: "https://youtube.com" },
  ]);
  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.surfaceSecondary }]} edges={["top"]}>
      <ScreenHeader title="Bookmarks" onBack={onBack} />
      <ScrollView>
        {bookmarks.length === 0 ? (
          <Text style={[s.emptyText, { color: c.textSecondary }]}>No bookmarks yet.</Text>
        ) : (
          bookmarks.map((b) => (
            <TouchableOpacity key={b.id} style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]} onPress={() => {}}>
              <View style={[s.bookmarkIcon, { backgroundColor: c.surfaceSecondary }]}>
                <Text>🔖</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.rowLabel, { color: c.text }]}>{b.title}</Text>
                <Text style={[s.rowSub, { color: c.textSecondary }]} numberOfLines={1}>{b.url}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}


function AppearanceScreen({ onBack }: { onBack: () => void }) {
  const { settings, setSetting } = useSettings();
  const c = useThemeColors();
  const themes = ["System Default", "Light", "Dark"];
  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.surfaceSecondary }]} edges={["top"]}>
      <ScreenHeader title="Appearance" onBack={onBack} />
      <ScrollView>
        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>THEME</Text>
        {themes.map((t) => (
          <TouchableOpacity key={t} style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]} onPress={() => setSetting("theme", t)}>
            <Text style={[s.rowLabel, { color: c.text }]}>{t}</Text>
            {settings.theme === t && <Text style={s.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>TABS</Text>
        <View style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <Text style={[s.rowLabel, { color: c.text }]}>Compact Tab Switcher</Text>
          <Switch value={settings.compactTabs} onValueChange={(v) => setSetting("compactTabs", v)} trackColor={{ true: "#4ECDC4" }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AboutScreen({ onBack }: { onBack: () => void }) {
  const c = useThemeColors();
  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.surfaceSecondary }]} edges={["top"]}>
      <ScreenHeader title="About" onBack={onBack} />
      <ScrollView>
        <View style={[s.aboutCard, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <Text style={[s.aboutAppName, { color: c.text }]}>My Browser</Text>
          <Text style={[s.aboutVersion, { color: c.textSecondary }]}>Version 1.0.0</Text>
        </View>
        {[
          { label: "Version", value: "1.0.0" },
          { label: "Build", value: "100" },
          { label: "Platform", value: "React Native / Expo" },
        ].map((item) => (
          <View key={item.label} style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
            <Text style={[s.rowLabel, { color: c.text }]}>{item.label}</Text>
            <Text style={[s.rowValue, { color: c.textSecondary }]}>{item.value}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Main Settings Screen ─────────────────────────────────────────────────────

type SubScreen = "searchEngine" | "language" | "history" | "bookmarks" | "appearance" | "about" | null;

export default function SettingsScreen() {
  const { settings } = useSettings();
  const c = useThemeColors();
  const [sub, setSub] = useState<SubScreen>(null);

  if (sub === "searchEngine") return <SearchEngineScreen onBack={() => setSub(null)} />;
  if (sub === "language") return <LanguageScreen onBack={() => setSub(null)} />;
  if (sub === "history") return <HistoryScreen onBack={() => setSub(null)} />;
  if (sub === "bookmarks") return <BookmarksScreen onBack={() => setSub(null)} />;
  if (sub === "appearance") return <AppearanceScreen onBack={() => setSub(null)} />;
  if (sub === "about") return <AboutScreen onBack={() => setSub(null)} />;

  const sections: Section[] = [
    {
      title: "BROWSING",
      data: [
        { kind: "nav", label: "🔍  Search Engine", value: settings.searchEngine, onPress: () => setSub("searchEngine") },
        { kind: "nav", label: "🌐  Language", value: settings.language, onPress: () => setSub("language") },
        { kind: "nav", label: "🕐  History", onPress: () => setSub("history") },
        { kind: "nav", label: "🔖  Bookmarks", onPress: () => setSub("bookmarks") },
      ],
    },
    {
      title: "DISPLAY",
      data: [{ kind: "nav", label: "🎨  Appearance", onPress: () => setSub("appearance") }],
    },
    {
      title: "INFO",
      data: [{ kind: "nav", label: "ℹ️  About", onPress: () => setSub("about") }],
    },
  ];

  const renderItem = ({ item }: { item: RowItem }) => {
    if (item.kind === "nav") {
      return (
        <TouchableOpacity style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]} onPress={item.onPress}>
          <Text style={[s.rowLabel, { color: c.text }]}>{item.label}</Text>
          <View style={s.rowRight}>
            {item.value ? <Text style={[s.rowValue, { color: c.textSecondary }]}>{item.value}</Text> : null}
            <Text style={[s.chevron, { color: c.border }]}>›</Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.kind === "toggle") {
      return (
        <View style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <Text style={[s.rowLabel, { color: c.text }]}>{item.label}</Text>
          <Switch value={item.value} onValueChange={item.onToggle} trackColor={{ true: "#4ECDC4" }} />
        </View>
      );
    }
    return (
      <View style={[s.row, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <Text style={[s.rowLabel, { color: c.text }]}>{item.label}</Text>
        <Text style={[s.rowValue, { color: c.textSecondary }]}>{item.value}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.surfaceSecondary }]} edges={["top"]}>
      <View style={s.mainHeader}>
        <Text style={[s.mainHeaderTitle, { color: c.text }]}>Settings</Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item, i) => item.label + i}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={[s.sectionHeader, { color: c.textSecondary }]}>{section.title}</Text>
        )}
        stickySectionHeadersEnabled={false}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  mainHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  mainHeaderTitle: { fontSize: 28, fontWeight: "700" },
  screenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  screenHeaderTitle: { fontSize: 17, fontWeight: "600" },
  backBtn: { minWidth: 80 },
  backBtnText: { fontSize: 16, color: "#4ECDC4", fontWeight: "500" },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1, fontSize: 16 },
  rowSub: { fontSize: 12, marginTop: 2 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowValue: { fontSize: 15, marginRight: 4 },
  chevron: { fontSize: 20, lineHeight: 22 },
  checkmark: { fontSize: 17, color: "#4ECDC4", fontWeight: "600" },
  dangerBtn: {
    margin: 16,
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#FF3B30",
  },
  dangerBtnText: { fontSize: 16, fontWeight: "600", color: "#FF3B30" },
  emptyText: { textAlign: "center", marginTop: 48, fontSize: 15 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  historyIcon: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  historyIconText: { fontSize: 16 },
  historyText: { flex: 1 },
  historyTitle: { fontSize: 15 },
  historyUrl: { fontSize: 12, marginTop: 1 },
  historyTime: { fontSize: 12 },
  bookmarkIcon: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center", marginRight: 10,
  },
  aboutCard: {
    alignItems: "center", paddingVertical: 32,
    marginBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  aboutAppName: { fontSize: 22, fontWeight: "700" },
  aboutVersion: { fontSize: 14, marginTop: 4 },
});
