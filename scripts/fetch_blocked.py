# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""
Fetch FRA Blocked Crossing Incident Reporter data for Pendleton/Umatilla County, OR
and shape it into public/data/blocked.json.

Usage:
  uv run scripts/fetch_blocked.py

The FRA exposes incidents through a reverse-proxy at:
  https://www.fra.dot.gov/blockedcrossings/api/incidents
which proxies to backend-bcir.fra.dot.gov. No API key required.
Filters: city=Pendleton + county backstop for Umatilla, OR.
"""

import json
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE_URL = "https://www.fra.dot.gov/blockedcrossings/api/incidents"
OUT_PATH = Path(__file__).parent.parent / "public" / "data" / "blocked.json"
PAGE_SIZE = 100
BBOX = {"lat_min": 45.55, "lat_max": 45.75, "lng_min": -119.0, "lng_max": -118.5}

DURATION_MAP = {
    "0-15 minutes": 7.5,
    "16-30 minutes": 23,
    "31-60 minutes": 45,
    "1-2 hours": 90,
    "2-6 hours": 240,
    "6-8 hours": 420,
    ">8 hours": 600,
    "less than 5 minutes": 2.5,
}


def fetch_pages(params_extra: dict) -> list:
    all_items = []
    page = 1
    while True:
        params = {
            "pageSize": PAGE_SIZE,
            "page": page,
            **params_extra,
        }
        resp = requests.get(BASE_URL, params=params, timeout=30, verify=False)
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items", [])
        all_items.extend(items)
        total = data.get("totalIncidents", 0)
        print(f"  page {page}: {len(items)} items (total={total}, fetched={len(all_items)})")
        if len(all_items) >= total or not items:
            break
        page += 1
        time.sleep(0.25)
    return all_items


def in_bbox(r: dict) -> bool:
    lat, lng = r.get("latitude"), r.get("longitude")
    if lat is None or lng is None:
        return False
    return (
        BBOX["lat_min"] <= float(lat) <= BBOX["lat_max"]
        and BBOX["lng_min"] <= float(lng) <= BBOX["lng_max"]
    )


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
    except Exception:
        return None


def parse_duration_min(s: str | None) -> float | None:
    if not s:
        return None
    return DURATION_MAP.get(s.strip())


def dur_bucket(mins: float | None) -> str:
    if mins is None:
        return "unknown"
    if mins < 10:
        return "<10 min"
    if mins < 30:
        return "10-30 min"
    if mins < 60:
        return "30-60 min"
    if mins < 120:
        return "1-2 hr"
    if mins < 360:
        return "2-6 hr"
    return ">6 hr"


def build_aggregates(rows: list) -> dict:
    dts = [parse_dt(r.get("dateTime")) for r in rows]
    valid_dts = [d for d in dts if d is not None]

    min_date = min(valid_dts).date().isoformat() if valid_dts else None
    max_date = max(valid_dts).date().isoformat() if valid_dts else None

    if min_date and max_date:
        d0 = datetime.strptime(min_date, "%Y-%m-%d")
        d1 = datetime.strptime(max_date, "%Y-%m-%d")
        obs_days = max(1, (d1 - d0).days + 1)
    else:
        obs_days = 1

    by_crossing: dict = defaultdict(lambda: {"count": 0, "street": "", "lat": None, "lng": None})
    by_hour = [0] * 24
    by_dow = [0] * 7
    by_month = [0] * 12
    dur_buckets: dict = defaultdict(int)
    reasons: dict = defaultdict(int)
    hour_dow_heat = [[0] * 24 for _ in range(7)]

    for i, r in enumerate(rows):
        cid = r.get("crossingID", "UNKNOWN")
        bc = by_crossing[cid]
        bc["count"] += 1
        if r.get("street"):
            bc["street"] = r["street"]
        if r.get("latitude"):
            bc["lat"] = r["latitude"]
        if r.get("longitude"):
            bc["lng"] = r["longitude"]

        dt = dts[i]
        if dt:
            by_hour[dt.hour] += 1
            by_dow[dt.weekday()] += 1
            by_month[dt.month - 1] += 1
            hour_dow_heat[dt.weekday()][dt.hour] += 1

        mins = parse_duration_min(r.get("duration", ""))
        dur_buckets[dur_bucket(mins)] += 1
        reasons[r.get("reason", "Unknown")] += 1

    predictive_by_hour = [
        {"hour": h, "prob": round(min(1.0, by_hour[h] / obs_days), 5)}
        for h in range(24)
    ]

    sorted_rows = sorted(rows, key=lambda r: r.get("dateTime", ""), reverse=True)
    recent_50 = [
        {
            "crossingID": r.get("crossingID"),
            "street": r.get("street"),
            "dateTime": r.get("dateTime"),
            "duration": r.get("duration"),
            "reason": r.get("reason"),
            "lat": r.get("latitude"),
            "lng": r.get("longitude"),
            "city": r.get("city"),
        }
        for r in sorted_rows[:50]
    ]

    by_crossing_list = sorted(
        [
            {"crossing_id": k, "street": v["street"], "lat": v["lat"], "lng": v["lng"], "count": v["count"]}
            for k, v in by_crossing.items()
        ],
        key=lambda x: -x["count"],
    )

    dur_order = ["<10 min", "10-30 min", "30-60 min", "1-2 hr", "2-6 hr", ">6 hr", "unknown"]
    dur_buckets_list = [{"label": l, "count": dur_buckets.get(l, 0)} for l in dur_order if l in dur_buckets]
    reasons_list = sorted(
        [{"reason": k, "count": v} for k, v in reasons.items()], key=lambda x: -x["count"]
    )

    heat_flat = []
    for dow in range(7):
        heat_flat.extend(hour_dow_heat[dow])

    return {
        "available": True,
        "reason": None,
        "source_url": BASE_URL,
        "source_backend": "https://backend-bcir.fra.dot.gov/api/incidents",
        "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "row_count": len(rows),
        "date_span": {"min": min_date, "max": max_date},
        "obs_days": obs_days,
        "filter": "county=UMATILLA, state=OR, bbox lat 45.55-45.75 lng -119.0 to -118.5",
        "by_crossing": by_crossing_list,
        "by_hour": by_hour,
        "by_dow": {"values": by_dow, "convention": "0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun"},
        "by_month": {"values": by_month, "convention": "0=Jan 1=Feb ... 11=Dec"},
        "duration_buckets": dur_buckets_list,
        "reasons": reasons_list,
        "hour_dow_heat": {
            "dims": "7x24 flat row-major, index=dow*24+hour, 0=Mon..6=Sun",
            "values": heat_flat,
        },
        "predictive": {
            "method": (
                "Historical frequency estimate. prob = incidents_in_hour / observation_days, "
                "capped at 1. NOT a live prediction. Based on public reports from FRA "
                "Blocked Crossing Incident Reporter."
            ),
            "by_hour": predictive_by_hour,
            "obs_days": obs_days,
            "date_span": {"min": min_date, "max": max_date},
            "total_incidents": len(rows),
        },
        "recent": recent_50,
    }


def main():
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    print("Fetching Pendleton city incidents...")
    pendleton = fetch_pages({"city": "Pendleton", "state": "OR"})

    print("Fetching Cayuse/Umatilla UP incidents...")
    cayuse = fetch_pages({"city": "CAYUSE", "state": "OR", "railroad": "UP"})

    # Combine and deduplicate
    all_rows = pendleton + cayuse
    seen: set = set()
    deduped = []
    for r in all_rows:
        key = (r.get("crossingID", ""), r.get("dateTime", ""))
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    # Filter to Umatilla county OR + bbox backstop
    rows = [
        r for r in deduped
        if r.get("county", "").upper() == "UMATILLA"
        and r.get("state", "").upper() == "OR"
        and in_bbox(r)
    ]

    # Add any extra UP bbox rows not caught by county filter
    extra = [r for r in deduped if r not in rows and r.get("railroad", "") == "UP" and in_bbox(r)]
    rows = rows + extra

    # Final dedup
    seen2: set = set()
    final = []
    for r in rows:
        key = (r.get("crossingID", ""), r.get("dateTime", ""))
        if key not in seen2:
            seen2.add(key)
            final.append(r)

    print(f"\nFiltered to {len(final)} Pendleton/Umatilla rows")

    if not final:
        out = {
            "available": False,
            "reason": "No incidents found for Umatilla County, OR after filtering",
            "source_url": BASE_URL,
            "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "row_count": 0,
            "by_crossing": [],
            "by_hour": [0] * 24,
            "by_dow": {"values": [0] * 7, "convention": "0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun"},
            "by_month": {"values": [0] * 12, "convention": "0=Jan ... 11=Dec"},
            "duration_buckets": [],
            "reasons": [],
            "hour_dow_heat": {"dims": "7x24 flat row-major", "values": [0] * 168},
            "predictive": {"method": "No data", "by_hour": [], "obs_days": 0},
            "recent": [],
        }
    else:
        out = build_aggregates(final)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    print(f"Wrote {OUT_PATH}")
    print(f"  row_count={out['row_count']}")
    if out["available"]:
        print(f"  date_span={out['date_span']}")
        print(f"  top crossing: {out['by_crossing'][0] if out['by_crossing'] else 'none'}")


if __name__ == "__main__":
    main()
