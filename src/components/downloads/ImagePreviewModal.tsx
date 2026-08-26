/** biome-ignore-all lint/correctness/useExhaustiveDependencies: effects intentionally re-run only on source change */
import { Image } from "expo-image";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  Dimensions,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "../../i18n";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

type Props = {
  uri: string | null;
  title?: string;
  onClose: () => void;
};

/**
 * Full-screen image viewer with pinch / pan / double-tap zoom.
 *
 * Split out of the old downloads PreviewModal so its zoom gestures no longer
 * share a component with the video player's seek gestures.
 */
export default function ImagePreviewModal({ uri, title, onClose }: Props) {
  const { t } = useTranslation();
  const [landscape, setLandscape] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const transX = useSharedValue(0);
  const transY = useSharedValue(0);
  const savedTransX = useSharedValue(0);
  const savedTransY = useSharedValue(0);

  const clamp = (tx: number, ty: number, s: number) => {
    "worklet";
    const maxX = ((s - 1) * SCREEN_WIDTH) / 2;
    const maxY = ((s - 1) * SCREEN_HEIGHT) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, tx)),
      y: Math.min(maxY, Math.max(-maxY, ty)),
    };
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        transX.value = withTiming(0);
        transY.value = withTiming(0);
        savedScale.value = 1;
        savedTransX.value = 0;
        savedTransY.value = 0;
      } else {
        savedScale.value = scale.value;
        const clamped = clamp(transX.value, transY.value, scale.value);
        transX.value = clamped.x;
        transY.value = clamped.y;
        savedTransX.value = clamped.x;
        savedTransY.value = clamped.y;
      }
    });

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      const clamped = clamp(
        savedTransX.value + e.translationX,
        savedTransY.value + e.translationY,
        scale.value,
      );
      transX.value = clamped.x;
      transY.value = clamped.y;
    })
    .onEnd(() => {
      savedTransX.value = transX.value;
      savedTransY.value = transY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        transX.value = withTiming(0);
        transY.value = withTiming(0);
        savedScale.value = 1;
        savedTransX.value = 0;
        savedTransY.value = 0;
      } else {
        const s = 2.5;
        const clamped = clamp(
          (SCREEN_WIDTH / 2 - e.x) * (s - 1),
          (SCREEN_HEIGHT / 2 - e.y) * (s - 1),
          s,
        );
        scale.value = withTiming(s);
        transX.value = withTiming(clamped.x);
        transY.value = withTiming(clamped.y);
        savedScale.value = s;
        savedTransX.value = clamped.x;
        savedTransY.value = clamped.y;
      }
    });

  const gesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture),
    [],
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: transX.value }, { translateY: transY.value }, { scale: scale.value }],
  }));

  // Reset zoom and orientation whenever a different image is opened.
  useEffect(() => {
    setLandscape(false);
    ScreenOrientation.unlockAsync();
    scale.value = 1;
    savedScale.value = 1;
    transX.value = 0;
    transY.value = 0;
    savedTransX.value = 0;
    savedTransY.value = 0;
  }, [uri]);

  useEffect(() => {
    if (!uri) return;
    if (landscape) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else {
      ScreenOrientation.unlockAsync();
    }
  }, [uri, landscape]);

  const handleClose = useCallback(() => {
    ScreenOrientation.unlockAsync();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!uri) return;
    const onBack = () => {
      if (landscape) {
        setLandscape(false);
        ScreenOrientation.unlockAsync();
        return true;
      }
      handleClose();
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [uri, landscape, handleClose]);

  if (!uri) return null;

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
      transparent={false}
    >
      <GestureHandlerRootView style={styles.root}>
        <StatusBar hidden />
        <GestureDetector gesture={gesture}>
          <Animated.View style={[StyleSheet.absoluteFill, animStyle]}>
            <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          </Animated.View>
        </GestureDetector>

        <SafeAreaView style={StyleSheet.absoluteFill} edges={["top"]} pointerEvents="box-none">
          <View style={styles.topBar} pointerEvents="box-none">
            <Text style={styles.titleText} numberOfLines={1}>
              {title || t("preview")}
            </Text>
            <TouchableOpacity
              style={[styles.iconBtn, styles.modeBtn]}
              onPress={() => setLandscape((l) => !l)}
              hitSlop={8}
            >
              <Text style={styles.modeBtnText}>
                {landscape ? `▯ ${t("portrait")}` : `▭ ${t("landscapeMode")}`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={handleClose} hitSlop={8}>
              <Text style={styles.iconBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  titleText: {
    flex: 1,
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  modeBtn: { width: undefined, paddingHorizontal: 12 },
  modeBtnText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
});
