"""
api/parking.py

Everything about parking lots and each user's weekly parking plan.

  GET  /api/parking/lots                              all the lots (for the map)
  GET  /api/parking/recommend?day=Monday&time=9:00 AM lots ranked best -> worst
  GET  /api/parking/schedule                          the logged-in user's saved week
  POST /api/parking/save    { day, arrivalTime, className, parkingLotId }
  POST /api/parking/remove  { day }

Every answer is JSON: { ok: true, ... } or { ok: false, error: "..." }
"""

from flask import Blueprint, request, session

from helpers import ApiError, ok, read_json_body, require_login
from parking_logic import (find_lot, lot_summary, minutes_to_label, probability_for,
                           rank_lots, time_to_minutes)
from settings import WEEKDAYS
from storage import database_lock, get_storage

parking = Blueprint("parking", __name__, url_prefix="/api/parking")


def find_logged_in_user(db):
    """
    Find the logged-in user inside the database.
    If the account doesn't exist anymore we log the person out.
    """
    user_id = require_login()
    for user in db["users"]:
        if user["userId"] == user_id:
            return user

    session.clear()
    raise ApiError("Please log in again.", 401)


def check_day(day):
    """Check that a day name is one we support (Monday - Friday)."""
    if day not in WEEKDAYS:
        raise ApiError("Please pick a day from Monday to Friday.")
    return day


def check_time(time_text):
    """Check a time like "9:00 AM" and return it as minutes after midnight."""
    minutes = time_to_minutes(time_text)
    if minutes is None:
        raise ApiError("Please pick an arrival time between 6:00 AM and 8:00 PM.")
    return minutes


@parking.get("/lots")
def lots():
    with database_lock:
        db = get_storage().load()

    # We leave out the big availability list here, the map only needs names and positions
    return ok(lots=[lot_summary(lot) for lot in db["parkingLots"]])


@parking.get("/recommend")
def recommend():
    day = check_day(request.args.get("day"))
    minutes = check_time(request.args.get("time"))

    with database_lock:
        db = get_storage().load()

    ranking = rank_lots(db, day, minutes)
    if not ranking:
        raise ApiError("We do not have parking data for that time yet.", 404)

    return ok(
        day=day,
        arrivalTime=minutes_to_label(minutes),
        best=ranking[0],        # the first one is the best chance
        ranking=ranking,
    )


@parking.get("/schedule")
def schedule():
    with database_lock:
        db = get_storage().load()
    user = find_logged_in_user(db)

    # Add the lot details and a fresh probability to every saved plan
    result = []
    for entry in user["parkingSchedule"]:
        lot = find_lot(db, entry["parkingLotId"])
        minutes = time_to_minutes(entry["arrivalTime"])
        if lot is None or minutes is None:
            continue
        result.append({
            **entry,
            **lot_summary(lot),
            "probability": probability_for(lot, entry["day"], minutes),
        })
    return ok(schedule=result)


@parking.post("/save")
def save():
    require_login()
    body = read_json_body()

    day = check_day(body.get("day"))
    minutes = check_time(body.get("arrivalTime"))
    class_name = str(body.get("className", "")).strip()
    if len(class_name) > 60:
        raise ApiError("The class name can be at most 60 characters.")

    with database_lock:
        storage = get_storage()
        db = storage.load()
        user = find_logged_in_user(db)

        lot = find_lot(db, str(body.get("parkingLotId", "")))
        if lot is None:
            raise ApiError("That parking lot does not exist.")

        new_entry = {
            "day": day,
            "className": class_name,
            "arrivalTime": minutes_to_label(minutes),
            "parkingLotId": lot["parkingLotId"],
        }

        # Each weekday only gets ONE plan, so drop the old one for this day first
        kept = [entry for entry in user["parkingSchedule"] if entry["day"] != day]
        kept.append(new_entry)

        # Keep the list in Monday -> Friday order
        kept.sort(key=lambda entry: WEEKDAYS.index(entry["day"]))

        user["parkingSchedule"] = kept
        storage.save(db)

    return ok(saved=new_entry)


@parking.post("/remove")
def remove():
    require_login()
    body = read_json_body()
    day = check_day(body.get("day"))

    with database_lock:
        storage = get_storage()
        db = storage.load()
        user = find_logged_in_user(db)

        user["parkingSchedule"] = [entry for entry in user["parkingSchedule"] if entry["day"] != day]
        storage.save(db)

    return ok()
