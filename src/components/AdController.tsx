import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  RewardedInterstitialAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { useAdState, useAdActions } from '../store/adStore';
import { REWARDED_INTERSTITIAL_AD_UNIT_ID } from '../config/admob';

export function AdController() {
  const { pendingInterstitial } = useAdState();
  const { markAdCompleted } = useAdActions();

  // Refs so callbacks never capture stale values
  const pendingRef = useRef(pendingInterstitial);
  pendingRef.current = pendingInterstitial;
  const markAdCompletedRef = useRef(markAdCompleted);
  markAdCompletedRef.current = markAdCompleted;

  const isLoadingRef = useRef(false);
  const rewardEarnedRef = useRef(false);
  const retryCountRef = useRef(0);
  const dismissCountRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAndShow = useCallback(() => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    rewardEarnedRef.current = false;

    const ad = RewardedInterstitialAd.createForAdRequest(REWARDED_INTERSTITIAL_AD_UNIT_ID);
    const unsubs: Array<() => void> = [];

    const cleanup = () => {
      unsubs.forEach(fn => fn());
      unsubs.length = 0;
      isLoadingRef.current = false;
    };

    unsubs.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        ad.show();
      }),
    );

    unsubs.push(
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        rewardEarnedRef.current = true;
        markAdCompletedRef.current();
      }),
    );

    unsubs.push(
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        cleanup();
        if (!rewardEarnedRef.current && pendingRef.current) {
          if (dismissCountRef.current < 2) {
            dismissCountRef.current++;
            pendingTimerRef.current = setTimeout(loadAndShow, 500);
          } else {
            dismissCountRef.current = 0;
            markAdCompletedRef.current();
          }
        }
      }),
    );

    unsubs.push(
      ad.addAdEventListener(AdEventType.ERROR, () => {
        cleanup();
        if (retryCountRef.current < 1) {
          retryCountRef.current++;
          pendingTimerRef.current = setTimeout(() => {
            if (pendingRef.current) loadAndShow();
          }, 3000);
        } else {
          retryCountRef.current = 0;
          markAdCompletedRef.current();
        }
      }),
    );

    ad.load();
  }, []); // stable — all mutable state accessed via refs

  // Fire when pendingInterstitial becomes true
  useEffect(() => {
    if (pendingInterstitial) {
      retryCountRef.current = 0;
      dismissCountRef.current = 0;
      loadAndShow();
    }
  }, [pendingInterstitial, loadAndShow]);

  // Re-show if app returns to foreground while ad is still pending
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && pendingRef.current) {
        loadAndShow();
      }
    });
    return () => sub.remove();
  }, [loadAndShow]);

  // Cancel any pending retry timers on unmount to prevent phantom ad activity
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
      }
    };
  }, []);

  return null;
}
