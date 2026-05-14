from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Optional
import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline as hf_pipeline


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


_pipe: Optional[Any] = None
_MODEL_ID = "openai/whisper-large-v3"


def load_model() -> None:
    global _pipe
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available. This server requires an NVIDIA GPU.")
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
    if _pipe is None:
        raise RuntimeError("Model not loaded. Call load_model() first.")
    generate_kwargs: dict[str, Any] = {"return_timestamps": True}
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
