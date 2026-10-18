"""
app.py - the starting point of the website.

Run it with:   python app.py
Then open:     http://localhost:5000

This file does three things:
  1. creates the Flask app and sets up the login cookie
  2. shows the one page of the site (templates/index.html)
  3. plugs in the account and parking API routes from the api/ folder
"""

import secrets
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from api.account import account
from api.parking import parking
from helpers import ApiError
from parking_logic import minutes_to_label
from settings import SEMESTERS, WEEKDAYS, get_setting

DATA_FOLDER = Path(__file__).parent / "data"


def get_secret_key():
    """
    Flask signs the login cookie with a secret key.
    Use the one from config.py if there is one. Otherwise make a random one
    the first time and save it, so people stay logged in after a restart.
    """
    key = get_setting("SECRET_KEY", "")
    if key:
        return key

    key_file = DATA_FOLDER / "secret_key.txt"
    if key_file.exists():
        return key_file.read_text().strip()

    DATA_FOLDER.mkdir(exist_ok=True)
    key = secrets.token_hex(32)
    key_file.write_text(key)
    return key


app = Flask(__name__)
app.config.update(
    SECRET_KEY=get_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,       # JavaScript can't read the login cookie
    SESSION_COOKIE_SAMESITE="Lax",
)

app.register_blueprint(account)
app.register_blueprint(parking)


@app.get("/")
def home():
    # every 30 minutes from 7:00 AM to 6:00 PM, for the arrival time dropdown
    times = [minutes_to_label(m) for m in range(7 * 60, 18 * 60 + 1, 30)]

    # settings the JavaScript needs
    client_settings = {
        "mapsKey": get_setting("GOOGLE_MAPS_KEY", ""),
        "weekdays": WEEKDAYS,
    }
    return render_template("index.html", weekdays=WEEKDAYS, semesters=SEMESTERS,
                           times=times, settings=client_settings)


# ---------------------------------------------------------------------------
# Errors. The API always answers with JSON so the front end can show the message.
# ---------------------------------------------------------------------------

@app.errorhandler(ApiError)
def handle_api_error(error):
    return jsonify(ok=False, error=error.message), error.status


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    # Normal HTTP errors (404 page not found, 405 wrong method...) keep their own status
    if isinstance(error, HTTPException):
        if request.path.startswith("/api/"):
            return jsonify(ok=False, error=error.description), error.code
        return error

    # Anything else is a bug or a problem with the database. The real message
    # goes in the server log, and the user just gets a friendly one.
    app.logger.exception("Unexpected error")
    return jsonify(ok=False, error="Something went wrong on the server. Please try again."), 500


@app.after_request
def add_headers(response):
    # API answers contain personal data, so the browser shouldn't keep a copy
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    app.run(debug=True, port=5000)
