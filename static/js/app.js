/**
 * app.js
 *
 * The main script for the page. It handles:
 *   - the Login / Create Account pop-ups
 *   - the two tabs ("Find Parking" and "My Week")
 *   - the class boxes (dropdowns) and uploading a schedule file
 *   - asking the back end which lot is best for each day and showing the answer
 *   - saving, showing and removing the weekly parking plan
 *
 * It uses Api (api.js) to talk to the server and ParkingMap (map.js) for the map.
 */

const DAYS = window.APP_SETTINGS.weekdays;

// Everything the page needs to remember lives in this one object
const state = {
    user: null,            // the logged-in user, or null
    schedule: [],          // the saved week plan (one entry per day at most)
    options: null,         // the dropdown lists from the server (classes, buildings, times)
    plans: [],             // the latest recommendations, one for each day that has a class
    chosen: {},            // day -> the lot the student picked (if not the best one)
    selectedDay: null,     // the day whose lot is showing on the map
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

/** Turn a chance (in percent) into a word and a color class (good / ok / low). */
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
// Tab 1: the class boxes
// ---------------------------------------------------------------------------

const DAY_BUTTONS = [['Monday', 'M'], ['Tuesday', 'T'], ['Wednesday', 'W'], ['Thursday', 'Th'], ['Friday', 'F']];
const MAX_CLASS_ROWS = 15;

/** Add an <option> to a dropdown. */
function addOption(select, value, text) {
    const option = make('option', '', text);
    option.value = value;
    select.appendChild(option);
}

/**
 * Add one class box to the form: day buttons, then dropdowns for the class,
 * the building and the start time. "data" can pre-fill it (used for uploads).
 */
function addClassRow(data = {}) {
    const container = byId('classRows');
    if (container.children.length >= MAX_CLASS_ROWS) {
        showToast('That is the most classes we can plan at once.');
        return;
    }

    const row = make('article', 'class-row');
    row.dataset.buildingTouched = data.buildingId ? 'yes' : 'no';

    // ---- top line: which days, and a remove button ----
    const top = make('div', 'class-row-top');
    const dayGroup = make('div', 'day-chips');
    dayGroup.setAttribute('role', 'group');
    dayGroup.setAttribute('aria-label', 'Days this class meets');

    DAY_BUTTONS.forEach(([day, letter]) => {
        const chip = make('button', 'day-chip', letter);
        chip.type = 'button';
        chip.dataset.day = day;
        chip.title = day;
        chip.setAttribute('aria-label', day);
        const isOn = (data.days || []).includes(day);
        chip.classList.toggle('is-on', isOn);
        chip.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        chip.addEventListener('click', () => {
            const nowOn = !chip.classList.contains('is-on');
            chip.classList.toggle('is-on', nowOn);
            chip.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
        });
        dayGroup.appendChild(chip);
    });

    const remove = make('button', 'row-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove this class');
    remove.addEventListener('click', () => {
        row.remove();
        if (byId('classRows').children.length === 0) {
            addClassRow();      // always keep at least one box on the page
        }
    });
    top.append(dayGroup, remove);
    row.appendChild(top);

    // ---- the class dropdown (and a text box that shows up for "Other class") ----
    const courseField = make('div', 'field');
    courseField.appendChild(make('label', '', 'Class'));
    const courseSelect = make('select', 'course-select');
    addOption(courseSelect, '', 'Choose a class');
    state.options.courses.forEach((course) => addOption(courseSelect, course.courseId, course.title));
    addOption(courseSelect, state.options.otherCourseId, 'Other class (type it in)');
    courseField.appendChild(courseSelect);

    const customName = make('input', 'course-custom');
    customName.type = 'text';
    customName.maxLength = 60;
    customName.placeholder = 'Class name';
    customName.setAttribute('aria-label', 'Class name');
    customName.hidden = true;
    courseField.appendChild(customName);
    row.appendChild(courseField);

    // ---- building and start time, side by side ----
    const lowerRow = make('div', 'field-row');

    const buildingField = make('div', 'field');
    buildingField.appendChild(make('label', '', 'Building'));
    const buildingSelect = make('select', 'building-select');
    addOption(buildingSelect, '', 'Choose a building');
    state.options.buildings.forEach((building) => addOption(buildingSelect, building.buildingId, building.name));
    buildingField.appendChild(buildingSelect);
    lowerRow.appendChild(buildingField);

    const timeField = make('div', 'field');
    timeField.appendChild(make('label', '', 'Starts at'));
    const timeSelect = make('select', 'start-select');
    addOption(timeSelect, '', 'Choose a time');
    state.options.startTimes.forEach((time) => addOption(timeSelect, time, time));
    timeField.appendChild(timeSelect);
    lowerRow.appendChild(timeField);
    row.appendChild(lowerRow);

    // ---- behavior ----
    courseSelect.addEventListener('change', () => {
        const isOther = courseSelect.value === state.options.otherCourseId;
        customName.hidden = !isOther;
        if (isOther) {
            customName.focus();
        }
        // Pick the building the class usually meets in, unless the student already chose one
        const course = state.options.courses.find((item) => item.courseId === courseSelect.value);
        if (course && row.dataset.buildingTouched !== 'yes') {
            buildingSelect.value = course.buildingId;
        }
    });
    buildingSelect.addEventListener('change', () => {
        row.dataset.buildingTouched = 'yes';
        buildingSelect.classList.remove('needs-attention');
    });

    // ---- pre-fill (for a schedule that was uploaded or a day that is being changed) ----
    if (data.courseId && data.courseId !== state.options.otherCourseId) {
        courseSelect.value = data.courseId;
    } else if (data.className) {
        courseSelect.value = state.options.otherCourseId;
        customName.hidden = false;
        customName.value = data.className;
    }
    if (data.buildingId) {
        buildingSelect.value = data.buildingId;
    }
    if (data.startTime) {
        timeSelect.value = data.startTime;
    }
    if (!data.buildingId && data.needsBuilding) {
        buildingSelect.classList.add('needs-attention');
    }

    container.appendChild(row);
    return row;
}

/** Read every class box and return the list the server wants. */
function readClassRows() {
    const classes = [];
    byId('classRows').querySelectorAll('.class-row').forEach((row) => {
        const days = [...row.querySelectorAll('.day-chip.is-on')].map((chip) => chip.dataset.day);
        const courseId = row.querySelector('.course-select').value;
        const course = state.options.courses.find((item) => item.courseId === courseId);

        let className = '';
        if (course) {
            className = course.title;
        } else if (courseId === state.options.otherCourseId) {
            className = row.querySelector('.course-custom').value.trim();
        }

        classes.push({
            days: days,
            className: className,
            buildingId: row.querySelector('.building-select').value,
            startTime: row.querySelector('.start-select').value,
        });
    });
    return classes;
}

/** True if a class box has nothing filled in yet. */
function rowIsEmpty(row) {
    return row.querySelectorAll('.day-chip.is-on').length === 0 &&
           row.querySelector('.course-select').value === '' &&
           row.querySelector('.building-select').value === '' &&
           row.querySelector('.start-select').value === '';
}

byId('addClass').addEventListener('click', () => addClassRow());


// ---------------------------------------------------------------------------
// Tab 1: uploading a schedule file
// ---------------------------------------------------------------------------

byId('uploadButton').addEventListener('click', () => byId('scheduleFile').click());

byId('scheduleFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';        // so choosing the same file again still works
    if (!file) {
        return;
    }

    const notes = byId('importNotes');
    notes.innerHTML = '';
    hideError(byId('findError'));

    try {
        const data = await Api.importSchedule(file);

        // Replace the empty boxes with the classes we found
        byId('classRows').innerHTML = '';
        data.classes.forEach((item) => addClassRow({ ...item, needsBuilding: true }));

        const missing = data.classes.filter((item) => !item.buildingId).length;
        const message = make('div', 'import-note');
        message.appendChild(make('strong', '', 'Found ' + data.classes.length + ' class' + (data.classes.length === 1 ? '' : 'es') + ' in ' + file.name + '.'));
        if (missing > 0) {
            message.appendChild(make('p', '', 'Choose the building for the ' + missing + ' highlighted class' + (missing === 1 ? '' : 'es') + ', then check everything below.'));
        } else {
            message.appendChild(make('p', '', 'Please check the days, buildings and times below.'));
        }
        data.warnings.forEach((warning) => message.appendChild(make('p', 'import-warning', warning)));
        notes.appendChild(message);
    } catch (err) {
        showError(byId('findError'), err.message);
    }
});


// ---------------------------------------------------------------------------
// Tab 1: asking for the recommendation
// ---------------------------------------------------------------------------

byId('planForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = byId('findError');
    hideError(errorBox);

    const classes = readClassRows();
    const button = byId('findButton');
    button.disabled = true;
    button.textContent = 'Checking lots...';

    try {
        const data = await Api.plan(classes, Number(byId('earlySelect').value));
        state.plans = data.plans;
        state.chosen = {};
        renderResult();
        selectDay(state.plans[0].day);
    } catch (err) {
        state.plans = [];
        renderResult();
        showError(errorBox, err.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Find Best Parking';
    }
});

/** The lot being shown for a day: the one the student clicked, otherwise the best one. */
function chosenLot(plan) {
    const chosenId = state.chosen[plan.day];
    return plan.ranking.find((lot) => lot.parkingLotId === chosenId) || plan.best;
}

/** Show one day's lot on the map (with the building it is for). */
function selectDay(day) {
    state.selectedDay = day;
    const plan = state.plans.find((item) => item.day === day);
    if (!plan) {
        return;
    }
    const lot = chosenLot(plan);

    ParkingMap.showChances(plan.ranking);
    ParkingMap.showBuilding(plan.buildingId);
    ParkingMap.select(lot.parkingLotId, lot.walkMinutes + ' min walk to ' + plan.buildingName + ' · ' + lot.chance + '% chance by ' + lot.parkBy);
    renderResult();
}

/** Draw one small meter bar, then the day cards, then the save button. */
function renderResult() {
    const box = byId('result');
    box.innerHTML = '';
    if (state.plans.length === 0) {
        return;
    }

    box.appendChild(make('h3', 'result-heading', 'Your parking plan'));
    box.appendChild(make('p', 'hint', 'Tap a day to see it on the map. Pick a different lot from the list if you prefer it.'));

    state.plans.forEach((plan) => box.appendChild(makePlanCard(plan)));

    // ---- save the whole week ----
    const saveButton = make('button', 'btn btn-primary btn-block');
    saveButton.type = 'button';
    if (state.user) {
        saveButton.textContent = 'Save this plan to My Week';
        saveButton.addEventListener('click', saveAllPlans);
    } else {
        saveButton.textContent = 'Log in to save this plan';
        saveButton.addEventListener('click', () => openDialog('login'));
    }
    box.appendChild(saveButton);
}

/** One card for one day. */
function makePlanCard(plan) {
    const lot = chosenLot(plan);
    const isBest = lot.parkingLotId === plan.best.parkingLotId;
    const chance = describeChance(lot.chance);

    const card = make('article', 'plan-card plan-' + chance.level);
    card.classList.toggle('is-selected', plan.day === state.selectedDay);

    // ---- which day and class ----
    const header = make('button', 'plan-header');
    header.type = 'button';
    header.addEventListener('click', () => selectDay(plan.day));
    header.appendChild(make('h4', '', plan.day));
    let classLine = plan.className + (plan.classCount > 1 ? ' + ' + (plan.classCount - 1) + ' more' : '');
    classLine += ' · starts ' + plan.classStart + ' · ' + plan.buildingName;
    header.appendChild(make('span', 'plan-class', classLine));
    card.appendChild(header);

    // ---- the lot ----
    card.appendChild(make('span', 'badge' + (isBest ? '' : ' badge-plain'), isBest ? 'Best pick' : 'Your choice'));
    card.appendChild(make('p', 'plan-lot', lot.lotName));

    const facts = make('p', 'plan-facts');
    facts.append(lot.walkMinutes + ' min walk (about ' + lot.walkMeters + ' m) · ');
    facts.appendChild(make('strong', 'chance-' + chance.level, lot.chance + '% chance of a space'));
    card.appendChild(facts);
    card.appendChild(makeMeter(lot.chance));
    card.appendChild(make('p', 'plan-park-by', 'Be parked by ' + lot.parkBy));

    // ---- why ----
    if (isBest) {
        card.appendChild(make('p', 'plan-why', plan.why));
        if (plan.tip) {
            card.appendChild(make('p', 'plan-tip', plan.tip));
        }
    } else {
        const extra = Math.round(lot.cost - plan.best.cost);
        const text = extra >= 1
            ? 'Expect to lose about ' + extra + ' more minute' + (extra === 1 ? '' : 's') + ' than with ' + plan.best.lotName + ' (walking plus the risk of a full lot).'
            : 'About the same total time as ' + plan.best.lotName + '.';
        card.appendChild(make('p', 'plan-why', text));
    }

    // ---- the other lots to choose from ----
    const choices = [plan.best, ...plan.others];
    if (!choices.some((item) => item.parkingLotId === lot.parkingLotId)) {
        choices.push(lot);      // the student clicked a lot on the map that isn't in the short list
    }
    const list = make('ul', 'option-list');
    choices.forEach((choice) => {
        const item = make('li');
        const button = make('button', 'option-row' + (choice.parkingLotId === lot.parkingLotId ? ' is-selected' : ''));
        button.type = 'button';
        button.addEventListener('click', () => {
            state.chosen[plan.day] = choice.parkingLotId;
            selectDay(plan.day);
        });
        button.appendChild(make('span', 'option-name', choice.lotName));
        button.appendChild(make('span', 'option-walk', choice.walkMinutes + ' min walk'));
        button.appendChild(make('span', 'option-chance chance-' + describeChance(choice.chance).level, choice.chance + '%'));
        item.appendChild(button);
        list.appendChild(item);
    });
    card.appendChild(list);

    return card;
}

/** Save the shown lot for every day in the plan. */
async function saveAllPlans() {
    const plans = state.plans.map((plan) => {
        const lot = chosenLot(plan);
        return {
            day: plan.day,
            className: plan.className,
            arrivalTime: lot.parkBy,
            parkingLotId: lot.parkingLotId,
            buildingId: plan.buildingId,
            classStart: plan.classStart,
        };
    });

    try {
        await Api.savePlans(plans);
        await loadSchedule();
        showToast('Saved ' + plans.length + ' day' + (plans.length === 1 ? '' : 's') + ' to My Week.');
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

            card.appendChild(make('p', 'day-lot', entry.lotName + ' · park by ' + entry.arrivalTime));
            const classText = [entry.className, entry.buildingName].filter(Boolean).join(' · ');
            if (classText) {
                card.appendChild(make('p', 'day-class', classText + (entry.classStart ? ' (starts ' + entry.classStart + ')' : '')));
            }
            card.appendChild(make('p', 'day-chance chance-' + chance.level, entry.probability + '% estimated chance'));

            const actions = make('div', 'day-actions');
            const view = make('button', 'btn btn-small', 'View on map');
            view.type = 'button';
            view.addEventListener('click', () => {
                ParkingMap.clearChances();    // the pins' % belong to the last search, not this day
                ParkingMap.showBuilding(entry.buildingId || null);
                ParkingMap.select(entry.parkingLotId, entry.day + ' · park by ' + entry.arrivalTime);
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

/** "Plan Monday" / "Change": go to the first tab with a class box for that day. */
function planDay(day, entry) {
    const rows = byId('classRows');
    const onlyEmptyBoxes = [...rows.children].every(rowIsEmpty);
    if (onlyEmptyBoxes) {
        rows.innerHTML = '';
    }

    const row = addClassRow({
        days: [day],
        className: entry ? entry.className : '',
        buildingId: entry ? entry.buildingId : '',
        startTime: entry ? entry.classStart : '',
    });
    showTab('find');
    if (row) {
        row.scrollIntoView({ block: 'center' });
    }
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
    renderAuthArea();
    renderWeek();

    // The dropdown lists come from the server, so we need them before drawing the class boxes
    try {
        state.options = await Api.options();
    } catch (err) {
        showError(byId('findError'), 'Could not load the page data: ' + err.message);
        return;
    }

    const early = byId('earlySelect');
    state.options.earlyChoices.forEach((minutes) => {
        addOption(early, String(minutes), minutes + ' minutes early');
    });
    early.value = String(state.options.defaultEarly);
    addClassRow();

    // When a pin on the map is clicked, treat it like picking that lot in the list
    ParkingMap.onLotClick = (lotId) => {
        const plan = state.plans.find((item) => item.day === state.selectedDay);
        if (plan && plan.ranking.some((lot) => lot.parkingLotId === lotId)) {
            state.chosen[plan.day] = lotId;
            selectDay(plan.day);
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
        ParkingMap.init(data.lots, state.options.buildings);
    } catch (err) {
        showToast('Could not load the parking lots: ' + err.message);
    }
}

startApp();
