// ==================================================
// CYFOR Nucleus Enhancer — Forensic Case helpers (background)
// Resolves the "Project" (case alias) field on Forensic_Case__c and fetches it
// for a set of case record ids, so the content script can surface the alias in
// places Salesforce doesn't show it (Task pages, Recently Viewed lists, etc.).
// Field is describe-discovered (label "Project", or an alias/project field);
// handles both a plain text field and a lookup whose related Name is the alias.
// Exported as self.SfCases.
// ==================================================

(function () {

var CASE_OBJ = 'Forensic_Case__c';

// resolved = { select, isRef, name?, rel? } | null
var resolved    = null;
var unavailable = false;

async function ctx() {
    var stored = await chrome.storage.local.get(['sfOAuthTokens', 'sfOAuthConfig']);
    var instanceUrl = ((stored.sfOAuthTokens || {}).instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) throw new Error('No instance URL');
    var token = await self.SfOAuth.getValidAccessToken();
    var apiVersion = (stored.sfOAuthConfig || {}).apiVersion || 'v62.0';
    return { base: instanceUrl + '/services/data/' + apiVersion, token: token };
}

async function resolveProjectField(c) {
    if (resolved) return resolved;
    if (unavailable) return null;
    // A describe failure here is TRANSIENT (network/HTTP) — let it throw so the caller
    // can retry, rather than permanently disabling the feature. Only a *successful*
    // describe with no matching field is treated as genuinely unavailable.
    var d = await self.SfUtils.describeObject(c.base, c.token, CASE_OBJ);
    var fields = d.fields || [];
    // The list-view column is labelled "Project"; it is the case alias. Match an
    // exact "Project" label first, then any alias/project field.
    var byLabel = function (re) { return fields.filter(function (f) { return re.test((f.label || '').trim()); })[0]; };
    var byAny   = function (re) { return fields.filter(function (f) { return re.test((f.label || '') + ' ' + (f.name || '')); })[0]; };
    var f = byLabel(/^project$/i) || byAny(/alias/i) || byAny(/\bproject\b/i);
    if (!f) { unavailable = true; return null; } // genuinely no Project field — stay dormant

    if (f.type === 'reference' && f.relationshipName) {
        resolved = { isRef: true, rel: f.relationshipName, select: f.relationshipName + '.Name' };
    } else {
        resolved = { isRef: false, name: f.name, select: f.name };
    }
    resolved.keyPrefix = d.keyPrefix || null; // e.g. "a2X" — lets the content target case links
    return resolved;
}

// ids → { ok, available, projects: { caseId: "Alias" } }. Only non-empty aliases
// are returned. Read-only; never throws to the caller.
async function fetchProjects(ids) {
    if (!Array.isArray(ids) || !ids.length) return { ok: true, available: true, projects: {} };
    var c;
    try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var map;
    // A transient describe error → ok:false so the content script retries; a clean
    // "no Project field" → available:false so it stops (the field genuinely isn't there).
    try { map = await resolveProjectField(c); } catch (e) { return { ok: false, error: e.message }; }
    if (!map) return { ok: true, available: false, projects: {} };

    var esc   = self.SfUtils.soqlEscape;
    var valid = ids.filter(function (id) { return self.SfUtils.isValidSfId(id); }).slice(0, 200);
    if (!valid.length) return { ok: true, available: true, projects: {} };

    var inList = valid.map(function (id) { return "'" + esc(id) + "'"; }).join(', ');
    var soql   = 'SELECT Id, ' + map.select + ' FROM ' + CASE_OBJ + ' WHERE Id IN (' + inList + ')';
    try {
        var res = await fetch(c.base + '/query?q=' + encodeURIComponent(soql),
            { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/json' } });
        if (!res.ok) return { ok: true, available: true, projects: {} };
        var data = await res.json();
        var out = {};
        (data.records || []).forEach(function (r) {
            var v = map.isRef ? (r[map.rel] && r[map.rel].Name) : r[map.name];
            if (v != null && String(v).trim()) out[r.Id] = String(v).trim();
        });
        if (self.dlog) self.dlog('cases', 'projects', { asked: valid.length, found: Object.keys(out).length });
        return { ok: true, available: true, projects: out, keyPrefix: map.keyPrefix || null };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// Resolve the "Case Background" field once (describe-discovered): exact "Case Background"
// label first, then any field carrying "case background", then a plain "background".
// null = not resolved yet; '' = genuinely none. Cached per SW lifetime on a SUCCESSFUL
// describe only (a transient failure throws and is retried next call).
var bgField = null;

async function resolveCaseBackgroundField(c) {
    if (bgField !== null) return bgField;
    var d = await self.SfUtils.describeObject(c.base, c.token, CASE_OBJ);
    var fields = d.fields || [];
    var byLabel = function (re) { return fields.filter(function (f) { return re.test((f.label || '').trim()); })[0]; };
    var byAny   = function (re) { return fields.filter(function (f) { return re.test((f.label || '') + ' ' + (f.name || '')); })[0]; };
    var f = byLabel(/^case background$/i) || byAny(/case\s*background/i) || byAny(/\bbackground\b/i);
    bgField = f ? f.name : '';
    return bgField;
}

// Relationship name from <object> to its Forensic Case lookup (e.g. a Generated
// Material's parent case), describe-discovered + cached per SW lifetime.
var caseRelByObject = {};
async function resolveCaseRelationship(c, object) {
    if (caseRelByObject[object] !== undefined) return caseRelByObject[object];
    var d   = await self.SfUtils.describeObject(c.base, c.token, object);
    var ref = self.SfUtils.findReferenceField(d.fields || [], CASE_OBJ);
    caseRelByObject[object] = ref ? (ref.relationshipName || null) : null;
    return caseRelByObject[object];
}

// { caseId } OR { recordId, object } → { ok, text } with the (parent) case's Case
// Background value (HTML for a rich-text field — the caller strips tags). The recordId
// form traverses a CHILD record up its Forensic Case lookup — needed when EDITING a
// Generated Material, whose own URL carries no case id. Read-only; never throws.
async function fetchCaseBackground(opts) {
    if (typeof opts === 'string') opts = { caseId: opts };   // backward-compat
    opts = opts || {};
    // A record that IS a Forensic Case → treat its id as the case id directly.
    if (!opts.caseId && opts.object === CASE_OBJ && self.SfUtils.isValidSfId(opts.recordId)) opts.caseId = opts.recordId;

    var c;
    try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }
    var field;
    try { field = await resolveCaseBackgroundField(c); } catch (e) { return { ok: false, error: e.message }; }
    if (!field) return { ok: true, text: '' };
    var esc = self.SfUtils.soqlEscape, soql = null, pick = null;

    if (opts.caseId && self.SfUtils.isValidSfId(opts.caseId)) {
        soql = 'SELECT ' + field + ' FROM ' + CASE_OBJ + " WHERE Id = '" + esc(opts.caseId) + "' LIMIT 1";
        pick = function (rec) { return rec[field]; };
    } else if (opts.recordId && self.SfUtils.isValidSfId(opts.recordId)
            && /^[A-Za-z][A-Za-z0-9_]*$/.test(opts.object || '')) {
        var rel;
        try { rel = await resolveCaseRelationship(c, opts.object); } catch (e) { return { ok: false, error: e.message }; }
        if (!rel) return { ok: true, text: '' };
        soql = 'SELECT ' + rel + '.' + field + ' FROM ' + opts.object + " WHERE Id = '" + esc(opts.recordId) + "' LIMIT 1";
        pick = function (rec) { return rec[rel] ? rec[rel][field] : ''; };
    } else {
        return { ok: true, text: '' };
    }

    try {
        var res = await fetch(c.base + '/query?q=' + encodeURIComponent(soql),
            { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/json' } });
        if (!res.ok) return { ok: true, text: '' };
        var data = await res.json();
        var rec  = (data.records || [])[0];
        if (self.dlog) self.dlog('cases', 'case background', { via: opts.caseId ? 'case' : opts.object, field: field, hit: !!rec });
        return { ok: true, text: String((rec && pick(rec)) || '') };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

self.SfCases = { fetchProjects: fetchProjects, fetchCaseBackground: fetchCaseBackground };

}());
