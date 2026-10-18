"""
helpers.py

Small functions shared by the account and parking routes.
"""

from flask import jsonify, request, session


class ApiError(Exception):
    """
    Raise this anywhere in a route to stop and send an error back to the browser.
    The front end looks for { ok: false, error: "..." }.
    """

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def read_json_body():
    """
    Read the JSON body of a POST request and return it as a dictionary.

    We insist on the application/json content type. A web page on a different
    site can't send that kind of request to us without our permission, so this
    also protects against cross-site request forgery (CSRF).
    """
    if not request.is_json:
        raise ApiError("Requests must be sent as JSON.", 415)

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError("The request body was not valid JSON.")
    return body


def require_login():
    """Return the id of the logged-in user, or stop with a 401 error."""
    user_id = session.get("userId")
    if not user_id:
        raise ApiError("Please log in first.", 401)
    return user_id


def public_user(user):
    """A copy of a user without the password, safe to send to the browser."""
    return {
        "userId": user["userId"],
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "email": user["email"],
        "semester": user["semester"],
    }


def ok(**data):
    """Send back { ok: true, ...whatever we pass in }."""
    return jsonify(ok=True, **data)
