---
name: android-build-inject
description: Use when building the Android APK or installing ("inject") it onto the connected phone for this project — obrowser/legacy flavors, debug/release, adb install, signature-mismatch errors (INSTALL_FAILED_UPDATE_INCOMPATIBLE), Gradle "Java heap space", or checking which package is open on the device.
---

# Android build & inject (my-browser)

## Flavors

| Flavor | applicationId | APK output (`android/app/build/outputs/apk/...`) |
|---|---|---|
| `obrowser` | `com.techoky.obrowser` (Play Store app) | `obrowser/{debug,release}/app-obrowser-{debug,release}.apk` |
| `legacy` | `com.mybrowser.app` (old app on the user's phone) | `legacy/{debug,release}/app-legacy-{debug,release}.apk` |

## Commands (package.json)

Build only (no install):
- `npm run build:obrowser:debug` / `npm run build:legacy:debug`
- `npm run apk:obrowser` / `npm run apk:legacy` (release, signed with release key)
- `npm run aab:obrowser` / `npm run aab:legacy` (Play bundle)

Inject only (install the last-built APK + open app, no rebuild):
- `npm run inject:obrowser:debug` / `inject:legacy:debug` — also runs `adb reverse tcp:8081`; **debug APKs need Metro** (`npm start`)
- `npm run inject:obrowser:release` / `inject:legacy:release` — standalone, no Metro

All-in-one: `npm run android` / `npm run android:legacy` (expo run:android: build + install + Metro).

VS Code: `.vscode/launch.json` has Build / Inject / Metro configs (gitignored, local only).

## Before injecting

- `adb devices` must show `device`, not `unauthorized` (accept the USB-debugging prompt on the phone).
- Inject fails if the APK was never built — run the matching Build first.

## ⚠️ Installed `com.mybrowser.app` is signed with the DEBUG key

Verified 2026-10-05 with apksigner: the app on the phone is signed by
`CN=Android Debug`, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`
(= `android/app/debug.keystore`, unchanged since the first commit, where both debug and release used it).
The release key (`release-key.keystore`, `CN=Oky, OU=Hartanto`, SHA-256 `f84d1323…fec6`) does NOT match.

So `npm run apk:legacy` + `inject:legacy:release` fails with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE: ... signatures do not match`.

**NEVER `adb uninstall com.mybrowser.app` to "fix" this** — it wipes the user's data:
private videos in `files/private_downloads/` (see `src/services/downloadManager.ts`), plus AsyncStorage
(download list, folders, bookmarks, settings). Only `/storage/emulated/0/Download` survives.

### Safe way to update legacy release on the phone (keeps data)

```powershell
Remove-Item android/app/build/outputs/apk/legacy/release/app-legacy-release.apk -ErrorAction SilentlyContinue
cd android; .\gradlew.bat assembleLegacyRelease -PuseDebugSigning=true; cd ..
npm run inject:legacy:release
```

- Delete the old APK first: AGP builds incrementally and will NOT re-sign an APK it considers up to date.
- `-PuseDebugSigning=true` is wired in `android/app/build.gradle` (`buildTypes.release.signingConfig`).
- Debug-signed release APKs are for the user's own phone ONLY — never upload to Play.
  Play builds use `apk:*` / `aab:*` without the flag.
- Alternatively `build:legacy:debug` + `inject:legacy:debug` (also debug-signed, needs Metro).

Verify a signature before injecting:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs <apk>
# installed app: adb shell pm path com.mybrowser.app -> adb pull <path> -> apksigner on it
```

If the user truly wants to switch to the release key, they must uninstall — first have them back up
private videos via the in-app "Move to Device Download" (release builds can't `run-as`, so adb backup
of private files only works while the installed app is DEBUGGABLE).

## Gradle "Java heap space" (JetifyTransform on react-android aar)

`android/gradle.properties` has `org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m`
(2 GB was too small; machine has 31 GB). After changing jvmargs run `.\gradlew.bat --stop`.
First build after a daemon restart can take ~12 min; incremental builds ~1–2 min — run long builds in the background.

## Gotchas

- Calling `npm run build:*` from the Claude Code shell can fail with `'gradlew.bat' is not recognized`
  (cmd doesn't search the cwd there). Run `cd android; .\gradlew.bat <task>` directly instead.
- PowerShell shows `NativeCommandError` for `adb shell monkey` stderr — not a failure; check for `Events injected: 1`.

## Which app is open on the phone

```powershell
adb shell dumpsys window | findstr mCurrentFocus                    # package/Activity
adb shell dumpsys activity activities | findstr ResumedActivity     # fallback
adb shell dumpsys package com.mybrowser.app | findstr /C:"versionName" /C:"lastUpdateTime" /C:"pkgFlags"
```
