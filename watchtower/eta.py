# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""
Train Vantage watchtower - ETA model.

Mirrors the JavaScript ETA model in src/ui/eta.js so the local pipeline and the
web app agree. Given a parsed milepost and speed, compute the direction of
travel (relative to downtown MP 215.5) and the minutes to downtown.

Stdlib only. Run directly for a quick demo:

    uv run eta.py        (or: python eta.py)
"""

from dataclasses import dataclass
from typing import Optional

DOWNTOWN_MP = 215.5


def direction_for(milepost: float, ref_mp: float = DOWNTOWN_MP) -> str:
    """
    Detectors west of downtown (milepost < 215.5) catch eastbound trains
    approaching from the Columbia plateau. Detectors east of downtown
    (milepost > 215.5) catch westbound trains coming down the Blue Mountain
    grade.
    """
    if milepost is None:
        return "unknown"
    if milepost < ref_mp:
        return "eastbound"
    if milepost > ref_mp:
        return "westbound"
    return "at downtown"


def distance_to_downtown_mi(milepost: float, ref_mp: float = DOWNTOWN_MP) -> Optional[float]:
    if milepost is None:
        return None
    return round(abs(ref_mp - milepost), 1)


def eta_min(distance_mi: Optional[float], speed_mph: Optional[float]) -> Optional[float]:
    """eta_min = distance_mi / speed_mph * 60. None if inputs are unusable."""
    if distance_mi is None or speed_mph is None:
        return None
    try:
        speed = float(speed_mph)
    except (TypeError, ValueError):
        return None
    if speed <= 0:
        return None
    return round(distance_mi / speed * 60.0, 1)


@dataclass
class Eta:
    milepost: Optional[float]
    direction: str
    dist_to_downtown_mi: Optional[float]
    speed_mph: Optional[float]
    eta_downtown_min: Optional[float]


def compute(milepost: Optional[float], speed_mph: Optional[float], ref_mp: float = DOWNTOWN_MP) -> Eta:
    dist = distance_to_downtown_mi(milepost, ref_mp)
    return Eta(
        milepost=milepost,
        direction=direction_for(milepost, ref_mp),
        dist_to_downtown_mi=dist,
        speed_mph=speed_mph,
        eta_downtown_min=eta_min(dist, speed_mph),
    )


if __name__ == "__main__":
    samples = [
        (221.9, 35),  # Mission, westbound down the grade
        (207.1, 28),  # Rieth, eastbound
        (240.7, 40),  # Bonifer, westbound
        (194.9, 31),  # Echo, eastbound, far out
    ]
    for mp, spd in samples:
        e = compute(mp, spd)
        print(
            "MP " + str(mp) + " @ " + str(spd) + " mph -> " + e.direction
            + ", " + str(e.dist_to_downtown_mi) + " mi, ETA "
            + (str(e.eta_downtown_min) + " min" if e.eta_downtown_min is not None else "n/a")
        )
