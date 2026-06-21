# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "faster-whisper>=1.0.0",
# ]
# ///
"""
Train Vantage watchtower - speech to text.

Transcribes a captured wav clip of a detector call into text, which parse.py
then turns into a structured detection.

Default backend is faster-whisper with the "tiny.en" model, which is small and
fast enough for short detector calls on a modest machine. The model downloads
once on first run and is cached locally.

Alternative backend: whisper.cpp. If you prefer to avoid the Python dependency,
build whisper.cpp and run:

    ./main -m models/ggml-tiny.en.bin -f clip.wav -otxt
    cat clip.wav.txt

The faster-whisper import is guarded so this file parses and imports cleanly
even when the dependency is not installed (you only need it at run time).

Usage:
  uv run transcribe.py clip.wav
  uv run transcribe.py clip.wav --model small.en
"""

import argparse
import sys


def transcribe(wav_path: str, model_name: str = "tiny.en") -> str:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "faster-whisper is not installed. Run this with `uv run transcribe.py`\n"
            "so uv installs the inline dependency, or `pip install faster-whisper`,\n"
            "or use the whisper.cpp path documented in this file's docstring.",
            file=sys.stderr,
        )
        raise

    # int8 on CPU keeps it light; switch to device='cuda' if a GPU is present.
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(wav_path, language="en", beam_size=1)
    text = " ".join(seg.text.strip() for seg in segments).strip()
    return text


def main():
    ap = argparse.ArgumentParser(description="Transcribe a detector-call wav.")
    ap.add_argument("wav", help="path to the wav clip")
    ap.add_argument("--model", default="tiny.en", help="whisper model size, e.g. tiny.en or small.en")
    args = ap.parse_args()
    text = transcribe(args.wav, args.model)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
