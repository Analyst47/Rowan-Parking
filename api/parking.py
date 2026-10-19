"""
api/parking.py

The parking lots and each user's saved weekly parking plan.

  GET  /api/parking/lots        all the lots (for the map)
  GET  /api/parking/schedule    the logged-in user's saved week
  POST /api/parking/save        { plans: [ { day, className, arrivalTime, parkingLotId,
                                             buildingId, classStart } ] }
  POST /api/parking/remove      { day }

(The advice itself, "which lot should I park in?", comes from api/schedule.py.)
Every answer is JSON: { ok: true, ... } or { ok: false, error: "..." }
"""

from flask import Blueprint, session

from campus_data import find_building
from helpers import ApiError, ok, read_json_body, require_login
from parking_logic import find_lot, lot_summary, minutes_to_label, probability_for, time_to_minutes
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


@parking.get("/lots")
def lots():
    with database_lock:
        db = get_storage().load()

    # We leave out the big availability list here, the map only needs names and positions
    return ok(lots=[lot_summary(lot) for lot in db["parkingLots"]])


@parking.get("/schedule")
def schedule():
    with database_lock:
        db = get_storage().load()
    user = find_logged_in_user(db)

    # Add the lot details and a fresh chance to every saved plan
    result = []
    for entry in user["parkingSchedule"]:
        lot = find_lot(db, entry["parkingLotId"])
        minutes = time_to_minutes(entry["arrivalTime"])
        if lot is None or minutes is None:
            continue

        building = find_building(entry.get("buildingId"))
        result.append({
            **entry,
            **lot_summary(lot),
            "buildingName": building["name"] if building else "",
            "probability": probability_for(lot, entry["day"], minutes),
        })
    return ok(schedule=result)


@parking.post("/save")
def save():
    require_login()
    body = read_json_body()

    plans = body.get("plans")
    if not isinstance(plans, list) or not plans:
        raise ApiError("There is nothing to save.")

    with database_lock:
        storage = get_storage()
        db = storage.load()
        user = find_logged_in_user(db)

        new_entries = []
        for plan in plans:
            if not isinstance(plan, dict):
                raise ApiError("One of the plans is not valid.")
            day = check_day(plan.get("day"))

            minutes = time_to_minutes(plan.get("arrivalTime"))
            if minutes is None:
                raise ApiError("Please pick an arrival time between 6:00 AM and 9:00 PM.")

            lot = find_lot(db, str(plan.get("parkingLotId", "")))
            if lot is None:
                raise ApiError("That parking lot does not exist.")

            entry = {
                "day": day,
                "className": str(plan.get("className", "")).strip()[:60],
                "arrivalTime": minutes_to_label(minutes),
                "parkingLotId": lot["parkingLotId"],
            }
            # Extra details about the class, so My Week can show the building
            building = find_building(plan.get("buildingId"))
            if building:
                entry["buildingId"] = building["id"]
            class_start = time_to_minutes(plan.get("classStart"))
            if class_start is not None:
                entry["classStart"] = minutes_to_label(class_start)
            new_entries.append(entry)

        # Each weekday only gets ONE plan: the new ones replace the old ones for those days
        days_being_saved = {entry["day"] for entry in new_entries}
        kept = [entry for entry in user["parkingSchedule"] if entry["day"] not in days_being_saved]

        # If the same day was sent twice, the last one wins
        by_day = {entry["day"]: entry for entry in new_entries}
        kept.extend(by_day.values())

        # Keep the list in Monday -> Friday order
        kept.sort(key=lambda entry: WEEKDAYS.index(entry["day"]))

        user["parkingSchedule"] = kept
        storage.save(db)

    return ok(saved=list(by_day.values()))


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
