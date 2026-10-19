"""
seed.py

Builds the starting parking lot data. This runs automatically the first time
the app starts with an empty database.

IMPORTANT: there are no real sensors or space counts behind the availability
numbers. They come from a simple model of how a commuter lot fills up during
the day (explained below). The point of keeping them in the database, in the
format the professor gave us, is that real numbers can replace them later and
the recommendation code (engine.py) will keep working without any changes.

THE MODEL
Three things decide how likely a lot is to have a spot:

  1. Time of day. Commuter lots are mostly empty early, fill up between about
     9 AM and 2 PM, and empty out again in the late afternoon.
  2. How popular the lot is. A lot close to lots of classroom buildings gets
     more drivers (we call this its "pull").
  3. How big the lot is. The same number of drivers fills a small lot faster.

We combine them into a "pressure" number (1.0 means the lot is about full)
and turn that into a chance with an S-shaped curve.
"""

import math

from campus import map_to_latlng
from campus_data import BUILDINGS, LOTS, MAP_HEIGHT, MAP_WIDTH
from parking_logic import minutes_to_label

# Bump this number whenever the model changes, so older databases get refreshed
MODEL_VERSION = 2

# How busy each day is compared to a normal day (Fridays have fewer classes)
DAY_BUSYNESS = {
    "Monday": 0.95,
    "Tuesday": 1.0,
    "Wednesday": 1.0,
    "Thursday": 0.95,
    "Friday": 0.6,
}

# Knobs of the model. These were picked so that at the busiest time of a normal
# day the popular lots are close to full and the far ones are still fine.
OVERALL_LOAD = 0.9      # how full campus is overall at the busiest time
PULL_DISTANCE = 110     # map points; buildings farther than this barely add to a lot's pull
ZONE_EXPONENT = 0.6     # <1 keeps the difference between lots from getting extreme
STEEPNESS = 5           # how quickly the chance drops as a lot gets close to full


def squash(z):
    """The S-shaped curve: very negative -> 0, very positive -> 1."""
    return 1 / (1 + math.exp(-z))


def how_busy_is_campus(minutes):
    """
    How full commuter parking is overall, from 0.12 (very empty) to 1.0 (busiest),
    for a time of day given in minutes after midnight.
    It rises around 9 AM and falls after about 3:30 PM.
    """
    rising = squash((minutes - 9 * 60) / 45)
    falling = squash((minutes - 15.5 * 60) / 60)
    return min(1.0, rising * (1 - 0.8 * falling) + 0.12)


def work_out_lot_zones():
    """
    For every lot, work out how popular it is compared with how big it is.
    Returns { lotId: ratio }. A ratio above 1 means the lot attracts more cars
    than its size suggests (so it fills up early); below 1 means it stays open.
    """
    pulls = {}
    for lot in LOTS:
        total = 0
        for building in BUILDINGS:
            distance = math.hypot(lot["x"] - building["x"], lot["y"] - building["y"])
            total += math.exp(-distance / PULL_DISTANCE)
        pulls[lot["id"]] = total

    all_pull = sum(pulls.values())
    all_size = sum(lot["size"] for lot in LOTS)

    ratios = {}
    for lot in LOTS:
        share_of_drivers = pulls[lot["id"]] / all_pull
        share_of_spaces = lot["size"] / all_size
        ratios[lot["id"]] = (share_of_drivers / share_of_spaces) ** ZONE_EXPONENT
    return ratios


def chance_of_spot(ratio, day, minutes):
    """The model: chance (3 to 98 percent) of finding a spot in a lot."""
    pressure = OVERALL_LOAD * DAY_BUSYNESS[day] * how_busy_is_campus(minutes) * ratio
    chance = 1 / (1 + math.exp(STEEPNESS * (pressure - 0.95)))
    return max(3, min(98, round(chance * 100)))


def make_availability(ratio):
    """
    The availability list for one lot, in the professor's format:
    { day: "Monday", time: "9:00 AM", probability: 65 }, one for every hour 7 AM - 6 PM.
    """
    slots = []
    for day in DAY_BUSYNESS:
        for hour in range(7, 19):
            slots.append({
                "day": day,
                "time": minutes_to_label(hour * 60),
                "probability": chance_of_spot(ratio, day, hour * 60),
            })
    return slots


def make_parking_lots():
    """Build the list of parking lots."""
    ratios = work_out_lot_zones()
    result = []
    for lot in LOTS:
        map_x = round(lot["x"] / MAP_WIDTH * 100, 2)
        map_y = round(lot["y"] / MAP_HEIGHT * 100, 2)
        latitude, longitude = map_to_latlng(map_x, map_y)

        result.append({
            "parkingLotId": lot["id"],
            "lotName": lot["name"],
            "shortName": lot["short"],
            "mapX": map_x,
            "mapY": map_y,
            "latitude": latitude,
            "longitude": longitude,
            "availability": make_availability(ratios[lot["id"]]),
        })
    return result


def make_seed_data():
    """The full starting database: no users yet, and the sample lots."""
    return {"modelVersion": MODEL_VERSION, "users": [], "parkingLots": make_parking_lots()}
