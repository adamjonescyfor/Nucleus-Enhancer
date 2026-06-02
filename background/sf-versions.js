// ==================================================
// CYFOR Nucleus Enhancer — Template Version Archive
// Archives a NucleusTemplate__c version before each update and retrieves the
// history. Field API names are DISCOVERED from the object describe (so labels
// like "Change Reason" -> Change_Reason__c are matched even if the code would
// have guessed ChangeReason__c). Who/when use the system CreatedBy/CreatedDate,
// so no custom "changed by" fields are required.
// Exported as self.SfVersions.
// ==================================================

(function () {

var VERSION_OBJ = 'NucleusTemplateVersion__c';
var VERSION_CONCEPTS = {
    versionLabel: ['versionlabel', 'version'],
    content:      ['content'],
    changeReason: ['changereason', 'reasonforchange', 'reason'],
    archivedAt:   ['archivedat', 'archived']
};

async function ctx() {
    var stored = await chrome.storage.local.get(['sfOAuthTokens', 'sfOAuthConfig']);
    var instanceUrl = ((stored.sfOAuthTokens || {}).instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) throw new Error('No instance URL');
    var token = await self.SfOAuth.getValidAccessToken();
    var apiVersion = (stored.sfOAuthConfig || {}).apiVersion || 'v62.0';
    return { base: instanceUrl + '/services/data/' + apiVersion, token: token };
}

// Resolve version-object field names + the lookup to NucleusTemplate__c.
async function resolveVersionFields(c) {
    var d = await self.SfUtils.describeObject(c.base, c.token, VERSION_OBJ); // throws if object missing
    var fields = d.fields || [];
    var map = self.SfUtils.resolveFields(fields, VERSION_CONCEPTS);
    var ref = self.SfUtils.findReferenceField(fields, 'NucleusTemplate__c');
    map.template = ref ? ref.name : null;
    return map;
}

async function getVersionHistory(templateId) {
    var c;
    try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }

    var map;
    try { map = await resolveVersionFields(c); }
    catch (e) { return { ok: true, versions: [], unavailable: true }; } // object not created yet

    if (!map.template) return { ok: true, versions: [], unavailable: true };

    var esc = self.SfUtils.soqlEscape;
    var sel = ['Id', 'CreatedDate', 'CreatedBy.Name', 'CreatedBy.Email'];
    ['versionLabel', 'content', 'changeReason', 'archivedAt'].forEach(function (k) { if (map[k]) sel.push(map[k]); });

    var soql = 'SELECT ' + sel.join(', ') + ' FROM ' + VERSION_OBJ
             + " WHERE " + map.template + " = '" + esc(templateId) + "'"
             + ' ORDER BY CreatedDate DESC';

    try {
        var res = await fetch(c.base + '/query?q=' + encodeURIComponent(soql),
            { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/json' } });
        if (!res.ok) {
            var eb = await res.json().catch(function () { return []; });
            var missing = Array.isArray(eb) && eb.some(function (e) { return e.errorCode === 'INVALID_TYPE' || e.errorCode === 'INVALID_FIELD'; });
            if (missing) return { ok: true, versions: [], unavailable: true };
            return { ok: false, error: 'History query failed: ' + res.status };
        }
        var data = await res.json();
        // Normalise to the keys the manager UI expects.
        var versions = (data.records || []).map(function (r) {
            var by = r.CreatedBy || {};
            return {
                VersionLabel__c:   map.versionLabel ? (r[map.versionLabel] || '') : '',
                Content__c:        map.content ? (r[map.content] || '') : '',
                ChangeReason__c:   map.changeReason ? (r[map.changeReason] || '') : '',
                ArchivedAt__c:     (map.archivedAt && r[map.archivedAt]) || r.CreatedDate || '',
                ChangedByName__c:  by.Name || '',
                ChangedByEmail__c: by.Email || ''
            };
        });
        return { ok: true, versions: versions };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// payload: { templateId, versionLabel, content, changeReason }
async function archiveCurrentVersion(payload) {
    var c;
    try { c = await ctx(); } catch (e) { console.warn('[CYFOR] archive: ' + e.message); return; }

    var map;
    try { map = await resolveVersionFields(c); }
    catch (e) { console.warn('[CYFOR] archive: version object unavailable'); return; } // object not created — skip silently

    if (!map.template) { console.warn('[CYFOR] archive: no Template lookup on ' + VERSION_OBJ); return; }

    var body = {};
    body[map.template] = payload.templateId;
    if (map.versionLabel) body[map.versionLabel] = payload.versionLabel || '1.0';
    if (map.content)      body[map.content]      = payload.content || '';
    if (map.changeReason) body[map.changeReason] = payload.changeReason || '';
    if (map.archivedAt)   body[map.archivedAt]   = new Date().toISOString();

    try {
        var res = await fetch(c.base + '/sobjects/' + VERSION_OBJ + '/', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            var eb = await res.json().catch(function () { return [{}]; });
            console.warn('[CYFOR] archiveCurrentVersion failed:', (eb[0] && eb[0].message) || res.status);
        }
    } catch (e) {
        console.warn('[CYFOR] archiveCurrentVersion error:', e.message);
    }
}

self.SfVersions = { getVersionHistory: getVersionHistory, archiveCurrentVersion: archiveCurrentVersion };

}());
