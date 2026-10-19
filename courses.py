"""
courses.py

The list of classes in the "Class" dropdown.

THIS IS A SAMPLE LIST. We do not have access to Rowan's real course catalog or
room assignments, so the courses below are common examples, and the building
next to each one is a guess at where it might meet. The student can always
change the building in the next dropdown, and can pick "Other class" to type
their own class name. To use real data, replace this list (for example with an
export from the registrar). Each entry needs:

    id        a short unique code
    title     what shows in the dropdown
    building  the id of the building it usually meets in (see campus_data.py)
"""

COURSES = [
    # Computer science, math, science
    {"id": "CS-INTRO",    "title": "Intro to Computer Science",       "building": "BLD-07"},
    {"id": "CS-DATA",     "title": "Data Structures",                 "building": "BLD-07"},
    {"id": "CS-WEB",      "title": "Web Development",                 "building": "BLD-07"},
    {"id": "CS-SOFTWARE", "title": "Software Engineering",            "building": "BLD-07"},
    {"id": "MATH-CALC1",  "title": "Calculus I",                      "building": "BLD-07"},
    {"id": "MATH-STATS",  "title": "Statistics",                      "building": "BLD-07"},
    {"id": "BIO-GEN",     "title": "General Biology",                 "building": "BLD-13"},
    {"id": "CHEM-GEN",    "title": "General Chemistry",               "building": "BLD-13"},
    {"id": "PHYS-GEN",    "title": "General Physics",                 "building": "BLD-13"},

    # Engineering
    {"id": "ENGR-INTRO",  "title": "Intro to Engineering",            "building": "BLD-10"},
    {"id": "ENGR-DESIGN", "title": "Engineering Design Studio",       "building": "BLD-10"},
    {"id": "ENGR-CLINIC", "title": "Engineering Clinic",              "building": "BLD-09"},

    # Business
    {"id": "ACCT-INTRO",  "title": "Principles of Accounting",        "building": "BLD-11"},
    {"id": "MKT-INTRO",   "title": "Principles of Marketing",         "building": "BLD-11"},
    {"id": "MGMT-INTRO",  "title": "Principles of Management",        "building": "BLD-11"},
    {"id": "ECON-MICRO",  "title": "Microeconomics",                  "building": "BLD-11"},

    # Liberal arts, communication, arts
    {"id": "ENG-COMP",    "title": "College Composition",             "building": "BLD-12"},
    {"id": "ENG-LIT",     "title": "Intro to Literature",             "building": "BLD-12"},
    {"id": "HIST-US",     "title": "U.S. History",                    "building": "BLD-17"},
    {"id": "PSY-INTRO",   "title": "Intro to Psychology",             "building": "BLD-06"},
    {"id": "SOC-INTRO",   "title": "Intro to Sociology",              "building": "BLD-06"},
    {"id": "COMM-PUBLIC", "title": "Public Speaking",                 "building": "BLD-15"},
    {"id": "COMM-MEDIA",  "title": "Media and Society",               "building": "BLD-15"},
    {"id": "ART-DRAW",    "title": "Drawing I",                       "building": "BLD-12"},
    {"id": "MUS-INTRO",   "title": "Music Appreciation",              "building": "BLD-08"},

    # Education, health, other
    {"id": "EDU-INTRO",   "title": "Intro to Education",              "building": "BLD-06"},
    {"id": "HLTH-WELL",   "title": "Health and Wellness",             "building": "BLD-05"},
    {"id": "PE-FIT",      "title": "Fitness and Conditioning",        "building": "BLD-04"},
    {"id": "LAW-INTRO",   "title": "Intro to Law and Justice",        "building": "BLD-16"},
]

# The last option in the dropdown. The student types the class name themselves.
OTHER_COURSE_ID = "OTHER"


def find_course(course_id):
    """Look up a course by its id. Returns None if there isn't one."""
    for course in COURSES:
        if course["id"] == course_id:
            return course
    return None
