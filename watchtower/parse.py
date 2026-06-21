# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""
Train Vantage watchtower - detector-call parser.

This is the heart of the local pipeline and the only file that MUST be correct.
It turns the transcribed text of a wayside defect-detector radio call into a
structured detection. It uses only the Python standard library, so it runs with
plain `python parse.py` or `uv run parse.py` with no dependencies to fetch.

A typical Union Pacific detector call, once transcribed by speech-to-text, reads
something like:

    "U P detector milepost two two one point nine track one total axles 412
     speed 35 miles per hour no defects"

Speech-to-text gives us a mix of spoken-out numbers ("two two one point nine")
and digit groups ("412", "35"), in any order, with filler words. The parser is
deliberately tolerant: it scans for the milepost, track, axle count, speed, and
the defect flag wherever they appear.

Run this file directly to see it parse a batch of sample calls:

    cd watchtower
    uv run parse.py        (or: python parse.py)
"""

import re
from dataclasses import dataclass, asdict
from typing import Optional


# --- spoken-number handling -------------------------------------------------

_DIGIT_WORDS = {
    "zero": "0", "oh": "0", "o": "0",
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9",
}

# Multi-digit number words that show up in axle/speed counts when STT spells
# them out instead of giving digits.
_TENS = {
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_ONES = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9,
}


def _normalize(text: str) -> str:
    """Lowercase, collapse whitespace, strip punctuation that is not a dot."""
    t = text.lower()
    t = t.replace("-", " ")
    t = re.sub(r"[^a-z0-9. ]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _spoken_digits_to_number(tokens):
    """
    Convert a run of digit-words (and the word "point") into a numeric string.
    "two two one point nine" -> "221.9". Returns None if no digit words found.
    """
    out = []
    saw = False
    for tok in tokens:
        if tok == "point" or tok == "decimal":
            out.append(".")
            saw = True
        elif tok in _DIGIT_WORDS:
            out.append(_DIGIT_WORDS[tok])
            saw = True
        else:
            break
    if not saw:
        return None
    s = "".join(out)
    # Guard against a leading or trailing stray dot.
    if s in (".", ""):
        return None
    return s


def _words_to_int(tokens):
    """
    Convert spelled-out small integers like "twenty one" or "thirty five" or a
    single digit-word run into an int. Returns None if not parseable.
    """
    total = 0
    used = False
    i = 0
    while i < len(tokens):
        w = tokens[i]
        if w in _TENS:
            total += _TENS[w]
            used = True
            # allow "twenty" + "one"
            if i + 1 < len(tokens) and tokens[i + 1] in _ONES and _TENS[w] % 10 == 0 and _TENS[w] >= 20:
                total += _ONES[tokens[i + 1]]
                i += 1
            i += 1
        elif w in _ONES:
            total = total * 10 + _ONES[w]
            used = True
            i += 1
        else:
            break
    return total if used else None


# --- field extractors -------------------------------------------------------

def _find_milepost(text: str) -> Optional[float]:
    """
    Find the milepost. Handles:
      - "milepost 221.9" / "mp 221.9" / "milepost 221 point 9"
      - "milepost two two one point nine"
    """
    toks = text.split()
    for i, tok in enumerate(toks):
        if tok in ("milepost", "mp") or (tok == "mile" and i + 1 < len(toks) and toks[i + 1] == "post"):
            start = i + 1
            if tok == "mile":
                start = i + 2
            rest = toks[start:start + 8]

            # Case 1: a literal numeric token like "221.9".
            if rest and re.fullmatch(r"\d+(\.\d+)?", rest[0]):
                # Could be "221 point 9" too.
                if len(rest) >= 3 and rest[1] in ("point", "decimal") and re.fullmatch(r"\d+", rest[2]):
                    return float(rest[0] + "." + rest[2])
                return float(rest[0])

            # Case 2: spoken digits "two two one point nine".
            spoken = _spoken_digits_to_number(rest)
            if spoken is not None:
                try:
                    return float(spoken)
                except ValueError:
                    pass
    # Fallback: a bare "mp221.9" style token anywhere.
    m = re.search(r"\bmp\s*(\d+(?:\.\d+)?)", text)
    if m:
        return float(m.group(1))
    return None


def _find_track(text: str) -> Optional[int]:
    toks = text.split()
    for i, tok in enumerate(toks):
        if tok == "track" and i + 1 < len(toks):
            nxt = toks[i + 1]
            if re.fullmatch(r"\d+", nxt):
                return int(nxt)
            if nxt in _ONES:
                return _ONES[nxt]
            if nxt == "main" or nxt == "single":
                return 1
    return None


def _find_speed(text: str) -> Optional[int]:
    toks = text.split()
    # "speed 35", "35 miles per hour", "35 mph"
    for i, tok in enumerate(toks):
        if tok == "speed" and i + 1 < len(toks):
            nxt = toks[i + 1]
            if re.fullmatch(r"\d+", nxt):
                return int(nxt)
            val = _words_to_int(toks[i + 1:i + 4])
            if val is not None:
                return val
    m = re.search(r"(\d+)\s+(?:miles per hour|mph|mile per hour)", text)
    if m:
        return int(m.group(1))
    return None


def _find_axles(text: str) -> Optional[int]:
    toks = text.split()
    # "total axles 412", "axles 412", "412 axles"
    for i, tok in enumerate(toks):
        if tok == "axles" or tok == "axle":
            # number after
            if i + 1 < len(toks) and re.fullmatch(r"\d+", toks[i + 1]):
                return int(toks[i + 1])
            after = _words_to_int(toks[i + 1:i + 5])
            if after is not None:
                return after
            # number before ("412 axles" / "total axles 412" handled above)
            if i - 1 >= 0 and re.fullmatch(r"\d+", toks[i - 1]):
                return int(toks[i - 1])
    return None


def _find_defect(text: str) -> bool:
    """
    True if a defect / alarm / integrity failure is reported. The common
    'no defects' / 'no alarms' / 'no exceptions' phrasing means clean.
    """
    if re.search(r"\bno (?:defect|defects|alarm|alarms|exception|exceptions|problems)\b", text):
        return False
    if re.search(r"\b(?:integrity failure|defect|defects|alarm|alarms|hot box|dragging equipment|hot wheel)\b", text):
        return True
    return False


# --- public API -------------------------------------------------------------

@dataclass
class Detection:
    milepost: Optional[float]
    track: Optional[int]
    axles: Optional[int]
    speed_mph: Optional[int]
    defect: bool
    raw_text: str

    def as_dict(self):
        return asdict(self)


def parse_detector_call(raw_text: str) -> Detection:
    """Parse a transcribed detector call into a Detection."""
    norm = _normalize(raw_text)
    return Detection(
        milepost=_find_milepost(norm),
        track=_find_track(norm),
        axles=_find_axles(norm),
        speed_mph=_find_speed(norm),
        defect=_find_defect(norm),
        raw_text=raw_text.strip(),
    )


# --- self-test (runs with plain stdlib) -------------------------------------

_SAMPLES = [
    # (raw text, expected milepost, expected speed, expected axles, expected defect)
    (
        "U P detector milepost two two one point nine track one total axles 412 speed 35 miles per hour no defects",
        221.9, 35, 412, False,
    ),
    (
        "Union Pacific milepost 207.1 track 1 total axles 248 speed 28 mph no defects detector out",
        207.1, 28, 248, False,
    ),
    (
        "U P detector milepost two four zero point seven track two speed forty miles per hour total axles 380 no defects",
        240.7, 40, 380, False,
    ),
    (
        "U P detector milepost 211 point 1 track 1 axles 156 speed 22 miles per hour integrity failure repeat integrity failure",
        211.1, 22, 156, True,
    ),
    (
        "milepost one nine four point nine track one total axles 512 speed 31 miles per hour you have a defect axle 88",
        194.9, 31, 512, True,
    ),
    (
        "U P detector mp 221.9 track 1 no defects",
        221.9, None, None, False,
    ),
]


def _run_selftest():
    ok = True
    for raw, exp_mp, exp_speed, exp_axles, exp_defect in _SAMPLES:
        d = parse_detector_call(raw)
        checks = [
            ("milepost", d.milepost, exp_mp),
            ("speed_mph", d.speed_mph, exp_speed),
            ("axles", d.axles, exp_axles),
            ("defect", d.defect, exp_defect),
        ]
        line_ok = all(got == want for _, got, want in checks)
        ok = ok and line_ok
        status = "PASS" if line_ok else "FAIL"
        print("[" + status + "] " + raw)
        print("        ->", d.as_dict())
        if not line_ok:
            for name, got, want in checks:
                if got != want:
                    print("        mismatch on " + name + ": got " + repr(got) + " want " + repr(want))
        print()
    print("OVERALL:", "PASS" if ok else "FAIL")
    return ok


if __name__ == "__main__":
    import sys
    sys.exit(0 if _run_selftest() else 1)
