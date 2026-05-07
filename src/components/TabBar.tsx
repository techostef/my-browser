import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  SafeAreaView,
  Dimensions,
} from "react-native";
import { BrowserTab } from "../types";

const CARD_GAP = 12;
const CARD_COLS = 2;
const SCREEN_WIDTH = Dimensions.get("window").width;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_GAP * (CARD_COLS + 1)) / CARD_COLS;
const CARD_HEIGHT = CARD_WIDTH * 1.35;

interface Props {
  tabs: BrowserTab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onAddTab: () => void;
  onRemoveTab: (id: string) => void;
  visible: boolean;
  onClose: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onAddTab,
  onRemoveTab,
  visible,
  onClose,
}: Props) {
  const visibleTabs = tabs.filter((t) => !t.hidden);

  const handleSwitchTab = (id: string) => {
    onSwitchTab(id);
    onClose();
  };

  const handleAddTab = () => {
    onAddTab();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{visibleTabs.length} tab{visibleTabs.length !== 1 ? "s" : ""}</Text>
          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Grid */}
        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}>
          {visibleTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const displayUrl = tab.url.replace(/^https?:\/\//, "").split("/")[0];
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.card, isActive && styles.cardActive]}
                onPress={() => handleSwitchTab(tab.id)}
                activeOpacity={0.85}>
                {/* Card top bar */}
                <View style={[styles.cardBar, isActive && styles.cardBarActive]}>
                  <Text style={[styles.cardUrl, isActive && styles.cardUrlActive]} numberOfLines={1}>
                    {displayUrl || "New Tab"}
                  </Text>
                  {visibleTabs.length > 1 && (
                    <TouchableOpacity
                      style={styles.closeBtn}
                      onPress={(e) => { e.stopPropagation?.(); onRemoveTab(tab.id); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.closeBtnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {/* Card body — title */}
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={3}>
                    {tab.title || "New Tab"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* New tab button */}
        <TouchableOpacity style={styles.newTabBtn} onPress={handleAddTab}>
          <Text style={styles.newTabBtnText}>+ New tab</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
  );
}

// Trigger button — rendered in the address bar to open the switcher
interface TriggerProps {
  count: number;
  onPress: () => void;
}

export function TabCountTrigger({ count, onPress }: TriggerProps) {
  return (
    <TouchableOpacity style={trigger.btn} onPress={onPress} activeOpacity={0.7}>
      <Text style={trigger.text}>{count > 99 ? "99+" : count}</Text>
    </TouchableOpacity>
  );
}

const trigger = StyleSheet.create({
  btn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#555",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 2,
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
    color: "#333",
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#F2F2F7",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#C8C8CC",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  doneBtn: {
    paddingHorizontal: 4,
  },
  doneBtnText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#4ECDC4",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: CARD_GAP,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 12,
    backgroundColor: "#FFF",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardActive: {
    borderColor: "#4ECDC4",
  },
  cardBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#E8E8E8",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DDD",
  },
  cardBarActive: {
    backgroundColor: "#D6F5F3",
    borderBottomColor: "#B2E8E5",
  },
  cardUrl: {
    flex: 1,
    fontSize: 11,
    color: "#666",
  },
  cardUrlActive: {
    color: "#2A9D96",
    fontWeight: "600",
  },
  closeBtn: {
    marginLeft: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#555",
    lineHeight: 18,
    textAlign: "center",
  },
  cardBody: {
    flex: 1,
    padding: 10,
  },
  cardTitle: {
    fontSize: 13,
    color: "#1C1C1E",
    lineHeight: 18,
  },
  newTabBtn: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#FFF",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  newTabBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4ECDC4",
  },
});
