"""
api/account.py

Everything about user accounts. The browser calls it like:
  POST /api/account/register   { firstName, lastName, email, password, semester }
  POST /api/account/login      { email, password }
  POST /api/account/logout
  GET  /api/account/me         (who is logged in right now?)

Every answer is JSON: { ok: true, ... } or { ok: false, error: "..." }
"""

import re

from flask import Blueprint, session
from werkzeug.security import check_password_hash, generate_password_hash

from helpers import ApiError, ok, public_user, read_json_body
from settings import SEMESTERS
from storage import database_lock, get_storage

account = Blueprint("account", __name__, url_prefix="/api/account")

# Used when someone logs in with an email we don't know. We still check their
# password against this fake hash so the response takes about the same time
# either way (otherwise the timing could reveal which emails have accounts).
FAKE_HASH = generate_password_hash("not-a-real-password")


def find_user_by_email(db, email):
    """Find a user by email (capital letters don't matter). Returns the user or None."""
    for user in db["users"]:
        if user["email"].lower() == email.lower():
            return user
    return None


@account.get("/me")
def me():
    user = None
    if session.get("userId"):
        with database_lock:
            db = get_storage().load()
        for u in db["users"]:
            if u["userId"] == session["userId"]:
                user = public_user(u)

    # Not being logged in isn't an error, so we answer with user: null
    return ok(user=user)


@account.post("/register")
def register():
    body = read_json_body()

    first_name = str(body.get("firstName", "")).strip()
    last_name = str(body.get("lastName", "")).strip()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    semester = str(body.get("semester", ""))

    # --- check everything the user typed ---
    if not first_name or not last_name:
        raise ApiError("Please enter your first and last name.")
    if len(first_name) > 50 or len(last_name) > 50:
        raise ApiError("Names can be at most 50 characters.")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 120:
        raise ApiError("Please enter a valid email address.")
    if len(password) < 8 or len(password) > 72:
        raise ApiError("Your password must be between 8 and 72 characters.")
    if semester not in SEMESTERS:
        raise ApiError("Please pick a semester from the list.")

    with database_lock:
        storage = get_storage()
        db = storage.load()

        if find_user_by_email(db, email):
            raise ApiError("An account with that email already exists. Try logging in.", 409)

        # userId = one more than the biggest id so far (the first user gets 101)
        next_id = max([100] + [u["userId"] for u in db["users"]]) + 1

        new_user = {
            "userId": next_id,
            "firstName": first_name,
            "lastName": last_name,
            "email": email,
            "password": generate_password_hash(password),   # never store the plain password!
            "semester": semester,
            "parkingSchedule": [],
        }
        db["users"].append(new_user)
        storage.save(db)

    # Log them in right away
    session.clear()
    session["userId"] = new_user["userId"]
    return ok(user=public_user(new_user)), 201


@account.post("/login")
def login():
    body = read_json_body()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))

    with database_lock:
        db = get_storage().load()
    user = find_user_by_email(db, email)

    password_ok = check_password_hash(user["password"] if user else FAKE_HASH, password)

    # We give the same message for "no such email" and "wrong password"
    # so nobody can use the form to find out which emails have accounts.
    if not user or not password_ok:
        raise ApiError("Incorrect email or password.", 401)

    session.clear()
    session["userId"] = user["userId"]
    return ok(user=public_user(user))


@account.post("/logout")
def logout():
    session.clear()
    return ok()
