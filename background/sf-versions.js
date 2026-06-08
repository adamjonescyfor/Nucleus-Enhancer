// ==================================================
// CYFOR Nucleus Enhancer — Template Version History
// Snapshots of NucleusTemplate__c content are now created by a record-triggered
// Salesforce Flow (docs/salesforce-version-history-flow.md), which fires on every
// Content change from ANY source — so the extension no longer archives versions
// itself (that would double-snapshot). This module just:
//   - reads the history for the manager's History/diff view, and
//   - cascade-deletes a template's child version records before the template is
//     deleted (the lookup restricts deletes otherwise).
// Field API names are DISCOVERED from the object describe (so labels like
// "Change Reason" -> Change_Reason__c are matched even if the code would have
// guessed ChangeReason__c). Who/when use the system CreatedBy/CreatedDate, so no
// custom "changed by" fields are required.
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

// Delete all NucleusTemplateVersion__c child records for a template, so the
// parent NucleusTemplate__c can be deleted (the lookup restricts the delete
// otherwise). Best-effort: if the version object doesn't exist or has no rows,
// resolves ok with deleted:0 and lets the parent delete proceed.
// Returns { ok, deleted } or { ok:false, error }.
async function deleteVersionsForTemplate(templateId) {
    var c;
    try { c = await ctx(); } catch (e) { return { ok: false, error: e.message }; }

    var map;
    try { map = await resolveVersionFields(c); }
    catch (e) { return { ok: true, deleted: 0, unavailable: true }; } // object not created — nothing to clean up

    if (!map.template) return { ok: true, deleted: 0, unavailable: true };

    var esc = self.SfUtils.soqlEscape;
    var soql = 'SELECT Id FROM ' + VERSION_OBJ
             + " WHERE " + map.template + " = '" + esc(templateId) + "'";

    var ids = [];
    try {
        var qres = await fetch(c.base + '/query?q=' + encodeURIComponent(soql),
            { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/json' } });
        if (!qres.ok) {
            var qeb = await qres.json().catch(function () { return []; });
            var missing = Array.isArray(qeb) && qeb.some(function (e) { return e.errorCode === 'INVALID_TYPE' || e.errorCode === 'INVALID_FIELD'; });
            if (missing) return { ok: true, deleted: 0, unavailable: true };
            return { ok: false, error: 'Version lookup failed: ' + qres.status };
        }
        var qdata = await qres.json();
        ids = (qdata.records || []).map(function (r) { return r.Id; });
    } catch (e) {
        return { ok: false, error: e.message };
    }

    if (!ids.length) return { ok: true, deleted: 0 };

    // Composite collection delete handles up to 200 ids per call.
    var deleted = 0;
    for (var i = 0; i < ids.length; i += 200) {
        var chunk = ids.slice(i, i + 200);
        try {
            var dres = await fetch(c.base + '/composite/sobjects?ids=' + chunk.join(',') + '&allOrNone=false',
                { method: 'DELETE', headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/json' } });
            if (!dres.ok) {
                var deb = await dres.json().catch(function () { return [{}]; });
                return { ok: false, error: (deb[0] && deb[0].message) || ('Version delete failed: ' + dres.status) };
            }
            var ddata = await dres.json();
            (ddata || []).forEach(function (r) {
                if (r.success) deleted++;
                else if (r.errors && r.errors[0]) throw new Error(r.errors[0].message);
            });
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    return { ok: true, deleted: deleted };
}

self.SfVersions = { getVersionHistory: getVersionHistory, deleteVersionsForTemplate: deleteVersionsForTemplate };

}());
