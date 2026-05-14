# Whisper Large-V3 Backend — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

---

## Overview

A self-contained Python FastAPI backend in `backend/` that serves the `openai/whisper-large-v3` model from HuggingFace via an OpenAI-compatible `/v1/audio/transcriptions` endpoint. The React Native app can switch from the paid OpenAI API to this local server with a single URL change.

---

## Goals

- Run `openai/whisper-large-v3` locally on an NVIDIA GPU (CUDA, float16)
- Expose a POST endpoint matching OpenAI's `/v1/audio/transcriptions` multipart API contract
- Return SRT or JSON output so the existing `parseSrt()` app logic works unchanged
- Load the model once at startup; keep it warm in GPU memory for all requests

---

## Non-Goals

- Multi-GPU or distributed inference
- Concurrent request handling (single worker, sequential inference)
- Authentication / API keys (local dev use only)
- Diarization or speaker identification

---

## File Structure

```
backend/
  main.py            # FastAPI app, /v1/audio/transcriptions endpoint
  model.py           # HuggingFace model loading + inference
  requirements.txt   # Python dependencies
  .env.example       # Example environment variables
  README.md          # Setup and usage instructions
```

---

## API Contract

### `POST /v1/audio/transcriptions`

Matches OpenAI's endpoint so the app only needs a base URL change.

**Request** — `multipart/form-data`:

| Field             | Type   | Required | Description                                      |
|-------------------|--------|----------|--------------------------------------------------|
| `file`            | binary | yes      | Audio or video file (mp4, m4a, wav, mp3, etc.)   |
| `model`           | string | no       | Ignored — server always uses whisper-large-v3    |
| `response_format` | string | no       | `srt` \| `json` \| `text` — defaults to `json`   |
| `language`        | string | no       | ISO-639-1 language code (e.g. `en`, `ja`)        |

**Response — `response_format=srt`:**

```
1
00:00:00,000 --> 00:00:02,500
Hello world.

2
00:00:02,500 --> 00:00:05,000
This is a test.
```

**Response — `response_format=json` (default):**

```json
{ "text": "Hello world. This is a test." }
```

**Error response:**

```json
{ "error": { "message": "No audio file provided." } }
```
HTTP status codes: `400` for bad input, `500` for inference errors.

---

## Components

### `model.py`

Responsibilities:
- Load `openai/whisper-large-v3` at startup via `AutoModelForSpeechSeq2Seq` + `AutoProcessor`
- Device: `cuda`, dtype: `torch.float16`
- Expose a single `transcribe(audio_path, language=None) -> list[Segment]` function
- Each `Segment` has `start: float`, `end: float`, `text: str` (seconds)
- Uses HuggingFace `pipeline("automatic-speech-recognition", return_timestamps=True)`

### `main.py`

Responsibilities:
- FastAPI app with lifespan hook that loads the model once on startup
- `POST /v1/audio/transcriptions` handler:
  1. Validate `file` field is present
  2. Save upload to a temp file (using `tempfile.NamedTemporaryFile`)
  3. Call `model.transcribe(path, language)`
  4. Format segments as SRT or JSON based on `response_format`
  5. Delete temp file in a `finally` block
- `GET /health` — returns `{"status": "ok"}` for readiness checks

---

## Data Flow

```
React Native app
  │  POST /v1/audio/transcriptions (multipart, file + params)
  ▼
FastAPI (main.py)
  │  save to temp file
  ▼
model.py → HuggingFace pipeline → whisper-large-v3 (CUDA float16)
  │  list of {start, end, text} segments
  ▼
main.py formats → SRT string or JSON
  │
  ▼
Response → app's existing parseSrt() works unchanged
```

---

## Dependencies (`requirements.txt`)

```
fastapi
uvicorn[standard]
python-multipart
torch
transformers
accelerate
```

CUDA toolkit must be installed separately on the host machine.

---

## Configuration (`.env.example`)

```
HOST=0.0.0.0
PORT=8000
```

The server binds to `0.0.0.0:8000` by default so the Android emulator/device can reach it over the local network.

---

## SRT Formatting

Segments from HuggingFace pipeline `return_timestamps=True` provide `(start, end)` in seconds as floats. These are formatted as `HH:MM:SS,mmm` per SRT spec. Each segment becomes one SRT block.

---

## How the App Connects

The existing `src/lib/videoEditor/whisper.ts` uploads to `https://api.openai.com/v1/audio/transcriptions`. To use this backend, change that base URL to `http://<local-ip>:8000` (e.g. `http://10.0.2.2:8000` for Android emulator). No other app code changes are needed.

---

## Error Handling

- Unsupported file format: ffmpeg-style errors from HuggingFace pipeline surface as `500` with the error message
- Missing `file` field: `400` immediately, no temp file created
- CUDA out of memory: `500` with message; server remains up for next request
- Temp file always deleted in `finally` block regardless of outcome
