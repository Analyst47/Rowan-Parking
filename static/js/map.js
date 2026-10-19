/**
 * map.js
 *
 * The right side of the page. There are two views of the same parking lots:
 *
 *   1. "Campus Map"  - Rowan's own campus and parking map (a picture). You can
 *                      drag it, zoom it, and the lots are pins on top of it.
 *   2. "Google Maps" - a normal Google map with the same pins. Google only loads
 *                      when you open this view, so it doesn't use up API calls
 *                      for people who never click it.
 *
 * app.js talks to this file through the ParkingMap object at the very bottom:
 *
 *   ParkingMap.init(lots, buildings)  draw a pin for every lot
 *   ParkingMap.select(lotId, text)    highlight one lot and move the map to it
 *   ParkingMap.showBuilding(id)       mark the building the student has class in
 *   ParkingMap.showChances(ranking)   put the % chance on each pin after a search
 *   ParkingMap.onLotClick = fn        app.js sets this to hear when a pin is clicked
 */

// ---------------------------------------------------------------------------
// Things both views share
// ---------------------------------------------------------------------------

const CAMPUS_IMAGE = { width: 2200, height: 1283 };   // size of the campus map picture
const CAMPUS_CENTER = { lat: 39.7109, lng: -75.1184 }; // where the Google map starts (Rowan's spot on Wikipedia)

// A box around campus. We use it to ignore Google results that are somewhere else.
const CAMPUS_BOUNDS = { north: 39.725, south: 39.695, east: -75.100, west: -75.135 };
const MAX_DISTANCE_FROM_CENTER = 1500;     // meters

let lots = [];               // every parking lot from the server
let buildings = [];          // every class building from the server
let selectedBuildingId = null;   // the building the student has class in (or null)
let chances = {};            // lotId -> probability, filled in after a search
let selectedLotId = null;    // the lot that is highlighted
let selectedText = '';       // the text shown in the pop-up for that lot
let currentView = 'campus';  // 'campus' or 'google'
let allPins = [];            // every pin element on the page: { lotId, element, inCampusView }

function findLot(lotId) {
    return lots.find((lot) => lot.parkingLotId === lotId);
}

function findBuilding(buildingId) {
    return buildings.find((building) => building.buildingId === buildingId);
}

/** green / amber / red depending on the chance */
function chanceLevel(probability) {
    if (probability >= 70) return 'good';
    if (probability >= 40) return 'ok';
    return 'low';
}

/**
 * Build one pin (the little label with the lot name on it).
 * We make a separate pin for each view because an element can only be in one place.
 */
function makePin(lot, inCampusView) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    pin.setAttribute('aria-label', lot.lotName);

    const name = document.createElement('span');
    name.className = 'pin-name';
    name.textContent = lot.shortName;
    pin.appendChild(name);

    pin.addEventListener('click', () => {
        if (ParkingMap.onLotClick) {
            ParkingMap.onLotClick(lot.parkingLotId);
        }
    });

    allPins.push({ lotId: lot.parkingLotId, element: pin, inCampusView: inCampusView });
    return pin;
}

/**
 * Update the look of every pin: selected or not, and the % chance if we have one.
 */
function refreshPins() {
    allPins.forEach((item) => {
        const pin = item.element;
        const isSelected = item.lotId === selectedLotId;
        const probability = chances[item.lotId];

        pin.classList.toggle('is-selected', isSelected);

        // the small % badge under the pin
        let badge = pin.querySelector('.pin-chance');
        if (probability === undefined) {
            if (badge) badge.remove();
        } else {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'pin-chance';
                pin.appendChild(badge);
            }
            badge.textContent = probability + '%';
            badge.className = 'pin-chance chance-bg-' + chanceLevel(probability);
        }

        // the pop-up above the selected pin (campus view only, Google has its own)
        let callout = pin.querySelector('.pin-callout');
        if (isSelected && item.inCampusView) {
            if (!callout) {
                callout = document.createElement('span');
                callout.className = 'pin-callout';
                pin.appendChild(callout);
            }
            const lot = findLot(item.lotId);
            callout.textContent = '';
            const title = document.createElement('strong');
            title.textContent = lot.lotName;
            const text = document.createElement('span');
            text.textContent = selectedText || 'Selected parking lot';
            callout.append(title, text);
        } else if (callout) {
            callout.remove();
        }
    });
}

/** Switch between the two views. */
function showView(name) {
    currentView = name;
    document.getElementById('campusView').hidden = name !== 'campus';
    document.getElementById('googleView').hidden = name !== 'google';

    const campusButton = document.getElementById('viewCampus');
    const googleButton = document.getElementById('viewGoogle');
    campusButton.classList.toggle('is-active', name === 'campus');
    googleButton.classList.toggle('is-active', name === 'google');
    campusButton.setAttribute('aria-pressed', name === 'campus');
    googleButton.setAttribute('aria-pressed', name === 'google');

    if (name === 'campus') {
        measureCampus();
    } else {
        openGoogleView();
    }
    showSelectedLot();
}

/** Move whichever map is showing to the selected lot. */
function showSelectedLot() {
    if (!selectedLotId) {
        return;
    }
    if (currentView === 'campus') {
        focusCampusOn(selectedLotId);
    } else {
        focusGoogleOn(selectedLotId);
    }
}


// ---------------------------------------------------------------------------
// View 1: Rowan's campus map (a picture you can drag and zoom)
// ---------------------------------------------------------------------------

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

const campus = {
    scale: 1,        // how zoomed in we are (1 = whole map visible)
    x: 0,            // how far the picture has been dragged (in pixels)
    y: 0,
    baseWidth: 0,    // size of the picture when scale is 1
    baseHeight: 0,
    boxWidth: 0,     // size of the box the picture sits in
    boxHeight: 0,
};

/**
 * Work out how big the picture is when the whole thing fits in the box.
 * Runs at start-up, when the window is resized, and when the view is shown.
 */
function measureCampus() {
    const viewport = document.getElementById('campusViewport');
    const stage = document.getElementById('campusStage');
    const box = viewport.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
        return;     // the view is hidden right now, we'll measure when it's shown
    }

    const ratio = CAMPUS_IMAGE.width / CAMPUS_IMAGE.height;
    campus.boxWidth = box.width;
    campus.boxHeight = box.height;
    campus.baseWidth = Math.min(box.width, box.height * ratio);
    campus.baseHeight = campus.baseWidth / ratio;

    stage.style.width = campus.baseWidth + 'px';
    stage.style.height = campus.baseHeight + 'px';
    drawCampus();
}

/** Don't let the picture be dragged completely out of view. */
function keepCampusInBox() {
    const width = campus.baseWidth * campus.scale;
    const height = campus.baseHeight * campus.scale;

    if (width <= campus.boxWidth) {
        campus.x = (campus.boxWidth - width) / 2;      // smaller than the box: center it
    } else {
        campus.x = Math.min(0, Math.max(campus.boxWidth - width, campus.x));
    }
    if (height <= campus.boxHeight) {
        campus.y = (campus.boxHeight - height) / 2;
    } else {
        campus.y = Math.min(0, Math.max(campus.boxHeight - height, campus.y));
    }
}

/** Apply the current zoom and drag to the picture. */
function drawCampus() {
    keepCampusInBox();
    const stage = document.getElementById('campusStage');
    stage.style.transform = 'translate(' + campus.x + 'px, ' + campus.y + 'px) scale(' + campus.scale + ')';
    stage.style.setProperty('--zoom', campus.scale);   // pins use this to stay the same size
}

/** Zoom to a new level, keeping the point (pointX, pointY) in the box where it is. */
function zoomCampusTo(newScale, pointX, pointY) {
    newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newScale));
    const change = newScale / campus.scale;
    campus.x = pointX - (pointX - campus.x) * change;
    campus.y = pointY - (pointY - campus.y) * change;
    campus.scale = newScale;
    drawCampus();
}

/** Do something with a short slide animation (used by the buttons and "select"). */
function animateCampus(change) {
    const stage = document.getElementById('campusStage');
    stage.classList.add('is-animating');
    change();
    setTimeout(() => stage.classList.remove('is-animating'), 400);
}

/**
 * Zoom in on a lot and put it near the middle of the box.
 * If the student has a class building marked, zoom so the lot AND the building are both in view.
 */
function focusCampusOn(lotId) {
    const lot = findLot(lotId);
    if (!lot || campus.baseWidth === 0) {
        return;
    }
    const building = findBuilding(selectedBuildingId);

    animateCampus(() => {
        const points = building ? [lot, building] : [lot];
        const xs = points.map((point) => point.mapX / 100 * campus.baseWidth);
        const ys = points.map((point) => point.mapY / 100 * campus.baseHeight);
        const spanX = Math.max(...xs) - Math.min(...xs);
        const spanY = Math.max(...ys) - Math.min(...ys);

        // The biggest zoom that still fits both points (with room around them), but not too far in or out
        let scale = Math.min(campus.boxWidth * 0.6 / Math.max(spanX, 1), campus.boxHeight * 0.5 / Math.max(spanY, 1));
        scale = Math.min(MAX_ZOOM - 0.5, Math.max(2.2, scale));

        const middleX = (Math.max(...xs) + Math.min(...xs)) / 2;
        const middleY = (Math.max(...ys) + Math.min(...ys)) / 2;
        campus.scale = scale;
        campus.x = campus.boxWidth / 2 - middleX * scale;
        campus.y = campus.boxHeight * 0.58 - middleY * scale;   // a bit low, so the pop-up has room
        drawCampus();
    });
}

/** Show the whole map again. */
function resetCampus() {
    animateCampus(() => {
        campus.scale = 1;
        drawCampus();
    });
}

/**
 * Set up dragging, the mouse wheel, pinching on a phone, and the + / - buttons.
 */
function setUpCampusControls() {
    const viewport = document.getElementById('campusViewport');
    const pointers = new Map();     // fingers / mouse currently touching the map
    let dragged = false;            // did the user actually drag (so we can ignore the click)?
    let lastPinchDistance = 0;

    viewport.addEventListener('pointerdown', (event) => {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        dragged = false;
        lastPinchDistance = 0;
    });

    viewport.addEventListener('pointermove', (event) => {
        const previous = pointers.get(event.pointerId);
        if (!previous) {
            return;
        }
        const now = { x: event.clientX, y: event.clientY };

        if (pointers.size === 1) {
            // one finger or the mouse: drag the map
            const dx = now.x - previous.x;
            const dy = now.y - previous.y;
            if (!dragged && Math.hypot(dx, dy) < 4) {
                return;     // tiny wiggles still count as a click on a pin
            }
            if (!dragged) {
                dragged = true;
                viewport.setPointerCapture(event.pointerId);
                viewport.classList.add('is-dragging');
            }
            campus.x += dx;
            campus.y += dy;
            drawCampus();
        } else if (pointers.size === 2) {
            // two fingers: pinch to zoom
            pointers.set(event.pointerId, now);
            const [a, b] = [...pointers.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (lastPinchDistance > 0) {
                const rect = viewport.getBoundingClientRect();
                zoomCampusTo(campus.scale * distance / lastPinchDistance,
                             (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
            }
            lastPinchDistance = distance;
            dragged = true;
        }
        pointers.set(event.pointerId, now);
    });

    const letGo = (event) => {
        pointers.delete(event.pointerId);
        lastPinchDistance = 0;
        if (pointers.size === 0) {
            viewport.classList.remove('is-dragging');
        }
    };
    viewport.addEventListener('pointerup', letGo);
    viewport.addEventListener('pointercancel', letGo);

    // After a drag the browser also sends a "click". Ignore it so a drag that ends
    // on top of a pin doesn't select that lot by accident.
    viewport.addEventListener('click', (event) => {
        if (dragged) {
            event.stopPropagation();
            event.preventDefault();
            dragged = false;
        }
    }, true);

    // Mouse wheel (and trackpad pinch) zooms where the cursor is
    viewport.addEventListener('wheel', (event) => {
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const speed = event.ctrlKey ? 0.01 : 0.0015;
        zoomCampusTo(campus.scale * Math.exp(-event.deltaY * speed),
                     event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    // Double click zooms in a step
    viewport.addEventListener('dblclick', (event) => {
        if (event.target.closest('.pin')) {
            return;
        }
        const rect = viewport.getBoundingClientRect();
        animateCampus(() => zoomCampusTo(campus.scale * 1.8, event.clientX - rect.left, event.clientY - rect.top));
    });

    // The + / - / reset buttons zoom around the middle of the box
    document.getElementById('zoomIn').addEventListener('click', () => {
        animateCampus(() => zoomCampusTo(campus.scale * 1.5, campus.boxWidth / 2, campus.boxHeight / 2));
    });
    document.getElementById('zoomOut').addEventListener('click', () => {
        animateCampus(() => zoomCampusTo(campus.scale / 1.5, campus.boxWidth / 2, campus.boxHeight / 2));
    });
    document.getElementById('zoomReset').addEventListener('click', resetCampus);

    // Re-fit the picture when the window changes size
    window.addEventListener('resize', measureCampus);
}

let campusBuildingPin = null;     // the marker for the student's class building on the campus map

/** Make the little marker that shows the building ("Robinson Hall"). */
function makeBuildingPin(building) {
    const pin = document.createElement('div');
    pin.className = 'building-pin';
    const label = document.createElement('span');
    label.className = 'building-pin-label';
    label.textContent = building.name;
    pin.appendChild(label);
    return pin;
}

/** Show (or hide) the building marker on the campus map. */
function updateCampusBuildingPin() {
    const building = findBuilding(selectedBuildingId);
    if (campusBuildingPin) {
        campusBuildingPin.remove();
        campusBuildingPin = null;
    }
    if (!building) {
        return;
    }
    campusBuildingPin = makeBuildingPin(building);
    campusBuildingPin.style.setProperty('--x', building.mapX + '%');
    campusBuildingPin.style.setProperty('--y', building.mapY + '%');
    document.getElementById('campusStage').appendChild(campusBuildingPin);
}

/** Put the pins on the campus map. */
function addCampusPins() {
    const stage = document.getElementById('campusStage');
    lots.forEach((lot) => {
        const pin = makePin(lot, true);
        pin.style.setProperty('--x', lot.mapX + '%');
        pin.style.setProperty('--y', lot.mapY + '%');
        stage.appendChild(pin);
    });
}


// ---------------------------------------------------------------------------
// View 2: Google Maps
// ---------------------------------------------------------------------------

let googleMap = null;
let googleInfo = null;
let googleMarkers = {};              // lotId -> marker
let googleBuildingMarker = null;     // the marker for the student's class building
let googleStatus = 'not-loaded';     // 'not-loaded', 'loading', 'ready' or 'failed'

/** Add the Google Maps script to the page and wait for it to finish loading. */
function loadGoogleScript(apiKey) {
    return new Promise((resolve, reject) => {
        window.onGoogleMapsLoaded = resolve;       // Google calls this when it's ready
        window.gm_authFailure = () => {            // Google calls this when the key is rejected
            showGoogleMessage('Google Maps rejected the API key. Check the key and its restrictions in Google Cloud Console.');
        };

        const script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) +
                     '&loading=async&callback=onGoogleMapsLoaded&v=weekly';
        script.async = true;
        script.onerror = () => reject(new Error('Could not load Google Maps. Check your internet connection.'));
        document.head.appendChild(script);
    });
}

/** Replace the Google map with a short message. */
function showGoogleMessage(text) {
    const box = document.getElementById('googleMap');
    box.innerHTML = '';
    const message = document.createElement('div');
    message.className = 'map-message';
    const title = document.createElement('strong');
    title.textContent = 'Google Maps is not available';
    const body = document.createElement('p');
    body.textContent = text;
    message.append(title, body);
    box.appendChild(message);
    googleStatus = 'failed';
}

/** Show a note above the Google map (or hide it when the text is empty). */
function setGoogleNote(text) {
    const note = document.getElementById('googleNote');
    note.textContent = text;
    note.hidden = !text;
}


// --- Lining up Rowan's map with Google Maps ---------------------------------
//
// Rowan's map is a picture, so we don't know the latitude/longitude of each lot.
// But Google DOES know where the buildings are. So the first time the Google view
// opens, we ask Google's Geocoder where each building is, and compare that with
// where the building is on Rowan's map. That gives us a formula to turn any spot
// on Rowan's map into a latitude and longitude (a straight "fit", worked out with
// least squares). We keep the result in the browser so it only happens once.

const FIT_STORAGE_KEY = 'rowan-parking-map-fit-v1';

/** Distance in meters between two latitude/longitude points (close enough for a campus). */
function metersBetween(lat1, lng1, lat2, lng2) {
    const metersPerDegree = 111320;
    const dLat = (lat2 - lat1) * metersPerDegree;
    const dLng = (lng2 - lng1) * metersPerDegree * Math.cos(lat1 * Math.PI / 180);
    return Math.hypot(dLat, dLng);
}

/**
 * Find the formula   lat = a*x + b*y + c   and   lng = d*x + e*y + f   that best matches
 * the points (x, y = spot on Rowan's map in percent; lat, lng = where Google says it is).
 * Returns null if the points can't give an answer (for example they are all in a line).
 */
function fitMapToLatLng(points) {
    const n = points.length;
    const mean = (key) => points.reduce((sum, point) => sum + point[key], 0) / n;
    const mx = mean('x'), my = mean('y'), mlat = mean('lat'), mlng = mean('lng');

    let sxx = 0, sxy = 0, syy = 0, sxLat = 0, syLat = 0, sxLng = 0, syLng = 0;
    points.forEach((point) => {
        const dx = point.x - mx;
        const dy = point.y - my;
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
        sxLat += dx * (point.lat - mlat);
        syLat += dy * (point.lat - mlat);
        sxLng += dx * (point.lng - mlng);
        syLng += dy * (point.lng - mlng);
    });

    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) < 1e-9) {
        return null;
    }
    return {
        mx, my, mlat, mlng,
        aLat: (sxLat * syy - syLat * sxy) / det,
        bLat: (sxx * syLat - sxy * sxLat) / det,
        aLng: (sxLng * syy - syLng * sxy) / det,
        bLng: (sxx * syLng - sxy * sxLng) / det,
    };
}

/** Use a fit to turn a spot on Rowan's map (in percent) into { lat, lng }. */
function mapPointToLatLng(fit, x, y) {
    return {
        lat: fit.mlat + fit.aLat * (x - fit.mx) + fit.bLat * (y - fit.my),
        lng: fit.mlng + fit.aLng * (x - fit.mx) + fit.bLng * (y - fit.my),
    };
}

/** How far (in meters) a fit puts a point from where Google says it is. */
function fitError(fit, point) {
    const guess = mapPointToLatLng(fit, point.x, point.y);
    return metersBetween(guess.lat, guess.lng, point.lat, point.lng);
}

/**
 * Work out the best fit from the buildings Google found. A building that Google
 * placed in the wrong spot (for example another "Rowan Hall") sticks out as a big
 * error, so we throw out the worst one and try again until the rest agree.
 * Throws an Error if we can't get a fit we trust.
 */
function chooseFit(allPoints) {
    let points = allPoints.slice();
    let fit = null;

    while (points.length >= 4) {
        fit = fitMapToLatLng(points);
        if (!fit) {
            break;
        }
        const errors = points.map((point) => fitError(fit, point));
        const worst = Math.max(...errors);
        if (worst <= 70 || points.length === 4) {
            break;
        }
        points.splice(errors.indexOf(worst), 1);
    }

    if (!fit || points.length < 4) {
        throw new Error('Google could only find ' + points.length + ' of the campus buildings, which is not enough to place the lots.');
    }

    // Sanity checks: the average error is small, the map is about the size we expect,
    // and north is up (latitude goes down as we go down the picture)
    const rms = Math.sqrt(points.reduce((sum, point) => sum + Math.pow(fitError(fit, point), 2), 0) / points.length);
    const widthMeters = Math.hypot(fit.aLat * 100 * 111320, fit.aLng * 100 * 111320 * Math.cos(fit.mlat * Math.PI / 180));
    if (rms > 120 || widthMeters < 900 || widthMeters > 2100 || fit.bLat >= 0 || fit.aLng <= 0) {
        throw new Error('The Google building lookups did not line up with the campus map well enough to place the lots.');
    }
    return fit;
}

/** Ask Google where each building is, and work out the fit (or reuse the one we saved). */
async function alignWithGoogle() {
    try {
        const saved = JSON.parse(localStorage.getItem(FIT_STORAGE_KEY));
        if (saved && saved.fit) {
            return saved.fit;
        }
    } catch (err) {
        // no saved fit, or the browser won't let us read it: just work it out again
    }

    const { Geocoder } = await google.maps.importLibrary('geocoding');
    const geocoder = new Geocoder();

    const lookups = buildings.map(async (building) => {
        try {
            const answer = await geocoder.geocode({
                address: building.name + ', Rowan University, Glassboro, NJ',
                bounds: CAMPUS_BOUNDS,
                region: 'us',
            });
            const spot = answer.results[0].geometry.location;
            return { x: building.mapX, y: building.mapY, lat: spot.lat(), lng: spot.lng() };
        } catch (err) {
            return { error: err };
        }
    });
    const results = await Promise.all(lookups);

    if (results.some((result) => result.error && result.error.code === 'REQUEST_DENIED')) {
        throw new Error('Google refused the building lookups. Turn on the "Geocoding API" for your key in Google Cloud (see the README).');
    }

    // keep only answers that are really on campus
    const found = results.filter((result) => !result.error &&
        metersBetween(CAMPUS_CENTER.lat, CAMPUS_CENTER.lng, result.lat, result.lng) < MAX_DISTANCE_FROM_CENTER);

    const fit = chooseFit(found);
    try {
        localStorage.setItem(FIT_STORAGE_KEY, JSON.stringify({ fit: fit }));
    } catch (err) {
        // can't save it: that's fine, we'll work it out next time
    }
    return fit;
}

/**
 * Make sure every lot and building has a latitude and longitude.
 * If the server already knows them (from the anchors in config.py) there is nothing to do.
 * Returns a note to show above the map, or '' for none.
 */
async function fillInCoordinates() {
    const missing = lots.concat(buildings).some((item) => item.latitude === null || item.latitude === undefined);
    if (!missing) {
        return '';
    }

    const fit = await alignWithGoogle();
    lots.concat(buildings).forEach((item) => {
        const spot = mapPointToLatLng(fit, item.mapX, item.mapY);
        item.latitude = spot.lat;
        item.longitude = spot.lng;
    });
    return 'Pin positions are worked out by matching building names with Google Maps, so they can be off by about half a block. The Campus Map view is more exact.';
}


// --- The Google map itself ---------------------------------------------------

/** Make a marker on the Google map. */
function makeGoogleMarker(AdvancedMarkerElement, item, content, title) {
    return new AdvancedMarkerElement({
        map: googleMap,
        position: { lat: item.latitude, lng: item.longitude },
        content: content,
        title: title,
    });
}

/** Open the Google view. The first time, this also loads Google Maps. */
async function openGoogleView() {
    if (googleStatus !== 'not-loaded') {
        return;
    }

    const apiKey = window.APP_SETTINGS.mapsKey;
    if (!apiKey) {
        showGoogleMessage('Add your Google Maps API key to config.py (see the README). The Campus Map view works without it.');
        return;
    }

    googleStatus = 'loading';
    try {
        await loadGoogleScript(apiKey);
        const { Map, InfoWindow } = await google.maps.importLibrary('maps');
        const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');

        googleMap = new Map(document.getElementById('googleMap'), {
            center: CAMPUS_CENTER,
            zoom: 16,
            mapId: 'DEMO_MAP_ID',        // advanced markers need a map id (this is Google's demo one)
            mapTypeControl: true,
            streetViewControl: false,
        });
        googleInfo = new InfoWindow();
        googleStatus = 'ready';

        // Find where everything is, then put the lots on the map
        try {
            setGoogleNote(await fillInCoordinates());
        } catch (err) {
            setGoogleNote('The lots could not be placed on this map. ' + err.message + ' The Campus Map view still works.');
            return;
        }

        const bounds = new google.maps.LatLngBounds();
        lots.forEach((lot) => {
            const marker = makeGoogleMarker(AdvancedMarkerElement, lot, makePin(lot, false), lot.lotName);
            googleMarkers[lot.parkingLotId] = marker;
            bounds.extend(marker.position);
        });
        googleMap.fitBounds(bounds, 50);

        window.makeGoogleBuildingMarker = (building) =>
            makeGoogleMarker(AdvancedMarkerElement, building, makeBuildingPin(building), building.name);
        updateGoogleBuildingMarker();

        refreshPins();
        showSelectedLot();
    } catch (err) {
        showGoogleMessage(err.message);
    }
}

/** Show (or hide) the class building on the Google map. */
function updateGoogleBuildingMarker() {
    if (googleStatus !== 'ready' || !window.makeGoogleBuildingMarker || Object.keys(googleMarkers).length === 0) {
        return;
    }
    if (googleBuildingMarker) {
        googleBuildingMarker.map = null;
        googleBuildingMarker = null;
    }
    const building = findBuilding(selectedBuildingId);
    if (building && building.latitude !== null && building.latitude !== undefined) {
        googleBuildingMarker = window.makeGoogleBuildingMarker(building);
    }
}

/** Move the Google map to a lot (and the class building, if there is one) and open its pop-up. */
function focusGoogleOn(lotId) {
    const marker = googleMarkers[lotId];
    if (googleStatus !== 'ready' || !marker) {
        return;
    }

    // Build the pop-up with DOM calls (not innerHTML) so lot names can't inject HTML
    const content = document.createElement('div');
    content.className = 'info';
    const title = document.createElement('strong');
    title.textContent = findLot(lotId).lotName;
    const text = document.createElement('span');
    text.textContent = selectedText || 'Selected parking lot';
    content.append(title, text);

    if (googleBuildingMarker) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(marker.position);
        bounds.extend(googleBuildingMarker.position);
        googleMap.fitBounds(bounds, 90);
    } else {
        googleMap.panTo(marker.position);
        if (googleMap.getZoom() < 17) {
            googleMap.setZoom(17);
        }
    }
    googleInfo.setContent(content);
    googleInfo.open({ map: googleMap, anchor: marker });
}


// ---------------------------------------------------------------------------
// What app.js uses
// ---------------------------------------------------------------------------

const ParkingMap = {
    onLotClick: null,

    /** Draw the pins and set up the controls. Call once, after the lots are loaded. */
    init(lotList, buildingList) {
        lots = lotList;
        buildings = buildingList || [];
        addCampusPins();
        setUpCampusControls();
        measureCampus();

        document.getElementById('viewCampus').addEventListener('click', () => showView('campus'));
        document.getElementById('viewGoogle').addEventListener('click', () => showView('google'));

        refreshPins();     // in case a search was made before the lots finished loading
        updateCampusBuildingPin();
    },

    /** Highlight a lot and move the map to it. */
    select(lotId, text) {
        selectedLotId = lotId;
        selectedText = text || '';
        refreshPins();
        showSelectedLot();
    },

    /** Mark the building the student has class in (pass null to take the marker away). */
    showBuilding(buildingId) {
        selectedBuildingId = buildingId || null;
        document.getElementById('buildingLegend').hidden = !selectedBuildingId;
        updateCampusBuildingPin();
        updateGoogleBuildingMarker();
    },

    /** After a search: show each lot's % chance on its pin. ranking = [{ parkingLotId, chance }, ...] */
    showChances(ranking) {
        chances = {};
        ranking.forEach((item) => {
            chances[item.parkingLotId] = item.chance;
        });
        document.getElementById('chanceLegend').hidden = false;
        refreshPins();
    },

    /** Take the % chances off the pins (they belong to one specific search). */
    clearChances() {
        chances = {};
        document.getElementById('chanceLegend').hidden = true;
        refreshPins();
    },
};
