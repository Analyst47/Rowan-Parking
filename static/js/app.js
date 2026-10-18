/**
 * app.js
 *
 * The main script for the page. It handles:
 *   - the Login / Create Account pop-ups
 *   - the two tabs ("Find Parking" and "My Week")
 *   - asking the back end for a recommendation and showing it
 *   - saving, showing and removing the weekly parking plan
 *
 * It uses Api (api.js) to talk to the server and ParkingMap (map.js) for the map.
 */

const DAYS = window.APP_SETTINGS.weekdays;

// Everything the page needs to remember lives in this one object
const state = {
    user: null,            // the logged-in user, or null
    schedule: [],          // the saved week plan (one entry per day at most)
    lastResult: null,      // the most recent recommendation { day, arrivalTime, className, ranking, bestId }
    selectedLotId: null,   // the lot the user is looking at in the results
};


// ---------------------------------------------------------------------------
// Small helper functions
// ---------------------------------------------------------------------------

/** Shortcut for document.getElementById */
function byId(id) {
    return document.getElementById(id);
}

/**
 * Make an element with a CSS class and some text.
 * We use textContent (not innerHTML) so nothing a user types can turn into HTML.
 */
function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

/** Show / hide a red error message under a form. */
function showError(element, message) {
    element.textContent = message;
    element.hidden = false;
}
function hideError(element) {
    element.textContent = '';
    element.hidden = true;
}

/** Show the pop-up message at the bottom of the screen for a few seconds. */
let toastTimer = null;
function showToast(message) {
    const toast = byId('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

/** Turn a probability into a word and a color class (good / ok / low). */
function describeChance(probability) {
    if (probability >= 70) {
        return { label: 'Good chance', level: 'good' };
    }
    if (probability >= 40) {
        return { label: 'Moderate chance', level: 'ok' };
    }
    return { label: 'Tough to find a spot', level: 'low' };
}

/** A small horizontal bar that shows a percentage. */
function makeMeter(probability) {
    const meter = make('div', 'meter');
    meter.setAttribute('aria-hidden', 'true');
    const fill = make('div', 'meter-fill meter-' + describeChance(probability).level);
    fill.style.width = probability + '%';
    meter.appendChild(fill);
    return meter;
}

/** Pick today's weekday for the default selection (weekends fall back to Monday). */
function todayName() {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = names[new Date().getDay()];
    return DAYS.includes(today) ? today : DAYS[0];
}


// ---------------------------------------------------------------------------
// Login / Create Account pop-ups
// ---------------------------------------------------------------------------

const loginDialog = byId('loginDialog');
const registerDialog = byId('registerDialog');

/** Open one of the dialogs (and close the other one). */
function openDialog(which) {
    loginDialog.close();
    registerDialog.close();

    const dialog = which === 'register' ? registerDialog : loginDialog;
    hideError(byId('loginError'));
    hideError(byId('registerError'));
    dialog.showModal();
}

/** Buttons inside the dialogs: the X, and the "switch to the other form" links */
document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
});
document.querySelectorAll('[data-switch]').forEach((button) => {
    button.addEventListener('click', () => openDialog(button.dataset.switch));
});

/** Clicking the dark area outside a dialog closes it. */
[loginDialog, registerDialog].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
            dialog.close();
        }
    });
});

/** Login form */
byId('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = byId('loginError');
    hideError(errorBox);

    const email = byId('loginEmail').value.trim();
    const password = byId('loginPassword').value;
    if (!email || !password) {
        showError(errorBox, 'Please enter your email and password.');
        return;
    }

    try {
        const data = await Api.login(email, password);
        loginDialog.close();
        byId('loginForm').reset();
        await handleLoggedIn(data.user, 'Welcome back, ' + data.user.firstName + '!');
    } catch (err) {
        showError(errorBox, err.message);
    }
});

/** Create account form */
byId('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = byId('registerError');
    hideError(errorBox);

    const info = {
        firstName: byId('regFirst').value.trim(),
        lastName: byId('regLast').value.trim(),
        email: byId('regEmail').value.trim(),
        semester: byId('regSemester').value,
        password: byId('regPassword').value,
    };

    // Quick checks here so the user gets instant feedback (the server checks again)
    if (!info.firstName || !info.lastName || !info.email || !info.password) {
        showError(errorBox, 'Please fill in every field.');
        return;
    }
    if (info.password.length < 8) {
        showError(errorBox, 'Your password needs at least 8 characters.');
        return;
    }
    if (info.password !== byId('regConfirm').value) {
        showError(errorBox, 'The two passwords do not match.');
        return;
    }

    try {
        const data = await Api.register(info);
        registerDialog.close();
        byId('registerForm').reset();
        await handleLoggedIn(data.user, 'Account created. Welcome, ' + data.user.firstName + '!');
    } catch (err) {
        showError(errorBox, err.message);
    }
});

/** Runs after a successful login or sign-up. */
async function handleLoggedIn(user, message) {
    state.user = user;
    renderAuthArea();
    await loadSchedule();
    showToast(message);
}

/** Log out button */
async function handleLogout() {
    try {
        await Api.logout();
    } catch (err) {
        // Even if this fails, we still clear things on the page below
    }
    state.user = null;
    state.schedule = [];
    renderAuthArea();
    renderWeek();
    renderResult();       // so the "Save" button goes back to "Log in to save"
    showToast('You have been logged out.');
}

/** Draw the buttons in the top right of the header. */
function renderAuthArea() {
    const area = byId('authArea');
    area.innerHTML = '';

    if (state.user) {
        area.appendChild(make('span', 'greeting', 'Hi, ' + state.user.firstName));
        const logout = make('button', 'btn btn-outline-light', 'Log Out');
        logout.type = 'button';
        logout.addEventListener('click', handleLogout);
        area.appendChild(logout);
    } else {
        const login = make('button', 'btn btn-gold', 'Login');
        login.type = 'button';
        login.addEventListener('click', () => openDialog('login'));

        const create = make('button', 'btn btn-outline-light', 'Create Account');
        create.type = 'button';
        create.addEventListener('click', () => openDialog('register'));

        area.append(login, create);
    }
}


// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const tabButtons = { find: byId('tabFind'), week: byId('tabWeek') };
const tabPanels = { find: byId('panelFind'), week: byId('panelWeek') };

function showTab(name) {
    Object.keys(tabButtons).forEach((key) => {
        const active = key === name;
        tabButtons[key].classList.toggle('is-active', active);
        tabButtons[key].setAttribute('aria-selected', active ? 'true' : 'false');
        tabPanels[key].hidden = !active;
    });
}

tabButtons.find.addEventListener('click', () => showTab('find'));
tabButtons.week.addEventListener('click', () => showTab('week'));


// ---------------------------------------------------------------------------
// Tab 1: Find Parking
// ---------------------------------------------------------------------------

byId('findForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = byId('findError');
    hideError(errorBox);

    const day = byId('daySelect').value;
    const time = byId('timeSelect').value;
    const className = byId('classInput').value.trim();
    const button = byId('findButton');

    button.disabled = true;
    button.textContent = 'Checking lots...';

    try {
        const data = await Api.recommend(day, time);

        state.lastResult = {
            day: data.day,
            arrivalTime: data.arrivalTime,
            className: className,
            ranking: data.ranking,
            bestId: data.best.parkingLotId,
        };
        ParkingMap.showChances(data.ranking);     // put the % on every pin
        selectResultLot(data.best.parkingLotId);
    } catch (err) {
        state.lastResult = null;
        byId('result').innerHTML = '';
        showError(errorBox, err.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Find Best Parking';
    }
});

/** Make one lot the "selected" one: update the results list and the map. */
function selectResultLot(lotId) {
    state.selectedLotId = lotId;
    renderResult();

    const lot = state.lastResult.ranking.find((item) => item.parkingLotId === lotId);
    ParkingMap.select(lotId, lot.probability + '% estimated chance at ' + state.lastResult.arrivalTime);
}

/** Draw the recommendation card and the list of the other lots. */
function renderResult() {
    const box = byId('result');
    box.innerHTML = '';

    const result = state.lastResult;
    if (!result) {
        return;
    }

    const selected = result.ranking.find((item) => item.parkingLotId === state.selectedLotId) || result.ranking[0];
    const isBest = selected.parkingLotId === result.bestId;
    const chance = describeChance(selected.probability);

    // ---- the big card for the selected lot ----
    const card = make('article', 'result-card');
    card.appendChild(make('span', 'badge' + (isBest ? '' : ' badge-plain'), isBest ? 'Best estimated availability' : 'Selected lot'));
    card.appendChild(make('h3', 'result-lot', selected.lotName));

    const line = make('p', 'result-chance');
    line.append(make('strong', 'chance-' + chance.level, selected.probability + '% estimated chance'));
    line.append(' · ' + chance.label);
    card.appendChild(line);
    card.appendChild(makeMeter(selected.probability));

    card.appendChild(make('p', 'result-when', result.day + ' at ' + result.arrivalTime +
        (result.className ? ' · ' + result.className : '')));

    // The save button needs a login
    const saveButton = make('button', 'btn btn-primary btn-block');
    saveButton.type = 'button';
    if (state.user) {
        saveButton.textContent = 'Save ' + selected.lotName + ' for ' + result.day;
        saveButton.addEventListener('click', () => savePlan(selected));
    } else {
        saveButton.textContent = 'Log in to save this plan';
        saveButton.addEventListener('click', () => openDialog('login'));
    }
    card.appendChild(saveButton);
    box.appendChild(card);

    // ---- the list of every lot ----
    box.appendChild(make('h4', 'list-title', 'All lots at ' + result.arrivalTime));
    const list = make('ul', 'lot-list');

    result.ranking.forEach((lot) => {
        const item = make('li');
        const row = make('button', 'lot-row' + (lot.parkingLotId === selected.parkingLotId ? ' is-selected' : ''));
        row.type = 'button';
        row.addEventListener('click', () => selectResultLot(lot.parkingLotId));

        row.appendChild(make('span', 'lot-name', lot.lotName));
        row.appendChild(makeMeter(lot.probability));
        row.appendChild(make('span', 'lot-percent', lot.probability + '%'));

        item.appendChild(row);
        list.appendChild(item);
    });
    box.appendChild(list);
}

/** Save the selected lot as the plan for the chosen day. */
async function savePlan(lot) {
    const result = state.lastResult;
    try {
        await Api.savePlan({
            day: result.day,
            arrivalTime: result.arrivalTime,
            className: result.className,
            parkingLotId: lot.parkingLotId,
        });
        await loadSchedule();
        showToast('Saved ' + lot.lotName + ' for ' + result.day + ' at ' + result.arrivalTime);
    } catch (err) {
        if (/log in/i.test(err.message)) {
            // The session probably expired
            state.user = null;
            renderAuthArea();
            renderResult();
            openDialog('login');
        }
        showToast(err.message);
    }
}


// ---------------------------------------------------------------------------
// Tab 2: My Week
// ---------------------------------------------------------------------------

/** Ask the server for the saved plan (only works when logged in). */
async function loadSchedule() {
    if (!state.user) {
        state.schedule = [];
    } else {
        try {
            const data = await Api.schedule();
            state.schedule = data.schedule;
        } catch (err) {
            state.schedule = [];
            showToast(err.message);
        }
    }
    renderWeek();
    renderResult();
}

/** Draw the five day cards. */
function renderWeek() {
    const list = byId('weekList');
    list.innerHTML = '';

    // Not logged in: ask them to log in
    if (!state.user) {
        const note = make('div', 'login-note');
        note.appendChild(make('p', '', 'Log in to retrieve your personal Monday–Friday plan.'));
        const button = make('button', 'btn btn-primary', 'Log In');
        button.type = 'button';
        button.addEventListener('click', () => openDialog('login'));
        note.appendChild(button);
        list.appendChild(note);
        return;
    }

    DAYS.forEach((day) => {
        const entry = state.schedule.find((item) => item.day === day);
        const card = make('article', 'day-card');
        card.appendChild(make('h3', '', day));

        if (!entry) {
            card.appendChild(make('p', 'day-empty', 'No parking plan saved.'));
            const plan = make('button', 'btn btn-small', 'Plan ' + day);
            plan.type = 'button';
            plan.addEventListener('click', () => planDay(day));
            card.appendChild(plan);
        } else {
            const chance = describeChance(entry.probability);
            card.classList.add('has-plan', 'plan-' + chance.level);

            card.appendChild(make('p', 'day-lot', entry.lotName + ' · ' + entry.arrivalTime));
            if (entry.className) {
                card.appendChild(make('p', 'day-class', entry.className));
            }
            card.appendChild(make('p', 'day-chance chance-' + chance.level, entry.probability + '% estimated chance'));

            const actions = make('div', 'day-actions');
            const view = make('button', 'btn btn-small', 'View on map');
            view.type = 'button';
            view.addEventListener('click', () => {
                ParkingMap.clearChances();    // the pins' % belong to the last search, not this day
                ParkingMap.select(entry.parkingLotId, entry.day + ' at ' + entry.arrivalTime);
            });
            const change = make('button', 'btn btn-small', 'Change');
            change.type = 'button';
            change.addEventListener('click', () => planDay(day, entry));
            const remove = make('button', 'btn btn-small btn-danger', 'Remove');
            remove.type = 'button';
            remove.addEventListener('click', () => removePlan(day));

            actions.append(view, change, remove);
            card.appendChild(actions);
        }
        list.appendChild(card);
    });
}

/** "Plan Monday" button: jump to the first tab with that day already picked. */
function planDay(day, entry) {
    byId('daySelect').value = day;
    if (entry) {
        byId('timeSelect').value = entry.arrivalTime;
        byId('classInput').value = entry.className || '';
    }
    showTab('find');
    byId('timeSelect').focus();
}

/** Delete the saved plan for one day. */
async function removePlan(day) {
    try {
        await Api.removePlan(day);
        await loadSchedule();
        showToast('Removed your ' + day + ' plan.');
    } catch (err) {
        showToast(err.message);
    }
}


// ---------------------------------------------------------------------------
// Start-up: runs once when the page loads
// ---------------------------------------------------------------------------

async function startApp() {
    // Pick today's weekday by default and draw the empty header / week list
    byId('daySelect').value = todayName();
    renderAuthArea();
    renderWeek();

    // When a pin on the map is clicked, treat it like clicking that lot in the list
    ParkingMap.onLotClick = (lotId) => {
        const inResults = state.lastResult && state.lastResult.ranking.some((item) => item.parkingLotId === lotId);
        if (inResults) {
            selectResultLot(lotId);
        } else {
            ParkingMap.select(lotId);
        }
    };

    // Are we already logged in from an earlier visit? (the session cookie remembers us)
    try {
        const me = await Api.me();
        state.user = me.user;
    } catch (err) {
        state.user = null;
    }
    renderAuthArea();
    await loadSchedule();

    // Load the lots and draw the map
    try {
        const data = await Api.lots();
        ParkingMap.init(data.lots);
    } catch (err) {
        showToast('Could not load the parking lots: ' + err.message);
    }
}

startApp();
