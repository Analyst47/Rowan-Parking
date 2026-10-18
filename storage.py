"""
storage.py

Where the app keeps its data (users and parking lots).
There are two options, picked with STORAGE in config.py:

  "local"   - saves everything in data/db.json on the server. This is the
              easiest way to start and needs no accounts or keys.
  "jsonbin" - saves everything in a JSONBin.io bin, using your bin ID and
              API key (this is the "separate backend" from the assignment).

Both classes have the same two methods, load() and save(), so the rest of the
code doesn't care which one is being used.
"""

import json
import os
import threading
from pathlib import Path

import requests

from campus import map_to_latlng
from seed import make_parking_lots, make_seed_data
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
     - If the lots are from an older version of the app (no map positions) we replace them.
     - If the anchors in config.py changed, we update every lot's latitude/longitude.

    We never touch the users list, so nobody's account gets wiped.
    "changed" is True when we fixed something, so the caller knows to save.
    """
    if not isinstance(db, dict):
        db = {}
    if not isinstance(db.get("users"), list):
        db["users"] = []

    lots = db.get("parkingLots")
    lots_are_current = isinstance(lots, list) and len(lots) > 0 and "mapX" in lots[0]
    if not lots_are_current:
        db["parkingLots"] = make_parking_lots()
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


class LocalStorage:
    """Option 1: a JSON file on the server."""

    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        # First run: no file yet, so create one with the starting data
        if not self.path.exists():
            db = make_seed_data()
            self.save(db)
            return db

        try:
            db = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            # The file is damaged. We stop instead of overwriting it,
            # otherwise we would delete every user's account.
            raise RuntimeError(f"{self.path} is not valid JSON") from error

        db, changed = fix_database_shape(db)
        if changed:
            self.save(db)
        return db

    def save(self, db):
        self.path.parent.mkdir(exist_ok=True)

        # Write to a temporary file first, then swap it in. That way a crash
        # in the middle of saving can't leave us with half a file.
        temp = self.path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(db, indent=2), encoding="utf-8")
        os.replace(temp, self.path)


class JsonBinStorage:
    """
    Option 2: a JSONBin.io bin.

    JSONBin docs: https://jsonbin.io/api-reference
    We keep ONE bin that holds { "users": [...], "parkingLots": [...] }.
    """

    def __init__(self, bin_id, api_key, base_url):
        self.bin_id = bin_id
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def load(self):
        answer = self.request("GET", f"/b/{self.bin_id}/latest")
        db, changed = fix_database_shape(answer.get("record", {}))

        # If the bin was empty (or the lots needed fixing), save so it's there next time
        if changed:
            self.save(db)
        return db

    def save(self, db):
        self.request("PUT", f"/b/{self.bin_id}", db)

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
        bin_id = get_setting("JSONBIN_BIN_ID", "")
        api_key = get_setting("JSONBIN_API_KEY", "")
        if not bin_id or not api_key:
            raise RuntimeError('STORAGE is "jsonbin" but the bin ID or API key is missing in config.py')
        return JsonBinStorage(bin_id, api_key, get_setting("JSONBIN_BASE_URL", "https://api.jsonbin.io/v3"))

    return LocalStorage(DATA_FOLDER / "db.json")
