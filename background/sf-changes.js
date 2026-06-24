// ==================================================
// CYFOR Nucleus Enhancer — Template change-requests (DORMANT until configured)
// Lets a non-admin propose an edit to a template; admins review (diff against the
// current content) and Apply or Reject. Lights up only once the admin creates
// NucleusTemplateChangeRequest__c (spec: docs/salesforce-change-request-object.md);
// until then every call is a silent no-op, so this ships ahead of the Salesforce
// config and activates by itself.
//
// Who/when come from the standard CreatedBy / CreatedDate. Field API names are
// describe-discovered like every other Nucleus object. Exported as self.SfChanges.
// ==================================================

(function () {

var CR_OBJ       = 'NucleusTemplateChangeRequest__c';
var TEMPLATE_OBJ = 'NucleusTemplate__c';
var CR_CONCEPTS  = {
    proposed: ['proposedcontent', 'proposed', 'content'],
    reason:   ['reason', 'changereason'],
    status:   ['status'],
    adminNote:['adminnote', 'reviewnote', 'note']   // optional
};

var resolvedMap = null;   // { template, proposed, reason, status, adminNote? }
var unavailable = false;

async function ctx() {
    var stored = await chrome.storage.local.get(['sfOAuthTokens', 'sfOAuthConfig']);
    var instanceUrl = ((stored.sfOAuthTokens || {}).instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) throw new Error('No instance URL');
    var token = await self.SfOAuth.getValidAccessToken();
    var apiVersion = (stored.sfOAuthConfig || {}).apiVersion || 'v62.0';
    return { base: instanceUrl + '/services/data/' + apiVersion, token: token };
}

function authHeaders(token) { return { Authorization: 'Bearer ' + token, Accept: 'application/json' }; }
function jsonHeaders(token) { return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }; }

async function resolveFields(c) {
    if (unavailable) return null;
    if (resolvedMap) return resolvedMap;
    try {
        var d      = await self.SfUtils.describeObject(c.base, c.token, CR_OBJ);
        var fields = d.fields || [];
        var ref    = self.SfUtils.findReferenceField(fields, TEMPLATE_OBJ);
        var conc   = self.SfUtils.resolveFields(fields, CR_CONCEPTS);
        // The required four: a Template lookup, proposed content, reason, status.
        if (!ref || !conc.proposed || !conc.reason || !conc.status) { unavailable = true; return null; }
        resolvedMap = {
            template: ref.name, templateRel: ref.relationshipName,
            proposed: conc.proposed, reason: conc.reason, status: conc.status, adminNote: conc.adminNote || null
        };
        return resolvedMap;
    } catch (e) {
        unavailable = true; // object not created yet — stay dormant
        return null;
    }
}

async function status() {
    var c; try { c = await ctx(); } catch (e) { return { ok: true, available: false }; }
    return { ok: true, available: !!(await resolveFields(c)) };
}

// Member: propose an edit. Creates a Pending request. Never touches the template.
async function submit(templateId, proposedContent, reason) {
    var c; try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var map = await resolveFields(c);
    if (!map) return { ok: false, error: 'NOT_AVAILABLE' };
    if (!self.SfUtils.isValidSfId(templateId)) return { ok: false, error: 'Invalid template id' };
    if (!String(proposedContent || '').trim()) return { ok: false, error: 'Proposed content is empty' };

    var body = {};
    body[map.template] = templateId;
    body[map.proposed] = String(proposedContent).slice(0, 131072);
    body[map.reason]   = String(reason || '').slice(0, 2000);
    // Status is NOT set here on purpose — it comes from the field's default (Pending),
    // so a member needs no write access to the review-status field. Admins set it to
    // Approved/Rejected via resolve(). (The Salesforce default value MUST be Pending,
    // since listPending() filters on it.)
    try {
        var res = await fetch(c.base + '/sobjects/' + CR_OBJ + '/', {
            method: 'POST', headers: jsonHeaders(c.token), body: JSON.stringify(body)
        });
        if (res.ok) { if (self.dlog) self.dlog('changes', 'submitted', { template: templateId }); return { ok: true }; }
        var message = 'Suggestion could not be saved (' + res.status + ')';
        try { var eb = await res.json(); if (Array.isArray(eb) && eb[0] && eb[0].message) message = eb[0].message; } catch (ig) {}
        return { ok: false, error: message };
    } catch (e) { return { ok: false, error: e.message }; }
}

function selectFields(map) {
    var sel = ['Id', map.template, map.proposed, map.reason, map.status, 'CreatedDate', 'CreatedBy.Name'];
    if (map.adminNote) sel.push(map.adminNote);
    return sel;
}

function mapRow(r, map) {
    return {
        id:         r.Id,
        templateId: r[map.template] || '',
        proposed:   r[map.proposed] || '',
        reason:     r[map.reason]   || '',
        status:     r[map.status]   || 'Pending',
        adminNote:  (map.adminNote && r[map.adminNote]) || '',
        by:         (r.CreatedBy && r.CreatedBy.Name) || '',
        at:         r.CreatedDate ? new Date(r.CreatedDate).getTime() : null
    };
}

// Admin: all Pending requests (newest first).
async function listPending() {
    var c; try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var map = await resolveFields(c);
    if (!map) return { ok: true, available: false, requests: [] };
    var soql = 'SELECT ' + selectFields(map).join(', ') + ' FROM ' + CR_OBJ
             + " WHERE " + map.status + " = 'Pending' ORDER BY CreatedDate DESC LIMIT 500";
    try {
        var res = await fetch(c.base + '/query?q=' + encodeURIComponent(soql), { headers: authHeaders(c.token) });
        if (!res.ok) return { ok: true, available: true, requests: [] };
        var data = await res.json();
        return { ok: true, available: true, requests: (data.records || []).map(function (r) { return mapRow(r, map); }) };
    } catch (e) { return { ok: false, error: e.message }; }
}

// The current user's bare 18-char User Id. Authoritative source is a live userinfo
// call (`user_id`); `sub` is an identity URL (".../00D…/005…") whose last segment is
// the id; the stored sfOAuthUser.id is the last-resort fallback. CreatedById needs the
// bare id — the stored value can be the URL form, which matches nothing.
async function currentUserId(c) {
    try {
        var res = await fetch(c.base + '/services/oauth2/userinfo', { headers: authHeaders(c.token) });
        if (res.ok) {
            var d = await res.json();
            if (d.user_id) return String(d.user_id);
            if (d.sub)     return String(d.sub).split('/').filter(Boolean).pop();
        }
    } catch (e) { /* fall back to stored */ }
    var stored = await chrome.storage.local.get('sfOAuthUser');
    var sid = String((stored.sfOAuthUser || {}).id || '');
    if (sid.indexOf('/') !== -1) sid = sid.split('/').filter(Boolean).pop();
    return sid;
}

// Member: their own requests + current status.
async function listMine() {
    var c; try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var map = await resolveFields(c);
    if (!map) return { ok: true, available: false, requests: [] };
    var uid = await currentUserId(c);
    if (!uid) return { ok: false, error: 'Could not determine your Salesforce user — reconnect from the popup.' };
    var esc = self.SfUtils.soqlEscape;
    var soql = 'SELECT ' + selectFields(map).join(', ') + ' FROM ' + CR_OBJ
             + " WHERE CreatedById = '" + esc(uid) + "' ORDER BY CreatedDate DESC LIMIT 200";
    try {
        var res = await fetch(c.base + '/query?q=' + encodeURIComponent(soql), { headers: authHeaders(c.token) });
        if (!res.ok) {
            var msg = 'Could not load your suggestions (' + res.status + ')';
            try { var eb = await res.json(); if (Array.isArray(eb) && eb[0] && eb[0].message) msg = eb[0].message; } catch (ig) {}
            return { ok: false, error: msg };
        }
        var data = await res.json();
        return { ok: true, available: true, requests: (data.records || []).map(function (r) { return mapRow(r, map); }) };
    } catch (e) { return { ok: false, error: e.message }; }
}

// Admin: mark a request Approved / Rejected (the template update itself is the
// normal admin editor Save — this just resolves the request + records a note).
async function resolve(requestId, newStatus, adminNote) {
    var c; try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var map = await resolveFields(c);
    if (!map) return { ok: false, error: 'NOT_AVAILABLE' };
    if (!self.SfUtils.isValidSfId(requestId)) return { ok: false, error: 'Invalid request id' };
    if (newStatus !== 'Approved' && newStatus !== 'Rejected') return { ok: false, error: 'Invalid status' };

    var body = {};
    body[map.status] = newStatus;
    if (map.adminNote && adminNote != null) body[map.adminNote] = String(adminNote).slice(0, 2000);
    try {
        var res = await fetch(c.base + '/sobjects/' + CR_OBJ + '/' + requestId, {
            method: 'PATCH', headers: jsonHeaders(c.token), body: JSON.stringify(body)
        });
        if (res.ok || res.status === 204) { if (self.dlog) self.dlog('changes', 'resolved', { id: requestId, status: newStatus }); return { ok: true }; }
        var message = 'Could not update the suggestion (' + res.status + ')';
        try { var eb = await res.json(); if (Array.isArray(eb) && eb[0] && eb[0].message) message = eb[0].message; } catch (ig) {}
        return { ok: false, error: message };
    } catch (e) { return { ok: false, error: e.message }; }
}

self.SfChanges = { status: status, submit: submit, listPending: listPending, listMine: listMine, resolve: resolve };

}());
