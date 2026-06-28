/** biome-ignore-all lint/suspicious/noArrayIndexKey: <explanation> */
import { useNavigation } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Linking,
  ScrollView,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AdBanner } from "../components/AdBanner";
import { withErrorBoundary } from "../components/ErrorBoundary";
import { ENABLE_AI_CAPTIONS } from "../config";
import { useTranslation } from "../i18n";
import { clearOpenAIKey, getOpenAIKey, setOpenAIKey } from "../lib/openaiKey";
import {
  clearAllSubtitles,
  getSubtitleCount,
} from "../lib/videoEditor/subtitleCache";
import { LOCAL_MODEL_PATH } from "../lib/videoEditor/whisper";
import {
  HistoryEntry,
  useSettings,
  useThemeColors,
} from "../store/settingsStore";
import { useActiveTabId, useTabActions } from "../store/tabStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type RowItem =
  | { kind: "nav"; label: string; value?: string; onPress: () => void }
  | {
      kind: "toggle";
      label: string;
      value: boolean;
      onToggle: (v: boolean) => void;
    }
  | { kind: "info"; label: string; value: string };

interface Section {
  title: string;
  data: RowItem[];
}

// ─── Shared header ────────────────────────────────────────────────────────────

function ScreenHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <View
      style={[
        s.screenHeader,
        { backgroundColor: c.surfaceSecondary, borderBottomColor: c.border },
      ]}
    >
      <TouchableOpacity
        onPress={onBack}
        style={s.backBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={s.backBtnText}>
          {"‹"} {t("settings")}
        </Text>
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
  const { t } = useTranslation();
  const engines = [
    "Google",
    "Bing",
    "DuckDuckGo",
    "Yahoo",
    "Brave Search",
    "Ecosia",
  ];
  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <ScreenHeader title={t("searchEngine")} onBack={onBack} />
      <ScrollView>
        {engines.map((e) => (
          <TouchableOpacity
            key={e}
            style={[
              s.row,
              { backgroundColor: c.surface, borderBottomColor: c.border },
            ]}
            onPress={() => setSetting("searchEngine", e)}
          >
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
  const { t } = useTranslation();
  const languages = [
    "English",
    "Indonesian",
    "Spanish",
    "French",
    "German",
    "Japanese",
    "Korean",
    "Chinese (Simplified)",
    "Arabic",
    "Portuguese",
    "Russian",
  ];
  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <ScreenHeader title={t("language")} onBack={onBack} />
      <ScrollView>
        {languages.map((l) => (
          <TouchableOpacity
            key={l}
            style={[
              s.row,
              { backgroundColor: c.surface, borderBottomColor: c.border },
            ]}
            onPress={() => setSetting("language", l)}
          >
            <Text style={[s.rowLabel, { color: c.text }]}>{l}</Text>
            {settings.language === l && <Text style={s.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function useFormatTime() {
  const { t } = useTranslation();
  return (ts: number): string => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("justNow");
    if (mins < 60) return `${mins} ${t("minAgo")}`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ${t("hrAgo")}`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return t("yesterday");
    return `${days} ${t("daysAgo")}`;
  };
}

function HistoryScreen({ onBack }: { onBack: () => void }) {
  const { history, clearHistory } = useSettings();
  const c = useThemeColors();
  const { t } = useTranslation();
  const formatTime = useFormatTime();
  const navigation = useNavigation();
  const { addTab } = useTabActions();

  const handleOpen = (url: string) => {
    addTab(url);
    navigation.navigate("Browser" as never);
  };

  const confirmClear = () =>
    Alert.alert(t("clearHistory"), t("clearHistoryConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("clearHistory"), style: "destructive", onPress: clearHistory },
    ]);

  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <ScreenHeader title={t("history")} onBack={onBack} />
      <ScrollView>
        {history.length === 0 ? (
          <Text style={[s.emptyText, { color: c.textSecondary }]}>
            {t("noHistoryYet")}
          </Text>
        ) : (
          history.map((item: HistoryEntry) => (
            <TouchableOpacity
              key={item.id}
              style={[
                s.historyRow,
                { backgroundColor: c.surface, borderBottomColor: c.border },
              ]}
              onPress={() => handleOpen(item.url)}
            >
              <View
                style={[s.historyIcon, { backgroundColor: c.surfaceSecondary }]}
              >
                <Text style={s.historyIconText}>🌐</Text>
              </View>
              <View style={s.historyText}>
                <Text
                  style={[s.historyTitle, { color: c.text }]}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text
                  style={[s.historyUrl, { color: c.textSecondary }]}
                  numberOfLines={1}
                >
                  {item.url}
                </Text>
              </View>
              <Text style={[s.historyTime, { color: c.textSecondary }]}>
                {formatTime(item.timestamp)}
              </Text>
            </TouchableOpacity>
          ))
        )}
        {history.length > 0 && (
          <TouchableOpacity
            style={[s.dangerBtn, { backgroundColor: c.surface }]}
            onPress={confirmClear}
          >
            <Text style={s.dangerBtnText}>{t("clearHistory")}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BookmarksScreen({ onBack }: { onBack: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { bookmarks, removeBookmark } = useSettings();
  const navigation = useNavigation();
  const activeTabId = useActiveTabId();
  const { pushUrl } = useTabActions();

  const handleOpen = (url: string) => {
    pushUrl(activeTabId, url);
    navigation.navigate("Browser" as never);
  };

  const confirmDelete = (id: string, title: string) =>
    Alert.alert(t("removeBookmark"), `${t("remove")} "${title}"?`, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("remove"),
        style: "destructive",
        onPress: () => removeBookmark(id),
      },
    ]);

  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <ScreenHeader title={t("bookmarks")} onBack={onBack} />
      <ScrollView>
        {bookmarks.length === 0 ? (
          <Text style={[s.emptyText, { color: c.textSecondary }]}>
            {t("noBookmarksYet")}
          </Text>
        ) : (
          bookmarks.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[
                s.row,
                { backgroundColor: c.surface, borderBottomColor: c.border },
              ]}
              onPress={() => handleOpen(b.url)}
            >
              <View
                style={[
                  s.bookmarkIcon,
                  { backgroundColor: c.surfaceSecondary },
                ]}
              >
                <Text>🔖</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.rowLabel, { color: c.text }]} numberOfLines={1}>
                  {b.title}
                </Text>
                <Text
                  style={[s.rowSub, { color: c.textSecondary }]}
                  numberOfLines={1}
                >
                  {b.url}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => confirmDelete(b.id, b.title)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={s.bookmarkDeleteBtn}
              >
                <Text style={s.bookmarkDeleteText}>✕</Text>
              </TouchableOpacity>
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
  const { t } = useTranslation();
  const themes: Array<{ key: string; label: string }> = [
    { key: "System Default", label: t("systemDefault") },
    { key: "Light", label: t("light") },
    { key: "Dark", label: t("dark") },
  ];
  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <ScreenHeader title={t("appearance")} onBack={onBack} />
      <ScrollView>
        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>
          {t("theme")}
        </Text>
        {themes.map((th) => (
          <TouchableOpacity
            key={th.key}
            style={[
              s.row,
              { backgroundColor: c.surface, borderBottomColor: c.border },
            ]}
            onPress={() => setSetting("theme", th.key)}
          >
            <Text style={[s.rowLabel, { color: c.text }]}>{th.label}</Text>
            {settings.theme === th.key && <Text style={s.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>
          {t("tabs")}
        </Text>
        <View
          style={[
            s.row,
            { backgroundColor: c.surface, borderBottomColor: c.border },
          ]}
        >
          <Text style={[s.rowLabel, { color: c.text }]}>
            {t("compactTabSwitcher")}
          </Text>
          <Switch
            value={settings.compactTabs}
            onValueChange={(v) => setSetting("compactTabs", v)}
            trackColor={{ true: "#4ECDC4" }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AISubtitlesScreen({ onBack }: { onBack: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    getOpenAIKey().then((k) => {
      if (k) setKey(k);
    });
  }, []);

  const handleSave = async () => {
    if (!key.trim()) return;
    await setOpenAIKey(key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () =>
    Alert.alert(t("removeApiKey"), t("removeApiKeyConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("remove"),
        style: "destructive",
        onPress: async () => {
          await clearOpenAIKey();
          setKey("");
        },
      },
    ]);

  const preview =
    key.length > 8
      ? key.slice(0, 4) + "••••••••" + key.slice(-4)
      : key
        ? "••••••••"
        : "";

  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <ScreenHeader title={t("aiSubtitles")} onBack={onBack} />
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>
          {t("openaiApiKey")}
        </Text>
        <View
          style={[
            s.keyCard,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <View style={[s.keyInputRow, { borderColor: c.border }]}>
            <TextInput
              style={[s.keyInput, { color: c.text }]}
              value={key}
              onChangeText={setKey}
              placeholder="sk-..."
              placeholderTextColor={c.textSecondary}
              secureTextEntry={!visible}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={() => setVisible((v) => !v)}
              style={s.eyeBtn}
            >
              <Text style={{ color: c.textSecondary, fontSize: 16 }}>
                {visible ? "🙈" : "👁️"}
              </Text>
            </TouchableOpacity>
          </View>
          {preview ? (
            <Text style={[s.keyPreview, { color: c.textSecondary }]}>
              {t("stored")}: {preview}
            </Text>
          ) : null}
          <View style={s.keyBtnRow}>
            <TouchableOpacity
              style={[
                s.keyBtn,
                { backgroundColor: "#6c63ff", opacity: key.trim() ? 1 : 0.4 },
              ]}
              onPress={handleSave}
              disabled={!key.trim()}
            >
              <Text style={s.keyBtnText}>{saved ? t("saved") : t("save")}</Text>
            </TouchableOpacity>
            {preview ? (
              <TouchableOpacity
                style={[s.keyBtn, { backgroundColor: "#FF3B30" }]}
                onPress={handleClear}
              >
                <Text style={s.keyBtnText}>{t("remove")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <Text style={[s.keyHint, { color: c.textSecondary }]}>
          {t("apiKeyHint")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function WhisperModelScreen({ onBack }: { onBack: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [modelSize, setModelSize] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    const info = await FileSystem.getInfoAsync(LOCAL_MODEL_PATH);
    setModelSize(info.exists && "size" in info ? (info as any).size : null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleImport = async () => {
    try {
      setImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      const dir = LOCAL_MODEL_PATH.substring(
        0,
        LOCAL_MODEL_PATH.lastIndexOf("/"),
      );
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.copyAsync({ from: file.uri, to: LOCAL_MODEL_PATH });
      await refresh();
      Alert.alert(t("modelImported"), t("modelImportedDesc"));
    } catch (e) {
      Alert.alert(
        t("importFailed"),
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = () =>
    Alert.alert(t("deleteModel"), t("deleteModelConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: async () => {
          await FileSystem.deleteAsync(LOCAL_MODEL_PATH, { idempotent: true });
          await refresh();
        },
      },
    ]);

  const sizeMB = modelSize
    ? (modelSize / (1024 * 1024)).toFixed(0) + " MB"
    : null;
  const installed = modelSize !== null;

  const MODELS = [
    { name: "ggml-tiny.bin", size: "~75 MB", note: "Fastest, lowest accuracy" },
    { name: "ggml-base.bin", size: "~142 MB", note: "Balanced (recommended)" },
    {
      name: "ggml-small.bin",
      size: "~466 MB",
      note: "Slower, higher accuracy",
    },
    {
      name: "ggml-medium.bin",
      size: "~1.5 GB",
      note: "Very slow, best accuracy",
    },
  ];

  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <ScreenHeader title={t("whisperModel")} onBack={onBack} />
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>
          {t("status")}
        </Text>
        <View
          style={[
            s.wmCard,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <Text style={s.wmStatusDot}>{installed ? "🟢" : "⚪"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.wmStatusLabel, { color: c.text }]}>
              {installed ? t("modelInstalled") : t("noModelInstalled")}
            </Text>
            {sizeMB ? (
              <Text style={[s.wmStatusSub, { color: c.textSecondary }]}>
                {sizeMB}
              </Text>
            ) : null}
          </View>
        </View>

        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>
          {t("howToUse")}
        </Text>
        <View
          style={[
            s.wmCard,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          {[
            t("whisperStep1"),
            t("whisperStep2"),
            t("whisperStep3"),
            t("whisperStep4"),
            t("whisperStep5"),
          ].map((step, i) => (
            <View key={i} style={s.wmStep}>
              <Text style={[s.wmStepNum, { color: "#4ECDC4" }]}>{i + 1}</Text>
              <Text style={[s.wmStepText, { color: c.text }]}>{step}</Text>
            </View>
          ))}
        </View>

        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>
          {t("download")}
        </Text>
        <TouchableOpacity
          style={[
            s.row,
            { backgroundColor: c.surface, borderBottomColor: c.border },
          ]}
          onPress={() =>
            Linking.openURL(
              "https://huggingface.co/ggerganov/whisper.cpp/tree/main",
            )
          }
        >
          <Text style={[s.rowLabel, { color: "#4ECDC4" }]}>
            {t("openHuggingFace")}
          </Text>
        </TouchableOpacity>

        <Text style={[s.sectionHeader, { color: c.textSecondary }]}>
          {t("availableModels")}
        </Text>
        {MODELS.map((m) => (
          <View
            key={m.name}
            style={[
              s.row,
              { backgroundColor: c.surface, borderBottomColor: c.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, { color: c.text }]}>{m.name}</Text>
              <Text style={[s.rowSub, { color: c.textSecondary }]}>
                {m.note}
              </Text>
            </View>
            <Text style={[s.rowValue, { color: c.textSecondary }]}>
              {m.size}
            </Text>
          </View>
        ))}

        <View style={s.wmActions}>
          {!installed ? (
            <TouchableOpacity
              style={[
                s.wmBtn,
                { backgroundColor: "#4ECDC4", opacity: importing ? 0.6 : 1 },
              ]}
              onPress={handleImport}
              disabled={importing}
            >
              <Text style={s.wmBtnText}>
                {importing ? t("importing") : t("importModel")}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.wmBtn, { backgroundColor: "#FF3B30" }]}
              onPress={handleDelete}
            >
              <Text style={s.wmBtnText}>{t("deleteModel")}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AboutScreen({ onBack }: { onBack: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <ScreenHeader title={t("about")} onBack={onBack} />
      <ScrollView>
        <View
          style={[
            s.aboutCard,
            { backgroundColor: c.surface, borderBottomColor: c.border },
          ]}
        >
          <Text style={[s.aboutAppName, { color: c.text }]}>My Browser</Text>
          <Text style={[s.aboutVersion, { color: c.textSecondary }]}>
            Version 1.0.0
          </Text>
        </View>
        {[
          { label: t("version"), value: "1.0.0" },
          { label: t("build"), value: "100" },
          { label: t("platform"), value: "React Native / Expo" },
        ].map((item) => (
          <View
            key={item.label}
            style={[
              s.row,
              { backgroundColor: c.surface, borderBottomColor: c.border },
            ]}
          >
            <Text style={[s.rowLabel, { color: c.text }]}>{item.label}</Text>
            <Text style={[s.rowValue, { color: c.textSecondary }]}>
              {item.value}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Main Settings Screen ─────────────────────────────────────────────────────

type SubScreen =
  | "searchEngine"
  | "language"
  | "history"
  | "bookmarks"
  | "appearance"
  | "aiSubtitles"
  | "whisperModel"
  | "about"
  | null;

function SettingsScreen() {
  const navigation = useNavigation();
  const { settings, setSetting } = useSettings();
  const c = useThemeColors();
  const { t } = useTranslation();
  const [sub, setSub] = useState<SubScreen>(null);
  const [subtitleCount, setSubtitleCount] = useState(0);

  useEffect(() => {
    getSubtitleCount().then(setSubtitleCount);
  }, []);

  const handleClearSubtitles = () => {
    if (subtitleCount === 0) {
      Alert.alert(t("noSubtitles"), t("noSubtitlesDesc"));
      return;
    }
    Alert.alert(
      t("deleteAllSubtitlesTitle"),
      t("deleteAllSubtitlesDesc", {
        count: subtitleCount,
        s: subtitleCount === 1 ? "" : "s",
      }),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("deleteAll"),
          style: "destructive",
          onPress: async () => {
            await clearAllSubtitles();
            setSubtitleCount(0);
          },
        },
      ],
    );
  };

  if (sub === "searchEngine")
    return <SearchEngineScreen onBack={() => setSub(null)} />;
  if (sub === "language") return <LanguageScreen onBack={() => setSub(null)} />;
  if (sub === "history") return <HistoryScreen onBack={() => setSub(null)} />;
  if (sub === "bookmarks")
    return <BookmarksScreen onBack={() => setSub(null)} />;
  if (sub === "appearance")
    return <AppearanceScreen onBack={() => setSub(null)} />;
  if (sub === "aiSubtitles")
    return <AISubtitlesScreen onBack={() => setSub(null)} />;
  if (sub === "whisperModel")
    return <WhisperModelScreen onBack={() => setSub(null)} />;
  if (sub === "about") return <AboutScreen onBack={() => setSub(null)} />;

  const sections: Section[] = [
    {
      title: t("browsing"),
      data: [
        {
          kind: "nav",
          label: `🔍  ${t("searchEngine")}`,
          value: settings.searchEngine,
          onPress: () => setSub("searchEngine"),
        },
        {
          kind: "nav",
          label: `🌐  ${t("language")}`,
          value: settings.language,
          onPress: () => setSub("language"),
        },
        {
          kind: "toggle",
          label: `🛡️  ${t("adBlocker")}`,
          value: settings.adBlockEnabled,
          onToggle: (v) => setSetting("adBlockEnabled", v),
        },
        {
          kind: "toggle",
          label: `🚫  ${t("popupBlocker")}`,
          value: settings.popupBlockEnabled,
          onToggle: (v) => setSetting("popupBlockEnabled", v),
        },
        {
          kind: "nav",
          label: `🕐  ${t("history")}`,
          onPress: () => setSub("history"),
        },
        {
          kind: "nav",
          label: `🔖  ${t("bookmarks")}`,
          onPress: () => setSub("bookmarks"),
        },
      ],
    },
    {
      title: t("display"),
      data: [
        {
          kind: "nav",
          label: `🎨  ${t("appearance")}`,
          onPress: () => setSub("appearance"),
        },
      ],
    },
    {
      title: t("ai"),
      data: [
        ...(ENABLE_AI_CAPTIONS
          ? [
              {
                kind: "nav" as const,
                label: `🤖  ${t("aiSubtitles")}`,
                onPress: () => setSub("aiSubtitles"),
              },
            ]
          : []),
        {
          kind: "nav",
          label: `�️  ${t("whisperModel")}`,
          onPress: () => setSub("whisperModel"),
        },
        ...(subtitleCount > 0
          ? [
              {
                kind: "nav" as const,
                label: `🗑️  ${t("deleteAllSubtitles")}`,
                value: `${subtitleCount} ${t("cached")}`,
                onPress: handleClearSubtitles,
              },
            ]
          : []),
      ],
    },
    {
      title: t("info"),
      data: [
        {
          kind: "nav",
          label: `ℹ️  ${t("about")}`,
          onPress: () => setSub("about"),
        },
      ],
    },
  ];

  const renderItem = ({ item }: { item: RowItem }) => {
    if (item.kind === "nav") {
      return (
        <TouchableOpacity
          style={[
            s.row,
            { backgroundColor: c.surface, borderBottomColor: c.border },
          ]}
          onPress={item.onPress}
        >
          <Text style={[s.rowLabel, { color: c.text }]}>{item.label}</Text>
          <View style={s.rowRight}>
            {item.value ? (
              <Text style={[s.rowValue, { color: c.textSecondary }]}>
                {item.value}
              </Text>
            ) : null}
            <Text style={[s.chevron, { color: c.border }]}>›</Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.kind === "toggle") {
      return (
        <View
          style={[
            s.row,
            { backgroundColor: c.surface, borderBottomColor: c.border },
          ]}
        >
          <Text style={[s.rowLabel, { color: c.text }]}>{item.label}</Text>
          <Switch
            value={item.value}
            onValueChange={item.onToggle}
            trackColor={{ true: "#4ECDC4" }}
          />
        </View>
      );
    }
    return (
      <View
        style={[
          s.row,
          { backgroundColor: c.surface, borderBottomColor: c.border },
        ]}
      >
        <Text style={[s.rowLabel, { color: c.text }]}>{item.label}</Text>
        <Text style={[s.rowValue, { color: c.textSecondary }]}>
          {item.value}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.surfaceSecondary }]}
      edges={["top"]}
    >
      <View style={s.mainHeader}>
        <TouchableOpacity
          onPress={() => (navigation as any).navigate("Browser")}
          style={s.mainBackBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[s.mainBackBtnText, { color: c.text }]}>{"‹"}</Text>
        </TouchableOpacity>
        <Text style={[s.mainHeaderTitle, { color: c.text }]}>
          {t("settings")}
        </Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item, i) => item.label + i}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={[s.sectionHeader, { color: c.textSecondary }]}>
            {section.title}
          </Text>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 60 }}
      />
      <AdBanner />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  mainHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  mainHeaderTitle: { fontSize: 28, fontWeight: "700" },
  mainBackBtn: { paddingRight: 12, paddingVertical: 4 },
  mainBackBtnText: { fontSize: 32, fontWeight: "400", lineHeight: 32 },
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
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  historyIconText: { fontSize: 16 },
  historyText: { flex: 1 },
  historyTitle: { fontSize: 15 },
  historyUrl: { fontSize: 12, marginTop: 1 },
  historyTime: { fontSize: 12 },
  bookmarkIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  aboutCard: {
    alignItems: "center",
    paddingVertical: 32,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  aboutAppName: { fontSize: 22, fontWeight: "700" },
  aboutVersion: { fontSize: 14, marginTop: 4 },
  bookmarkDeleteBtn: {
    padding: 6,
    marginLeft: 8,
  },
  bookmarkDeleteText: { fontSize: 14, color: "#FF3B30" },
  keyCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  keyInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  keyInput: { flex: 1, fontSize: 15, paddingVertical: 14 },
  eyeBtn: { padding: 8 },
  keyPreview: { fontSize: 12, paddingHorizontal: 12, paddingTop: 8 },
  keyBtnRow: { flexDirection: "row", gap: 8, padding: 12 },
  keyBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  keyBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  keyHint: {
    fontSize: 12,
    lineHeight: 18,
    marginHorizontal: 16,
    marginTop: 12,
  },
  wmCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  wmStatusDot: { fontSize: 20 },
  wmStatusLabel: { fontSize: 15, fontWeight: "600" },
  wmStatusSub: { fontSize: 12, marginTop: 2 },
  wmStep: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  wmStepNum: { fontSize: 14, fontWeight: "700", minWidth: 18, marginTop: 1 },
  wmStepText: { flex: 1, fontSize: 14, lineHeight: 20 },
  wmActions: { margin: 16, marginTop: 24 },
  wmBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  wmBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});

export default withErrorBoundary(SettingsScreen);
