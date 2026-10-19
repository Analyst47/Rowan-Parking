"""
storage.py

Where the app keeps its data. There are TWO databases, each its own JSON file:

  users.json         the accounts and each person's saved weekly parking plan
                     { "users": [ ... ] }
  parking_lots.json  the commuter lots and their availability numbers
                     { "modelVersion": 2, "parkingLots": [ ... ] }

There are two options, picked with STORAGE in config.py:

  "local"   - saves the two files in the data/ folder on the server. This is
              the easiest way to start and needs no accounts or keys.
  "jsonbin" - saves them in two JSONBin.io bins, using your two bin IDs and
              your API key (this is the "separate backend" from the assignment).

Both classes have the same two methods, load() and save(), so the rest of the
code doesn't care which one is being used. load() puts the two databases
together into one dictionary { "users": [...], "parkingLots": [...] }, and
save() splits it up again into the two files.
"""

import json
import os
import threading
from pathlib import Path

import requests

from campus import map_to_latlng
from seed import MODEL_VERSION, make_parking_lots, make_seed_data
from settings import get_setting

DATA_FOLDER = Path(__file__).parent / "data"

# Flask can handle two requests at the same time. This lock makes them take
# turns when they read and then rewrite the data, so one can't overwrite the other.
# Use it like:   with database_lock:  ...
database_lock = threading.RLock()


def fix_database_shape(db):
    """
    Make sure the database has the shape we expect. Returns (db, changed).

     - If the lots are missing (brand new database) we fill in the sample lots.
     - If the lots were made by an older version of the app (an older "modelVersion")
       we make them again with the current model.
     - If the anchors in config.py changed, we update every lot's latitude/longitude.

    We never touch the users list, so nobody's account gets wiped.
    "changed" is True when we fixed something, so the caller knows to save.
    """
    if not isinstance(db, dict):
        db = {}
    if not isinstance(db.get("users"), list):
        db["users"] = []

    lots = db.get("parkingLots")
    lots_are_current = (db.get("modelVersion") == MODEL_VERSION
                        and isinstance(lots, list) and len(lots) > 0)
    if not lots_are_current:
        db["parkingLots"] = make_parking_lots()
        db["modelVersion"] = MODEL_VERSION
        return db, True

    # keep the GPS positions in step with the anchors in config.py
    changed = False
    for lot in db["parkingLots"]:
        latitude, longitude = map_to_latlng(float(lot["mapX"]), float(lot["mapY"]))
        if lot.get("latitude") != latitude or lot.get("longitude") != longitude:
            lot["latitude"] = latitude
            lot["longitude"] = longitude
            changed = True
    return db, changed


def split_database(db):
    """Split the combined dictionary into the two documents we store."""
    users_doc = {"users": db["users"]}
    lots_doc = {"modelVersion": db.get("modelVersion"), "parkingLots": db["parkingLots"]}
    return users_doc, lots_doc


def join_database(users_doc, lots_doc):
    """Put the two stored documents back together (and make sure they have the right shape)."""
    users_doc = users_doc if isinstance(users_doc, dict) else {}
    lots_doc = lots_doc if isinstance(lots_doc, dict) else {}
    db = {
        "users": users_doc.get("users"),
        "parkingLots": lots_doc.get("parkingLots"),
        "modelVersion": lots_doc.get("modelVersion"),
    }
    return fix_database_shape(db)


def to_text(document):
    return json.dumps(document, indent=2)


class LocalStorage:
    """Option 1: two JSON files on the server."""

    def __init__(self, folder):
        self.users_path = Path(folder) / "users.json"
        self.lots_path = Path(folder) / "parking_lots.json"
        self.old_path = Path(folder) / "db.json"       # the single file older versions used

    def read_file(self, path):
        """Read one JSON file. Returns None if it doesn't exist yet."""
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            # The file is damaged. We stop instead of overwriting it,
            # otherwise we would delete every user's account.
            raise RuntimeError(f"{path} is not valid JSON") from error

    def load(self):
        users_doc = self.read_file(self.users_path)
        lots_doc = self.read_file(self.lots_path)

        # An older version kept everything in one file (data/db.json).
        # Split it into the two new files the first time, so nobody loses their account.
        if users_doc is None and lots_doc is None and self.old_path.exists():
            old = self.read_file(self.old_path)
            if isinstance(old, dict):
                users_doc, lots_doc = split_database(fix_database_shape(old)[0])
                self.write_file(self.users_path, users_doc)
                self.write_file(self.lots_path, lots_doc)
                os.replace(self.old_path, self.old_path.with_name("db.old.json"))

        db, changed = join_database(users_doc, lots_doc)
        # First run (a missing file) or a fix: save so the files are there next time
        if changed or users_doc is None or lots_doc is None:
            self.save(db)
        return db

    def write_file(self, path, document):
        path.parent.mkdir(exist_ok=True)
        text = to_text(document)

        # Only touch the file if something changed (saving a user shouldn't rewrite the lots)
        if path.exists() and path.read_text(encoding="utf-8") == text:
            return

        # Write to a temporary file first, then swap it in. That way a crash
        # in the middle of saving can't leave us with half a file.
        temp = path.with_suffix(".json.tmp")
        temp.write_text(text, encoding="utf-8")
        os.replace(temp, path)

    def save(self, db):
        users_doc, lots_doc = split_database(db)
        self.write_file(self.users_path, users_doc)
        self.write_file(self.lots_path, lots_doc)


# What we last read from / wrote to each JSONBin bin, so we can skip saving a bin that didn't change
last_seen_bin_text = {}


class JsonBinStorage:
    """
    Option 2: two JSONBin.io bins (one for users, one for parking lots).

    JSONBin docs: https://jsonbin.io/api-reference
    """

    def __init__(self, users_bin_id, lots_bin_id, api_key, base_url):
        self.users_bin_id = users_bin_id
        self.lots_bin_id = lots_bin_id
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def read_bin(self, bin_id):
        answer = self.request("GET", f"/b/{bin_id}/latest")
        record = answer.get("record", {})
        last_seen_bin_text[bin_id] = to_text(record)
        return record

    def write_bin(self, bin_id, document):
        text = to_text(document)
        if last_seen_bin_text.get(bin_id) == text:
            return
        self.request("PUT", f"/b/{bin_id}", document)
        last_seen_bin_text[bin_id] = text

    def load(self):
        users_doc = self.read_bin(self.users_bin_id)
        lots_doc = self.read_bin(self.lots_bin_id)
        db, changed = join_database(users_doc, lots_doc)

        # If a bin was empty (or the lots needed fixing), save so it's there next time
        if changed:
            self.save(db)
        return db

    def save(self, db):
        users_doc, lots_doc = split_database(db)
        self.write_bin(self.users_bin_id, users_doc)
        self.write_bin(self.lots_bin_id, lots_doc)

    def request(self, method, path, body=None):
        """Talk to the JSONBin API and return the answer as a dictionary."""
        try:
            response = requests.request(
                method,
                self.base_url + path,
                json=body,
                headers={"X-Master-Key": self.api_key},
                timeout=10,
            )
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as error:
            # We only show the kind of problem, never the URL or key, so
            # the API key can't leak into the logs.
            raise RuntimeError("JSONBin request failed: " + type(error).__name__) from None


def get_storage():
    """Pick the right storage class based on config.py."""
    if get_setting("STORAGE", "local") == "jsonbin":
        users_bin = get_setting("JSONBIN_USERS_BIN_ID", "")
        lots_bin = get_setting("JSONBIN_LOTS_BIN_ID", "")
        api_key = get_setting("JSONBIN_API_KEY", "")
        if not users_bin or not lots_bin or not api_key:
            raise RuntimeError('STORAGE is "jsonbin" but the two bin IDs or the API key are missing in config.py')
        return JsonBinStorage(users_bin, lots_bin, api_key, get_setting("JSONBIN_BASE_URL", "https://api.jsonbin.io/v3"))

    return LocalStorage(DATA_FOLDER)
