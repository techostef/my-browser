import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
  Dimensions,
  Alert,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  ScrollView,
} from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
  Extrapolation,
  runOnJS,
} from "react-native-reanimated";
import { BrowserTab } from "../types";

const CARD_GAP = 12;
const SWIPE_THRESHOLD = 0.35; // fraction of card width
const OUT_X = 500; // px to slide off screen
const CARD_COLS = 2;
const SCREEN_WIDTH = Dimensions.get("window").width;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_GAP * (CARD_COLS + 1)) / CARD_COLS;
const CARD_HEIGHT = CARD_WIDTH * 1.35;

interface CardProps {
  tab: BrowserTab;
  isActive: boolean;
  isIncognito: boolean;
  canClose: boolean;
  onSwitch: () => void;
  onRemove: () => void;
}

function SwipeableTabCard({ tab, isActive, isIncognito, canClose, onSwitch, onRemove }: CardProps) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);

  const displayUrl = tab.url.replace(/^https?:\/\//, "").split("/")[0];

  const canCloseShared = useSharedValue(canClose);
  canCloseShared.value = canClose;

  const panGesture = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onUpdate((e) => {
      translateX.value = e.translationX;
      opacity.value = interpolate(
        Math.abs(e.translationX),
        [0, CARD_WIDTH * SWIPE_THRESHOLD],
        [1, 0.3],
        Extrapolation.CLAMP,
      );
    })
    .onEnd((e) => {
      const shouldDismiss =
        canCloseShared.value && (
          Math.abs(e.translationX) > CARD_WIDTH * SWIPE_THRESHOLD ||
          Math.abs(e.velocityX) > 500
        );
      if (shouldDismiss) {
        const dir = e.translationX >= 0 ? 1 : -1;
        translateX.value = withTiming(dir * OUT_X, { duration: 220 }, (finished) => {
          if (finished) runOnJS(onRemove)();
        });
        opacity.value = withTiming(0, { duration: 180 });
      } else {
        translateX.value = withSpring(0);
        opacity.value = withSpring(1);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[
          styles.card,
          isIncognito && styles.cardIncognito,
          isActive && (isIncognito ? styles.cardActiveIncognito : styles.cardActive),
          animatedStyle,
        ]}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onSwitch} activeOpacity={0.85}>
          <View style={[
            styles.cardBar,
            isIncognito && styles.cardBarIncognito,
            isActive && (isIncognito ? styles.cardBarActiveIncognito : styles.cardBarActive),
          ]}>
            <Text style={[
              styles.cardUrl,
              isIncognito && styles.cardUrlIncognito,
              isActive && styles.cardUrlActive,
            ]} numberOfLines={1}>
              {isIncognito && <Text>🕵️ </Text>}{displayUrl || "New Tab"}
            </Text>
            {canClose && (
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onRemove}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardTitle, isIncognito && styles.cardTitleIncognito]} numberOfLines={3}>
              {tab.title || "New Tab"}
            </Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </GestureDetector>
  );
}

interface Props {
  tabs: BrowserTab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onAddTab: () => void;
  onAddIncognitoTab: () => void;
  onRemoveTab: (id: string) => void;
  onCloseAllTabs: (ids: string[]) => void;
  visible: boolean;
  onClose: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onAddTab,
  onAddIncognitoTab,
  onRemoveTab,
  onCloseAllTabs,
  visible,
  onClose,
}: Props) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  // Default segment to whichever mode the active tab is in
  const [segment, setSegment] = useState<"normal" | "incognito">(
    activeTab?.incognito ? "incognito" : "normal"
  );

  const isIncognito = segment === "incognito";
  const visibleTabs = tabs.filter((t) => !t.hidden && !!t.incognito === isIncognito);
  const normalCount = tabs.filter((t) => !t.hidden && !t.incognito).length;
  const incognitoCount = tabs.filter((t) => !t.hidden && t.incognito).length;

  const handleSwitchTab = (id: string) => {
    onSwitchTab(id);
    onClose();
  };

  const handleAddTab = () => {
    if (isIncognito) onAddIncognitoTab();
    else onAddTab();
    onClose();
  };

  const handleCloseAll = () => {
    if (visibleTabs.length === 0) return;
    const label = isIncognito ? "incognito tabs" : "tabs";
    Alert.alert(
      `Close all ${label}?`,
      `This will close all ${visibleTabs.length} ${label}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close All",
          style: "destructive",
          onPress: () => {
            onCloseAllTabs(visibleTabs.map(t => t.id));
            onClose();
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.root, isIncognito && styles.rootIncognito]}>
        {/* Header */}
        <View style={[styles.header, isIncognito && styles.headerIncognito]}>
          <TouchableOpacity
            style={styles.closeAllBtn}
            onPress={handleCloseAll}
            disabled={visibleTabs.length === 0}>
            <Text style={[styles.closeAllText, visibleTabs.length === 0 && styles.closeAllTextDisabled]}>
              Close All
            </Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, isIncognito && styles.headerTitleIncognito]}>
            {visibleTabs.length} {isIncognito ? "incognito" : ""} tab{visibleTabs.length !== 1 ? "s" : ""}
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Segment control */}
        <View style={[styles.segmentRow, isIncognito && styles.segmentRowIncognito]}>
          <TouchableOpacity
            style={[styles.segmentBtn, !isIncognito && styles.segmentBtnActive]}
            onPress={() => setSegment("normal")}>
            <Text style={[styles.segmentText, !isIncognito && styles.segmentTextActive]}>
              Tabs{normalCount > 0 ? ` (${normalCount})` : ""}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, isIncognito && styles.segmentBtnActiveIncognito]}
            onPress={() => setSegment("incognito")}>
            <Text style={[styles.segmentText, styles.segmentTextIncog, isIncognito && styles.segmentTextActive]}>
              🕵️ Incognito{incognitoCount > 0 ? ` (${incognitoCount})` : ""}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Incognito info banner */}
        {isIncognito && (
          <View style={styles.incognitoBanner}>
            <Text style={styles.incognitoBannerTitle}>You're incognito</Text>
            <Text style={styles.incognitoBannerBody}>
              Pages won't appear in history, cookies and site data are cleared when you close these tabs.
            </Text>
          </View>
        )}

        {/* Grid */}
        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}>
          {visibleTabs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, isIncognito && styles.emptyTextIncognito]}>
                {isIncognito ? "No incognito tabs open" : "No tabs open"}
              </Text>
            </View>
          ) : (
            visibleTabs.map((tab) => (
              <SwipeableTabCard
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                isIncognito={isIncognito}
                canClose={visibleTabs.length > 1}
                onSwitch={() => handleSwitchTab(tab.id)}
                onRemove={() => onRemoveTab(tab.id)}
              />
            ))
          )}
        </ScrollView>

        {/* New tab button */}
        <TouchableOpacity
          style={[styles.newTabBtn, isIncognito && styles.newTabBtnIncognito]}
          onPress={handleAddTab}>
          <Text style={[styles.newTabBtnText, isIncognito && styles.newTabBtnTextIncognito]}>
            {isIncognito ? "🕵️  New Incognito Tab" : "+ New Tab"}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ─── Trigger button ───────────────────────────────────────────────────────────

interface TriggerProps {
  count: number;
  isIncognito: boolean;
  onPress: () => void;
}

export function TabCountTrigger({ count, isIncognito, onPress }: TriggerProps) {
  return (
    <TouchableOpacity
      style={[trigger.btn, isIncognito && trigger.btnIncognito]}
      onPress={onPress}
      activeOpacity={0.7}>
      {isIncognito ? (
        <Text style={trigger.icon}>🕵️</Text>
      ) : (
        <Text style={[trigger.text, isIncognito && trigger.textIncognito]}>
          {count > 99 ? "99+" : count}
        </Text>
      )}
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
  btnIncognito: {
    borderColor: "#A78BFA",
    backgroundColor: "#2D2040",
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
    color: "#333",
  },
  textIncognito: {
    color: "#E9D5FF",
  },
  icon: {
    fontSize: 14,
  },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F2F2F7" },
  rootIncognito: { backgroundColor: "#1A1025" },

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
  headerIncognito: {
    backgroundColor: "#1A1025",
    borderBottomColor: "#3D2D5C",
  },
  headerTitle: { fontSize: 17, fontWeight: "600", color: "#1C1C1E" },
  headerTitleIncognito: { color: "#E9D5FF" },

  doneBtn: { paddingHorizontal: 4 },
  doneBtnText: { fontSize: 17, fontWeight: "600", color: "#4ECDC4" },
  closeAllBtn: { paddingHorizontal: 4 },
  closeAllText: { fontSize: 17, fontWeight: "600", color: "#FF3B30" },
  closeAllTextDisabled: { opacity: 0.3 },

  segmentRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginVertical: 10,
    backgroundColor: "#E0E0E5",
    borderRadius: 10,
    padding: 3,
  },
  segmentRowIncognito: {
    backgroundColor: "#2D2040",
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
  },
  segmentBtnActive: {
    backgroundColor: "#FFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentBtnActiveIncognito: {
    backgroundColor: "#4C3575",
  },
  segmentText: { fontSize: 13, fontWeight: "600", color: "#8E8E93" },
  segmentTextIncog: { color: "#8E8E93" },
  segmentTextActive: { color: "#1C1C1E" },

  incognitoBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: "#2D2040",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#4C3575",
  },
  incognitoBannerTitle: { fontSize: 13, fontWeight: "700", color: "#C4B5FD", marginBottom: 4 },
  incognitoBannerBody: { fontSize: 12, color: "#9D8EC4", lineHeight: 17 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: CARD_GAP,
    gap: CARD_GAP,
  },
  emptyWrap: { width: "100%", alignItems: "center", paddingTop: 40 },
  emptyText: { fontSize: 15, color: "#8E8E93" },
  emptyTextIncognito: { color: "#6B5A8A" },

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
  cardIncognito: { backgroundColor: "#2D2040" },
  cardActive: { borderColor: "#4ECDC4" },
  cardActiveIncognito: { borderColor: "#A78BFA" },

  cardBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#E8E8E8",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DDD",
  },
  cardBarIncognito: { backgroundColor: "#3D2D5C", borderBottomColor: "#4C3575" },
  cardBarActive: { backgroundColor: "#D6F5F3", borderBottomColor: "#B2E8E5" },
  cardBarActiveIncognito: { backgroundColor: "#4C3575", borderBottomColor: "#6D4E9E" },

  cardUrl: { flex: 1, fontSize: 11, color: "#666" },
  cardUrlIncognito: { color: "#C4B5FD" },
  cardUrlActive: { color: "#2A9D96", fontWeight: "600" },

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
  cardBody: { flex: 1, padding: 10 },
  cardTitle: { fontSize: 13, color: "#1C1C1E", lineHeight: 18 },
  cardTitleIncognito: { color: "#D8B4FE" },

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
  newTabBtnIncognito: { backgroundColor: "#2D2040", borderWidth: 1, borderColor: "#4C3575" },
  newTabBtnText: { fontSize: 16, fontWeight: "600", color: "#4ECDC4" },
  newTabBtnTextIncognito: { color: "#C4B5FD" },
});
