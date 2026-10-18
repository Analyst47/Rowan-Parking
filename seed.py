"""
seed.py

Builds the starting parking lot data. This runs automatically the first time
the app starts with an empty database.

The lots are the COMMUTER lots listed on Rowan's 2025-2026 campus parking map
(Lots A, B-1, C, D, D-1, F-1, J, O, R, Y and the 411 Ellis St. lot).

IMPORTANT: there is no real sensor data behind the availability numbers.
The "probability" values are sample estimates made by a simple formula
(see make_availability). The map positions come from the map itself.
"""

import math

from campus import map_to_latlng
from parking_logic import minutes_to_label

# Size of the campus map picture in points (the PDF's units). We use these to
# turn a position on the picture into a percent.
MAP_WIDTH = 792
MAP_HEIGHT = 462

# Roughly the middle of the academic core (Wilson, Robinson, Campbell Library).
# Lots near it fill up faster than lots far away.
CORE_X = 250
CORE_Y = 200

# id, short name for the pin, full name, and where it is on the map picture (in points)
LOTS = [
    ("LOT-A",   "A",   "Lot A",              141,   270),
    ("LOT-B1",  "B-1", "Lot B-1",            228.5,  51),
    ("LOT-C",   "C",   "Lot C",              118,    46.5),
    ("LOT-D",   "D",   "Lot D",               75,    80),
    ("LOT-D1",  "D-1", "Lot D-1",             77,   144),
    ("LOT-F1",  "F-1", "Lot F-1",             48,   311),
    ("LOT-J",   "J",   "Lot J",              459,   126),
    ("LOT-O",   "O",   "Lot O",              193,    91),
    ("LOT-R",   "R",   "Lot R",              418,   342),
    ("LOT-Y",   "Y",   "Lot Y",              353,   376),
    ("LOT-411", "411", "411 Ellis St. Lot",  546,   442),
]

# How busy each day is compared to a normal day
DAY_BUSYNESS = {
    "Monday": 1.0,
    "Tuesday": 1.1,
    "Wednesday": 1.1,
    "Thursday": 1.0,
    "Friday": 0.6,
}


def make_availability(drop_at_peak, peak_hour):
    """
    Make the availability list for one lot.
    That's a list like: { day: "Monday", time: "9:00 AM", probability: 65 }

    drop_at_peak = how many percent the chance falls at the busiest hour
    peak_hour    = the busiest hour (10.5 means 10:30 AM)

    Every lot is mostly open early and late in the day and fills up around its
    peak hour. Fridays are quieter because fewer classes are scheduled.
    """
    open_chance = 97    # chance when the lot is at its emptiest

    slots = []
    for day, busyness in DAY_BUSYNESS.items():
        # one entry for every hour from 7 AM to 6 PM
        for hour in range(7, 19):
            # A bell curve: biggest drop at the peak hour, smaller as we move away from it
            distance = hour - peak_hour
            drop = drop_at_peak * busyness * math.exp(-(distance ** 2) / 18)

            probability = round(open_chance - drop)
            probability = max(5, min(98, probability))   # keep it between 5% and 98%

            slots.append({
                "day": day,
                "time": minutes_to_label(hour * 60),
                "probability": probability,
            })
    return slots


def make_parking_lots():
    """Build the list of parking lots."""
    result = []
    for lot_id, short_name, name, x, y in LOTS:
        # Lots closer to the middle of campus get a bigger drop and an earlier peak
        distance = math.hypot(x - CORE_X, y - CORE_Y)
        drop_at_peak = max(10, min(85, 115 - 0.4 * distance))
        peak_hour = 9.5 + min(distance, 260) / 260 * 2.5

        map_x = round(x / MAP_WIDTH * 100, 2)
        map_y = round(y / MAP_HEIGHT * 100, 2)
        latitude, longitude = map_to_latlng(map_x, map_y)

        result.append({
            "parkingLotId": lot_id,
            "lotName": name,
            "shortName": short_name,
            "mapX": map_x,
            "mapY": map_y,
            "latitude": latitude,
            "longitude": longitude,
            "availability": make_availability(drop_at_peak, peak_hour),
        })
    return result


def make_seed_data():
    """The full starting database: no users yet, and the sample lots."""
    return {"users": [], "parkingLots": make_parking_lots()}
