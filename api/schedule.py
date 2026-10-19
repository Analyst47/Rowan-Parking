"""
api/schedule.py

Everything about a student's CLASS schedule and getting parking advice from it.

  GET  /api/schedule/options   the dropdown lists (classes, buildings, times)
  POST /api/schedule/import    upload a .csv or .ics file, get the classes in it back
  POST /api/schedule/plan      { classes: [...], minutesEarly } -> the best lot for each day

None of these need a login. Saving the plan to an account is in api/parking.py.
"""

from flask import Blueprint, request

from campus_data import BUILDINGS, building_summary, find_building
from courses import COURSES, OTHER_COURSE_ID
from engine import plan_week
from helpers import ApiError, ok, read_json_body
from parking_logic import minutes_to_label, time_to_minutes
from schedule_import import MAX_CLASSES, MAX_FILE_BYTES, read_schedule_file
from settings import WEEKDAYS
from storage import database_lock, get_storage

schedule = Blueprint("schedule", __name__, url_prefix="/api/schedule")

# How many minutes before class the student wants to be at the door
EARLY_CHOICES = [5, 10, 15, 20, 30]
DEFAULT_EARLY = 10


def class_start_times():
    """Every 15 minutes from 7:00 AM to 8:00 PM, for the start time dropdown."""
    return [minutes_to_label(minutes) for minutes in range(7 * 60, 20 * 60 + 1, 15)]


@schedule.get("/options")
def options():
    return ok(
        weekdays=WEEKDAYS,
        courses=[{"courseId": c["id"], "title": c["title"], "buildingId": c["building"]} for c in COURSES],
        otherCourseId=OTHER_COURSE_ID,
        buildings=[building_summary(b) for b in BUILDINGS],
        startTimes=class_start_times(),
        earlyChoices=EARLY_CHOICES,
        defaultEarly=DEFAULT_EARLY,
    )


@schedule.post("/import")
def import_file():
    # This route only reads the file and sends back what it found. It doesn't
    # change anything on the server, so it doesn't need a login.
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise ApiError("Please choose a .csv or .ics file to upload.")

    data = upload.stream.read(MAX_FILE_BYTES + 1)       # read a little extra to notice a too-big file
    try:
        classes, warnings = read_schedule_file(upload.filename, data)
    except ValueError as error:
        raise ApiError(str(error)) from None

    if not classes:
        message = "We could not find any classes in that file."
        if warnings:
            message += " " + warnings[0]
        raise ApiError(message)
    return ok(classes=classes, warnings=warnings)


def check_classes(raw_classes):
    """
    Check the classes the browser sent and turn them into what the engine needs.
    Raises an ApiError with a friendly message if something is wrong.
    """
    if not isinstance(raw_classes, list) or not raw_classes:
        raise ApiError("Add at least one class first.")
    if len(raw_classes) > MAX_CLASSES:
        raise ApiError("That is a lot of classes! The most we can plan is " + str(MAX_CLASSES) + ".")

    classes = []
    for number, raw in enumerate(raw_classes, start=1):
        if not isinstance(raw, dict):
            raise ApiError("Class " + str(number) + " is not valid.")
        label = "Class " + str(number)

        days = raw.get("days")
        if not isinstance(days, list) or not days or any(day not in WEEKDAYS for day in days):
            raise ApiError(label + ": pick at least one day from Monday to Friday.")

        if find_building(raw.get("buildingId")) is None:
            raise ApiError(label + ": pick the building the class is in.")

        start_minutes = time_to_minutes(raw.get("startTime"))
        if start_minutes is None:
            raise ApiError(label + ": pick a start time.")

        classes.append({
            "days": [day for day in WEEKDAYS if day in days],
            "className": str(raw.get("className", "")).strip()[:60] or "Class",
            "buildingId": raw["buildingId"],
            "startMinutes": start_minutes,
        })
    return classes


@schedule.post("/plan")
def plan():
    body = read_json_body()
    classes = check_classes(body.get("classes"))

    minutes_early = body.get("minutesEarly", DEFAULT_EARLY)
    if minutes_early not in EARLY_CHOICES:
        raise ApiError("Please pick how early you want to arrive.")

    with database_lock:
        db = get_storage().load()

    plans = plan_week(db, classes, minutes_early)
    if not plans:
        raise ApiError("We do not have parking data for those times yet.", 404)
    return ok(plans=plans, minutesEarly=minutes_early)
