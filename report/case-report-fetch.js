// ==================================================
// CYFOR Nucleus Enhancer — Case Report Live Fetch (background)
// Given a Forensic Case object + record id, pulls the case
// and all related child records live via the Salesforce REST
// API, resolving lookups to display names so the records match
// the shape the disclosure-report generator expects.
//
// Child objects are discovered dynamically from the parent's
// describe (childRelationships) so exact API names do not need
// to be hardcoded. A stored `caseReportConfig` override can pin
// any object/link field if discovery cannot match it.
//
// Exposes: self.CaseReportFetch.fetchCaseBundle({ caseObject, caseId })
// ==================================================

self.CaseReportFetch = (function () {

// Candidate API names per section. Discovery matches the parent's
// childRelationships exactly (case-insensitive) against these.
var OBJECT_CANDIDATES = {
    exhibits:          ['Exhibit__c'],
    process:           ['Process__c', 'Exhibit_Processing__c', 'Processing__c'],
    timeEntries:       ['Time_Entry__c', 'Time_Log__c', 'TimeEntry__c', 'Time_Entries__c'],
    generatedMaterial: ['Generated_Material__c', 'GeneratedMaterial__c', 'Generated_Exhibit__c'],
    archive:           ['Forensic_Case_Archive__c', 'Case_Archive__c', 'ForensicCaseArchive__c'],
    continuity:        ['Continuity__c', 'Exhibit_Continuity__c', 'ExhibitContinuity__c']
};

// Field types that cannot be selected directly in SOQL (compound / binary).
var UNSELECTABLE_TYPES = { 'address': true, 'location': true, 'base64': true };

// ── REST helpers ──────────────────────────────────────────────────────────────

async function sfError(res) {
    try {
        var j = await res.json();
        if (Array.isArray(j) && j[0]) return j[0].message || j[0].errorCode || ('HTTP ' + res.status);
        if (j && j.error) return j.error;
    } catch (e) { /* ignore */ }
    return 'HTTP ' + res.status;
}

async function apiGet(ctx, path) {
    var res = await fetch(ctx.base + path, { headers: { Authorization: 'Bearer ' + ctx.token } });
    if (!res.ok) throw new Error(await sfError(res));
    return res.json();
}

async function soql(ctx, q) {
    var res = await fetch(ctx.base + '/query/?q=' + encodeURIComponent(q), {
        headers: { Authorization: 'Bearer ' + ctx.token }
    });
    if (!res.ok) throw new Error(await sfError(res));
    var data = await res.json();
    return data.records || [];
}

async function describe(ctx, obj) {
    var key = obj.toLowerCase();
    if (ctx.cache.has(key)) return ctx.cache.get(key);
    var d = await apiGet(ctx, '/sobjects/' + obj + '/describe');
    ctx.cache.set(key, d);
    return d;
}

// Build a SELECT clause for ALL queryable fields, resolving lookups to <rel>.Name.
// Selection order follows describe field order so the rendered detail follows it.
async function buildSelectAll(ctx, obj, descOpt) {
    var d = descOpt || await describe(ctx, obj);
    var selects = [];
    var relToField = Object.create(null);

    (d.fields || []).forEach(function (f) {
        if (UNSELECTABLE_TYPES[f.type]) return;
        if (f.type === 'reference' && f.relationshipName) {
            selects.push(f.relationshipName + '.Name');
            relToField[f.relationshipName] = f.name;
        } else {
            selects.push(f.name);
        }
    });

    var seen = Object.create(null);
    selects = selects.filter(function (s) {
        var k = s.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
    });
    if (!selects.length) selects.push('Id');
    return { selects: selects, relToField: relToField };
}

// Flatten resolved lookups in place: row.RecordType.Name -> out.RecordTypeId, etc.
// Field order is preserved (the relationship sits where its id field would).
function normalize(row, relToField) {
    var out = {};
    for (var k in row) {
        if (k === 'attributes') continue;
        var fld = relToField[k];
        if (fld !== undefined) {
            out[fld] = (row[k] && row[k].Name != null) ? row[k].Name : null;
        } else {
            out[k] = row[k];
        }
    }
    return out;
}

// Locate a child object + its lookup field via the parent's childRelationships.
function resolveChild(parentDesc, candidates, override) {
    if (override && override.object && override.linkField) {
        return { object: override.object, linkField: override.linkField };
    }
    var rels = parentDesc.childRelationships || [];
    for (var i = 0; i < candidates.length; i++) {
        var cand = candidates[i].toLowerCase();
        for (var j = 0; j < rels.length; j++) {
            var r = rels[j];
            if (r.childSObject && r.field && r.childSObject.toLowerCase() === cand) {
                return { object: r.childSObject, linkField: r.field };
            }
        }
    }
    return null;
}

// ── Public ────────────────────────────────────────────────────────────────────

async function fetchCaseBundle(params) {
    var caseObject = params.caseObject;
    var caseId = params.caseId;

    var cfgRes = await chrome.storage.local.get(['sfOAuthConfig', 'caseReportConfig']);
    var apiVersion = (cfgRes.sfOAuthConfig || {}).apiVersion || 'v62.0';
    var override = cfgRes.caseReportConfig || {};

    var token = await self.SfOAuth.getValidAccessToken();
    var tk = await chrome.storage.local.get('sfOAuthTokens');
    var instanceUrl = (tk.sfOAuthTokens || {}).instanceUrl;
    if (!instanceUrl) throw new Error('NOT_AUTHENTICATED');

    var ctx = {
        base: instanceUrl.replace(/\/$/, '') + '/services/data/' + apiVersion,
        token: token,
        cache: new Map(),
        warnings: []
    };

    var parentDesc = await describe(ctx, caseObject);

    // Case record
    var caseSel = await buildSelectAll(ctx, caseObject, parentDesc);
    var caseRows = await soql(ctx, 'SELECT ' + caseSel.selects.join(',') + ' FROM ' + caseObject +
        " WHERE Id = '" + caseId + "' LIMIT 1");
    if (!caseRows.length) throw new Error('Case record not found');
    var caseRecord = normalize(caseRows[0], caseSel.relToField);

    async function childSection(key) {
        var loc = resolveChild(parentDesc, OBJECT_CANDIDATES[key], override[key]);
        if (!loc) { ctx.warnings.push('Could not locate object for "' + key + '"'); return { supplied: false, records: [] }; }
        try {
            var sel = await buildSelectAll(ctx, loc.object);
            var rows = await soql(ctx, 'SELECT ' + sel.selects.join(',') + ' FROM ' + loc.object +
                " WHERE " + loc.linkField + " = '" + caseId + "' LIMIT 2000");
            return {
                supplied: true,
                object: loc.object,
                records: rows.map(function (r) { return normalize(r, sel.relToField); })
            };
        } catch (e) {
            ctx.warnings.push(key + ' query failed: ' + e.message);
            return { supplied: false, records: [] };
        }
    }

    var exhibits = await childSection('exhibits');
    var process = await childSection('process');
    var timeEntries = await childSection('timeEntries');
    var generatedMaterial = await childSection('generatedMaterial');
    var archive = await childSection('archive');
    var continuity = await fetchContinuity(ctx, exhibits, override.continuity);

    return {
        caseRecord: caseRecord,
        exhibits: exhibits,
        continuity: continuity,
        generatedMaterial: generatedMaterial,
        process: process,
        timeEntries: timeEntries,
        archive: archive,
        meta: {
            warnings: ctx.warnings,
            childRelationships: (parentDesc.childRelationships || [])
                .filter(function (r) { return r.childSObject && r.field; })
                .map(function (r) { return { object: r.childSObject, field: r.field, relationship: r.relationshipName }; })
        }
    };
}

// Continuity records hang off Exhibit, not the Case.
async function fetchContinuity(ctx, exhibits, override) {
    if (!exhibits || !exhibits.supplied || !exhibits.object || !exhibits.records.length) {
        return { supplied: false, records: [] };
    }
    var exDesc;
    try { exDesc = await describe(ctx, exhibits.object); }
    catch (e) { ctx.warnings.push('Exhibit describe failed: ' + e.message); return { supplied: false, records: [] }; }

    var loc = resolveChild(exDesc, OBJECT_CANDIDATES.continuity, override);
    if (!loc) { ctx.warnings.push('Could not locate Continuity object'); return { supplied: false, records: [] }; }

    var ids = exhibits.records.map(function (r) { return r.Id; }).filter(Boolean);
    if (!ids.length) return { supplied: true, records: [] };

    try {
        var sel = await buildSelectAll(ctx, loc.object);
        var inList = '(' + ids.map(function (id) { return "'" + id + "'"; }).join(',') + ')';
        var rows = await soql(ctx, 'SELECT ' + sel.selects.join(',') + ' FROM ' + loc.object +
            ' WHERE ' + loc.linkField + ' IN ' + inList + ' LIMIT 2000');
        return { supplied: true, records: rows.map(function (r) { return normalize(r, sel.relToField); }) };
    } catch (e) {
        ctx.warnings.push('Continuity query failed: ' + e.message);
        return { supplied: false, records: [] };
    }
}

return { fetchCaseBundle: fetchCaseBundle };

})();
