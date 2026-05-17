# Persistent Resumable Downloads

**Status:** Approved
**Date:** 2026-05-17
**Scope:** Video download persistence + auto-pause on connection loss + true byte-level resume

## Problem

When a download is interrupted by connection loss (e.g. airplane mode), the user has no reliable way to recover the partial:

1. `expo-file-system`'s `downloadAsync()` may resolve "successfully" with a truncated file (already partially mitigated by `verifyDownloadComplete`, but the partial is then deleted).
2. There is no persistence across app restart. Closing the app while a download is paused loses all state — the task disappears from the Downloads tab.

The user wants: persist enough state to AsyncStorage that they can close the app, lose connection, reopen later, tap Resume, and continue from the byte offset where the download stopped.

## User-confirmed choices

- **Resume strategy:** continue from byte offset (true resume), not restart from zero
- **Trigger:** manual (user taps Resume) — no auto-resume on network reconnect, no NetInfo dependency
- **HLS:** restart FFmpeg job on resume (FFmpeg can't truly resume mid-merge)

## Architecture

### 1. Persistent storage

AsyncStorage key: `@persisted_downloads_v1`. Value: JSON-serialized array of `PersistedDownload` records.

```ts
interface PersistedDownload {
  id: string;
  type: 'direct' | 'hls';
  url: string;
  fileUri: string;              // destination path (under private_downloads/)
  fileName: string;
  pageTitle: string;
  pageUrl?: string;
  cookies?: string;
  expectedTotalBytes: number;   // from HEAD pre-flight (authoritative)
  bytesDownloaded: number;      // last persisted progress
  createdAt: number;
  status: 'paused';             // only paused entries are persisted

  // direct-only
  savable?: FileSystem.DownloadPauseState;  // includes resumeData

  // HLS-only
  hlsInfo?: HlsMasterInfo;
  selectedVariant?: HlsVariant;
}
```

Only `paused` entries are persisted. `downloading` is in-memory only (with periodic snapshots, but the persisted status is always `paused`); `completed`/`cancelled`/`failed` are removed.

Writes happen on lifecycle transitions, plus a debounced (~2s) progress snapshot during active download so a crash during download doesn't lose every byte.

### 2. Stall watchdog → auto-pause on connection loss

No NetInfo dependency. Instead, a single global `setInterval` (started lazily when first download begins, cleared when no actives remain) walks `activeTasks` once per second. For any task where:

- `status === 'downloading'`
- `Date.now() - lastProgressAt > STALL_THRESHOLD_MS` (15s)

…it calls `autoPause(id)`:

- **Direct:** `task.pauseAsync()` to capture `resumeData` into the resumable, then persist `savable()` with `status='paused'`. Status callback emits `paused` with error message "Connection lost — tap Resume to continue".
- **HLS:** cancel the FFmpeg session, persist HLS metadata (no savable), set status `paused`.

Add a `lastProgressAt` field to `ActiveTask`. Stamp it in the progress callback. Initialize to `Date.now()` at task creation so a download that never produces any progress still triggers the stall after 15s.

### 3. Resume flow (user-triggered)

`resumeDownload(id)` already exists. Extend it to handle the persisted case:

- If `active.task` (DownloadResumable) is still in memory → existing behavior: `resumeAsync()`.
- If `active` has a `savable` record but no live `task` (post-restart case) → reconstruct: `createDownloadResumable(url, fileUri, options, progressCb, savable.resumeData)`, attach it to `active.task`, then `resumeAsync()`.
- If `active` is HLS → restart `startHlsDownload` with stored args (already done in earlier fix).
- If `active` exists but has no savable and no live task (truncation detected post-fact, can't pause) → re-invoke `startDownload` from scratch using stored metadata. Loses progress but at least works.

After successful resume, `finalizeDownload`'s verification still runs.

### 4. App startup restoration

In [src/store/downloadStore.tsx](src/store/downloadStore.tsx) `useEffect` bootstrap (lines 404-463), after restoring caches, call `downloadManager.restorePersistedDownloads()`. That method:

1. Loads persisted records from AsyncStorage.
2. For each, registers an `ActiveTask` (with `savable`, `paused: true`, and all the metadata fields), pre-reconstructing the `DownloadResumable` for direct downloads so the resume button works immediately.
3. Returns `DownloadTask[]` for the store to merge into the downloads list with `status: 'paused'`.

Direct download `task` reconstruction:

```ts
const task = FileSystem.createDownloadResumable(
  record.url,
  record.fileUri,
  record.savable.options,
  progressCb,
  record.savable.resumeData,
);
```

### 5. Lifecycle persistence map

| Event | Storage write | Partial file |
|---|---|---|
| Download started (`startDownload`) | upsert (status='paused' shape with empty savable) | — |
| Progress callback (debounced 2s) | update `bytesDownloaded` | — |
| User pause | upsert (savable captured, status='paused') | keep |
| Auto-pause on stall | upsert (savable captured, status='paused') | keep |
| User resume | no change (still 'paused' in storage until next pause) | — |
| User cancel | delete record | delete |
| Completed (verified) | delete record | — |
| Failed (non-resumable, e.g. 404) | delete record | delete |
| Truncation detected post-fact | upsert (no savable; resume = restart) | keep partial; resume builds on it |

For the truncation case ("post-fact"), we don't delete the partial anymore — it's evidence of progress and the restart-from-scratch resume will overwrite it.

### 6. ActiveTask additions

```ts
interface ActiveTask {
  // existing...
  lastProgressAt?: number;
  // mirror of the persisted savable so resumeDownload can reconstruct
  savable?: FileSystem.DownloadPauseState;
  type?: 'direct' | 'hls';   // disambiguates resume path
  fileName?: string;          // for restoration path display
}
```

The existing HLS-arg fields (`hlsInfo`, `selectedVariant`, `pageTitle`, `pageUrl`, `cookies`) cover the HLS persistence shape.

## What's NOT in scope

- **NetInfo / auto-resume on reconnect.** Manual resume only.
- **Background downloads** (continue after screen-off / app-killed by OS). Out of scope; native foreground service required.
- **Multi-part parallel chunked downloads.** Out of scope.
- **HLS true byte-level resume** (segment-level partial cache). FFmpeg-based HLS restarts from zero on resume.
- **Resume of failed-state downloads** that aren't `paused` (e.g. 404). Failed downloads are removed from persistence.

## Files changed

- **[src/services/downloadManager.ts](src/services/downloadManager.ts)** — the bulk:
  - Persistence helpers (`loadPersisted`, `savePersisted`, `removePersisted`, `restorePersistedDownloads`)
  - Watchdog (`ensureStallWatchdog`, `stopStallWatchdog`, `autoPauseStalled`)
  - `startDownload` writes initial persisted record after HEAD pre-flight
  - Progress callback stamps `lastProgressAt`, schedules debounced persist
  - `pauseDownload` captures `savable()` and persists
  - `resumeDownload` handles savable-reconstruction path
  - `cancelDownload`, `finalizeDownload` (completion), `runTask` (failure) remove persisted record
  - `ActiveTask` interface extended
- **[src/store/downloadStore.tsx](src/store/downloadStore.tsx)** — small change:
  - In bootstrap effect, call `downloadManager.restorePersistedDownloads()` and merge results into the downloads list with `status: 'paused'`.

No UI/type/component changes.

## Testing plan

Manual on Android:

1. **Happy path (regression):** start a download, let it complete normally → no persisted record left in AsyncStorage; file is in the private folder.
2. **Stall pause:** start a download, toggle airplane mode → within ~15s status flips to `paused` with "Connection lost" error. Disable airplane mode. Tap Resume. Download continues from where it stopped. File completes correctly and plays full duration.
3. **Stall pause across app restart:** repeat (2) but kill the app after the stall pause. Reopen. The paused download appears in the Downloads tab. Disable airplane mode. Tap Resume. Download continues. File completes correctly.
4. **User pause across app restart:** start, tap Pause, kill app, reopen, tap Resume. Same outcome.
5. **HLS stall:** start an HLS download, airplane mode → status `paused`. Disable airplane, Resume → FFmpeg job restarts from zero, completes.
6. **HLS across app restart:** same with app kill between pause and resume.
7. **Cancel a paused download:** start, pause (stall or user), tap Cancel → record removed from storage, partial deleted.
8. **Storage corruption resilience:** manually corrupt the AsyncStorage value (or test path: invalid JSON) → app starts cleanly, drops the corrupted entry, logs a warning.

## Failure modes to keep in mind

- `pauseAsync()` itself might throw if the connection is broken mid-pause. Catch and fall back to "no savable, restart-from-scratch" path on resume.
- `savable()` on Android may return `resumeData` as a byte offset; on iOS as opaque resumeData. Both are JSON-serializable.
- `expectedTotalBytes` might be 0 if HEAD failed at start time. In that case verification skips after resume too — accept and move on.
