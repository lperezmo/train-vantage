# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "faster-whisper>=1.0.0",
# ]
# ///
"""
Train Vantage watchtower - end-to-end glue.

Ties the pipeline together: capture -> transcribe -> parse -> eta -> push.

  capture.py     RTL-SDR on 160.410 MHz NFM -> wav clip
  transcribe.py  Whisper (tiny.en) -> text
  parse.py       text -> {milepost, track, axles, speed, defect}
  eta.py         {milepost, speed} -> direction + ETA to downtown MP 215.5
  push.py        POST the detection to the app ingest endpoint or Supabase

The recommended way to run the watchtower for real is a loop around capture.py
that hands each new clip to this script. For a quick, hardware-free check use
--mock with a sample wav (it skips the radio and runs the rest):

  uv run run.py --mock sample.wav

To exercise just the text path without Whisper, pass --text (skips capture and
transcribe and feeds the string straight into the parser):

  uv run run.py --text "U P detector milepost two two one point nine track one total axles 412 speed 35 miles per hour no defects"

Setup notes for the whole pipeline live in the individual module docstrings
(capture.py for the radio, transcribe.py for the speech model, push.py for the
store). Run individual steps with `uv run <file>.py`.
"""

import argparse
import datetime
import sys

import parse as parse_mod
import eta as eta_mod
import push as push_mod


def detection_payload(detector_id, parsed, eta_result):
    """Assemble the row shape the app/store expects."""
    return {
        "detected_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "detector_id": detector_id,
        "milepost": parsed.milepost,
        "speed_mph": parsed.speed_mph,
        "axles": parsed.axles,
        "direction": eta_result.direction,
        "defect": parsed.defect,
        "eta_downtown_min": eta_result.eta_downtown_min,
        "raw_text": parsed.raw_text,
    }


def run_from_text(text: str, detector_id: str) -> int:
    parsed = parse_mod.parse_detector_call(text)
    eta_result = eta_mod.compute(parsed.milepost, parsed.speed_mph)
    payload = detection_payload(detector_id, parsed, eta_result)
    print("parsed:", parsed.as_dict())
    print("eta:", eta_result)
    push_mod.push(payload)
    return 0


def run_from_wav(wav_path: str, detector_id: str, model: str) -> int:
    # transcribe is imported lazily so the text path needs no whisper install.
    import transcribe as transcribe_mod
    text = transcribe_mod.transcribe(wav_path, model)
    print("transcribed:", text)
    return run_from_text(text, detector_id)


def main():
    ap = argparse.ArgumentParser(description="Run the watchtower pipeline end to end.")
    ap.add_argument("--mock", help="a wav clip to transcribe instead of capturing from the radio")
    ap.add_argument("--text", help="skip capture/transcribe and parse this raw text directly")
    ap.add_argument("--detector-id", default="unknown", help="detector id this clip came from")
    ap.add_argument("--model", default="tiny.en", help="whisper model size")
    args = ap.parse_args()

    if args.text:
        return run_from_text(args.text, args.detector_id)
    if args.mock:
        return run_from_wav(args.mock, args.detector_id, args.model)

    print("Provide --mock <wav> or --text <string>. For live capture, run capture.py")
    print("in a loop and feed each clip to: uv run run.py --mock <clip>.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
