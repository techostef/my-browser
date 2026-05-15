import React, { useState } from 'react';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { BANNER_AD_UNIT_ID } from '../config/admob';

const MAX_RETRIES = 2;

export function AdBanner() {
  const [retries, setRetries] = useState(0);

  if (retries > MAX_RETRIES) return null;

  return (
    <BannerAd
      key={retries}
      unitId={BANNER_AD_UNIT_ID}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      onAdFailedToLoad={(error) => {
        console.warn('[AdBanner] failed to load (attempt', retries + 1, '):', error.message, '| code:', (error as any).code);
        setRetries(r => r + 1);
      }}
    />
  );
}
