# In-App Update Notification (Google Play)

**Date:** 2026-05-18
**Status:** Approved — ready for implementation plan
**Scope:** Android only (app published on Google Play Store as `com.mybrowser.app`)

## Goal

Notify users when a newer version of the app is available on Google Play and let them update without leaving the app. Use Google's native in-app update UI rather than a custom version-check + Play Store redirect.

## Decisions

| Question | Decision |
|---|---|
| Approach | Google Play In-App Updates (native), via `sp-react-native-in-app-updates` |
| Flow type | **FLEXIBLE** — user keeps using the app while update downloads in background |
| Check timing | Once per cold start (on `App` mount) |
| iOS | No-op (this feature is Play-Store-specific) |

## Library & native setup

**Package:** `sp-react-native-in-app-updates` — the most maintained JS wrapper around Google's `com.google.android.play:app-update` API.

**Install:**
- `npm install sp-react-native-in-app-updates`
- Autolinking handles the native module on RN 0.81. If the Play `app-update` dep is missing at build time, explicitly add it to `android/app/build.gradle`:
  ```gradle
  implementation "com.google.android.play:app-update:2.1.0"
  implementation "com.google.android.play:app-update-ktx:2.1.0"
  ```
- No `app.json` plugin entry needed — package has no Expo config plugin, and the app is already prebuilt (`android/` folder exists).

**Hard requirement (Google):** in-app updates only fire when the app was installed from Play Store (or Internal App Sharing / Internal Test track) with the **same signing key** as the live version. Debug builds will always report "no update available" — this is by design and not a bug.

## Files

**New:**
- `src/services/appUpdate.ts` — service module wrapping the library
- `src/components/UpdateReadyBanner.tsx` — "Restart to install" banner

**Modified:**
- `App.tsx` — call the service on mount, render the banner
- `package.json` — add `sp-react-native-in-app-updates`

**Possibly modified:**
- `android/app/build.gradle` — only if autolinking misses the play:app-update dep

## `src/services/appUpdate.ts`

Self-contained module. Single public function plus an install-status subscription.

**Public API:**
```ts
checkAndStartFlexibleUpdate(
  onDownloaded: () => void
): Promise<void>
```

**Behavior:**
1. Return early on iOS (`Platform.OS !== 'android'`).
2. Create an `SpInAppUpdates` instance.
3. Call `checkNeedsUpdate()`. If `shouldUpdate === false`, return.
4. Call `startUpdate({ updateType: IAUUpdateKind.FLEXIBLE })` — Google's native bottom-sheet prompt renders here.
5. Subscribe to `addStatusUpdateListener`. When status === `DOWNLOADED`, invoke `onDownloaded()` so the UI can show the restart banner.
6. Wrap everything in `try/catch`. Any failure (no Play Store, no network, dev build, signing mismatch, user cancellation) is swallowed with a `console.warn` — never throws, never blocks the app.

The module also exports an `installUpdate()` helper that the banner calls when the user taps "Restart now".

## `src/components/UpdateReadyBanner.tsx`

Small dismissible banner rendered at the top of the app, above `NavigationContainer`.

- Visible only when state flag `updateReady === true`.
- Content: "Update ready — Restart now" + a primary button → calls `installUpdate()`.
- Has a dismiss (×) button that hides the banner for the session (no persistence — it'll come back next launch if the update is still pending).
- Styling uses `useSettings().themeColors` so it matches dark/light mode.
- Lives outside `NavigationContainer` so it overlays all screens.

## `App.tsx` integration

Two changes:
1. Local state `const [updateReady, setUpdateReady] = useState(false);` in `App` (or in a tiny `<UpdateChecker />` child of the providers).
2. `useEffect` on mount: `checkAndStartFlexibleUpdate(() => setUpdateReady(true)).catch(() => {})`.
3. Render `<UpdateReadyBanner visible={updateReady} onDismiss={() => setUpdateReady(false)} />` near the top of the tree (above or beside `<AppNavigator />`).

The banner needs access to `useSettings()`, so it must be rendered inside `<SettingsProvider>`.

## Error handling

| Scenario | Behavior |
|---|---|
| iOS | Service returns early. Banner never renders. |
| Debug build / sideloaded APK | `checkNeedsUpdate` throws → caught, `console.warn`, no UI. |
| No network | `checkNeedsUpdate` rejects → caught, no UI. |
| User dismisses Google's update prompt | `startUpdate` resolves; no banner shown; not re-prompted this session. |
| Download fails mid-way | `onStatusUpdate` emits `FAILED`; logged; do nothing. Google retries next launch. |
| User taps "Restart now" but install fails | Caught; banner stays so user can retry. |

No retries, no failure toasts, no analytics. The feature degrades silently.

## Testing

Cannot be tested with `expo run:android` debug builds. Use Internal App Sharing:

1. Ensure live Play Store version is `versionCode N`.
2. In `android/app/build.gradle`, set local `versionCode` to `N - 1`.
3. Build signed release AAB: `cd android && ./gradlew bundleRelease`.
4. Upload to **Play Console → Internal app sharing**, copy the share link.
5. Install via the share link on a real device.
6. Open the app — Google reports `UPDATE_AVAILABLE`, the native prompt appears.
7. Accept → confirm download progresses → confirm `UpdateReadyBanner` appears when complete → tap "Restart now" → confirm app restarts and runs new version.

No automated tests. The library is a thin wrapper around an unmockable native flow, and the failure mode is "silently no-op", which is safe.

## Out of scope

- iOS in-app updates (different mechanism, not requested).
- IMMEDIATE update flow (not chosen).
- Throttling / persistence across launches (not needed for cold-start-only checks).
- Custom "update available" banner (Google's native prompt handles this).
- Analytics on update funnel.
