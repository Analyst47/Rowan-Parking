# Rowan Commuter Parking

A capstone project that helps commuter students decide where to park. A student builds
their class schedule (picking classes, buildings and start times from dropdowns, or
uploading a `.csv` / `.ics` file) and the site recommends a commuter lot **for each day**.
The recommendation weighs how far the lot is from the class building against the chance
of finding a space at the time the student will actually arrive. Everything shows on
**Rowan's own campus parking map** or on **Google Maps**. Logged-in students can save
their week (Monday to Friday). The site gives no turn-by-turn directions.

> **Note:** the availability percentages are **modeled estimates** (see `seed.py`), not
> live space counts. The course list is a **sample** and its buildings are guesses
> (the student can change the building). Walking times are approximate.

## What's in it

| Part | Tech | Files |
|------|------|-------|
| Front end | HTML (Jinja template), CSS, vanilla JavaScript, Google Maps JS API | `templates/`, `static/` |
| Back end | Python 3 + Flask (JSON API) | `app.py`, `api/`, and the other `.py` files |
| Databases (two) | JSON: `users.json` and `parking_lots.json`, stored as local files or in two JSONBin bins | `storage.py`, `data/` |

The page follows the layout from the assignment: a header with Login / Create Account,
then two panels. The **left panel has two tabs** (*Find Parking* for data entry and
*My Week* for the saved plan). The **right panel is the map**, with a switch between
Rowan's campus map and Google Maps.

The lots are the commuter lots from Rowan's 2025-2026 campus parking map:
A, B-1, C, D, D-1, F-1, J, O, R, Y and the 411 Ellis St. lot.

## Run it locally

You need Python 3.9 or newer.

```bash
# 1. install the packages (Flask and requests)
pip install -r requirements.txt

# 2. make your own config file
cp config_example.py config.py

# 3. start the site
python app.py

# 4. open http://localhost:5000
```

With the default settings (`STORAGE = "local"`) it works right away, including the
Rowan campus map. The data is saved in two files, `data/users.json` and `data/parking_lots.json`, which are created on the first request.

## Setting up the Google Maps API

The Campus Map view works without this. You only need it for the **Google Maps** view.

1. Go to <https://console.cloud.google.com> and create a project (or pick one).
2. Google requires a **billing account** on the project before the Maps APIs work.
   There is a free monthly usage allowance. Check Google's current pricing page and
   set a budget alert so you don't get surprised.
3. Open **APIs & Services > Library**, search for **Maps JavaScript API**, and click **Enable**.
4. Open **APIs & Services > Credentials > Create credentials > API key**.
5. Click the new key and add restrictions (the key is visible in the browser, so this matters):
   - **Application restrictions:** Websites (HTTP referrers). Add `http://localhost:5000/*`
     and, later, your deployed site, for example `https://yoursite.com/*`.
   - **API restrictions:** Restrict key > **Maps JavaScript API** only.
6. Paste the key into `config.py`:
   ```python
   GOOGLE_MAPS_KEY = "YOUR_KEY_HERE"
   ```
7. Reload the site and click **Google Maps** above the map. Google only loads when that
   view is opened.

If the map says the key was rejected, the usual causes are: the Maps JavaScript API isn't
enabled, billing isn't set up, or the referrer list doesn't match the address in your browser bar.

### Lining up the Google Maps view

Rowan's map is a picture, so the app has to work out where each lot is on Google Maps.
It does this by itself: the first time the Google view opens, the browser asks Google
where each campus building is (the **Geocoding API**), compares that with the building's
spot on Rowan's map, and works out a formula. The result is saved in the browser. Pins can be
about half a block off. To use this, enable the **Geocoding API** as well as the
**Maps JavaScript API** for your key (step 3 above, and add it under API restrictions in step 5).

**Optional, more exact:** set `CAMPUS_ANCHORS` in `config.py` (see `config_example.py`).
Find each landmark on <https://www.google.com/maps> in Satellite view, right-click the exact
spot, click the two numbers to copy them, and put them in as `lat` and `lng` (leave `x` and
`y` alone). With at least 3 anchors the server works out every position and the browser
doesn't need to ask Google.

### Use JSONBin instead of local files

There are two databases, so you need two bins.

1. Create two bins at [jsonbin.io](https://jsonbin.io). JSONBin does not allow an empty bin, so use:
   - users bin: `{ "users": [] }`
   - parking lots bin: `{ "parkingLots": [] }`
2. In `config.py` set:
   ```python
   STORAGE = "jsonbin"
   JSONBIN_USERS_BIN_ID = "YOUR_USERS_BIN_ID"
   JSONBIN_LOTS_BIN_ID = "YOUR_LOTS_BIN_ID"
   JSONBIN_API_KEY = "YOUR_X_MASTER_KEY"
   ```
3. The first request fills in the parking lots automatically.

## Data format

There are two databases, each its own JSON file, shaped like the examples in the assignment email. `users.json` holds `{ "users": [...] }` and `parking_lots.json` holds `{ "modelVersion": 2, "parkingLots": [...] }`. The code reads them together as one object, shown below, and saves them back into the two files. An older single `data/db.json` is split into the two files automatically the first time the app starts (and kept as `db.old.json`).
Each lot also has `shortName`, `mapX` and `mapY` (its position on the campus map picture, in percent),
and `modelVersion` (stored in `parking_lots.json`) records which version of the sample data was generated (when it changes,
the lots are regenerated and the users are kept). Saved plans can also hold `buildingId` and `classStart`.

```json
{
  "users": [
    {
      "userId": 101,
      "firstName": "Jamie",
      "lastName": "Smith",
      "email": "smith@students.rowan.edu",
      "password": "<hashed password>",
      "semester": "Fall 2026",
      "parkingSchedule": [
        { "day": "Monday", "className": "Computer Science", "arrivalTime": "10:30 AM", "parkingLotId": "LOT-A" }
      ]
    }
  ],
  "parkingLots": [
    {
      "parkingLotId": "LOT-A",
      "lotName": "Lot A",
      "shortName": "A",
      "mapX": 17.8,
      "mapY": 58.44,
      "latitude": 39.7101,
      "longitude": -75.1182,
      "availability": [
        { "day": "Monday", "time": "8:00 AM", "probability": 85 }
      ]
    }
  ]
}
```

`latitude` and `longitude` are `null` unless the anchors are set in `config.py`.

## API

All answers are JSON: `{ "ok": true, ... }` or `{ "ok": false, "error": "message" }`.
POST bodies must be sent as `application/json` (except the file upload).

| Method | URL | Body / query | Needs login |
|--------|-----|--------------|:-----------:|
| POST | `/api/account/register` | `firstName, lastName, email, password, semester` | no |
| POST | `/api/account/login` | `email, password` | no |
| POST | `/api/account/logout` | | no |
| GET | `/api/account/me` | | no |
| GET | `/api/schedule/options` | | no |
| POST | `/api/schedule/import` | multipart `file` (.csv or .ics) | no |
| POST | `/api/schedule/plan` | `classes: [{days, className, buildingId, startTime}], minutesEarly` | no |
| GET | `/api/parking/lots` | | no |
| GET | `/api/parking/schedule` | | yes |
| POST | `/api/parking/save` | `plans: [{day, className, arrivalTime, parkingLotId, buildingId, classStart}]` | yes |
| POST | `/api/parking/remove` | `day` | yes |

## Uploading a schedule

Click **Upload schedule** and choose a file. The classes it finds are put into the form so
the student can check and fix them before getting a result.

- **CSV:** columns `Days, Class, Building, Start`, for example `MW,Web Development,Engineering Hall,9:30 AM`.
  Days can be `MW`, `TR`, `Tue/Thu`, `MWF` and so on. A template is in `static/schedule_template.csv`.
- **ICS:** a calendar export (Google Calendar, Outlook, Apple). We read `SUMMARY`, `LOCATION`,
  the start time and weekly repeat days. Building names are matched loosely.
- Files are limited to 200 KB and 40 classes. Nothing is stored on the server.

## How the recommendation works

The code is in `engine.py`. For every lot it estimates how many minutes the lot would cost
the student, and the lowest wins:

```
cost = walk to the class building
     + half of the walk back to the car
     + (chance the lot is full) x 12 minutes lost finding another place
```

The chance depends on *when* the student arrives, which depends on the lot:
`park-by time = class start - minutes early - walk - 3 minutes to park`.
So a faraway lot is checked at an earlier, emptier time. The chance is read from the lot's
hourly `availability` data (smoothly between hours). If the closest lot is not the pick, the
result says why. If even the best lot is tight, it suggests arriving earlier. When a day has
several classes, the earliest decides arrival time and the last decides the walk back.

Walking distance comes from positions on Rowan's map (`campus_data.py`): about 1.9 m per map
point (an estimate) x 1.25 for paths, at 80 m per minute.

**What is real and what isn't:** building and lot positions come from Rowan's map. The
chances are generated by `seed.py` from where the lots are, how big they are (estimated)
and the time of day. Replace the `availability` data with real counts and the engine uses them unchanged.

## Project structure

```
rowan-parking/
├── app.py                  starts the site, shows the page, handles errors
├── settings.py             reads config.py (or environment variables)
├── config_example.py       copy to config.py and add your keys + anchors
├── helpers.py              small helpers for the API (errors, login check)
├── engine.py               the recommendation engine
├── parking_logic.py        time helpers, chance lookup
├── campus_data.py          buildings, lots, walking distance (from Rowan's map)
├── campus.py               map picture position -> latitude/longitude (anchors)
├── courses.py              the sample class list for the dropdown
├── schedule_import.py      reads uploaded .csv / .ics files
├── seed.py                 commuter lots + modeled availability
├── storage.py              local file storage and JSONBin storage
├── requirements.txt
├── api/
│   ├── account.py          register, login, logout, me
│   ├── schedule.py         dropdown options, upload, plan
│   └── parking.py          lots, saved week
├── templates/index.html    the page
├── static/
│   ├── schedule_template.csv   example upload file
│   ├── css/style.css
│   ├── img/rowan-campus-parking-map.webp   Rowan's campus map (cropped from the PDF)
│   └── js/
│       ├── api.js          calls to the back end
│       ├── map.js          campus map (pan/zoom/pins) and Google Maps
│       └── app.js          tabs, forms, results, My Week
└── data/                   users.json and parking_lots.json are created here (not committed)
```

## Credits

The campus map image is from Rowan University's 2025-2026 Campus & Parking Map and
belongs to Rowan University. It is used here for a class project.

## Security notes

- Passwords are hashed with Werkzeug's `generate_password_hash()` and never sent back to the browser.
- `config.py`, `data/*.json` and `data/secret_key.txt` are in `.gitignore`. Don't commit API keys.
- Restrict your Google Maps key to your site, since it is visible in the browser.
  Keep your JSONBin key private. It is only used on the server.
- Only `static/` is served as files. The data and Python code are never reachable from the browser.

## Known limits

- Availability is modeled, not live. Lot sizes are estimated. The course list is a sample.
- The Google view was written against Google's documented APIs but needs a real key to try; check the pins on your campus.
- The whole data object is read and rewritten on each save. A lock keeps one server process safe, but several servers sharing the same JSONBin bins could overwrite each other. This is fine for a class project.
- There is no password reset or email verification.

## Pushing to GitHub

```bash
cd rowan-parking
git init
git add .
git status          # check that config.py and the data/*.json files are NOT listed
git commit -m "Add parking recommendation app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```
