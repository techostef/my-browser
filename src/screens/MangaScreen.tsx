import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { withErrorBoundary } from "../components/ErrorBoundary";
import MangaCard from "../components/manga/MangaCard";
import { useTranslation } from "../i18n";
import { isMangaDownloading, useManga } from "../store/mangaStore";
import { useSettings } from "../store/settingsStore";
import { MangaTitle } from "../types/manga";
import { RootStackParamList } from "../types/videoEditor";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function MangaScreen() {
  const { titles, loaded, removeTitle, updateTitle, getTitle } = useManga();
  const navigation = useNavigation<Nav>();
  const { themeColors: c } = useSettings();
  const { t } = useTranslation();

  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const handlePress = useCallback(
    (manga: MangaTitle) => {
      navigation.navigate("MangaChapters", { mangaId: manga.id });
    },
    [navigation],
  );

  const handleLongPress = useCallback(
    (manga: MangaTitle) => {
      const mangaId = manga.id;
      Alert.alert(manga.title, undefined, [
        {
          text: t("rename"),
          onPress: () => {
            setRenameTarget(mangaId);
            setRenameText(manga.title);
          },
        },
        {
          text: t("delete"),
          style: "destructive",
          onPress: () => {
            // Deleting mid-download would let the download loop recreate
            // the folder on disk after it was removed.
            if (isMangaDownloading(getTitle(mangaId) ?? manga)) {
              Alert.alert(t("deleteManga"), t("mangaDownloadInProgress"));
              return;
            }
            Alert.alert(t("deleteManga"), t("deleteMangaConfirm"), [
              { text: t("cancel"), style: "cancel" },
              {
                text: t("delete"),
                style: "destructive",
                onPress: () => removeTitle(mangaId),
              },
            ]);
          },
        },
        { text: t("cancel"), style: "cancel" },
      ]);
    },
    [removeTitle, getTitle, t],
  );

  const confirmRename = () => {
    if (renameTarget && renameText.trim()) {
      updateTitle(renameTarget, { title: renameText.trim() });
    }
    setRenameTarget(null);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text style={[styles.headerTitle, { color: c.text }]}>
          {t("manga")}
        </Text>
      </View>

      {!loaded ? (
        <View style={styles.empty}>
          <ActivityIndicator color={c.textSecondary} />
        </View>
      ) : titles.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📚</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>
            {t("noMangaYet")}
          </Text>
          <Text style={[styles.emptySubtitle, { color: c.textSecondary }]}>
            {t("noMangaHint")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={titles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => (
            <MangaCard
              manga={item}
              onPress={handlePress}
              onLongPress={handleLongPress}
            />
          )}
        />
      )}

      {/* Rename Modal */}
      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: c.surface }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>
              {t("renameManga")}
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  color: c.text,
                  borderColor: c.border,
                  backgroundColor: c.inputBackground,
                },
              ]}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={confirmRename}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setRenameTarget(null)}>
                <Text style={[styles.modalCancel, { color: c.textSecondary }]}>
                  {t("cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmRename}>
                <Text style={styles.modalConfirm}>{t("rename")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: "600", textAlign: "center" },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalBox: { width: 300, borderRadius: 12, padding: 20, gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: "600" },
  modalInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 16 },
  modalCancel: { fontSize: 15 },
  modalConfirm: { fontSize: 15, color: "#3b82f6", fontWeight: "600" },
});

export default withErrorBoundary(MangaScreen);
