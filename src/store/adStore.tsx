import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import mobileAds from 'react-native-google-mobile-ads';

const AD_TRIGGER_FREQUENCY = 3;

interface AdState {
  downloadCount: number;
  pendingInterstitial: boolean;
}

interface AdActions {
  // Call this instead of startDownload directly. On every 3rd press the ad
  // shows first and startFn runs after the ad is dismissed/rewarded.
  // On other presses startFn runs immediately.
  requestDownload: (startFn: () => void) => void;
  markAdCompleted: () => void;
}

type AdAction =
  | { type: 'INCREMENT_DOWNLOAD' }
  | { type: 'MARK_AD_COMPLETED' };

function adReducer(state: AdState, action: AdAction): AdState {
  switch (action.type) {
    case 'INCREMENT_DOWNLOAD': {
      const newCount = state.downloadCount + 1;
      return {
        downloadCount: newCount,
        pendingInterstitial: newCount % AD_TRIGGER_FREQUENCY === 0 ? true : state.pendingInterstitial,
      };
    }
    case 'MARK_AD_COMPLETED':
      return { ...state, pendingInterstitial: false };
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
      .setRequestConfiguration({ testDeviceIdentifiers: ['EMULATOR'] })
      .then(() => mobileAds().initialize())
      .catch(err => {
        console.warn('MobileAds init failed:', err);
      });
  }, []);

  const markAdCompleted = useCallback(() => {
    dispatch({ type: 'MARK_AD_COMPLETED' });
    const pending = pendingDownloadRef.current;
    pendingDownloadRef.current = null;
    if (pending) { pending(); }
  }, []);

  const requestDownload = useCallback((startFn: () => void) => {
    countRef.current += 1;
    const triggersAd = countRef.current % AD_TRIGGER_FREQUENCY === 0;
    dispatch({ type: 'INCREMENT_DOWNLOAD' });
    if (triggersAd) {
      // Ad will show via AdController; download starts after markAdCompleted fires.
      pendingDownloadRef.current = startFn;
    } else {
      startFn();
    }
  }, []);

  const actions = useMemo<AdActions>(
    () => ({ requestDownload, markAdCompleted }),
    [requestDownload, markAdCompleted],
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
  if (!ctx) throw new Error('useAdState must be used within AdProvider');
  return ctx;
}

export function useAdActions(): AdActions {
  const ctx = useContext(AdActionsContext);
  if (!ctx) throw new Error('useAdActions must be used within AdProvider');
  return ctx;
}
