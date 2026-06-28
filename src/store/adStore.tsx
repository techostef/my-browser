import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import mobileAds from "react-native-google-mobile-ads";

const AD_TRIGGER_FREQUENCY = 3;

interface AdState {
  downloadCount: number;
  pendingInterstitial: boolean;
}

interface AdActions {
  // Call this instead of startDownload directly. On every 3rd press the ad
  // shows first and startFn runs only after the reward is earned.
  // On other presses startFn runs immediately.
  requestDownload: (startFn: () => void) => void;
  markAdCompleted: () => void;
  // Discard the pending download when the user skips the ad without earning
  // the reward. Re-arms the trigger so the next request re-shows the ad.
  cancelPendingDownload: () => void;
}

type AdAction =
  | { type: "INCREMENT_DOWNLOAD" }
  | { type: "MARK_AD_COMPLETED" }
  | { type: "CANCEL_PENDING_DOWNLOAD" };

function adReducer(state: AdState, action: AdAction): AdState {
  switch (action.type) {
    case "INCREMENT_DOWNLOAD": {
      const newCount = state.downloadCount + 1;
      return {
        downloadCount: newCount,
        pendingInterstitial:
          newCount % AD_TRIGGER_FREQUENCY === 0
            ? true
            : state.pendingInterstitial,
      };
    }
    case "MARK_AD_COMPLETED":
      return { ...state, pendingInterstitial: false };
    case "CANCEL_PENDING_DOWNLOAD":
      return {
        downloadCount: Math.max(0, state.downloadCount - 1),
        pendingInterstitial: false,
      };
    default:
      return state;
  }
}

const initialState: AdState = { downloadCount: 0, pendingInterstitial: false };

const AdStateContext = createContext<AdState | null>(null);
const AdActionsContext = createContext<AdActions | null>(null);

export function AdProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(adReducer, initialState);
  // Tracks count synchronously so requestDownload can decide before the
  // async dispatch settles whether this press will trigger an ad.
  const countRef = useRef(0);
  const pendingDownloadRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mobileAds()
      .setRequestConfiguration({ testDeviceIdentifiers: ["EMULATOR"] })
      .then(() => mobileAds().initialize())
      .catch((err) => {
        console.warn("MobileAds init failed:", err);
      });
  }, []);

  const markAdCompleted = useCallback(() => {
    dispatch({ type: "MARK_AD_COMPLETED" });
    const pending = pendingDownloadRef.current;
    pendingDownloadRef.current = null;
    if (pending) {
      pending();
    }
  }, []);

  const cancelPendingDownload = useCallback(() => {
    pendingDownloadRef.current = null;
    // Roll back the synchronous counter so the next requestDownload lands on
    // the trigger again and re-shows the ad. Kept in sync with the reducer's
    // downloadCount via CANCEL_PENDING_DOWNLOAD.
    countRef.current = Math.max(0, countRef.current - 1);
    dispatch({ type: "CANCEL_PENDING_DOWNLOAD" });
  }, []);

  const requestDownload = useCallback((startFn: () => void) => {
    countRef.current += 1;
    const triggersAd = countRef.current % AD_TRIGGER_FREQUENCY === 0;
    dispatch({ type: "INCREMENT_DOWNLOAD" });
    if (triggersAd) {
      // Ad will show via AdController; download starts after markAdCompleted fires.
      pendingDownloadRef.current = startFn;
    } else {
      startFn();
    }
  }, []);

  const actions = useMemo<AdActions>(
    () => ({ requestDownload, markAdCompleted, cancelPendingDownload }),
    [requestDownload, markAdCompleted, cancelPendingDownload],
  );

  return (
    <AdActionsContext.Provider value={actions}>
      <AdStateContext.Provider value={state}>
        {children}
      </AdStateContext.Provider>
    </AdActionsContext.Provider>
  );
}

export function useAdState(): AdState {
  const ctx = useContext(AdStateContext);
  if (!ctx) throw new Error("useAdState must be used within AdProvider");
  return ctx;
}

export function useAdActions(): AdActions {
  const ctx = useContext(AdActionsContext);
  if (!ctx) throw new Error("useAdActions must be used within AdProvider");
  return ctx;
}
