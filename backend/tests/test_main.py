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
