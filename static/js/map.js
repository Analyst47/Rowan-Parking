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
 *   ParkingMap.init(lots)            draw a pin for every lot
 *   ParkingMap.select(lotId, text)   highlight one lot and move the map to it
 *   ParkingMap.showChances(ranking)  put the % chance on each pin after a search
 *   ParkingMap.onLotClick = fn       app.js sets this to hear when a pin is clicked
 */

// ---------------------------------------------------------------------------
// Things both views share
// ---------------------------------------------------------------------------

const CAMPUS_IMAGE = { width: 2200, height: 1283 };   // size of the campus map picture
const CAMPUS_CENTER = { lat: 39.7101, lng: -75.1190 }; // where the Google map starts (approximate)

let lots = [];               // every parking lot from the server
let chances = {};            // lotId -> probability, filled in after a search
let selectedLotId = null;    // the lot that is highlighted
let selectedText = '';       // the text shown in the pop-up for that lot
let currentView = 'campus';  // 'campus' or 'google'
let allPins = [];            // every pin element on the page: { lotId, element, inCampusView }

function findLot(lotId) {
    return lots.find((lot) => lot.parkingLotId === lotId);
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

/** Zoom in on a lot and put it near the middle of the box. */
function focusCampusOn(lotId) {
    const lot = findLot(lotId);
    if (!lot || campus.baseWidth === 0) {
        return;
    }
    animateCampus(() => {
        campus.scale = Math.max(campus.scale, 2.4);
        const lotX = lot.mapX / 100 * campus.baseWidth;
        const lotY = lot.mapY / 100 * campus.baseHeight;
        campus.x = campus.boxWidth / 2 - lotX * campus.scale;
        campus.y = campus.boxHeight * 0.6 - lotY * campus.scale;   // a bit low, so the pop-up has room
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

/** Open the Google view. The first time, this also loads Google Maps. */
async function openGoogleView() {
    // Tell the user if the lots can't be placed yet (no coordinates in config.py)
    const hasCoordinates = lots.some((lot) => lot.latitude !== null && lot.longitude !== null);
    document.getElementById('googleNote').hidden = hasCoordinates || !window.APP_SETTINGS.mapsKey;

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
            zoom: 15,
            mapId: 'DEMO_MAP_ID',        // advanced markers need a map id (this is Google's demo one)
            mapTypeControl: true,
            streetViewControl: false,
        });
        googleInfo = new InfoWindow();

        // Fit the map around the lots (only the ones that have coordinates)
        const bounds = new google.maps.LatLngBounds();
        let placed = 0;

        lots.forEach((lot) => {
            if (lot.latitude === null || lot.longitude === null) {
                return;
            }
            const marker = new AdvancedMarkerElement({
                map: googleMap,
                position: { lat: lot.latitude, lng: lot.longitude },
                content: makePin(lot, false),
                title: lot.lotName,
            });
            googleMarkers[lot.parkingLotId] = marker;
            bounds.extend(marker.position);
            placed++;
        });

        if (placed > 0) {
            googleMap.fitBounds(bounds, 50);
        }
        googleStatus = 'ready';
        refreshPins();
        showSelectedLot();
    } catch (err) {
        showGoogleMessage(err.message);
    }
}

/** Move the Google map to a lot and open its pop-up. */
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

    googleMap.panTo(marker.position);
    if (googleMap.getZoom() < 17) {
        googleMap.setZoom(17);
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
    init(lotList) {
        lots = lotList;
        addCampusPins();
        setUpCampusControls();
        measureCampus();

        document.getElementById('viewCampus').addEventListener('click', () => showView('campus'));
        document.getElementById('viewGoogle').addEventListener('click', () => showView('google'));

        refreshPins();     // in case a search was made before the lots finished loading
    },

    /** Highlight a lot and move the map to it. */
    select(lotId, text) {
        selectedLotId = lotId;
        selectedText = text || '';
        refreshPins();
        showSelectedLot();
    },

    /** After a search: show each lot's % chance on its pin. */
    showChances(ranking) {
        chances = {};
        ranking.forEach((item) => {
            chances[item.parkingLotId] = item.probability;
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
