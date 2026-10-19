"""
campus_data.py

Facts about the Rowan campus that the rest of the app uses.
Everything here was read off Rowan's 2025-2026 Campus & Parking Map.

Positions are in "map points": the map is 792 points wide and 462 points tall
(that is the size of the PDF page the map was printed on).
"""

import math

from campus import map_to_latlng

# Size of the campus map picture, in map points
MAP_WIDTH = 792
MAP_HEIGHT = 462

# How many meters one map point is.
# The map has no scale bar, so this was worked out from things with a known
# size: the football field in Wackar Stadium (about 110 m long) and the soccer
# field (about 100 m long). It is a rough number (maybe 10% off), which is fine
# for "about a 5 minute walk", but it is not survey data.
METERS_PER_POINT = 1.9

# Walking paths are not straight lines, so we make every straight-line
# distance a bit longer. 1.25 is a common rule of thumb for campus paths.
PATH_FACTOR = 1.25

# Average walking speed, in meters per minute (about 4.8 km/h)
WALK_METERS_PER_MINUTE = 80


# Class buildings. Each one has: the number on the map, its name, and where the
# number sits on the map picture (x, y in map points).
BUILDINGS = [
    {"id": "BLD-02", "number": 2,  "name": "Campbell Library",           "x": 323.5, "y": 200.6},
    {"id": "BLD-03", "number": 3,  "name": "Chamberlain Student Center", "x": 365.6, "y": 183.8},
    {"id": "BLD-04", "number": 4,  "name": "Recreation Center",          "x": 292.2, "y": 140.8},
    {"id": "BLD-05", "number": 5,  "name": "Esbjornson Gym",             "x": 269.9, "y": 147.3},
    {"id": "BLD-06", "number": 6,  "name": "James Hall",                 "x": 225.3, "y": 131.6},
    {"id": "BLD-07", "number": 7,  "name": "Robinson Hall",              "x": 244.1, "y": 186.3},
    {"id": "BLD-08", "number": 8,  "name": "Wilson Hall",                "x": 188.9, "y": 194.9},
    {"id": "BLD-09", "number": 9,  "name": "Rowan Hall",                 "x": 142.6, "y": 189.1},
    {"id": "BLD-10", "number": 10, "name": "Engineering Hall",           "x": 124.1, "y": 154.7},
    {"id": "BLD-11", "number": 11, "name": "Business Hall",              "x": 213.0, "y": 259.0},
    {"id": "BLD-12", "number": 12, "name": "Westby Hall",                "x": 233.0, "y": 240.5},
    {"id": "BLD-13", "number": 13, "name": "Science Hall",               "x": 262.9, "y": 226.0},
    {"id": "BLD-14", "number": 14, "name": "Hawthorn Hall",              "x": 281.6, "y": 269.9},
    {"id": "BLD-15", "number": 15, "name": "Bozorth Hall",               "x": 293.8, "y": 302.1},
    {"id": "BLD-16", "number": 16, "name": "Bunce Hall",                 "x": 350.0, "y": 308.7},
    {"id": "BLD-17", "number": 17, "name": "Memorial Hall",              "x": 359.5, "y": 262.3},
    {"id": "BLD-38", "number": 38, "name": "Discovery Hall",            "x": 452.7, "y": 155.5},
    {"id": "BLD-44", "number": 44, "name": "Enterprise Center",          "x": 584.7, "y": 161.8},
]

# The commuter lots. Each one has: id, short name for the pin, full name, where
# it is on the map (x, y in map points), and "size", a rough guess of how many
# cars it holds compared with the others (1 = small, 3 = big).
# The sizes were judged by eye from the lot's shape on the map. If you ever get
# the real space counts from Public Safety, put them here instead.
LOTS = [
    {"id": "LOT-A",   "short": "A",   "name": "Lot A",             "x": 141,   "y": 270,   "size": 2},
    {"id": "LOT-B1",  "short": "B-1", "name": "Lot B-1",           "x": 228.5, "y": 51,    "size": 3},
    {"id": "LOT-C",   "short": "C",   "name": "Lot C",             "x": 118,   "y": 46.5,  "size": 3},
    {"id": "LOT-D",   "short": "D",   "name": "Lot D",             "x": 75,    "y": 80,    "size": 1},
    {"id": "LOT-D1",  "short": "D-1", "name": "Lot D-1",           "x": 77,    "y": 144,   "size": 1},
    {"id": "LOT-F1",  "short": "F-1", "name": "Lot F-1",           "x": 48,    "y": 311,   "size": 1},
    {"id": "LOT-J",   "short": "J",   "name": "Lot J",             "x": 459,   "y": 126,   "size": 2},
    {"id": "LOT-O",   "short": "O",   "name": "Lot O",             "x": 193,   "y": 91,    "size": 3},
    {"id": "LOT-R",   "short": "R",   "name": "Lot R",             "x": 418,   "y": 342,   "size": 2},
    {"id": "LOT-Y",   "short": "Y",   "name": "Lot Y",             "x": 353,   "y": 376,   "size": 2},
    {"id": "LOT-411", "short": "411", "name": "411 Ellis St. Lot", "x": 546,   "y": 442,   "size": 2},
]


def distance_meters(x1, y1, x2, y2):
    """Straight-line distance between two map positions, in meters."""
    return math.hypot(x1 - x2, y1 - y2) * METERS_PER_POINT


def walk_minutes(x1, y1, x2, y2):
    """About how many minutes it takes to walk between two map positions."""
    meters = distance_meters(x1, y1, x2, y2) * PATH_FACTOR
    return meters / WALK_METERS_PER_MINUTE


def find_building(building_id):
    """Look up a building by its id. Returns None if there isn't one."""
    for building in BUILDINGS:
        if building["id"] == building_id:
            return building
    return None


def building_summary(building):
    """What the browser needs to know about a building (position as a percent of the map)."""
    map_x = round(building["x"] / MAP_WIDTH * 100, 2)
    map_y = round(building["y"] / MAP_HEIGHT * 100, 2)
    # latitude/longitude are None unless the anchors are set in config.py
    # (otherwise the Google view works them out in the browser)
    latitude, longitude = map_to_latlng(map_x, map_y)
    return {
        "buildingId": building["id"],
        "name": building["name"],
        "number": building["number"],
        "mapX": map_x,
        "mapY": map_y,
        "latitude": latitude,
        "longitude": longitude,
    }
