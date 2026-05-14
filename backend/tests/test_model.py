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
