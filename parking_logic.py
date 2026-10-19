"""
parking_logic.py

Small helpers shared by the rest of the back end: working with times like
"9:30 AM", finding a lot, and looking up a lot's chance of having a spot.
The code that actually picks the best lot is in engine.py.
"""

import re


def time_to_minutes(text):
    """
    Turn a time like "9:30 AM" into minutes after midnight (570).
    Returns None if the text isn't a valid time between 6:00 AM and 9:00 PM.
    """
    if not isinstance(text, str):
        return None

    match = re.fullmatch(r"(1[0-2]|[1-9]):([0-5][0-9]) (AM|PM)", text.strip())
    if not match:
        return None

    hour = int(match.group(1)) % 12          # 12 AM/PM becomes 0 here
    if match.group(3) == "PM":
        hour += 12
    minutes = hour * 60 + int(match.group(2))

    # Only allow times that make sense for being on campus
    if minutes < 6 * 60 or minutes > 21 * 60:
        return None
    return minutes


def minutes_to_label(minutes):
    """Turn minutes after midnight (570) back into a label ("9:30 AM")."""
    minutes = int(round(minutes))
    hour24 = (minutes // 60) % 24
    minute = minutes % 60
    suffix = "PM" if hour24 >= 12 else "AM"
    hour12 = 12 if hour24 % 12 == 0 else hour24 % 12
    return f"{hour12}:{minute:02d} {suffix}"


def find_lot(db, lot_id):
    """Look up a lot by its id. Returns None if there isn't one."""
    for lot in db["parkingLots"]:
        if lot["parkingLotId"] == lot_id:
            return lot
    return None


def probability_for(lot, day, minutes):
    """
    The chance (0-100) of finding a spot in one lot on a day at a time.

    The lot's data has one entry per hour (7 AM, 8 AM, ...). For a time in
    between, like 8:40, we blend the two entries on either side of it. Times
    before the first entry or after the last one use the nearest entry.
    Returns None if the lot has no data for that day.
    """
    points = []
    for slot in lot["availability"]:
        if slot["day"] != day:
            continue
        slot_minutes = time_to_minutes(slot["time"])
        if slot_minutes is not None:
            points.append((slot_minutes, float(slot["probability"])))
    if not points:
        return None
    points.sort()

    if minutes <= points[0][0]:
        return round(points[0][1])
    if minutes >= points[-1][0]:
        return round(points[-1][1])

    for (time_a, chance_a), (time_b, chance_b) in zip(points, points[1:]):
        if time_a <= minutes <= time_b:
            share = (minutes - time_a) / (time_b - time_a)
            return round(chance_a + (chance_b - chance_a) * share)
    return None


def lot_summary(lot):
    """The basic details of a lot that the browser needs (no big availability list)."""
    return {
        "parkingLotId": lot["parkingLotId"],
        "lotName": lot["lotName"],
        "shortName": lot["shortName"],
        "mapX": lot["mapX"],
        "mapY": lot["mapY"],
        "latitude": lot["latitude"],
        "longitude": lot["longitude"],
    }
