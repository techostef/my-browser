# AdMob Integration Design

**Date:** 2026-05-13  
**Project:** OBrowser - Video Download  
**Status:** Approved

---

## Overview

Add Google AdMob monetization to the app with two ad formats:

1. **Banner ads** — fixed to the bottom of the Downloads, Projects, and Settings screens. Always visible.
2. **Rewarded Interstitial ads** — fires every 4 completed downloads per session. Full-screen, cannot be dismissed until the video ad ends. Re-shows if the user backgrounds the app before completion.

---

## Package

**`react-native-google-mobile-ads`**

- Supports `BannerAd` and `RewardedInterstitialAd`
- Works with bare Expo workflow (React Native 0.74.5 / Expo SDK 51)
- TypeScript support, actively maintained
- Requires native config in `android/build.gradle` and `AndroidManifest.xml`

---

## Ad Unit IDs

All IDs use Google's official test values. Each is marked with a `TODO` comment for the real ID swap before production release.

| Format | Constant | Test ID |
|---|---|---|
| App ID | `ADMOB_APP_ID` | `ca-app-pub-3940256099942544~3347511713` |
| Banner | `BANNER_AD_UNIT_ID` | `ca-app-pub-3940256099942544/6300978111` |
| Rewarded Interstitial | `REWARDED_INTERSTITIAL_AD_UNIT_ID` | `ca-app-pub-3940256099942544/5354046379` |

Defined in `src/config/admob.ts`.

---

## Architecture

### New Files

| File | Purpose |
|---|---|
| `src/config/admob.ts` | All ad unit ID constants with TODO swap comments |
| `src/components/AdBanner.tsx` | Reusable anchored banner component |
| `src/store/adStore.tsx` | Session download counter + pending interstitial flag + AdProvider |

### Modified Files

| File | Change |
|---|---|
| `app.json` | Add `react-native-google-mobile-ads` plugin entry with test App ID |
| `android/app/src/main/AndroidManifest.xml` | Add `<meta-data>` for AdMob App ID |
| `App.tsx` | Wrap with `AdProvider`; mount `AdController` inside navigator |
| `src/screens/DownloadsScreen.tsx` | Add `<AdBanner>` at bottom; call `incrementDownload()` on completion |
| `src/screens/ProjectsScreen.tsx` | Add `<AdBanner>` at bottom |
| `src/screens/SettingsScreen.tsx` | Add `<AdBanner>` at bottom |

---

## Banner Ads

### Component: `AdBanner`

- Wraps `BannerAd` from `react-native-google-mobile-ads`
- Size: `BannerAdSize.ANCHORED_ADAPTIVE_BANNER` (auto-sizes to screen width)
- On load error: renders nothing (no error UI shown to user)
- Receives no props — reads unit ID from `src/config/admob.ts`

### Screen Layout

Each affected screen wraps its existing content in a `flex: 1` container with `<AdBanner />` below it, outside the scroll area:

```
┌─────────────────────────┐
│                         │
│   Screen content        │
│   (scrollable)          │
│                         │
├─────────────────────────┤
│   AdBanner (fixed)      │  ← always visible, never scrolls
└─────────────────────────┘
```

Bottom padding is added to the screen's scroll content equal to the banner height so no content is permanently hidden behind the banner.

---

## Rewarded Interstitial Ad

### State: `adStore`

```ts
interface AdState {
  downloadCount: number;       // resets to 0 on every app launch (not persisted)
  pendingInterstitial: boolean; // true when threshold hit but ad not yet completed
}
```

Actions:
- `incrementDownload()` — increments `downloadCount`; if `count % 4 === 0`, sets `pendingInterstitial = true`
- `markAdCompleted()` — sets `pendingInterstitial = false`

### Trigger: `DownloadsScreen`

A `useEffect` watches the `downloads` list from `useDownloads()`. A `useRef` stores the previously seen status map. When any item transitions **to** `completed` status, `incrementDownload()` is called. Fires once per item per completion, not on every render.

### Component: `AdController`

Mounted once inside `App.tsx` (renders nothing visible). Responsibilities:

1. **Load ad** — when `pendingInterstitial` becomes `true`, calls `RewardedInterstitialAd.createForAdRequest()` and loads the ad
2. **Show ad** — once loaded (`onAdLoaded`), presents the full-screen rewarded interstitial immediately
3. **On completion** — `onUserEarnedReward` fires → calls `markAdCompleted()`
4. **On dismiss without reward** — `onAdDismissed` without earning reward → keeps `pendingInterstitial = true`; reloads and shows the ad again
5. **AppState listener** — if app transitions from `active` → `background` while `pendingInterstitial === true`, when app returns to `active`, the ad re-shows immediately (re-loads if needed)

### Re-show Logic (AppState)

```
App enters background  →  note that pendingInterstitial === true
App returns to foreground  →  AdController sees pendingInterstitial still true → loads + shows ad
```

The AppState listener only triggers a re-show when `pendingInterstitial === true`. Normal background/foreground transitions (e.g., taking a call) do not show an ad unless the 4-download threshold was already hit.

---

## Error Handling

- **Banner fails to load** — `AdBanner` hides itself silently; screen layout is unaffected
- **Rewarded interstitial fails to load** — `AdController` retries once after a 3-second delay; if it fails again, `markAdCompleted()` is called to unblock the user (the ad is skipped silently)
- **No internet connection** — both ad types fail silently per above rules

---

## What Is Not Changing

- Package ID (`com.mybrowser.app`) — unchanged
- Navigation structure — unchanged
- All existing Context stores — `adStore` is additive only
- Download count does **not** persist across app restarts (session-only)
