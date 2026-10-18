"""
parking_logic.py

The "brain" of the app: helpers for times, and the code that decides which
lot is the best choice for a given day and arrival time.
"""

import re


def time_to_minutes(text):
    """
    Turn a time like "9:30 AM" into minutes after midnight (570).
    Returns None if the text isn't a valid time between 6:00 AM and 8:00 PM.
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

    # Only allow times that make sense for coming to campus
    if minutes < 6 * 60 or minutes > 20 * 60:
        return None
    return minutes


def minutes_to_label(minutes):
    """Turn minutes after midnight (570) back into a label ("9:30 AM")."""
    hour24 = minutes // 60
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
    Get the chance (0-100) of finding a spot in one lot.

    Our data has one entry per hour, but the user might pick 9:30 AM,
    so we use the entry whose time is closest to what they picked.
    """
    best_probability = None
    best_gap = None

    for slot in lot["availability"]:
        if slot["day"] != day:
            continue
        slot_minutes = time_to_minutes(slot["time"])
        if slot_minutes is None:
            continue

        gap = abs(slot_minutes - minutes)
        if best_gap is None or gap < best_gap:
            best_gap = gap
            best_probability = int(slot["probability"])
    return best_probability


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


def rank_lots(db, day, minutes):
    """
    Rank all the lots for a day and time, best chance first.
    Returns a list of lot_summary() details plus the probability.
    """
    ranking = []

    for lot in db["parkingLots"]:
        probability = probability_for(lot, day, minutes)
        if probability is None:
            continue    # no data for this lot at that time, skip it
        ranking.append({**lot_summary(lot), "probability": probability})

    # Sort highest probability first. If two lots tie, keep them in name order.
    ranking.sort(key=lambda lot: (-lot["probability"], lot["lotName"]))
    return ranking
