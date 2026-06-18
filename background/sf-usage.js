// ==================================================
// CYFOR Nucleus Enhancer — Org-wide template usage (DORMANT until configured)
// Mirrors the local usage log into a Salesforce NucleusTemplateUsage__c record
// per insertion — but ONLY once the admin creates that object (spec:
// docs/salesforce-usage-object.md). Until then every call is a silent no-op,
// so this ships ahead of the Salesforce config and "lights up" by itself.
// Who/when come from the standard CreatedBy/CreatedDate. Field API names are
// describe-discovered like every other Nucleus object.
// Exported as self.SfUsage.
// ==================================================

(function () {

var USAGE_OBJ = 'NucleusTemplateUsage__c';
var USAGE_CONCEPTS = {
    templateName: ['templatename', 'template'],
    recordId:     ['recordid'],
    recordUrl:    ['recordurl', 'url']
};

// Availability cache (per SW lifetime): once the describe fails we stop trying
// until the worker restarts — so a missing object costs one request per
// lifetime, and creating it in Salesforce gets picked up automatically.
var resolvedMap = null;
var unavailable = false;

async function ctx() {
    var stored = await chrome.storage.local.get(['sfOAuthTokens', 'sfOAuthConfig']);
    var instanceUrl = ((stored.sfOAuthTokens || {}).instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) throw new Error('No instance URL');
    var token = await self.SfOAuth.getValidAccessToken();
    var apiVersion = (stored.sfOAuthConfig || {}).apiVersion || 'v62.0';
    return { base: instanceUrl + '/services/data/' + apiVersion, token: token };
}

async function resolveUsageFields(c) {
    if (unavailable) return null;
    if (resolvedMap) return resolvedMap;
    try {
        var d = await self.SfUtils.describeObject(c.base, c.token, USAGE_OBJ);
        resolvedMap = self.SfUtils.resolveFields(d.fields || [], USAGE_CONCEPTS);
        return resolvedMap;
    } catch (e) {
        unavailable = true; // object not created yet — stay dormant
        return null;
    }
}

// Fire-and-forget insert log. NEVER throws to the caller — a failed usage
// write must not affect the user's insert in any way.
async function pushUsage(entry) {
    try {
        var c   = await ctx();
        var map = await resolveUsageFields(c);
        if (!map || !map.templateName) return { ok: true, skipped: true };

        var body = {};
        body[map.templateName] = String(entry.template || '').slice(0, 255);
        if (map.recordId && entry.recordId) body[map.recordId] = String(entry.recordId).slice(0, 18);
        if (map.recordUrl && entry.url)     body[map.recordUrl] = String(entry.url).slice(0, 255);

        var res = await fetch(c.base + '/sobjects/' + USAGE_OBJ + '/', {
            method:  'POST',
            headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
            body:    JSON.stringify(body)
        });
        if (res.ok) { noteHealth(null); return { ok: true }; }
        // Salesforce ACCEPTED the request but REJECTED the write (object read-only,
        // "In Development", a validation rule, …). Capture a compact diagnostic so
        // the manager can warn admins their org-wide log is silently dropping.
        var code = '', message = '';
        try {
            var eb = await res.json();
            if (Array.isArray(eb) && eb[0]) { code = eb[0].errorCode || ''; message = eb[0].message || ''; }
        } catch (ignore) { /* non-JSON error body */ }
        noteHealth({ status: res.status, code: code, message: message, ts: Date.now() });
        return { ok: true, rejected: true };
    } catch (e) {
        return { ok: true, skipped: true }; // offline / network error — retry on the next insert
    }
}

// Persist the most recent org-write outcome so the manager can show admins a
// quiet, self-healing warning when writes are being rejected. Storage holds an
// error ONLY while the last attempt failed; the next success clears it. Never throws.
function noteHealth(err) {
    try {
        if (err) chrome.storage.local.set({ usageLogError: err });
        else     chrome.storage.local.remove('usageLogError');
    } catch (e) { /* best-effort */ }
}

// Org-wide usage for the manager (admin-gated by the caller).
// Returns { ok, available, entries: [{ template, user, ts, url }] }.
async function listOrgUsage(limit) {
    var c;
    try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }

    var map = await resolveUsageFields(c);
    if (!map || !map.templateName) return { ok: true, available: false, entries: [] };

    var sel = ['Id', 'CreatedDate', 'CreatedBy.Name', map.templateName];
    if (map.recordId)  sel.push(map.recordId);
    if (map.recordUrl) sel.push(map.recordUrl);
    var soql = 'SELECT ' + sel.join(', ') + ' FROM ' + USAGE_OBJ
             + ' ORDER BY CreatedDate DESC LIMIT ' + Math.min(limit || 200, 500);

    try {
        var res = await fetch(c.base + '/query?q=' + encodeURIComponent(soql),
            { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/json' } });
        if (!res.ok) return { ok: true, available: false, entries: [] };
        var data = await res.json();
        var entries = (data.records || []).map(function (r) {
            return {
                template: r[map.templateName] || '',
                user:     (r.CreatedBy && r.CreatedBy.Name) || '',
                ts:       r.CreatedDate ? new Date(r.CreatedDate).getTime() : null,
                recordId: (map.recordId && r[map.recordId]) || '',
                url:      (map.recordUrl && r[map.recordUrl]) || ''
            };
        });
        return { ok: true, available: true, entries: entries };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// Resolve the id of a record the user JUST created in a modal, where neither the
// URL nor the success-toast link can be read. Queries their most-recently-created
// record of <object> at/after <sinceTs> (epoch ms) — deterministic and record-
// type-agnostic. Read-only; { ok, id } with id null for none (e.g. a cancel).
async function findLatestRecord(object, sinceTs) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(object || ''))) return { ok: true, id: null };
    var c;
    try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var stored = await chrome.storage.local.get(['sfOAuthUser']);
    var uid = (stored.sfOAuthUser || {}).id;
    if (!uid) return { ok: true, id: null };

    var esc = self.SfUtils.soqlEscape;
    // 15s slack absorbs client/server clock skew. CreatedDate is a SOQL datetime
    // literal — no quotes, no milliseconds.
    var sinceIso = new Date(Math.max(0, (sinceTs || 0) - 15000)).toISOString().replace(/\.\d{3}Z$/, 'Z');
    var soql = 'SELECT Id FROM ' + object
             + " WHERE CreatedById = '" + esc(uid) + "'"
             + ' AND CreatedDate >= ' + sinceIso
             + ' ORDER BY CreatedDate DESC LIMIT 1';
    try {
        var res = await fetch(c.base + '/query?q=' + encodeURIComponent(soql),
            { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/json' } });
        if (!res.ok) return { ok: true, id: null };   // not queryable / no access — stay silent
        var data = await res.json();
        var rec = (data.records || [])[0];
        return { ok: true, id: rec ? rec.Id : null };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

self.SfUsage = { pushUsage: pushUsage, listOrgUsage: listOrgUsage, findLatestRecord: findLatestRecord };

}());
