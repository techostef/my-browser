import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useTranslation } from "../i18n";

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
  const { t } = useTranslation();
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
              {isIncognito && <Text>🕵️ </Text>}{displayUrl || t('newTabLabel')}
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
              {tab.title || t('newTabLabel')}
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
  const { t } = useTranslation();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  // Default segment to whichever mode the active tab is in
  const [segment, setSegment] = useState<"normal" | "incognito">(
    activeTab?.incognito ? "incognito" : "normal"
  );

  // ── Undo close state ─────────────────────────────────────────────────────
  const [pendingClose, setPendingClose] = useState<{ id: string; title: string } | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressWidth = useSharedValue(1);

  const commitClose = useCallback((id: string) => {
    onRemoveTab(id);
    setPendingClose(null);
  }, [onRemoveTab]);

  const handleRequestClose = useCallback((id: string) => {
    const tab = tabs.find((t) => t.id === id);
    const title = tab?.title || tab?.url?.replace(/^https?:\/\//, "").split("/")[0] || t('newTabLabel');
    // If there's already a pending close, commit it immediately
    if (pendingClose && pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      onRemoveTab(pendingClose.id);
    }
    setPendingClose({ id, title });
    progressWidth.value = 1;
    progressWidth.value = withTiming(0, { duration: 3000 });
    pendingTimerRef.current = setTimeout(() => {
      commitClose(id);
    }, 3000);
  }, [tabs, pendingClose, commitClose, onRemoveTab]);

  const handleUndo = useCallback(() => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    progressWidth.value = 1;
    setPendingClose(null);
  }, []);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value * 100}%`,
  }));

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, []);

  // When modal closes, commit any pending close immediately
  useEffect(() => {
    if (!visible && pendingClose) {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      onRemoveTab(pendingClose.id);
      setPendingClose(null);
    }
  }, [visible]);

  const isIncognito = segment === "incognito";
  const allVisibleTabs = tabs.filter((t) => !t.hidden && !!t.incognito === isIncognito);
  // Hide the pending-close tab from the grid
  const visibleTabs = pendingClose
    ? allVisibleTabs.filter((t) => t.id !== pendingClose.id)
    : allVisibleTabs;
  const normalCount = tabs.filter((t) => !t.hidden && !t.incognito && t.id !== pendingClose?.id).length;
  const incognitoCount = tabs.filter((t) => !t.hidden && t.incognito && t.id !== pendingClose?.id).length;

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
    const title = isIncognito ? t('closeAllIncognitoTitle') : t('closeAllNormalTitle');
    const body = isIncognito
      ? t('closeAllIncognitoBody', { count: String(visibleTabs.length) })
      : t('closeAllNormalBody', { count: String(visibleTabs.length) });
    Alert.alert(
      title,
      body,
      [
        { text: t('cancel'), style: "cancel" },
        {
          text: t('closeAll'),
          style: "destructive",
          onPress: () => {
            onCloseAllTabs(visibleTabs.map((tab) => tab.id));
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
              {t('closeAll')}
            </Text>
          </TouchableOpacity>
       
          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>{t('done')}</Text>
          </TouchableOpacity>
        </View>

        {/* Segment control */}
        <View style={[styles.segmentRow, isIncognito && styles.segmentRowIncognito]}>
          <TouchableOpacity
            style={[styles.segmentBtn, !isIncognito && styles.segmentBtnActive]}
            onPress={() => setSegment("normal")}>
            <Text style={[styles.segmentText, !isIncognito && styles.segmentTextActive]}>
              {t('tabsSegment')}{normalCount > 0 ? ` (${normalCount})` : ""}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, isIncognito && styles.segmentBtnActiveIncognito]}
            onPress={() => setSegment("incognito")}>
            <Text style={[styles.segmentText, styles.segmentTextIncog, isIncognito && styles.segmentTextActive]}>
              {t('incognitoSegment')}{incognitoCount > 0 ? ` (${incognitoCount})` : ""}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Incognito info banner */}
        {isIncognito && (
          <View style={styles.incognitoBanner}>
            <Text style={styles.incognitoBannerTitle}>{t('youreIncognito')}</Text>
            <Text style={styles.incognitoBannerBody}>{t('incognitoDescription')}</Text>
          </View>
        )}

        {/* Grid */}
        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}>
          {visibleTabs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, isIncognito && styles.emptyTextIncognito]}>
                {isIncognito ? t('noIncognitoTabs') : t('noTabsOpen')}
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
                onRemove={() => handleRequestClose(tab.id)}
              />
            ))
          )}
        </ScrollView>

        {/* Undo close toast */}
        {pendingClose && (
          <View style={[styles.undoToast, isIncognito && styles.undoToastIncognito]}>
            <View style={styles.undoToastContent}>
              <Text style={[styles.undoToastText, isIncognito && styles.undoToastTextIncognito]} numberOfLines={1}>
                {t('closedTabToast', { title: pendingClose.title })}
              </Text>
              <TouchableOpacity style={styles.undoBtn} onPress={handleUndo}>
                <Text style={styles.undoBtnText}>{t('undo')}</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.progressTrack, isIncognito && styles.progressTrackIncognito]}>
              <Animated.View style={[styles.progressBar, isIncognito && styles.progressBarIncognito, progressStyle]} />
            </View>
          </View>
        )}

        {/* New tab button */}
        <TouchableOpacity
          style={[styles.newTabBtn, isIncognito && styles.newTabBtnIncognito]}
          onPress={handleAddTab}>
          <Text style={[styles.newTabBtnText, isIncognito && styles.newTabBtnTextIncognito]}>
            {isIncognito ? t('newIncognitoTabBtn') : t('newTabBtn')}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

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

  undoToast: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: "#333",
    overflow: "hidden",
  },
  undoToastContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  progressTrack: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  progressTrackIncognito: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  progressBar: {
    height: 3,
    backgroundColor: "#4ECDC4",
  },
  progressBarIncognito: {
    backgroundColor: "#A78BFA",
  },
  undoToastIncognito: {
    backgroundColor: "#4C3575",
  },
  undoToastText: {
    flex: 1,
    fontSize: 14,
    color: "#FFF",
  },
  undoToastTextIncognito: {
    color: "#E9D5FF",
  },
  undoBtn: {
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#4ECDC4",
  },
  undoBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFF",
  },
});
