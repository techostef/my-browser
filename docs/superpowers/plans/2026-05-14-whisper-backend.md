# Whisper Large-V3 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a FastAPI backend in `backend/` that runs `openai/whisper-large-v3` on CUDA and exposes an OpenAI-compatible `/v1/audio/transcriptions` endpoint.

**Architecture:** FastAPI app loads the HuggingFace Whisper large-v3 model once at startup into GPU memory (float16/CUDA). A single `POST /v1/audio/transcriptions` endpoint accepts multipart uploads, writes to a temp file, runs inference, and returns SRT or JSON. Sequential inference (no concurrency).

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, PyTorch (CUDA), HuggingFace `transformers`, `accelerate`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/requirements.txt` | Create | Runtime + dev dependencies |
| `backend/.env.example` | Create | Environment variable template |
| `backend/model.py` | Create | Model load, inference, SRT formatting |
| `backend/main.py` | Create | FastAPI app, endpoint handler |
| `backend/tests/__init__.py` | Create | Make tests a package |
| `backend/tests/test_model.py` | Create | Unit tests for SRT formatting + transcribe |
| `backend/tests/test_main.py` | Create | Integration tests for HTTP endpoint |
| `backend/README.md` | Create | Setup and usage docs |

---

## Task 1: Project scaffold

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/requirements-dev.txt`
- Create: `backend/.env.example`
- Create: `backend/tests/__init__.py`

- [ ] **Step 1: Create `backend/requirements.txt`**

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
python-multipart>=0.0.12
torch>=2.4.0
transformers>=4.45.0
accelerate>=1.0.0
```

- [ ] **Step 2: Create `backend/requirements-dev.txt`**

```
pytest>=8.0.0
httpx>=0.27.0
```

- [ ] **Step 3: Create `backend/.env.example`**

```
HOST=0.0.0.0
PORT=8000
```

- [ ] **Step 4: Create `backend/tests/__init__.py`**

Empty file — makes `backend/tests/` a Python package so pytest discovers tests correctly.

```python
```

- [ ] **Step 5: Commit scaffold**

```bash
git add backend/requirements.txt backend/requirements-dev.txt backend/.env.example backend/tests/__init__.py
git commit -m "chore: scaffold whisper backend project"
```

---

## Task 2: SRT formatting utilities (TDD)

**Files:**
- Create: `backend/model.py` (partial — data types + formatting only)
- Create: `backend/tests/test_model.py` (formatting tests only)

- [ ] **Step 1: Write failing tests for `_seconds_to_srt_time` and `segments_to_srt`**

Create `backend/tests/test_model.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from model import Segment, _seconds_to_srt_time, segments_to_srt


def test_seconds_to_srt_time_zero():
    assert _seconds_to_srt_time(0.0) == "00:00:00,000"


def test_seconds_to_srt_time_simple():
    assert _seconds_to_srt_time(62.5) == "00:01:02,500"


def test_seconds_to_srt_time_hours():
    assert _seconds_to_srt_time(3661.001) == "01:01:01,001"


def test_segments_to_srt_single():
    segs = [Segment(start=0.0, end=2.5, text="Hello world.")]
    result = segments_to_srt(segs)
    assert result == (
        "1\n"
        "00:00:00,000 --> 00:00:02,500\n"
        "Hello world."
    )


def test_segments_to_srt_multiple():
    segs = [
        Segment(start=0.0, end=2.0, text="First."),
        Segment(start=2.0, end=4.5, text="Second."),
    ]
    result = segments_to_srt(segs)
    assert result == (
        "1\n"
        "00:00:00,000 --> 00:00:02,000\n"
        "First.\n\n"
        "2\n"
        "00:00:02,000 --> 00:00:04,500\n"
        "Second."
    )


def test_segments_to_srt_empty():
    assert segments_to_srt([]) == ""
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python -m pytest tests/test_model.py -v
```

Expected: `ImportError` or `ModuleNotFoundError` — `model.py` does not exist yet.

- [ ] **Step 3: Create `backend/model.py` with data types and formatting (no model loading yet)**

```python
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class Segment:
    start: float
    end: float
    text: str


def _seconds_to_srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    secs, ms = divmod(ms, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def segments_to_srt(segments: list[Segment]) -> str:
    if not segments:
        return ""
    blocks: list[str] = []
    for i, seg in enumerate(segments, 1):
        blocks.append(
            f"{i}\n"
            f"{_seconds_to_srt_time(seg.start)} --> {_seconds_to_srt_time(seg.end)}\n"
            f"{seg.text}"
        )
    return "\n\n".join(blocks)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
python -m pytest tests/test_model.py -v
```

Expected output:
```
tests/test_model.py::test_seconds_to_srt_time_zero PASSED
tests/test_model.py::test_seconds_to_srt_time_simple PASSED
tests/test_model.py::test_seconds_to_srt_time_hours PASSED
tests/test_model.py::test_segments_to_srt_single PASSED
tests/test_model.py::test_segments_to_srt_multiple PASSED
tests/test_model.py::test_segments_to_srt_empty PASSED
6 passed
```

- [ ] **Step 5: Commit**

```bash
git add backend/model.py backend/tests/test_model.py
git commit -m "feat: add Segment type and SRT formatting utilities"
```

---

## Task 3: Model loading and transcription (TDD)

**Files:**
- Modify: `backend/model.py` — add `load_model()` and `transcribe()`
- Modify: `backend/tests/test_model.py` — add transcribe tests

- [ ] **Step 1: Add failing tests for `transcribe` to `backend/tests/test_model.py`**

Append to the existing file:

```python
from unittest.mock import MagicMock, patch


def test_transcribe_returns_segments():
    mock_result = {
        "chunks": [
            {"timestamp": (0.0, 2.5), "text": " Hello world."},
            {"timestamp": (2.5, 5.0), "text": " Second line."},
        ]
    }
    mock_pipe = MagicMock(return_value=mock_result)

    import model as m
    m._pipe = mock_pipe

    segs = m.transcribe("fake_path.wav")
    assert len(segs) == 2
    assert segs[0].start == 0.0
    assert segs[0].end == 2.5
    assert segs[0].text == "Hello world."
    assert segs[1].start == 2.5
    assert segs[1].text == "Second line."


def test_transcribe_skips_empty_text():
    mock_result = {
        "chunks": [
            {"timestamp": (0.0, 1.0), "text": "   "},
            {"timestamp": (1.0, 3.0), "text": " Real text."},
        ]
    }
    mock_pipe = MagicMock(return_value=mock_result)

    import model as m
    m._pipe = mock_pipe

    segs = m.transcribe("fake_path.wav")
    assert len(segs) == 1
    assert segs[0].text == "Real text."


def test_transcribe_passes_language():
    mock_pipe = MagicMock(return_value={"chunks": []})

    import model as m
    m._pipe = mock_pipe

    m.transcribe("fake_path.wav", language="ja")
    call_kwargs = mock_pipe.call_args
    assert call_kwargs[1]["generate_kwargs"]["language"] == "ja"


def test_transcribe_no_language_omits_key():
    mock_pipe = MagicMock(return_value={"chunks": []})

    import model as m
    m._pipe = mock_pipe

    m.transcribe("fake_path.wav", language=None)
    call_kwargs = mock_pipe.call_args
    assert "language" not in call_kwargs[1]["generate_kwargs"]
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
cd backend
python -m pytest tests/test_model.py::test_transcribe_returns_segments -v
```

Expected: `AttributeError` — `_pipe` and `transcribe` not defined yet.

- [ ] **Step 3: Add `load_model` and `transcribe` to `backend/model.py`**

Append to the existing `backend/model.py`:

```python
from typing import Optional
import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline as hf_pipeline

_pipe = None
_MODEL_ID = "openai/whisper-large-v3"


def load_model() -> None:
    global _pipe
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        _MODEL_ID,
        torch_dtype=torch.float16,
        low_cpu_mem_usage=True,
    )
    model.to("cuda")
    processor = AutoProcessor.from_pretrained(_MODEL_ID)
    _pipe = hf_pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        torch_dtype=torch.float16,
        device="cuda",
    )


def transcribe(audio_path: str, language: Optional[str] = None) -> list[Segment]:
    generate_kwargs: dict = {"return_timestamps": True}
    if language:
        generate_kwargs["language"] = language
    result = _pipe(audio_path, generate_kwargs=generate_kwargs)
    segments: list[Segment] = []
    for chunk in result.get("chunks", []):
        ts = chunk.get("timestamp", (0.0, 0.0))
        start = ts[0] if ts[0] is not None else 0.0
        end = ts[1] if ts[1] is not None else start
        text = chunk.get("text", "").strip()
        if text:
            segments.append(Segment(start=start, end=end, text=text))
    return segments
```

- [ ] **Step 4: Run all model tests to verify they pass**

```bash
cd backend
python -m pytest tests/test_model.py -v
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/model.py backend/tests/test_model.py
git commit -m "feat: add whisper model loading and transcription"
```

---

## Task 4: FastAPI app and endpoint (TDD)

**Files:**
- Create: `backend/main.py`
- Create: `backend/tests/test_main.py`

- [ ] **Step 1: Write failing tests in `backend/tests/test_main.py`**

```python
import io
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


# Patch load_model at import time so no GPU is required during tests
with patch("model.load_model"):
    from main import app

client = TestClient(app)


def _fake_segments():
    from model import Segment
    return [
        Segment(start=0.0, end=2.5, text="Hello world."),
        Segment(start=2.5, end=5.0, text="Second line."),
    ]


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_transcription_returns_json_by_default():
    with patch("main.transcribe", return_value=_fake_segments()):
        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("audio.mp4", io.BytesIO(b"fake"), "audio/mp4")},
        )
    assert response.status_code == 200
    assert response.json() == {"text": "Hello world. Second line."}


def test_transcription_returns_srt():
    with patch("main.transcribe", return_value=_fake_segments()):
        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("audio.mp4", io.BytesIO(b"fake"), "audio/mp4")},
            data={"response_format": "srt"},
        )
    assert response.status_code == 200
    assert "00:00:00,000 --> 00:00:02,500" in response.text
    assert "Hello world." in response.text


def test_transcription_returns_text():
    with patch("main.transcribe", return_value=_fake_segments()):
        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("audio.mp4", io.BytesIO(b"fake"), "audio/mp4")},
            data={"response_format": "text"},
        )
    assert response.status_code == 200
    assert response.text == "Hello world. Second line."


def test_transcription_missing_file_returns_422():
    response = client.post("/v1/audio/transcriptions", data={"model": "whisper-1"})
    assert response.status_code == 422


def test_transcription_passes_language():
    with patch("main.transcribe", return_value=[]) as mock_t:
        client.post(
            "/v1/audio/transcriptions",
            files={"file": ("audio.mp4", io.BytesIO(b"fake"), "audio/mp4")},
            data={"language": "ja"},
        )
        _, kwargs = mock_t.call_args
        assert kwargs.get("language") == "ja"


def test_transcription_inference_error_returns_500():
    with patch("main.transcribe", side_effect=RuntimeError("CUDA OOM")):
        response = client.post(
            "/v1/audio/transcriptions",
            files={"file": ("audio.mp4", io.BytesIO(b"fake"), "audio/mp4")},
        )
    assert response.status_code == 500
    assert "CUDA OOM" in response.json()["error"]["message"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python -m pytest tests/test_main.py -v
```

Expected: `ModuleNotFoundError` — `main.py` does not exist yet.

- [ ] **Step 3: Create `backend/main.py`**

```python
from __future__ import annotations
import os
import tempfile
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

import model as _model
from model import transcribe, segments_to_srt


@asynccontextmanager
async def lifespan(app: FastAPI):
    _model.load_model()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    response_format: str = Form("json"),
    language: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
) -> PlainTextResponse | dict:
    ext = os.path.splitext(file.filename or "audio")[1] or ".tmp"
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=ext)
    try:
        os.write(tmp_fd, await file.read())
        os.close(tmp_fd)
        segments = transcribe(tmp_path, language=language)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc)}},
        )
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass

    if response_format == "srt":
        return PlainTextResponse(segments_to_srt(segments))
    if response_format == "text":
        return PlainTextResponse(" ".join(s.text for s in segments))
    return {"text": " ".join(s.text for s in segments)}
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
cd backend
python -m pytest tests/ -v
```

Expected: all tests pass. If you see an import error about `torch` or `transformers` not installed, install dev dependencies first:

```bash
pip install -r requirements-dev.txt
# For tests only (no GPU needed), also install:
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install transformers accelerate
```

Then rerun pytest.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_main.py
git commit -m "feat: add FastAPI app with /v1/audio/transcriptions endpoint"
```

---

## Task 5: README

**Files:**
- Create: `backend/README.md`

- [ ] **Step 1: Create `backend/README.md`**

```markdown
# Whisper Large-V3 Backend

Local transcription server running `openai/whisper-large-v3` via HuggingFace. Exposes an OpenAI-compatible `/v1/audio/transcriptions` endpoint.

## Requirements

- Python 3.11+
- NVIDIA GPU with CUDA 12.x
- ~3 GB VRAM (float16)

## Setup

```bash
cd backend
pip install -r requirements.txt
# Install PyTorch with CUDA — pick your CUDA version from https://pytorch.org/get-started/locally/
# Example for CUDA 12.1:
pip install torch --index-url https://download.pytorch.org/whl/cu121
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
pip install transformers accelerate
python -m pytest tests/ -v
```
```

- [ ] **Step 2: Commit**

```bash
git add backend/README.md
git commit -m "docs: add backend README with setup and usage instructions"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|-----------------|------|
| `backend/` directory with 5 files | Task 1, 2, 3, 4, 5 |
| `openai/whisper-large-v3` via HuggingFace pipeline | Task 3 |
| CUDA float16 | Task 3 (`load_model`) |
| Load once at startup | Task 4 (`lifespan`) |
| `POST /v1/audio/transcriptions` multipart | Task 4 |
| `file`, `model`, `response_format`, `language` fields | Task 4 |
| SRT response | Task 2 + 4 |
| JSON response `{"text": "..."}` | Task 4 |
| Text response | Task 4 |
| `GET /health` | Task 4 |
| 400/422 for missing file | Task 4 (FastAPI handles 422 automatically) |
| 500 for inference errors with `{"error": {"message": ...}}` | Task 4 |
| Temp file always deleted | Task 4 (`finally` block) |
| README with setup, run, connection instructions | Task 5 |

All requirements covered. ✓
