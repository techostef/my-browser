import { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import {
  AdEventType,
  RewardedAdEventType,
  RewardedInterstitialAd,
} from "react-native-google-mobile-ads";
import { REWARDED_INTERSTITIAL_AD_UNIT_ID } from "../../config/admob";
import { useTranslation } from "../../i18n";

type Props = {
  onEdit: () => void;
};

/**
 * "Edit" affordance for a downloaded video, gated behind a rewarded ad.
 *
 * Lives outside the player so the player component stays free of AdMob.
 * If the ad fails to load or errors, editing proceeds anyway — a broken ad
 * should never lock the user out of the feature.
 */
export default function EditVideoButton({ onEdit }: Props) {
  const { t } = useTranslation();

  const handlePress = useCallback(() => {
    const ad = RewardedInterstitialAd.createForAdRequest(REWARDED_INTERSTITIAL_AD_UNIT_ID);
    const unsubs: Array<() => void> = [];
    let rewardEarned = false;
    const cleanup = () => {
      unsubs.forEach((fn) => {
        fn();
      });
      unsubs.length = 0;
    };

    unsubs.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show()));
    unsubs.push(
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        rewardEarned = true;
      }),
    );
    unsubs.push(
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        cleanup();
        if (rewardEarned) onEdit();
      }),
    );
    unsubs.push(
      ad.addAdEventListener(AdEventType.ERROR, () => {
        cleanup();
        onEdit();
      }),
    );

    ad.load();
  }, [onEdit]);

  return (
    <TouchableOpacity style={styles.btn} onPress={handlePress}>
      <Text style={styles.text}>✂️ {t("edit")}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Shaped to match the ↓ Save button in VideoControls' top bar, so the two
  // read as the same kind of action when they sit in the same slot.
  btn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(108,99,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(108,99,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#A9A2FF", fontSize: 13, fontWeight: "700" },
});
