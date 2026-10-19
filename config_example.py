"""
config_example.py

HOW TO USE:
  1. Copy this file and name the copy  config.py
  2. Fill in your own keys in config.py

config.py is listed in .gitignore, so your keys never get pushed to GitHub.
Only this example file (with empty values) goes in the repo.

(When you deploy the site you can also set these as environment variables with
the same names, for example GOOGLE_MAPS_KEY. Environment variables win.)
"""

# Where to save the two databases (users and parking lots): "local" or "jsonbin"
# "local" works right away with no setup. Switch to "jsonbin" when you want
# the data stored in your JSONBin bin instead.
STORAGE = "local"

# JSONBin settings (only used when STORAGE is "jsonbin")
JSONBIN_USERS_BIN_ID = ""    # the ID of the bin that holds the users
JSONBIN_LOTS_BIN_ID = ""     # the ID of the bin that holds the parking lots
JSONBIN_API_KEY = ""     # your X-Master-Key
JSONBIN_BASE_URL = "https://api.jsonbin.io/v3"

# Google Maps JavaScript API key. Only needed for the "Google Maps" view.
# The Rowan campus map view works without it.
GOOGLE_MAPS_KEY = ""

# Flask signs the login cookie with this secret. Use a long random string.
# If you leave it empty, one is created for you the first time the app runs
# and saved in data/secret_key.txt.
SECRET_KEY = ""

# Landmarks that appear on BOTH Rowan's campus map and Google Maps.
# x and y are where the landmark is on the campus map picture (in percent),
# so leave those alone. Fill in the real lat and lng from Google Maps
# (see "Lining up the Google Maps view" in the README). You need at least 3.
CAMPUS_ANCHORS = [
    {"name": "Richard Wacker Stadium (middle of the field)", "x": 15.0, "y": 18.0, "lat": None, "lng": None},
    {"name": "Chamberlain Student Center",                  "x": 46.1, "y": 37.9, "lat": None, "lng": None},
    {"name": "Baseball field (home plate area)",            "x": 38.1, "y": 74.5, "lat": None, "lng": None},
    {"name": "Enterprise Center (Rowan Boulevard)",         "x": 73.9, "y": 34.8, "lat": None, "lng": None},
]
