// ==================================================
// CYFOR Nucleus Enhancer — Template read-acknowledgements (DORMANT until configured)
// "I have read and understood v2.1" per analyst per CONTROLLED template — for QMS /
// UKAS accreditation. Lights up only once the admin creates NucleusTemplateAck__c
// (spec: docs/salesforce-ack-object.md); until then every call is a silent no-op,
// so this ships ahead of the Salesforce config and "lights up" by itself.
//
// Who/when come from the standard CreatedBy / CreatedDate (immutable = a real audit
// trail). Field API names are describe-discovered like every other Nucleus object.
// Exported as self.SfAcks.
// ==================================================

(function () {

var ACK_OBJ      = 'NucleusTemplateAck__c';
var TEMPLATE_OBJ = 'NucleusTemplate__c';
var MEMBER_OBJ   = 'NucleusTeamMember__c';
var ACK_CONCEPTS = { version: ['versionlabel', 'version'] };

// Availability cache (per SW lifetime): once the describe fails we stop trying
// until the worker restarts, so a missing object costs one request per lifetime
// and creating it in Salesforce gets picked up automatically on the next restart.
var resolvedMap = null;   // { template, templateRel, version }
var unavailable = false;

async function ctx() {
    var stored = await chrome.storage.local.get(['sfOAuthTokens', 'sfOAuthConfig']);
    var instanceUrl = ((stored.sfOAuthTokens || {}).instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) throw new Error('No instance URL');
    var token = await self.SfOAuth.getValidAccessToken();
    var apiVersion = (stored.sfOAuthConfig || {}).apiVersion || 'v62.0';
    return { base: instanceUrl + '/services/data/' + apiVersion, token: token };
}

function authHeaders(token) {
    return { Authorization: 'Bearer ' + token, Accept: 'application/json' };
}

async function resolveAckFields(c) {
    if (unavailable) return null;
    if (resolvedMap) return resolvedMap;
    try {
        var d      = await self.SfUtils.describeObject(c.base, c.token, ACK_OBJ);
        var fields = d.fields || [];
        var ref    = self.SfUtils.findReferenceField(fields, TEMPLATE_OBJ); // the Template lookup
        var conc   = self.SfUtils.resolveFields(fields, ACK_CONCEPTS);
        if (!ref || !conc.version) { unavailable = true; return null; } // object exists but is missing a required field
        resolvedMap = { template: ref.name, templateRel: ref.relationshipName, version: conc.version };
        return resolvedMap;
    } catch (e) {
        unavailable = true; // object not created yet — stay dormant
        return null;
    }
}

async function currentUserId() {
    var stored = await chrome.storage.local.get('sfOAuthUser');
    return (stored.sfOAuthUser || {}).id || null;
}

function ackKey(templateId, version) { return String(templateId) + '|' + String(version); }

// Is the feature live? (object + required fields present.)
async function status() {
    var c;
    try { c = await ctx(); } catch (e) { return { ok: true, available: false }; }
    var map = await resolveAckFields(c);
    return { ok: true, available: !!map };
}

// The current user's acknowledgements → { available, acks: ["templateId|version", …] }.
// The manager checks each controlled template's CURRENT version against this set.
async function fetchMine() {
    var c;
    try { c = await ctx(); } catch (e) { return { ok: true, available: false, acks: [] }; }
    var map = await resolveAckFields(c);
    if (!map) return { ok: true, available: false, acks: [] };

    var uid = await currentUserId();
    if (!uid) return { ok: true, available: true, acks: [] };

    var esc  = self.SfUtils.soqlEscape;
    var soql = 'SELECT ' + map.template + ', ' + map.version + ' FROM ' + ACK_OBJ
             + " WHERE CreatedById = '" + esc(uid) + "' LIMIT 5000";
    try {
        var res = await fetch(c.base + '/query?q=' + encodeURIComponent(soql), { headers: authHeaders(c.token) });
        if (!res.ok) return { ok: true, available: true, acks: [] };
        var data = await res.json();
        var acks = (data.records || []).map(function (r) {
            return ackKey(r[map.template], r[map.version]);
        });
        return { ok: true, available: true, acks: acks };
    } catch (e) {
        return { ok: true, available: true, acks: [] };
    }
}

// Record an acknowledgement. Idempotent — if this user already acknowledged this
// template+version, we don't create a duplicate. Never affects anything else.
async function acknowledge(templateId, versionLabel) {
    var c;
    try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var map = await resolveAckFields(c);
    if (!map) return { ok: false, error: 'NOT_AVAILABLE' };
    if (!self.SfUtils.isValidSfId(templateId)) return { ok: false, error: 'Invalid template id' };

    var version = String(versionLabel == null ? '' : versionLabel).slice(0, 20);
    var uid     = await currentUserId();
    var esc     = self.SfUtils.soqlEscape;

    // Idempotency guard — don't record the same acknowledgement twice.
    if (uid) {
        var dupSoql = 'SELECT Id FROM ' + ACK_OBJ
            + " WHERE CreatedById = '" + esc(uid) + "'"
            + ' AND ' + map.template + " = '" + esc(templateId) + "'"
            + ' AND ' + map.version  + " = '" + esc(version) + "' LIMIT 1";
        try {
            var dup = await fetch(c.base + '/query?q=' + encodeURIComponent(dupSoql), { headers: authHeaders(c.token) });
            if (dup.ok) { var dd = await dup.json(); if (dd.records && dd.records.length) return { ok: true, already: true }; }
        } catch (e) { /* fall through and just create */ }
    }

    var body = {};
    body[map.template] = templateId;
    body[map.version]  = version;
    try {
        var res = await fetch(c.base + '/sobjects/' + ACK_OBJ + '/', {
            method:  'POST',
            headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
            body:    JSON.stringify(body)
        });
        if (res.ok) { if (self.dlog) self.dlog('acks', 'acknowledged', { template: templateId, version: version }); return { ok: true }; }
        // Distinguish a STRUCTURAL rejection (object still "In Development"/read-only, or
        // the user has no Create) from a genuine save error. Salesforce's raw text for the
        // former — "entity type cannot be inserted" — is meaningless to an analyst, so give
        // an actionable message and tag it notReady (it's a setup gap, not their fault).
        var code = '', raw = '';
        try { var eb = await res.json(); if (Array.isArray(eb) && eb[0]) { code = eb[0].errorCode || ''; raw = eb[0].message || ''; } } catch (ignore) {}
        if (res.status === 403 || /CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY|INSUFFICIENT_ACCESS|NOT_INSERTABLE/i.test(code)) {
            return { ok: false, notReady: true,
                error: 'Acknowledgements aren’t switched on in Salesforce yet — a template admin needs to finish the setup. Nothing’s lost; try again once it’s enabled.' };
        }
        return { ok: false, error: raw || ('Acknowledgement could not be saved (' + res.status + ')') };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// Admin matrix data: the active member roster + every acknowledgement. The manager
// joins these against its template list (which carries each template's teams,
// current version and the requires-ack flag) to compute who is OUTSTANDING per
// controlled template. Admin-gated by the caller.
async function fetchMatrix() {
    var c;
    try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var map = await resolveAckFields(c);
    if (!map) return { ok: true, available: false, members: [], acks: [] };

    // Roster — de-duplicate a user who belongs to several teams into one entry
    // that lists all their team codes (mirrors multi-team membership).
    var members = [];
    try {
        var memSoql = 'SELECT User__c, User__r.Name, Team__r.TeamCode__c FROM ' + MEMBER_OBJ
                    + ' WHERE Team__r.IsActive__c = true LIMIT 5000';
        var mRes = await fetch(c.base + '/query?q=' + encodeURIComponent(memSoql), { headers: authHeaders(c.token) });
        if (mRes.ok) {
            var mData = await mRes.json();
            var byUser = {};
            (mData.records || []).forEach(function (r) {
                var uid = r.User__c;
                if (!uid) return;
                if (!byUser[uid]) byUser[uid] = { userId: uid, name: (r.User__r && r.User__r.Name) || '', teamCodes: [] };
                var code = r.Team__r && r.Team__r.TeamCode__c;
                if (code && byUser[uid].teamCodes.indexOf(code) === -1) byUser[uid].teamCodes.push(code);
            });
            members = Object.keys(byUser).map(function (k) { return byUser[k]; });
        }
    } catch (e) { /* roster unavailable — matrix just can't show "outstanding" names */ }

    // Every acknowledgement.
    var acks = [];
    try {
        var aSoql = 'SELECT ' + map.template + ', ' + map.version + ', CreatedById, CreatedBy.Name FROM ' + ACK_OBJ + ' LIMIT 5000';
        var aRes  = await fetch(c.base + '/query?q=' + encodeURIComponent(aSoql), { headers: authHeaders(c.token) });
        if (aRes.ok) {
            var aData = await aRes.json();
            acks = (aData.records || []).map(function (r) {
                return {
                    templateId: r[map.template] || '',
                    version:    r[map.version]  || '',
                    userId:     r.CreatedById   || '',
                    name:       (r.CreatedBy && r.CreatedBy.Name) || ''
                };
            });
        }
    } catch (e) { /* no acks yet */ }

    return { ok: true, available: true, members: members, acks: acks };
}

self.SfAcks = { status: status, fetchMine: fetchMine, acknowledge: acknowledge, fetchMatrix: fetchMatrix };

}());
