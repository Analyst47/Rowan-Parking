"""
schedule_import.py

Reads a schedule file that a student uploads and turns it into a list of classes.
Two kinds of files work:

  .csv  - a simple table. The columns are Days, Class, Building and Start
          (there is a template to download on the page). Example row:
              MW,Data Structures,Robinson Hall,9:30 AM

  .ics  - a calendar export (Google Calendar, Outlook and Apple Calendar can all
          make one). Each repeating event becomes a class: the title is the
          class name, the location is the building, the start time is the
          class time, and the repeat days are the class days.

Whatever we can't understand is skipped, and we tell the student about it
instead of guessing.

Every class we return looks like:
  { days: ["Monday", "Wednesday"], className: "Data Structures", courseId: "CS-DATA",
    buildingId: "BLD-07" (or None if we couldn't tell), startTime: "9:30 AM" }
"""

import csv
import difflib
import io
import re
from datetime import datetime, timezone

from campus_data import BUILDINGS
from courses import COURSES, OTHER_COURSE_ID
from parking_logic import minutes_to_label
from settings import WEEKDAYS

MAX_FILE_BYTES = 200 * 1024     # 200 KB is far more than any schedule needs
MAX_CLASSES = 40

# ---------------------------------------------------------------------------
# Days
# ---------------------------------------------------------------------------

DAY_WORDS = {
    "m": "Monday", "mon": "Monday", "monday": "Monday",
    "t": "Tuesday", "tu": "Tuesday", "tue": "Tuesday", "tues": "Tuesday", "tuesday": "Tuesday",
    "w": "Wednesday", "wed": "Wednesday", "wednesday": "Wednesday",
    "r": "Thursday", "th": "Thursday", "thu": "Thursday", "thur": "Thursday",
    "thurs": "Thursday", "thursday": "Thursday",
    "f": "Friday", "fri": "Friday", "friday": "Friday",
}

# Calendar files use two letter codes for the days
ICS_DAYS = {"MO": "Monday", "TU": "Tuesday", "WE": "Wednesday", "TH": "Thursday", "FR": "Friday"}


def parse_days(text):
    """
    Read days like "MW", "TR", "Tue/Thu", "Monday, Wednesday" or "MWF".
    Returns a list of weekday names in Monday-to-Friday order (empty if we can't tell).
    """
    found = set()
    for token in re.split(r"[\s,/&;+\-]+", text.strip().lower()):
        if not token:
            continue
        if token in DAY_WORDS:
            found.add(DAY_WORDS[token])
            continue

        # A run of letters like "mwf" or "tth": read one day at a time, "th" is Thursday
        position = 0
        while position < len(token):
            if token[position:position + 2] == "th":
                found.add("Thursday")
                position += 2
            elif token[position] in DAY_WORDS and len(token[position]) == 1:
                found.add(DAY_WORDS[token[position]])
                position += 1
            else:
                return []       # something we don't understand: better to skip it than to guess
    return [day for day in WEEKDAYS if day in found]


# ---------------------------------------------------------------------------
# Times
# ---------------------------------------------------------------------------

def parse_time(text):
    """
    Read a time like "9:30 AM", "9am", "09:30" or "14:00".
    Returns it as a label like "9:30 AM", or None if it isn't a time between 6 AM and 9 PM.
    """
    text = text.strip().lower().replace(".", "")

    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)", text)
    if match:
        hour = int(match.group(1)) % 12
        if match.group(3).startswith("p"):
            hour += 12
        minutes = hour * 60 + int(match.group(2) or 0)
    else:
        match = re.fullmatch(r"(\d{1,2}):(\d{2})", text) or re.fullmatch(r"(\d{2})(\d{2})", text)
        if not match:
            return None
        minutes = int(match.group(1)) * 60 + int(match.group(2))

    if minutes < 6 * 60 or minutes > 21 * 60 or minutes % 60 > 59:
        return None
    return minutes_to_label(minutes)


# ---------------------------------------------------------------------------
# Buildings and classes
# ---------------------------------------------------------------------------

# Other names people use for a building
BUILDING_NICKNAMES = {
    "BLD-02": ["library"],
    "BLD-03": ["student center", "csc"],
    "BLD-04": ["rec center", "recreation"],
    "BLD-05": ["gym", "esbjornson"],
}


def match_building(text):
    """Find which building a location like "Robinson Hall 204" means. Returns its id or None."""
    text = text.lower().strip()
    if not text:
        return None

    # 1. the full building name appears in the text ("Robinson Hall 204")
    for building in sorted(BUILDINGS, key=lambda item: -len(item["name"])):
        if building["name"].lower() in text:
            return building["id"]

    # 2. the first word of the name ("Robinson 204"), or a nickname ("Student Center")
    #    ("Rowan" on its own is skipped because it could mean the school itself)
    for building in BUILDINGS:
        first_word = building["name"].split()[0].lower()
        if first_word != "rowan" and re.search(r"\b" + re.escape(first_word) + r"\b", text):
            return building["id"]
    for building_id, nicknames in BUILDING_NICKNAMES.items():
        if any(nickname in text for nickname in nicknames):
            return building_id

    # 3. close spelling ("Robinsen Hall")
    names = {building["name"].lower(): building["id"] for building in BUILDINGS}
    close = difflib.get_close_matches(text, list(names), n=1, cutoff=0.75)
    return names[close[0]] if close else None


def match_course(class_name):
    """Match a class name to the dropdown list. Returns the course, or None for "Other"."""
    wanted = class_name.strip().lower()
    for course in COURSES:
        if course["title"].lower() == wanted:
            return course
    close = difflib.get_close_matches(wanted, [course["title"].lower() for course in COURSES], n=1, cutoff=0.85)
    if close:
        for course in COURSES:
            if course["title"].lower() == close[0]:
                return course
    return None


def make_class(days, class_name, location, start_time):
    """Put one class together, filling in the dropdown choices where we can."""
    class_name = class_name.strip()[:60] or "Class"
    course = match_course(class_name)
    building_id = match_building(location)
    if building_id is None and course is not None and not location.strip():
        building_id = course["building"]       # no building given: use the course's usual one

    return {
        "days": days,
        "className": course["title"] if course else class_name,
        "courseId": course["id"] if course else OTHER_COURSE_ID,
        "buildingId": building_id,
        "startTime": start_time,
    }


def remove_duplicates(classes):
    """Drop classes that are exactly the same as an earlier one."""
    seen = set()
    result = []
    for item in classes:
        key = (tuple(item["days"]), item["className"], item["buildingId"], item["startTime"])
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


# ---------------------------------------------------------------------------
# CSV files
# ---------------------------------------------------------------------------

# Column names we accept, so "Course" or "Location" work as well as "Class" and "Building"
COLUMN_NAMES = {
    "days":     ["days", "day", "meeting days", "meets"],
    "class":    ["class", "course", "name", "title", "class name", "course name"],
    "building": ["building", "location", "room", "where"],
    "start":    ["start", "start time", "time", "begins"],
}


def find_column(headers, field):
    """Find which column of the file holds a field. Returns the column's real name or None."""
    for header in headers:
        if header.strip().lower() in COLUMN_NAMES[field]:
            return header
    return None


def parse_csv(text):
    """Read a CSV schedule. Returns (classes, warnings)."""
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []

    columns = {field: find_column(headers, field) for field in COLUMN_NAMES}
    if not columns["days"] or not columns["start"]:
        return [], ["The first row needs the column names Days and Start (and ideally Class and Building). "
                    "Download the template to see the format."]

    classes = []
    warnings = []
    for number, row in enumerate(reader, start=2):      # row 1 is the header
        if len(classes) >= MAX_CLASSES:
            warnings.append("Only the first " + str(MAX_CLASSES) + " classes were read.")
            break

        def cell(field):
            column = columns[field]
            return (row.get(column) or "").strip() if column else ""

        if not any(cell(field) for field in COLUMN_NAMES):
            continue        # empty line

        days = parse_days(cell("days"))
        start_time = parse_time(cell("start"))
        if not days:
            warnings.append("Row " + str(number) + ": could not read the days '" + cell("days") + "'.")
            continue
        if not start_time:
            warnings.append("Row " + str(number) + ": could not read the start time '" + cell("start") + "'.")
            continue

        classes.append(make_class(days, cell("class"), cell("building"), start_time))

    return remove_duplicates(classes), warnings


# ---------------------------------------------------------------------------
# Calendar (.ics) files
# ---------------------------------------------------------------------------

def unfold_lines(text):
    """Calendar files break long lines and continue them on the next line starting with a space."""
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def unescape(value):
    """Undo the escaping calendar files use (\\, becomes a comma, and so on)."""
    return value.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def read_ics_events(text):
    """Split a calendar file into events, each one a dictionary of its properties."""
    events = []
    current = None
    for line in unfold_lines(text):
        if line.strip().upper() == "BEGIN:VEVENT":
            current = {}
        elif line.strip().upper() == "END:VEVENT":
            if current is not None:
                events.append(current)
            current = None
        elif current is not None and ":" in line:
            name_part, value = line.split(":", 1)
            name = name_part.split(";")[0].upper()
            current.setdefault(name, value)             # keep the first one if a property repeats
            current.setdefault(name + "_PARAMS", name_part.upper())
    return events


def read_ics_start(event):
    """
    Get the weekday and start time of an event.
    Returns (weekday number 0-6, minutes after midnight), or None (e.g. all-day events).
    """
    value = event.get("DTSTART", "").strip()
    match = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)", value)
    if not match:
        return None
    year, month, day, hour, minute = (int(match.group(i)) for i in range(1, 6))
    moment = datetime(year, month, day, hour, minute)

    if match.group(7) == "Z":
        # A time in UTC: convert it to Rowan's time zone
        try:
            from zoneinfo import ZoneInfo
            moment = moment.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("America/New_York"))
        except Exception:
            pass        # no time zone data on this computer: use the time as it is
    return moment.weekday(), moment.hour * 60 + moment.minute


def parse_ics(text):
    """Read a calendar schedule. Returns (classes, warnings)."""
    classes = []
    skipped = 0

    for event in read_ics_events(text):
        start = read_ics_start(event)
        if start is None:
            skipped += 1
            continue
        weekday, minutes = start

        # The days: from BYDAY=MO,WE in the repeat rule, otherwise just the day of the event
        days = []
        by_day = re.search(r"BYDAY=([A-Z,0-9+-]+)", event.get("RRULE", "").upper())
        if by_day:
            for code in by_day.group(1).split(","):
                code = re.sub(r"[0-9+-]", "", code)
                if code in ICS_DAYS and ICS_DAYS[code] not in days:
                    days.append(ICS_DAYS[code])
        elif weekday < 5:
            days = [WEEKDAYS[weekday]]
        days = [day for day in WEEKDAYS if day in days]
        if not days:
            skipped += 1        # weekend or unreadable events
            continue

        label = parse_time(minutes_to_label(minutes))
        if label is None:
            skipped += 1
            continue

        classes.append(make_class(days, unescape(event.get("SUMMARY", "")),
                                  unescape(event.get("LOCATION", "")), label))
        if len(classes) >= MAX_CLASSES * 3:
            break

    classes = remove_duplicates(classes)[:MAX_CLASSES]
    warnings = []
    if skipped:
        warnings.append(str(skipped) + " calendar event(s) were skipped (all-day, weekend or no readable time).")
    return classes, warnings


# ---------------------------------------------------------------------------
# The one function the route uses
# ---------------------------------------------------------------------------

def read_schedule_file(filename, data):
    """
    Read an uploaded schedule.
    filename: the name of the file (we look at its ending), data: the raw bytes.
    Returns (classes, warnings). Raises ValueError with a friendly message if the file is no good.
    """
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("That file is too big. A schedule file should be under 200 KB.")

    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("We could not read that file. Please upload a .csv or .ics file saved as text.") from None

    name = (filename or "").lower()
    if name.endswith(".csv"):
        return parse_csv(text)
    if name.endswith(".ics"):
        return parse_ics(text)
    raise ValueError("Please upload a .csv or .ics file.")
