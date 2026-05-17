# Download Pause/Resume Fix

**Status:** Approved
**Date:** 2026-05-17
**Scope:** Bug fix only — no new download entry points

## Problem

Users cannot resume paused video downloads. Affects both:

1. **Direct MP4 downloads** (via `expo-file-system`'s `DownloadResumable`)
2. **HLS / .m3u8 downloads** (via `@wokcito/ffmpeg-kit-react-native`)

After tapping Pause then Resume, the download either disappears, shows as failed, or the Resume button never appears.

## Root cause

### Direct MP4

`src/services/downloadManager.ts` `runTask` (lines 917–945):

```ts
} catch (err: any) {
  if (err?.message?.includes('pause')) {
    return '';
  }
  if (err?.message?.includes('cancel')) {
    this.activeTasks.delete(id);
    this.onStatusChange?.(id, 'cancelled');
    return '';
  }
  this.activeTasks.delete(id);
  this.onStatusChange?.(id, 'failed', undefined, err?.message || 'Download failed');
  throw err;
}
```

When `pauseAsync()` triggers rejection of the in-flight `downloadAsync()`, the rejection message is not guaranteed to contain the literal substring `pause` across all expo-file-system versions and Android/iOS native bridges. When the substring check fails, the code:

- Deletes the task from `activeTasks`
- Sets status `failed`

Then `resumeDownload` throws `"No paused task found for this download"` (line 967) because `activeTasks.get(id)` returns undefined.

### HLS

`pauseDownload` (lines 947–962) for HLS tasks:

```ts
if (active.ffmpegSessionId !== undefined) {
  FFmpegKit.cancel(active.ffmpegSessionId);
  this.activeTasks.delete(id);
  this.onStatusChange?.(id, 'cancelled');
  return;
}
```

It cancels the FFmpeg session, deletes the task, and sets status `cancelled`. Result:

- The UI never shows the Resume button (only appears for `status === 'paused'`)
- Even if status were `paused`, no task exists to resume — FFmpeg has no native pause primitive

## Design

Two-part fix, both contained in `src/services/downloadManager.ts`. No store, UI, or type changes.

### Part 1 — Direct MP4: flag-based pause detection

Add a `paused: boolean` field to `ActiveTask`. Set it in `pauseDownload` *before* calling `pauseAsync()`. Check it in `runTask`'s catch block instead of pattern-matching error messages.

**ActiveTask interface (extend existing):**

```ts
interface ActiveTask {
  task?: FileSystem.DownloadResumable;
  ffmpegSessionId?: number;
  url: string;
  fileUri: string;
  bytesDownloaded: number;
  totalBytes: number;
  paused?: boolean;
  // HLS-only — preserved for restart-on-resume:
  pageTitle?: string;
  pageUrl?: string;
  cookies?: string;
  hlsInfo?: HlsMasterInfo;
  selectedVariant?: HlsVariant;
}
```

**pauseDownload (direct branch):**

```ts
active.paused = true;
this.onStatusChange?.(id, 'paused');
active.task?.pauseAsync().catch(() => { /* expected to reject downloadAsync */ });
```

**runTask catch:**

```ts
} catch (err: any) {
  if (active.paused) {
    // Keep activeTask alive so resumeDownload can find it.
    return '';
  }
  if (err?.message?.includes('cancel')) {
    this.activeTasks.delete(id);
    this.onStatusChange?.(id, 'cancelled');
    return '';
  }
  this.activeTasks.delete(id);
  this.onStatusChange?.(id, 'failed', undefined, err?.message || 'Download failed');
  throw err;
}
```

Note: re-fetch `active` at top of `runTask` (already done) so the `paused` check works after `pauseDownload` mutates it.

**resumeDownload (direct branch):**

```ts
active.paused = false;
this.onStatusChange?.(id, 'downloading');
return this.runResumeTask(id);
```

Apply the same `active.paused` check in `runResumeTask`'s catch (user could pause again during the resumed download).

### Part 2 — HLS: restart-on-resume

FFmpeg cannot pause an HLS merge mid-flight. The fix: keep the task record alive on pause and restart the FFmpeg job on resume.

**Pre-step in `startHlsDownload`:** when populating `activeTasks.set(id, {...})`, also store `pageTitle`, `pageUrl`, `cookies`, `hlsInfo`, `selectedVariant` so resume can re-run with the same parameters.

**pauseDownload (HLS branch):**

```ts
if (active.ffmpegSessionId !== undefined) {
  active.paused = true;
  FFmpegKit.cancel(active.ffmpegSessionId);
  active.ffmpegSessionId = undefined;
  // Delete partial output so the restart writes cleanly.
  await FileSystem.deleteAsync(active.fileUri, { idempotent: true }).catch(() => {});
  this.onStatusChange?.(id, 'paused');
  return;
}
```

The existing `startHlsDownload` callback chain calls `rejectCompletion(new Error('cancelled'))` when `ReturnCode.isCancel(rc)` is true. The catch block in `startHlsDownload` (lines 904–914) currently sees `err.message === 'cancelled'`, deletes the task, and sets status `cancelled`. We need to bypass that when `active.paused` is true:

```ts
} catch (err: any) {
  await FileSystem.deleteAsync(outputPath, { idempotent: true }).catch(() => {});
  const stillActive = this.activeTasks.get(id);
  if (stillActive?.paused) {
    // Pause path — leave task in map, status already set to 'paused'.
    return '';
  }
  if (err?.message === 'cancelled') {
    this.activeTasks.delete(id);
    this.onStatusChange?.(id, 'cancelled');
    return '';
  }
  // ...existing failed branch
}
```

**resumeDownload (HLS branch):** detect via stored `hlsInfo` (or absence of `task` + presence of `pageTitle`), then re-invoke `startHlsDownload`:

```ts
async resumeDownload(id: string): Promise<string> {
  const active = this.activeTasks.get(id);
  if (!active) {
    throw new Error('No paused task found for this download');
  }
  if (active.pageTitle !== undefined && active.task === undefined) {
    // HLS — restart from scratch with stored args.
    active.paused = false;
    this.activeTasks.delete(id);  // startHlsDownload will create a fresh entry
    return this.startHlsDownload(id, active.url, active.pageTitle, active.pageUrl, active.cookies, active.hlsInfo, active.selectedVariant);
  }
  active.paused = false;
  this.onStatusChange?.(id, 'downloading');
  return this.runResumeTask(id);
}
```

**UX trade-off:** HLS resume restarts the FFmpeg job — progress goes back to 0%. This is acceptable because:

- FFmpeg has no resume primitive for an HLS→MP4 mux
- Alternative (segment-level partial cache) is a much larger change
- The user explicitly tapped Resume, so restarting matches the verb

No confirmation dialog. If it becomes annoying we can revisit.

## What's NOT in scope

- **Persistence across app restart.** `DownloadResumable.savable()` could serialize state to AsyncStorage so a paused download survives app kill. Out of scope — separate, larger change. Current behavior: app kill loses pause state (unchanged).
- **HLS partial-segment resume.** Would require swapping FFmpeg for a custom segment downloader. Out of scope.
- **New UI entry points** (manual URL paste, etc.). Confirmed out of scope by user.

## Testing plan

Manual verification on Android (the user's primary platform):

1. Start direct MP4 download from a browser-detected video, pause mid-download, resume → completes from where it stopped.
2. Start HLS (.m3u8) download, pause mid-download, resume → restarts and completes (progress returns to 0%, then climbs to 100%).
3. Pause, then pause again rapidly → no crash, status stays `paused`.
4. Pause, then cancel → status goes to `cancelled`, task removed.
5. Direct download fails mid-stream (e.g. network drop, no pause issued) → still goes to `failed` status as before.

## Files changed

- `src/services/downloadManager.ts` — single file
