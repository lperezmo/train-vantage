# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""
Train Vantage watchtower - push a detection.

Records a parsed-and-timed detection in the detection store so the web app can
read it. Two paths are supported; pick one with environment variables.

Path A (recommended) - through the app ingest endpoint:
  Set INGEST_URL to the app's /api/ingest URL and INGEST_TOKEN to the shared
  secret (the same value as the app's INGEST_TOKEN env var). push.py POSTs the
  detection as JSON with an x-ingest-token header. The app writes to Supabase.

    export INGEST_URL="https://your-app.vercel.app/api/ingest"
    export INGEST_TOKEN="the-shared-secret"

Path B - straight to Supabase:
  Set SUPABASE_URL and SUPABASE_KEY. push.py POSTs the row directly to the
  detections table via PostgREST. Use this only if you do not want to route
  through the app.

    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_KEY="service-or-anon-key"

INERT by default: with no env set, push.py just prints the payload it would send
and exits 0, so the pipeline is safe to run end to end without a store.

Stdlib only (urllib), so no dependencies to fetch.

Usage (normally called by run.py, but standalone too):
  echo '{"detector_id":"10701","milepost":221.9}' | uv run push.py
"""

import json
import os
import sys
import urllib.request
import urllib.error


def _post_json(url: str, payload: dict, headers: dict, timeout: float = 10.0):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", "replace")


def push(detection: dict) -> bool:
    """
    Send a detection to whichever store is configured. Returns True on a write,
    False if inert (nothing configured). Raises on a real network/HTTP error.
    """
    ingest_url = os.environ.get("INGEST_URL")
    ingest_token = os.environ.get("INGEST_TOKEN")
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")

    # Path A: app ingest endpoint.
    if ingest_url and ingest_token:
        status, body = _post_json(
            ingest_url, detection, {"x-ingest-token": ingest_token}
        )
        print("ingest -> HTTP " + str(status) + " " + body)
        return 200 <= status < 300

    # Path B: direct to Supabase.
    if supabase_url and supabase_key:
        endpoint = supabase_url.rstrip("/") + "/rest/v1/detections"
        status, body = _post_json(
            endpoint,
            detection,
            {
                "apikey": supabase_key,
                "Authorization": "Bearer " + supabase_key,
                "Prefer": "return=minimal",
            },
        )
        print("supabase -> HTTP " + str(status) + " " + body)
        return 200 <= status < 300

    # Inert.
    print("push: no store configured (set INGEST_URL+INGEST_TOKEN or SUPABASE_URL+SUPABASE_KEY).")
    print("push: would have sent:")
    print(json.dumps(detection, indent=2))
    return False


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print("push: no JSON on stdin", file=sys.stderr)
        return 2
    try:
        detection = json.loads(raw)
    except json.JSONDecodeError as e:
        print("push: invalid JSON on stdin: " + str(e), file=sys.stderr)
        return 2
    try:
        push(detection)
        return 0
    except urllib.error.HTTPError as e:
        print("push: HTTP error " + str(e.code) + ": " + e.read().decode("utf-8", "replace"), file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print("push: network error: " + str(e.reason), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
