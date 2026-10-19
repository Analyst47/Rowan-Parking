"""
engine.py - the recommendation engine.

Given a student's classes, it decides which commuter lot to park in each day.

THE IDEA
The closest lot is not always the best one, because the closest lot is often
full. And a lot with plenty of room is no good if it is a 15 minute walk. So
for every lot we estimate how many minutes it will cost the student:

    cost = walk to class
         + half of the walk back to the car (that walk matters less, nobody is late for it)
         + (chance the lot is full) x (minutes lost driving around to find another lot)

The lot with the lowest cost wins. To work out the chance the lot is full we
need to know WHEN the student will be there, and that depends on the lot:

    park-by time = class start - minutes early - walk to class - a few minutes to park

So a far lot has an earlier park-by time (a longer walk), when the lots are
emptier, and a near lot has a later one.

Walking distance comes from the lot and building positions on Rowan's campus
map (see campus_data.py). The chance of a spot comes from each lot's
"availability" data in the database (see seed.py for where that comes from).
"""

from campus_data import (MAP_HEIGHT, MAP_WIDTH, PATH_FACTOR,
                         distance_meters, find_building, walk_minutes)
from parking_logic import minutes_to_label, probability_for
from settings import WEEKDAYS

PARKING_TIME = 3        # minutes between arriving at the lot and starting to walk
MISS_PENALTY = 12       # minutes lost when a lot is full (circling, driving to another lot)
RETURN_WALK_WEIGHT = 0.5
OTHER_OPTIONS = 3       # how many backup lots to show next to the best one


def lot_position(lot):
    """Where a lot is on the campus map, in map points."""
    return lot["mapX"] / 100 * MAP_WIDTH, lot["mapY"] / 100 * MAP_HEIGHT


def round_meters(meters):
    """Round a distance to the nearest 10 meters (more digits would pretend to be exact)."""
    return int(round(meters / 10.0) * 10)


def score_lot(lot, day, first_building, last_building, class_start, minutes_early):
    """
    Work out everything about one lot for one day.
    Returns a dict (the cost, the chance, the walk, the park-by time) or
    None if the lot has no availability data for that day.
    """
    lot_x, lot_y = lot_position(lot)

    walk_in = walk_minutes(lot_x, lot_y, first_building["x"], first_building["y"])
    walk_out = walk_minutes(lot_x, lot_y, last_building["x"], last_building["y"])

    park_by = class_start - minutes_early - walk_in - PARKING_TIME
    chance = probability_for(lot, day, park_by)
    if chance is None:
        return None

    chance_full = 1 - chance / 100
    cost = walk_in + RETURN_WALK_WEIGHT * walk_out + chance_full * MISS_PENALTY

    meters = distance_meters(lot_x, lot_y, first_building["x"], first_building["y"]) * PATH_FACTOR
    return {
        "parkingLotId": lot["parkingLotId"],
        "lotName": lot["lotName"],
        "shortName": lot["shortName"],
        "mapX": lot["mapX"],
        "mapY": lot["mapY"],
        "latitude": lot["latitude"],
        "longitude": lot["longitude"],
        "walkMinutes": max(1, round(walk_in)),
        "walkMeters": round_meters(meters),
        "chance": chance,
        "parkBy": minutes_to_label(park_by),
        "cost": round(cost, 1),
        "_walk": walk_in,          # unrounded values, only used inside this file
        "_parkByMinutes": park_by,
    }


def explain(best, nearest, building_name):
    """A sentence or two on why the best lot was picked."""
    if best["parkingLotId"] == nearest["parkingLotId"]:
        return (best["lotName"] + " is the closest lot to " + building_name + " (about " +
                str(best["walkMinutes"]) + " min walk) and has a " + str(best["chance"]) +
                "% chance of a space when you arrive.")

    return (nearest["lotName"] + " is closest (" + str(nearest["walkMinutes"]) + " min walk) but only has a " +
            str(nearest["chance"]) + "% chance of a space around " + nearest["parkBy"] + ". " +
            best["lotName"] + " is about " + str(best["walkMinutes"]) + " min from " + building_name +
            " with a " + str(best["chance"]) + "% chance, so it should cost you less time overall.")


def earlier_tip(db_lots, best, day, class_start, minutes_early, first_building, last_building):
    """
    If the best lot is still risky, check whether leaving 20 minutes earlier would help.
    Returns a sentence, or None when there is nothing useful to say.
    """
    if best["chance"] >= 60:
        return None
    lot = next(item for item in db_lots if item["parkingLotId"] == best["parkingLotId"])
    earlier = score_lot(lot, day, first_building, last_building, class_start, minutes_early + 20)
    if earlier is None or earlier["chance"] - best["chance"] < 15:
        return None
    return ("Even the best lot is tight at that time. Parking by " + earlier["parkBy"] +
            " instead would raise your chance to about " + str(earlier["chance"]) + "%.")


def plan_day(db, day, classes, minutes_early):
    """
    Pick the best lot for one day.

    classes: that day's classes, each { startMinutes, buildingId, className }.
    The earliest class decides when the student arrives. The last class decides
    where they walk back from.
    """
    classes = sorted(classes, key=lambda item: item["startMinutes"])
    first, last = classes[0], classes[-1]
    first_building = find_building(first["buildingId"])
    last_building = find_building(last["buildingId"])

    options = []
    for lot in db["parkingLots"]:
        scored = score_lot(lot, day, first_building, last_building, first["startMinutes"], minutes_early)
        if scored is not None:
            options.append(scored)
    if not options:
        return None

    # Lowest cost first. If two lots tie, the shorter walk wins.
    options.sort(key=lambda item: (item["cost"], item["_walk"], item["lotName"]))
    best = options[0]
    nearest = min(options, key=lambda item: item["_walk"])

    why = explain(best, nearest, first_building["name"])
    tip = earlier_tip(db["parkingLots"], best, day, first["startMinutes"], minutes_early,
                      first_building, last_building)

    # Remove the helper values before sending the answer to the browser
    clean = [{key: value for key, value in item.items() if not key.startswith("_")} for item in options]
    return {
        "day": day,
        "className": first["className"],
        "classCount": len(classes),
        "classStart": minutes_to_label(first["startMinutes"]),
        "buildingId": first["buildingId"],
        "buildingName": first_building["name"],
        "best": clean[0],
        "others": clean[1:1 + OTHER_OPTIONS],
        "ranking": clean,
        "nearestLotId": nearest["parkingLotId"],
        "why": why,
        "tip": tip,
    }


def plan_week(db, classes, minutes_early):
    """
    Plan every day that has a class.

    classes: a list of { days: ["Monday", ...], className, buildingId, startMinutes }.
    Returns a list of plan_day() results, Monday to Friday.
    """
    by_day = {}
    for item in classes:
        for day in item["days"]:
            by_day.setdefault(day, []).append(item)

    plans = []
    for day in WEEKDAYS:
        if day in by_day:
            plan = plan_day(db, day, by_day[day], minutes_early)
            if plan is not None:
                plans.append(plan)
    return plans
