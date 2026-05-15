import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import mobileAds from 'react-native-google-mobile-ads';

const AD_TRIGGER_FREQUENCY = 4;

interface AdState {
  downloadCount: number;
  pendingInterstitial: boolean;
}

interface AdActions {
  incrementDownload: () => void;
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

  useEffect(() => {
    mobileAds()
      .setRequestConfiguration({ testDeviceIdentifiers: ['EMULATOR'] })
      .then(() => mobileAds().initialize())
      .catch(err => {
        console.warn('MobileAds init failed:', err);
      });
  }, []);

  const incrementDownload = useCallback(() => dispatch({ type: 'INCREMENT_DOWNLOAD' }), []);
  const markAdCompleted = useCallback(() => dispatch({ type: 'MARK_AD_COMPLETED' }), []);

  const actions = useMemo<AdActions>(
    () => ({ incrementDownload, markAdCompleted }),
    [incrementDownload, markAdCompleted],
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
