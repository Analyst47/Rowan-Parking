# Rowan Commuter Parking

A capstone project that helps commuter students decide where to park. Pick the day and
time you arrive on campus and the site ranks Rowan's commuter lots by your estimated
chance of finding a spot, and shows them on **Rowan's own campus parking map** or on
**Google Maps**. Logged-in students can save one parking plan for each weekday
(Monday to Friday).

> **Note:** the availability percentages are **sample estimates** made by a simple formula
> (see `seed.py`). They are not live space counts.

## What's in it

| Part | Tech | Files |
|------|------|-------|
| Front end | HTML (Jinja template), CSS, vanilla JavaScript, Google Maps JS API | `templates/`, `static/` |
| Back end | Python 3 + Flask (JSON API) | `app.py`, `api/`, and the other `.py` files |
| Database | JSON, stored either in a local file or in a JSONBin bin | `storage.py`, `data/` |

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
Rowan campus map. The data is saved in `data/db.json`, which is created on the first request.

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

Rowan's map is a picture, so the app can't know where each lot really is on Google Maps.
We fix that with a few **anchors**: landmarks that appear on both Rowan's map and Google Maps.
You tell the app the real latitude/longitude of the landmarks, and it works out the
position of every lot from them. Takes about five minutes:

1. Open <https://www.google.com/maps> and switch to **Satellite** (bottom-left).
2. Find each landmark listed in `config_example.py` (`CAMPUS_ANCHORS`):
   Richard Wacker Stadium, Chamberlain Student Center, the baseball field and the Enterprise Center.
3. **Right-click the exact spot** (for example the middle of the football field). The first line
   of the menu shows two numbers like `39.7123, -75.1201`. Click it to copy.
4. Put them in your `config.py` as `lat` and `lng` for that anchor:
   ```python
   {"name": "Richard Wacker Stadium (middle of the field)", "x": 15.0, "y": 18.0,
    "lat": 39.7123, "lng": -75.1201},
   ```
   Leave `x` and `y` alone. They are the landmark's position on the campus map picture.
5. You need at least 3 anchors; all 4 is better. Reload the page and open the Google Maps view.
   The pins should now sit on the lots. If one looks off, re-check the anchor that is
   closest to it. You can add more anchors with the same `x` / `y` / `lat` / `lng` format.

The lot positions update automatically whenever you change the anchors.

### Use JSONBin instead of a local file

1. Create a bin at [jsonbin.io](https://jsonbin.io) with this content (JSONBin does not allow an empty bin):
   ```json
   { "users": [] }
   ```
2. In `config.py` set:
   ```python
   STORAGE = "jsonbin"
   JSONBIN_BIN_ID = "YOUR_BIN_ID"
   JSONBIN_API_KEY = "YOUR_X_MASTER_KEY"
   ```
3. The first request fills in the parking lots automatically.

## Data format

Everything is stored in one JSON object, shaped like the examples in the assignment email.
Each lot also has `shortName`, `mapX` and `mapY` (its position on the campus map picture, in percent).

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

`latitude` and `longitude` are `null` until the anchors are filled in.

## API

All answers are JSON: `{ "ok": true, ... }` or `{ "ok": false, "error": "message" }`.
POST bodies must be sent as `application/json`.

| Method | URL | Body / query | Needs login |
|--------|-----|--------------|:-----------:|
| POST | `/api/account/register` | `firstName, lastName, email, password, semester` | no |
| POST | `/api/account/login` | `email, password` | no |
| POST | `/api/account/logout` | | no |
| GET | `/api/account/me` | | no |
| GET | `/api/parking/lots` | | no |
| GET | `/api/parking/recommend?day=Monday&time=9:00 AM` | | no |
| GET | `/api/parking/schedule` | | yes |
| POST | `/api/parking/save` | `day, arrivalTime, className, parkingLotId` | yes |
| POST | `/api/parking/remove` | `day` | yes |

## How the recommendation works

For the chosen day and time, the back end looks up each lot's estimated probability
(using the availability entry closest to the chosen time), sorts the lots from highest
to lowest, and returns the list. The top lot is the recommendation.
The code is in `parking_logic.py`.

The sample availability numbers come from `seed.py`. Lots closer to the middle of
campus fill up earlier and harder than lots on the edge, and Fridays are quieter.

## Project structure

```
rowan-parking/
├── app.py                  starts the site, shows the page, handles errors
├── settings.py             reads config.py (or environment variables)
├── config_example.py       copy to config.py and add your keys + anchors
├── helpers.py              small helpers for the API (errors, login check)
├── parking_logic.py        time helpers and the ranking code
├── campus.py               map picture position -> latitude/longitude
├── seed.py                 Rowan's commuter lots + sample availability
├── storage.py              local file storage and JSONBin storage
├── requirements.txt
├── api/
│   ├── account.py          register, login, logout, me
│   └── parking.py          lots, recommend, schedule, save, remove
├── templates/index.html    the page
├── static/
│   ├── css/style.css
│   ├── img/rowan-campus-parking-map.webp   Rowan's campus map (cropped from the PDF)
│   └── js/
│       ├── api.js          calls to the back end
│       ├── map.js          campus map (pan/zoom/pins) and Google Maps
│       └── app.js          tabs, forms, results, My Week
└── data/                   db.json is created here (not committed)
```

## Credits

The campus map image is from Rowan University's 2025-2026 Campus & Parking Map and
belongs to Rowan University. It is used here for a class project.

## Security notes

- Passwords are hashed with Werkzeug's `generate_password_hash()` and never sent back to the browser.
- `config.py`, `data/db.json` and `data/secret_key.txt` are in `.gitignore`. Don't commit API keys.
- Restrict your Google Maps key to your site, since it is visible in the browser.
  Keep your JSONBin key private. It is only used on the server.
- Only `static/` is served as files. The data and Python code are never reachable from the browser.

## Known limits

- Availability is sample data, not live.
- The whole data object is read and rewritten on each save. A lock keeps one server process safe, but several servers sharing one JSONBin bin could overwrite each other. This is fine for a class project.
- There is no password reset or email verification.

## Pushing to GitHub

```bash
cd rowan-parking
git init
git add .
git status          # check that config.py and data/db.json are NOT listed
git commit -m "Add parking recommendation app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```
