# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""
Fetch and shape geographic data files for Train Vantage (Pendleton, OR):
  - public/data/crossings.json  (FRA NTAD Railroad Grade Crossings, UP only)
  - public/data/railline.json   (OSM rail ways via Overpass)
  - public/data/mileposts.json  (NTAD Rail Mileposts, La Grande subdivision)
  - public/data/detectors.json  (UP La Grande defect detectors, baked from source)

Usage:
  uv run scripts/fetch_geo.py

All endpoints are keyless public APIs.
"""

import json
import urllib.parse
from pathlib import Path

import requests

SCRATCHPAD = None  # Set to a path string to override detector source location

# Pendleton bounding box
BBOX = "-118.8819,45.6397,-118.7498,45.7111"
BBOX_DICT = {"west": -118.8819, "south": 45.6397, "east": -118.7498, "north": 45.7111}
ARCGIS_BASE = "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services"

OUT_DIR = Path(__file__).parent.parent / "public" / "data"

DOWNTOWN_MP = 215.5
KEY_DETECTOR_IDS = {"10700", "10701", "10702", "10703", "10704"}
HEADS_UP = {
    "10701": {"distance_mi": 6.4, "direction_text": "westbound, approaching from west"},
    "10702": {"distance_mi": 4.4, "direction_text": "eastbound, approaching from east"},
    "10703": {"distance_mi": 8.4, "direction_text": "eastbound, approaching from east"},
    "10704": {"distance_mi": 20.6, "direction_text": "eastbound, approaching from east"},
    "10700": {"distance_mi": 25.2, "direction_text": "westbound, approaching from west"},
}

# Embedded detector data (24 UP La Grande Subdivision detectors)
# Source: AAR/UP detector directory, La Grande Subdivision
DETECTOR_DATA = [
    {"milepost": 188.6, "location": "Stanfield", "lat": 45.781667, "lng": -119.224959, "frequency": "160.4100", "functions": "DED", "detector_id": "10705"},
    {"milepost": 194.9, "location": "Echo", "lat": 45.713197, "lng": -119.156191, "frequency": "160.4100", "functions": "DED-HBD-HWD", "detector_id": "10704"},
    {"milepost": 207.1, "location": "Rieth", "lat": 45.653688, "lng": -118.948957, "frequency": "160.4100", "functions": "DED-HBD", "detector_id": "10703"},
    {"milepost": 211.1, "location": "Rieth", "lat": 45.658782, "lng": -118.875005, "frequency": "160.4100", "functions": "DED", "detector_id": "10702"},
    {"milepost": 221.9, "location": "Mission", "lat": 45.669442, "lng": -118.66406, "frequency": "160.4100", "functions": "DED-HBD", "detector_id": "10701"},
    {"milepost": 240.7, "location": "Bonifer", "lat": 45.662717, "lng": -118.363887, "frequency": "160.4100", "functions": "DED", "detector_id": "10700"},
    {"milepost": 243.7, "location": "Bonifer", "lat": 45.620754, "lng": -118.353871, "frequency": "160.4100", "functions": "DED-HBD", "detector_id": "10699"},
    {"milepost": 251.4, "location": "Duncan", "lat": 45.523604, "lng": -118.286507, "frequency": "160.4100", "functions": "DED", "detector_id": "10698"},
    {"milepost": 252.4, "location": "Camp", "lat": 45.510555, "lng": -118.28117, "frequency": "160.4100", "functions": "DED", "detector_id": "10697"},
    {"milepost": 253.7, "location": "Camp", "lat": 45.492687, "lng": -118.278262, "frequency": "160.4100", "functions": "DED", "detector_id": "10696"},
    {"milepost": 255.8, "location": "Camp", "lat": 45.478796, "lng": -118.301302, "frequency": "160.4100", "functions": "DED", "detector_id": "10695"},
    {"milepost": 256.8, "location": "Camp", "lat": 45.485652, "lng": -118.31855, "frequency": "160.4100", "functions": "DED", "detector_id": "10694"},
    {"milepost": 259.8, "location": "Meacham", "lat": 45.521134, "lng": -118.343356, "frequency": "160.4100", "functions": "DED", "detector_id": "10693"},
    {"milepost": 260.9, "location": "Meacham", "lat": 45.532644, "lng": -118.35608, "frequency": "160.4100", "functions": "DED", "detector_id": "10692"},
    {"milepost": 262.1, "location": "Meacham", "lat": 45.525679, "lng": -118.378856, "frequency": "160.4100", "functions": "DED", "detector_id": "10691"},
    {"milepost": 264.0, "location": "Meacham", "lat": 45.516285, "lng": -118.405202, "frequency": "160.4100", "functions": "DED", "detector_id": "10690"},
    {"milepost": 269.1, "location": "Kamela", "lat": 45.457535, "lng": -118.417784, "frequency": "160.4100", "functions": "DED", "detector_id": "10689"},
    {"milepost": 270.2, "location": "Kamela", "lat": 45.44365, "lng": -118.404276, "frequency": "160.4100", "functions": "DED", "detector_id": "10684"},
    {"milepost": 273.3, "location": "Nordeen", "lat": 45.411274, "lng": -118.364857, "frequency": "160.4100", "functions": "DED", "detector_id": "10683"},
    {"milepost": 276.3, "location": "Motanic", "lat": 45.37705, "lng": -118.331807, "frequency": "160.4100", "functions": "DED", "detector_id": "10682"},
    {"milepost": 278.8, "location": "Motanic", "lat": 45.371965, "lng": -118.288257, "frequency": "160.4100", "functions": "DED", "detector_id": "10681"},
    {"milepost": 280.3, "location": "Railroad Canyon", "lat": 45.364947, "lng": -118.260924, "frequency": "160.4100", "functions": "DED", "detector_id": "10680"},
    {"milepost": 284.4, "location": "Perry", "lat": 45.354865, "lng": -118.190358, "frequency": "160.4100", "functions": "DED", "detector_id": "10679"},
    {"milepost": 289.1, "location": "La Grande", "lat": 45.34057, "lng": -118.110689, "frequency": "160.4100", "functions": "DED", "detector_id": "10678"},
]


def arcgis_query(service: str, layer: int = 0, extra_params: dict | None = None) -> dict:
    url = f"{ARCGIS_BASE}/{service}/FeatureServer/{layer}/query"
    params = {
        "f": "json",
        "where": "1=1",
        "outFields": "*",
        "geometry": BBOX,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "resultRecordCount": 500,
    }
    if extra_params:
        params.update(extra_params)
    resp = requests.get(url, params=params, timeout=60)
    resp.raise_for_status()
    return resp.json()


def is_downtown(lat: float, lng: float) -> bool:
    return (45.664 <= lat <= 45.676) and (-118.81 <= lng <= -118.775)


def build_crossings() -> dict:
    print("Fetching NTAD Railroad Grade Crossings...")
    data = arcgis_query("NTAD_Railroad_Grade_Crossings")
    features = data.get("features", [])
    up = [f for f in features if f["attributes"].get("RAILROAD") == "UP"]
    print(f"  {len(features)} total, {len(up)} UP")

    crossings = []
    for feat in up:
        a = feat["attributes"]
        lat = a.get("LATDD")
        lng = a.get("LONGDD")
        if lat is None or lng is None:
            continue
        lat, lng = float(lat), float(lng)
        pos_raw = (a.get("POSXING") or "").strip().lower()
        if "under" in pos_raw:
            position = "grade-separated-under"
        elif "over" in pos_raw:
            position = "grade-separated-over"
        elif "at grade" in pos_raw:
            position = "at-grade"
        else:
            position = pos_raw or "unknown"
        crossings.append({
            "id": a.get("CROSSING"),
            "street": (a.get("STREET") or "").strip(),
            "lat": lat,
            "lng": lng,
            "railroad": "UP",
            "position": position,
            "type": (a.get("TYPEXING") or "").strip().lower(),
            "downtown": is_downtown(lat, lng) and position == "at-grade",
            "milepost": a.get("MILEPOST"),
            "subdivision": (a.get("RRSUBDIV") or "").strip(),
        })

    crossings.sort(key=lambda c: c["lng"], reverse=True)
    return {
        "type": "FeatureCollection",
        "source": "NTAD Railroad Grade Crossings FeatureServer (ArcGIS), UP only, Pendleton bbox",
        "source_url": f"{ARCGIS_BASE}/NTAD_Railroad_Grade_Crossings/FeatureServer/0",
        "count": len(crossings),
        "features": crossings,
    }


def build_railline() -> dict:
    print("Fetching rail lines from Overpass (maps.mail.ru mirror)...")
    query = (
        "[out:json][timeout:25];"
        "(way[\"railway\"=\"rail\"]"
        f"({BBOX_DICT['south']},{BBOX_DICT['west']},{BBOX_DICT['north']},{BBOX_DICT['east']});"
        ");out geom;"
    )
    resp = requests.post(
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        data={"data": query},
        timeout=60,
    )
    resp.raise_for_status()
    elements = resp.json().get("elements", [])
    print(f"  {len(elements)} OSM way elements")

    way_features = []
    for e in elements:
        if e["type"] != "way":
            continue
        geom = e.get("geometry", [])
        if len(geom) < 2:
            continue
        tags = e.get("tags", {})
        way_features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[pt["lon"], pt["lat"]] for pt in geom]},
            "properties": {
                "id": e["id"],
                "name": tags.get("name", ""),
                "operator": tags.get("operator", ""),
                "service": tags.get("service", ""),
                "railway": tags.get("railway", "rail"),
                "maxspeed": tags.get("maxspeed", ""),
            },
        })

    return {
        "type": "FeatureCollection",
        "source": "OpenStreetMap via Overpass API (maps.mail.ru mirror)",
        "query": "way[railway=rail](bbox Pendleton)",
        "feature_count": len(way_features),
        "features": way_features,
    }


def build_mileposts() -> dict:
    print("Fetching NTAD Rail Mileposts...")
    data = arcgis_query("NTAD_Rail_Mileposts")
    features = data.get("features", [])
    print(f"  {len(features)} milepost features in bbox")

    mp_features = []
    for feat in features:
        a = feat["attributes"]
        lat, lon = a.get("LAT"), a.get("LON")
        if lat is None or lon is None:
            continue
        mp_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            "properties": {
                "milepost": a.get("MILEPOST"),
                "subdivision": a.get("SUBDIV", ""),
                "lat": float(lat),
                "lng": float(lon),
            },
        })

    mp_features.sort(key=lambda x: x["properties"]["milepost"])
    return {
        "type": "FeatureCollection",
        "source": "NTAD Rail Mileposts FeatureServer (ArcGIS), La Grande Subdivision, Pendleton bbox",
        "source_url": f"{ARCGIS_BASE}/NTAD_Rail_Mileposts/FeatureServer/0",
        "count": len(mp_features),
        "features": mp_features,
    }


def build_detectors() -> dict:
    print("Building detectors.json from baked source data...")
    detectors = []
    for d in sorted(DETECTOR_DATA, key=lambda x: x["milepost"]):
        mp = d["milepost"]
        did = str(d.get("detector_id", ""))
        key = did in KEY_DETECTOR_IDS
        direction_caught = (
            "eastbound" if mp < DOWNTOWN_MP
            else "westbound" if mp > DOWNTOWN_MP
            else "at-downtown"
        )
        dist = round(abs(mp - DOWNTOWN_MP), 1)
        if did in HEADS_UP:
            h = HEADS_UP[did]
            heads_up = {
                "distance_mi": h["distance_mi"],
                "direction_text": h["direction_text"],
                "eta_note": f"Train detected here gives ~{h['distance_mi']} mi lead time to downtown MP 215.5",
            }
        else:
            heads_up = {
                "distance_mi": dist,
                "direction_text": f"{direction_caught}, computed from milepost delta",
                "eta_note": f"Approx {dist} mi to downtown MP 215.5",
            }
        detectors.append({
            "detector_id": d.get("detector_id"),
            "milepost": mp,
            "location": d.get("location"),
            "lat": d.get("lat"),
            "lng": d.get("lng"),
            "frequency": d.get("frequency"),
            "functions": d.get("functions"),
            "direction_caught": direction_caught,
            "dist_to_downtown_mi": dist,
            "key": key,
            "heads_up": heads_up,
        })
    print(f"  {len(detectors)} detectors, {sum(1 for d in detectors if d['key'])} key")
    return {
        "source": "UP La Grande Subdivision defect detectors, extracted from AAR/UP detector directory",
        "downtown_reference_mp": DOWNTOWN_MP,
        "count": len(detectors),
        "key_detector_ids": sorted(KEY_DETECTOR_IDS),
        "detectors": detectors,
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    crossings = build_crossings()
    with open(OUT_DIR / "crossings.json", "w", encoding="utf-8") as f:
        json.dump(crossings, f, indent=2)
    print(f"  -> crossings.json ({crossings['count']} features)")

    railline = build_railline()
    with open(OUT_DIR / "railline.json", "w", encoding="utf-8") as f:
        json.dump(railline, f, indent=2)
    print(f"  -> railline.json ({railline['feature_count']} features)")

    mileposts = build_mileposts()
    with open(OUT_DIR / "mileposts.json", "w", encoding="utf-8") as f:
        json.dump(mileposts, f, indent=2)
    print(f"  -> mileposts.json ({mileposts['count']} features)")

    detectors = build_detectors()
    with open(OUT_DIR / "detectors.json", "w", encoding="utf-8") as f:
        json.dump(detectors, f, indent=2)
    print(f"  -> detectors.json ({detectors['count']} detectors)")

    print("\nAll geo files written successfully.")


if __name__ == "__main__":
    main()
