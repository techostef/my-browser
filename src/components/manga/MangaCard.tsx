import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "../../i18n";
import { useSettings } from "../../store/settingsStore";
import { MangaTitle } from "../../types/manga";

interface Props {
  manga: MangaTitle;
  onPress: () => void;
  onLongPress: () => void;
}

export default function MangaCard({ manga, onPress, onLongPress }: Props) {
  const { themeColors: c } = useSettings();
  const { t } = useTranslation();

  const completed = manga.chapters.filter(
    (ch) => ch.status === "completed",
  ).length;
  const total = manga.chapters.length;
  const downloading = manga.chapters.find((ch) => ch.status === "downloading");
  const progress = total > 0 ? completed / total : 0;

  const lastRead = manga.chapters
    .filter((ch) => ch.lastReadAt)
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];

  const lastReadDate = lastRead?.lastReadAt
    ? new Date(lastRead.lastReadAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      {manga.coverImagePath ? (
        <Image
          source={{ uri: manga.coverImagePath }}
          style={styles.cover}
          resizeMode="cover"
        />
      ) : (
        <View
          style={[
            styles.cover,
            styles.coverPlaceholder,
            { backgroundColor: c.surfaceSecondary },
          ]}
        >
          <Text style={styles.coverEmoji}>📖</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {manga.title}
        </Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          {t("chaptersOfTotal", {
            completed: String(completed),
            total: String(total),
          })}
        </Text>
        <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${progress * 100}%`,
                backgroundColor: progress === 1 ? "#34d399" : "#3b82f6",
              },
            ]}
          />
        </View>
        {downloading ? (
          <Text style={styles.downloadingText}>
            {t("downloadingChapter", { n: String(downloading.chapterNumber) })}
          </Text>
        ) : lastRead && lastReadDate ? (
          <Text style={[styles.lastReadText, { color: c.textSecondary }]}>
            {t("lastReadChapter", {
              n: String(lastRead.chapterNumber),
              date: lastReadDate,
            })}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.chevron, { color: c.textSecondary }]}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
    marginVertical: 5,
    padding: 10,
    gap: 10,
  },
  cover: { width: 52, height: 72, borderRadius: 4 },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverEmoji: { fontSize: 24 },
  info: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: "600" },
  subtitle: { fontSize: 12 },
  progressTrack: { height: 4, borderRadius: 2, marginTop: 4 },
  progressFill: { height: 4, borderRadius: 2 },
  downloadingText: { fontSize: 11, color: "#60a5fa", marginTop: 2 },
  lastReadText: { fontSize: 11, marginTop: 2 },
  chevron: { fontSize: 20, marginLeft: 4 },
});
