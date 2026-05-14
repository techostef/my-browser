# Whisper Large-V3 Backend

Local transcription server running `openai/whisper-large-v3` via HuggingFace. Exposes an OpenAI-compatible `/v1/audio/transcriptions` endpoint.

## Requirements

- Python 3.11+
- NVIDIA GPU with CUDA 12.x
- ~3 GB VRAM (float16)

## Setup

```bash
cd backend
# Install PyTorch with CUDA first — pick your version from https://pytorch.org/get-started/locally/
# Example for CUDA 12.1:
pip install torch --index-url https://download.pytorch.org/whl/cu121
# Then install remaining dependencies (torch already satisfied):
pip install -r requirements.txt
```

On first run, HuggingFace downloads `openai/whisper-large-v3` (~3 GB) to `~/.cache/huggingface/`.

## Run

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

Server starts on `http://0.0.0.0:8000`. Model loads at startup (~30s on first run after download).

## Connect from the React Native app

In `src/lib/videoEditor/whisper.ts`, change the upload URL from:

```
https://api.openai.com/v1/audio/transcriptions
```

to:

```
http://<your-machine-ip>:8000/v1/audio/transcriptions
```

For Android emulator, use `http://10.0.2.2:8000`.  
For a physical device on the same Wi-Fi, use your machine's local IP (e.g. `http://192.168.1.x:8000`).

Remove the `Authorization` header — the local server does not require an API key.

## API

### `POST /v1/audio/transcriptions`

Same contract as OpenAI's endpoint.

**Form fields:**
- `file` (required) — audio or video file
- `response_format` — `srt` | `json` | `text` (default: `json`)
- `language` — ISO-639-1 code, e.g. `en`, `ja` (optional)
- `model` — ignored, always uses `whisper-large-v3`

### `GET /health`

Returns `{"status": "ok"}` when the server is ready.

## Run tests

```bash
cd backend
pip install -r requirements-dev.txt
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python -m pytest tests/ -v
```
