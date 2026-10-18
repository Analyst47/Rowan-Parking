"""
settings.py

Loads the settings from config.py (or from config_example.py if you haven't made
a config.py yet). Environment variables with the same names win, which is handy
when the site is deployed.

Use it like this:   from settings import get_setting
                    key = get_setting("GOOGLE_MAPS_KEY")
"""

import os

try:
    import config                       # your own file, not in GitHub
except ImportError:
    import config_example as config     # the empty example, so the app still starts

# The days of the week the app supports, in the order they show on the page.
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

# Semesters a student can pick when they create an account.
SEMESTERS = ["Fall 2026", "Spring 2027", "Fall 2027", "Spring 2028"]


def get_setting(name, default=None):
    """Get one setting: environment variable first, then config.py, then the default."""
    if name in os.environ:
        return os.environ[name]
    return getattr(config, name, default)
