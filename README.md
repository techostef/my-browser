# MyBrowser — React Native Video Downloader Browser

A lightweight mobile browser built with React Native that detects and downloads videos from web pages.

## Expo Quick Start

```bash
npm install
npx expo start
```

Then press:
- `a` for Android emulator/device
- `i` for iOS simulator (macOS)
- `w` for web

### Notes for Expo runtime
- Downloads now use `expo-file-system` + `expo-media-library` so this works in Expo-managed projects.
- The optional native Android interception module (`android/.../VideoInterceptModule.java`) is **not available in Expo Go**.
- For native interception support, build a dev client with `npx expo run:android` or EAS build.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                     App.tsx                         │
│          (SafeAreaProvider + DownloadProvider        │
│           + NavigationContainer)                    │
├────────────────────┬────────────────────────────────┤
│   BrowserScreen    │       DownloadsScreen          │
│  ┌──────────────┐  │  ┌──────────────────────────┐  │
│  │  AddressBar   │  │  │  FlatList<DownloadItem>  │  │
│  ├──────────────┤  │  │  - Progress bars          │  │
│  │   WebView     │  │  │  - Pause / Resume        │  │
│  │  (injected JS │  │  │  - Cancel / Remove       │  │
│  │   detector)   │  │  └──────────────────────────┘  │
│  ├──────────────┤  │                                │
│  │ VideoBanner   │  │                                │
│  └──────────────┘  │                                │
└────────────────────┴────────────────────────────────┘

Services Layer:
  videoDetector.ts  ─── Injected JS (MutationObserver + XHR/fetch hooks)
  downloadManager.ts ── react-native-blob-util wrapper (progress, pause, resume)

State:
  downloadStore.tsx ─── React Context + useReducer

Native (Android):
  VideoInterceptModule.java ─── WebViewClient.shouldInterceptRequest()
  VideoInterceptPackage.java ── RN package registration
```

### Data Flow

1. User navigates to a URL in the **BrowserScreen**
2. `injectedJavaScript` runs the **video detector** after page load
3. Detector scans `<video>` elements, hooks `XMLHttpRequest.open` and `window.fetch`, and observes DOM mutations
4. Detected video URLs are sent to RN via `window.ReactNativeWebView.postMessage()`
5. `BrowserScreen.onMessage` parses the data and shows **VideoDetectedBanner**
6. User taps "Download" → `DownloadProvider.startDownload()` is called
7. **DownloadManager** uses `react-native-blob-util` to fetch the file with progress tracking
8. Progress and status updates flow through the **DownloadStore** (React Context)
9. **DownloadsScreen** renders live progress via the `useDownloads()` hook

---

## Project Structure

```
my-browser/
├── App.tsx                          # Root: navigation + providers
├── index.js                         # RN entry point
├── package.json
├── tsconfig.json
├── babel.config.js
├── metro.config.js
├── app.json
│
├── src/
│   ├── types/
│   │   └── index.ts                 # TypeScript interfaces
│   ├── utils/
│   │   └── permissions.ts           # Android storage permissions
│   ├── services/
│   │   ├── videoDetector.ts         # Injected JS for video detection
│   │   └── downloadManager.ts       # Download engine (blob-util)
│   ├── store/
│   │   └── downloadStore.tsx        # React Context state management
│   ├── components/
│   │   ├── AddressBar.tsx           # URL bar + nav buttons
│   │   ├── VideoDetectedBanner.tsx  # Floating banner with download buttons
│   │   └── DownloadItem.tsx         # Single download row with progress
│   └── screens/
│       ├── BrowserScreen.tsx        # WebView browser tab
│       └── DownloadsScreen.tsx      # Download manager tab
│
└── android/app/src/main/java/com/mybrowser/
    ├── VideoInterceptModule.java    # Native network interception
    └── VideoInterceptPackage.java   # RN package registration
```

---

## Setup

### Prerequisites
- Node.js >= 18
- React Native CLI (`npx react-native`)
- Android Studio + Android SDK (for Android)
- Xcode (for iOS, macOS only)

### Installation

```bash
# 1. Initialize a new RN project (if starting fresh)
npx react-native@latest init MyBrowser --directory my-browser-rn

# 2. Copy the src/ files from this project into the initialized project
#    Or simply install deps in this directory:
cd my-browser
npm install

# 3. Install iOS pods (macOS only)
cd ios && pod install && cd ..

# 4. Run on Android
npx react-native run-android

# 5. Run on iOS
npx react-native run-ios
```

### Android Permissions

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="28" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32" />
```

### Registering the Native Module (Android)

In `MainApplication.java`, add the package:

```java
import com.mybrowser.VideoInterceptPackage;

// In getPackages():
packages.add(new VideoInterceptPackage());
```

Then in JS you can listen for native detections:

```typescript
import { NativeModules, NativeEventEmitter } from 'react-native';

const { VideoInterceptModule } = NativeModules;
const emitter = new NativeEventEmitter(VideoInterceptModule);

emitter.addListener('onVideoStreamDetected', (event) => {
  console.log('Native detected:', event.url, event.mimeType);
});
```

---

## How Video Detection Works

### Layer 1: Injected JavaScript (Primary)
- Scans all `<video>` elements and their `<source>` children
- Uses `MutationObserver` to catch dynamically inserted videos (SPAs)
- Monkey-patches `XMLHttpRequest.open()` and `window.fetch()` to detect video URLs in network requests
- Periodic re-scan every 3 seconds for lazy-loaded content
- Sends results via `window.ReactNativeWebView.postMessage()`

### Layer 2: Native Android Interception (Advanced)
- Overrides `WebViewClient.shouldInterceptRequest()` to inspect every network request
- Checks URL extensions (`.mp4`, `.webm`, `.m3u8`, etc.) and MIME types
- Emits events to JS via `RCTDeviceEventEmitter`
- Catches video requests that JS injection might miss (e.g., preload requests)

### URL Classification
| Type | Extension/Pattern | Downloadable? |
|------|-------------------|---------------|
| MP4  | `.mp4`            | Yes           |
| WebM | `.webm`           | Yes           |
| HLS  | `.m3u8`           | No (needs FFmpeg) |
| Blob | `blob:...`        | No (DRM/memory) |

---

## Limitations & Best Practices

### Known Limitations

1. **DRM Content**: YouTube, Netflix, Disney+, and similar services use Widevine/FairPlay DRM. Their video URLs are encrypted and cannot be downloaded. This app intentionally skips them.

2. **Blob URLs**: `blob:` URLs reference in-memory data and are not downloadable from outside the browser context. They often indicate DRM or Media Source Extensions (MSE) usage.

3. **HLS/DASH Streams**: `.m3u8` (HLS) and `.mpd` (DASH) are manifests pointing to many small `.ts`/`.m4s` segments. Downloading them requires an FFmpeg-based approach to reassemble.

4. **Cross-Origin Iframes**: The injected JS cannot access video elements inside cross-origin iframes (browser security restriction).

5. **Pause/Resume**: True HTTP range-based resume requires server support (`Accept-Ranges: bytes`). The current implementation restarts the download on resume.

6. **iOS Restrictions**: iOS is more restrictive with file system access. Downloaded files are saved to the app's Documents directory and can be accessed via the Files app.

### Best Practices

- **User-Agent**: The WebView uses a Chrome-like UA string to avoid being served mobile-lite pages that strip video players.
- **Scoped Storage** (Android 10+): Files are downloaded to cache first, then copied to MediaStore using `copyToMediaStore()`.
- **Permission Handling**: Runtime permissions are only requested on Android < 10. Newer versions use scoped storage.
- **Deduplication**: Both the JS detector and download manager deduplicate URLs to avoid spam.
- **Error Handling**: Failed downloads show error messages; users can remove or retry.

### Potential Enhancements

- [ ] Integrate FFmpeg (via `ffmpeg-kit-react-native`) for HLS stream downloading
- [ ] Add a download history persisted with AsyncStorage or SQLite
- [ ] Implement true Range-header resume for paused downloads
- [ ] Add a whitelist/blacklist for domains
- [ ] Thumbnail extraction from video files
- [ ] Background download support via headless JS tasks
- [ ] Video player integration to preview before downloading

---

## License

MIT


# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

3. build the app on expo.dev

   ```bash
   eas build --profile preview
   ```

4. build the android app standalone on locally

   ```bash
   npx expo run:android --variant release
   ```
   Note: location apk file in android/app/build/outputs/apk/release/app-release.apk

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Build on expo.dev
eas build --profile preview