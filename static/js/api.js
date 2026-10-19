/**
 * api.js
 *
 * All the calls from the browser to our Python back end live here, so the rest of
 * the code can just write things like  Api.login(email, password).
 */

/**
 * Send a request and return the JSON answer.
 * If the server says something went wrong, we throw an Error with its message,
 * so the code that called us can show that message to the user.
 */
async function sendRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',   // send the session cookie along
        ...options,
    });

    let data = null;
    try {
        data = await response.json();
    } catch (err) {
        // The server didn't send JSON (maybe a server error). We handle it below.
    }

    if (!response.ok || !data || data.ok === false) {
        throw new Error((data && data.error) || 'Something went wrong (error ' + response.status + ').');
    }
    return data;
}

/** POST some data as JSON. */
function postJson(url, data = {}) {
    return sendRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
}

const Api = {
    // ---- accounts ----
    me:       ()     => sendRequest('/api/account/me'),
    register: (data) => postJson('/api/account/register', data),
    login:    (email, password) => postJson('/api/account/login', { email, password }),
    logout:   ()     => postJson('/api/account/logout'),

    // ---- parking lots and the saved week ----
    lots:       ()      => sendRequest('/api/parking/lots'),
    schedule:   ()      => sendRequest('/api/parking/schedule'),
    savePlans:  (plans) => postJson('/api/parking/save', { plans }),
    removePlan: (day)   => postJson('/api/parking/remove', { day }),

    // ---- class schedule and recommendations ----
    options: () => sendRequest('/api/schedule/options'),

    /** Upload a .csv or .ics file. The server sends back the classes it found. */
    importSchedule: (file) => {
        const form = new FormData();
        form.append('file', file);
        return sendRequest('/api/schedule/import', { method: 'POST', body: form });
    },

    /** Ask for the best lot for each day. classes is the list from the class boxes. */
    plan: (classes, minutesEarly) => postJson('/api/schedule/plan', { classes, minutesEarly }),
};
