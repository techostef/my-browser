from __future__ import annotations
import os
import tempfile
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
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


@app.post("/v1/audio/transcriptions", response_model=None)
async def transcriptions(
    file: UploadFile = File(...),
    response_format: str = Form("json"),
    language: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
) -> PlainTextResponse | dict:
    _SAFE_EXTS = {".mp4", ".m4a", ".wav", ".mp3", ".webm", ".ogg", ".flac"}
    raw_ext = os.path.splitext(file.filename or "")[1].lower()
    ext = raw_ext if raw_ext in _SAFE_EXTS else ".tmp"
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=ext)
    segments: list = []
    try:
        try:
            os.write(tmp_fd, await file.read())
        finally:
            os.close(tmp_fd)
        segments = transcribe(tmp_path, language=language)
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"error": {"message": str(exc)}},
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
