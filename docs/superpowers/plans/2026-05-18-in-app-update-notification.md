# In-App Update Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify users on cold start when a newer version of the app is available on Google Play, using Google's native FLEXIBLE in-app update flow plus a small in-app "restart to install" banner.

**Architecture:** A self-contained `appUpdate` service wraps `sp-react-native-in-app-updates`. On `App` mount, we call it once. The library renders Google's native update prompt and downloads in the background. When download completes, the service invokes a callback that flips state in `App`, rendering a themed `UpdateReadyBanner` above the navigation tree with a "Restart now" button. iOS is a no-op. All errors are swallowed silently — the feature degrades to invisible.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript, `sp-react-native-in-app-updates`, Google Play `com.google.android.play:app-update` (autolinked).

**Spec:** [docs/superpowers/specs/2026-05-18-in-app-update-notification-design.md](../specs/2026-05-18-in-app-update-notification-design.md)

---

## File Structure

**New files:**
- `src/services/appUpdate.ts` — service module wrapping `sp-react-native-in-app-updates`. Public functions: `checkAndStartFlexibleUpdate(onDownloaded)` and `installUpdate()`. Handles platform gate, error swallowing, and status-listener cleanup.
- `src/components/UpdateReadyBanner.tsx` — themed banner rendered when an update has finished downloading. Has "Restart now" and dismiss buttons.

**Modified files:**
- `App.tsx` — add a small `UpdateChecker` component inside the provider tree that owns `updateReady` state, calls the service on mount, and renders `UpdateReadyBanner` above `AppNavigator`.
- `package.json` — add `sp-react-native-in-app-updates` dependency.

**Possibly modified (only if Gradle build fails):**
- `android/app/build.gradle` — add explicit `com.google.android.play:app-update` deps if autolinking misses them.

---

## Task 1: Install the library

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run:
```bash
npm install sp-react-native-in-app-updates
```

Expected: `package.json` and `package-lock.json` updated; no errors. The package should appear under `dependencies`.

- [ ] **Step 2: Verify it appears in package.json**

Open `package.json` and confirm a line like:
```json
"sp-react-native-in-app-updates": "^x.y.z"
```
…has been added to `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add sp-react-native-in-app-updates for Google Play in-app updates"
```

---

## Task 2: Create the appUpdate service module

**Files:**
- Create: `src/services/appUpdate.ts`

- [ ] **Step 1: Create the file with full contents**

Create `src/services/appUpdate.ts` with exactly this content:

```ts
import { Platform } from 'react-native';
import SpInAppUpdates, {
  IAUUpdateKind,
  StartUpdateOptions,
  StatusUpdateEvent,
} from 'sp-react-native-in-app-updates';

const InstallStatus = {
  DOWNLOADED: 11,
} as const;

let inAppUpdates: SpInAppUpdates | null = null;
let statusListener: ((event: StatusUpdateEvent) => void) | null = null;

function getClient(): SpInAppUpdates {
  if (!inAppUpdates) {
    inAppUpdates = new SpInAppUpdates(false);
  }
  return inAppUpdates;
}

export async function checkAndStartFlexibleUpdate(
  onDownloaded: () => void,
): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    const client = getClient();
    const result = await client.checkNeedsUpdate();
    if (!result.shouldUpdate) return;

    if (statusListener) {
      client.removeStatusUpdateListener(statusListener);
      statusListener = null;
    }

    statusListener = (event: StatusUpdateEvent) => {
      if (event.status === InstallStatus.DOWNLOADED) {
        onDownloaded();
      }
    };
    client.addStatusUpdateListener(statusListener);

    const options: StartUpdateOptions = {
      updateType: IAUUpdateKind.FLEXIBLE,
    };
    await client.startUpdate(options);
  } catch (err) {
    console.warn('[appUpdate] check/start failed:', err);
  }
}

export async function installUpdate(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await getClient().installUpdate();
  } catch (err) {
    console.warn('[appUpdate] install failed:', err);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors related to `src/services/appUpdate.ts`. (Pre-existing errors elsewhere in the repo are fine — only fix ones the new file introduced.)

- [ ] **Step 3: Commit**

```bash
git add src/services/appUpdate.ts
git commit -m "feat(update): add appUpdate service wrapping sp-react-native-in-app-updates"
```

---

## Task 3: Create the UpdateReadyBanner component

**Files:**
- Create: `src/components/UpdateReadyBanner.tsx`

- [ ] **Step 1: Create the file with full contents**

Create `src/components/UpdateReadyBanner.tsx` with exactly this content:

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../store/settingsStore';
import { installUpdate } from '../services/appUpdate';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function UpdateReadyBanner({ visible, onDismiss }: Props) {
  const { themeColors } = useSettings();

  if (!visible) return null;

  return (
    <SafeAreaView
      edges={['top']}
      style={[
        styles.wrap,
        { backgroundColor: themeColors.surface, borderBottomColor: themeColors.border },
      ]}
    >
      <View style={styles.row}>
        <Text style={[styles.message, { color: themeColors.text }]} numberOfLines={2}>
          Update ready to install
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              installUpdate();
            }}
            style={[styles.btn, { backgroundColor: themeColors.tabBarActive }]}
          >
            <Text style={styles.btnText}>Restart</Text>
          </Pressable>
          <Pressable
            onPress={onDismiss}
            style={[styles.dismiss, { borderColor: themeColors.border }]}
            hitSlop={8}
          >
            <Text style={[styles.dismissText, { color: themeColors.textSecondary }]}>×</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  dismiss: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '600',
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: no new errors related to `UpdateReadyBanner.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/UpdateReadyBanner.tsx
git commit -m "feat(update): add UpdateReadyBanner shown when in-app update finishes downloading"
```

---

## Task 4: Wire the checker and banner into App.tsx

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Add the imports**

Open `App.tsx`. After the existing imports (after the `AdController` import on line 20), add:

```tsx
import { UpdateReadyBanner } from './src/components/UpdateReadyBanner';
import { checkAndStartFlexibleUpdate } from './src/services/appUpdate';
```

Also, at the top of the file, change:
```tsx
import React from 'react';
```
to:
```tsx
import React, { useEffect, useState } from 'react';
```

- [ ] **Step 2: Add the UpdateChecker component**

In `App.tsx`, immediately above the existing `function AppNavigator() {` definition, insert this new component:

```tsx
function UpdateChecker() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    checkAndStartFlexibleUpdate(() => setUpdateReady(true)).catch(() => {});
  }, []);

  return <UpdateReadyBanner visible={updateReady} onDismiss={() => setUpdateReady(false)} />;
}
```

- [ ] **Step 3: Render UpdateChecker in the provider tree**

In the `App` function at the bottom of `App.tsx`, change the inner `<AdProvider>` block from:

```tsx
<AdProvider>
  <AppNavigator />
</AdProvider>
```

to:

```tsx
<AdProvider>
  <UpdateChecker />
  <AppNavigator />
</AdProvider>
```

`UpdateChecker` must be inside `SettingsProvider` (it consumes `useSettings`) and outside `NavigationContainer` so the banner overlays all routes. The current nesting already satisfies both — `SettingsProvider` wraps everything and `NavigationContainer` is rendered inside `AppNavigator`.

- [ ] **Step 4: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat(update): run in-app update check on App mount and render restart banner"
```

---

## Task 5: Rebuild Android and confirm Gradle resolves the native dep

**Files:**
- Possibly modify: `android/app/build.gradle`

- [ ] **Step 1: Clean and rebuild**

Run:
```bash
cd android && ./gradlew clean && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL. If you see errors mentioning unresolved class `com.google.android.play.core.appupdate.AppUpdateManager` or similar, proceed to Step 2. Otherwise skip to Step 4.

- [ ] **Step 2: (Only if Step 1 failed) Add explicit Play app-update deps**

Open `android/app/build.gradle`. Inside the `dependencies { ... }` block (starts around line 169), add these two lines at the end, just before the closing `}`:

```gradle
    implementation "com.google.android.play:app-update:2.1.0"
    implementation "com.google.android.play:app-update-ktx:2.1.0"
```

- [ ] **Step 3: (Only if Step 2 was needed) Rebuild**

Run:
```bash
cd android && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Smoke-launch the debug build**

Run from project root:
```bash
npx expo run:android
```

Expected: app launches normally on emulator or device. Watch logcat for the line `[appUpdate] check/start failed:` — this is **expected** in a debug build (Google's API returns `ERROR_API_NOT_AVAILABLE`) and confirms the service is wired up and failing silently as designed. The UI must show no banner, no crash, no popup.

- [ ] **Step 5: Commit (only if `android/app/build.gradle` was modified)**

```bash
git add android/app/build.gradle
git commit -m "build(android): add explicit play:app-update dep (autolinking fallback)"
```

If no Gradle change was needed, skip this commit.

---

## Task 6: Manual verification via Play Internal App Sharing

This task is run **once** to verify the feature end-to-end. It produces no commits — it's a verification gate.

- [ ] **Step 1: Note the live versionCode**

Open Google Play Console → your app → Production track. Note the `versionCode` of the currently published release. Call this `LIVE_CODE`.

- [ ] **Step 2: Set local versionCode below live**

In `android/app/build.gradle`, find `versionCode 1` on line 117 and change it to `LIVE_CODE - 1`. For example, if `LIVE_CODE` is `10`, set:

```gradle
versionCode 9
```

(Do **not** commit this change — it's only for testing.)

- [ ] **Step 3: Build a signed release AAB**

Run:
```bash
cd android && ./gradlew bundleRelease
```

Expected: BUILD SUCCESSFUL. Output AAB at `android/app/build/outputs/bundle/release/app-release.aab`.

- [ ] **Step 4: Upload to Internal App Sharing**

In Play Console → Internal app sharing → Upload → select the AAB. Copy the share link.

- [ ] **Step 5: Install via the share link on a real Android device**

Open the share link on the device (must be signed into a Google account allowed to view Internal App Sharing). Tap install.

- [ ] **Step 6: Launch the app and verify the flow**

Open the app. Expected sequence:
1. Within a few seconds, Google's native bottom-sheet "Update available" prompt appears.
2. Tap "Update" → the sheet dismisses and download begins (you can keep using the app).
3. When the download completes, the in-app `UpdateReadyBanner` appears at the top with "Update ready to install" and a "Restart" button.
4. Tap "Restart" → the app restarts on the new version (`LIVE_CODE`).

If any step fails, debug with `adb logcat | grep -E "(appUpdate|InAppUpdate)"`.

- [ ] **Step 7: Revert the test versionCode change**

In `android/app/build.gradle`, restore `versionCode` to whatever it should be for your next real release. Do not commit the test value.

---

## Self-Review

**1. Spec coverage:**
- Library & native setup → Tasks 1, 5 ✓
- Service module (`src/services/appUpdate.ts`) with `checkAndStartFlexibleUpdate(onDownloaded)` + `installUpdate()`, platform gate, error swallowing → Task 2 ✓
- `UpdateReadyBanner` themed with `useSettings().themeColors`, dismiss + restart buttons → Task 3 ✓
- `App.tsx` integration: `useState`/`useEffect` triggers check on mount; banner rendered inside providers, outside `NavigationContainer` → Task 4 ✓
- Error handling table (debug build / no network / etc.) → Implemented by the `try/catch` + silent `console.warn` in Task 2 ✓
- Testing strategy (Internal App Sharing flow) → Task 6 ✓
- iOS no-op → Platform.OS gate in Task 2 ✓

**2. Placeholder scan:** No "TBD" / "implement later" / "handle edge cases" instructions. All code shown verbatim. All file paths exact.

**3. Type consistency:** `checkAndStartFlexibleUpdate(onDownloaded)` signature matches between Task 2 (definition) and Task 4 (caller). `installUpdate()` exported from the service is imported and called by `UpdateReadyBanner` in Task 3. Banner Props (`visible`, `onDismiss`) match between Task 3 (definition) and Task 4 (usage).
