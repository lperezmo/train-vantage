# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""
Train Vantage watchtower - radio capture.

Listens to the wayside defect-detector frequency and saves a wav clip for each
transmission. The Union Pacific La Grande Subdivision detectors broadcast their
automated voice report on 160.410 MHz, narrowband FM.

This step needs an RTL-SDR dongle and the rtl_fm + sox command-line tools. They
are not Python packages, so this script shells out to them. If they are not
installed it prints clear setup instructions and exits cleanly (it does not
crash). A --mock mode skips the radio entirely and copies a local wav clip, so
the rest of the pipeline can be tested without any hardware.

Setup (one time):
  - Install an RTL-SDR dongle and its drivers (rtl-sdr package).
    Windows: download rtl-sdr binaries (rtl_fm.exe) and add them to PATH, or
    use the zadig driver. Linux: `sudo apt install rtl-sdr sox`.
  - Verify the dongle: `rtl_test` should list it.

The capture command this script runs (documented so you can run it by hand):

  rtl_fm -f 160.410M -M fm -s 16k -l 50 -g 40 | \
      sox -t raw -r 16k -e signed -b 16 -c 1 - clip.wav silence 1 0.1 1% 1 2.0 1%

  -f 160.410M   tune the detector frequency
  -M fm         narrowband FM demodulation
  -s 16k        16 kHz sample rate (matches what Whisper wants)
  -l 50         squelch level so we only capture when a detector is talking
  -g 40         gain
  the sox 'silence' effect splits the stream into one wav per transmission.

Usage:
  uv run capture.py --mock path/to/sample.wav --out clip.wav
  uv run capture.py --out captures/      (live; needs the dongle)
"""

import argparse
import os
import shutil
import subprocess
import sys

FREQUENCY = "160.410M"


def have(tool: str) -> bool:
    return shutil.which(tool) is not None


def print_setup_instructions():
    print("Radio capture tools are not installed.")
    print()
    print("This step needs an RTL-SDR dongle plus the rtl_fm and sox tools:")
    print("  Linux:   sudo apt install rtl-sdr sox")
    print("  Windows: install rtl-sdr (rtl_fm.exe) and sox, add both to PATH")
    print()
    print("Verify the dongle with: rtl_test")
    print()
    print("To test the rest of the pipeline without hardware, use --mock:")
    print("  uv run capture.py --mock sample.wav --out clip.wav")


def capture_mock(src: str, out: str) -> str:
    if not os.path.isfile(src):
        print("Mock source wav not found: " + src)
        sys.exit(2)
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    shutil.copyfile(src, out)
    print("Mock capture: copied " + src + " -> " + out)
    return out


def capture_live(out: str) -> int:
    if not (have("rtl_fm") and have("sox")):
        print_setup_instructions()
        return 1

    os.makedirs(out if out.endswith(("/", "\\")) else os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    target = os.path.join(out, "clip.wav") if os.path.isdir(out) else out

    # rtl_fm piped into sox; sox 'silence' splits transmissions into clips.
    rtl_cmd = [
        "rtl_fm", "-f", FREQUENCY, "-M", "fm", "-s", "16k", "-l", "50", "-g", "40",
    ]
    sox_cmd = [
        "sox", "-t", "raw", "-r", "16k", "-e", "signed", "-b", "16", "-c", "1",
        "-", target, "silence", "1", "0.1", "1%", "1", "2.0", "1%",
    ]
    print("Listening on " + FREQUENCY + " NFM, squelched. Ctrl-C to stop.")
    print("  " + " ".join(rtl_cmd) + " | " + " ".join(sox_cmd))
    try:
        rtl = subprocess.Popen(rtl_cmd, stdout=subprocess.PIPE)
        sox = subprocess.Popen(sox_cmd, stdin=rtl.stdout)
        if rtl.stdout:
            rtl.stdout.close()
        sox.communicate()
        return sox.returncode or 0
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0
    except FileNotFoundError:
        print_setup_instructions()
        return 1


def main():
    ap = argparse.ArgumentParser(description="Capture wayside detector audio.")
    ap.add_argument("--mock", help="path to a local wav clip to use instead of the radio")
    ap.add_argument("--out", default="clip.wav", help="output wav file or directory")
    args = ap.parse_args()

    if args.mock:
        capture_mock(args.mock, args.out)
        return 0
    return capture_live(args.out)


if __name__ == "__main__":
    sys.exit(main())
