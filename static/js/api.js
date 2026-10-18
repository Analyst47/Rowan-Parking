/**
 * api.js
 *
 * All the calls from the browser to our PHP back end live here, so the rest of
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
        // The server didn't send JSON (maybe a PHP error). We handle it below.
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

    // ---- parking ----
    lots: () => sendRequest('/api/parking/lots'),

    recommend: (day, time) => {
        const query = new URLSearchParams({ day: day, time: time });
        return sendRequest('/api/parking/recommend?' + query.toString());
    },

    schedule:  ()     => sendRequest('/api/parking/schedule'),
    savePlan:  (plan) => postJson('/api/parking/save', plan),
    removePlan: (day) => postJson('/api/parking/remove', { day }),
};
