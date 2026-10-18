"""
campus.py

Turns a spot on Rowan's campus map picture into a real latitude/longitude,
so the same lot can also be shown on Google Maps.

HOW IT WORKS
Every lot has a position on the map picture: mapX and mapY, written as a percent
(0,0 is the top-left corner of the picture, 100,100 is the bottom-right).

We can't know the real GPS spot of a lot just from a picture. So in config.py
you give us the real latitude/longitude of 3 or more landmarks that are also on
the picture ("anchors"). From those we work out a formula that converts any
spot on the picture to GPS. If the anchors aren't filled in yet, the lat/lng
stay empty (None) and the Google view just has no lot pins.
"""

from settings import get_setting


def get_campus_anchors():
    """Get the anchors that are filled in (they need a lat and a lng)."""
    anchors = []
    for anchor in get_setting("CAMPUS_ANCHORS", []):
        lat = anchor.get("lat")
        lng = anchor.get("lng")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            anchors.append(anchor)
    return anchors


def determinant(m):
    """Determinant of a 3x3 matrix (a list of three rows)."""
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def solve_3x3(matrix, right_side):
    """
    Solve a 3x3 system of equations with Cramer's rule.
    Returns [a, b, c], or None if there is no single answer.
    """
    d = determinant(matrix)
    if abs(d) < 1e-9:
        return None     # the anchors are in a straight line, so we can't solve it

    answer = []
    for col in range(3):
        copy = [row[:] for row in matrix]
        for row in range(3):
            copy[row][col] = right_side[row]    # swap one column for the right-hand side
        answer.append(determinant(copy) / d)
    return answer


def build_map_formula():
    """
    Work out the formulas:  lat = a*x + b*y + c   and   lng = d*x + e*y + f
    using all the anchors (a "least squares" fit, so extra anchors make it more accurate).
    Returns None when there are fewer than 3 usable anchors.
    """
    anchors = get_campus_anchors()
    if len(anchors) < 3:
        return None

    # add up the sums the least squares method needs
    sxx = sxy = syy = sx = sy = 0.0
    sx_lat = sy_lat = s_lat = sx_lng = sy_lng = s_lng = 0.0
    for a in anchors:
        x, y = float(a["x"]), float(a["y"])
        sxx += x * x
        sxy += x * y
        syy += y * y
        sx += x
        sy += y
        sx_lat += x * a["lat"]
        sy_lat += y * a["lat"]
        s_lat += a["lat"]
        sx_lng += x * a["lng"]
        sy_lng += y * a["lng"]
        s_lng += a["lng"]

    matrix = [
        [sxx, sxy, sx],
        [sxy, syy, sy],
        [sx, sy, len(anchors)],
    ]
    lat_part = solve_3x3(matrix, [sx_lat, sy_lat, s_lat])
    lng_part = solve_3x3(matrix, [sx_lng, sy_lng, s_lng])
    if lat_part is None or lng_part is None:
        return None
    return {"lat": lat_part, "lng": lng_part}


def map_to_latlng(x, y):
    """
    Convert a spot on the map picture (in percent) to (latitude, longitude).
    Gives (None, None) if the anchors haven't been set up.
    """
    formula = build_map_formula()
    if formula is None:
        return None, None

    lat = formula["lat"][0] * x + formula["lat"][1] * y + formula["lat"][2]
    lng = formula["lng"][0] * x + formula["lng"][1] * y + formula["lng"][2]
    return round(lat, 6), round(lng, 6)
