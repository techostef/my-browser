import React, { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { useTranslation } from "../../i18n";
import type { Segment } from "../../types/videoEditor";
import { formatTime } from "../../utils/videoEditor/srt";

type Props = {
  segment: Segment;
  onUpdate: (id: number, text: string) => void;
};

export default function SubtitleItem({ segment, onUpdate }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(segment.text);

  const handleBlur = () => {
    setEditing(false);
    onUpdate(segment.id, text);
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setEditing(true)}
      activeOpacity={0.8}
    >
      <Text style={styles.timestamp}>
        {formatTime(segment.start)} → {formatTime(segment.end)}
      </Text>
      {editing ? (
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onBlur={handleBlur}
          multiline
          autoFocus
        />
      ) : (
        <Text style={styles.text}>
          {text || <Text style={styles.empty}>{t("subtitleEmpty")}</Text>}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
    marginBottom: 6,
    fontFamily: "monospace",
  },
  text: { fontSize: 15, color: "#333", lineHeight: 22 },
  input: {
    fontSize: 15,
    color: "#333",
    lineHeight: 22,
    borderBottomWidth: 2,
    borderBottomColor: "#6c63ff",
    paddingBottom: 4,
  },
  empty: { color: "#ccc", fontStyle: "italic" },
});
