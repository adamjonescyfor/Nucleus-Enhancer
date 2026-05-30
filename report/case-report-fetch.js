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

// Fields requested per object (resolved to display names where they are lookups).
var FIELDS = {
    'case': [
        'Name', 'Account__c', 'Submission_Reference__c', 'Access_Level__c',
        'Access_Level_Name__c', 'Status__c', 'Job_Type__c', 'Case_Primary_Owner__c',
        'Contact_Reference__c', 'OIC_eMail__c', 'Created_Date_Time__c', 'Start_Date_Time__c',
        'Completed_Date_Time__c', 'Close_Date_Time__c', 'Returned_Date_Time__c',
        'Due_Date_Time__c', 'Turnaround_Time_TRT__c', 'Estimated_Duration_hrs__c',
        'Total_Logged_Time_hrs__c', 'Crime_Category__c', 'Specific_Crimes__c',
        'Case_Background__c', 'Forensic_Strategy__c'
    ],
    exhibits: [
        'Name', 'Forensic_Case__c', 'Type__c', 'Description__c', 'Parent_Exhibit__c',
        'Property_Number__c', 'Barcode_Number__c', 'Original_Seal_Reference__c',
        'ReSeal_Reference__c', 'Status__c', 'Forensic_Location__c', 'Receipt_Date_Time__c',
        'Check_In_Date_Time__c', 'Re_Sealed_By__c', 'Re_Sealed_Date_Time__c',
        'Exhibit_Notes__c', 'Custodian__c', 'To_Be_Destroyed__c'
    ],
    process: [
        'Name', 'RecordTypeId', 'Forensic_Case__c', 'Exhibit__c', 'Exhibit_Type__c',
        'Status__c', 'Type__c', 'Completed_By__c', 'Start_Date_Time__c', 'End_Date_Time__c',
        'Notes__c', 'Damage_Details__c', 'Device_Colour__c', 'Manufacturer__c', 'Model__c',
        'Operating_Sytem__c', 'Extraction_Method__c', 'Extraction_Software__c',
        'Imaging_Software__c', 'Imaging_Workstation__c', 'Extraction_Workstation__c',
        'MD5_Checksum__c', 'SHA1_Checksum__c', 'ICCID__c', 'IMEI_1__c', 'IMEI_2__c',
        'IMSI__c', 'Network_Operator__c'
    ],
    timeEntries: [
        'Name', 'Forensic_Case__c', 'Process_Step__c', 'Exhibit__c', 'Logged_Time_For__c',
        'Duration_hrs__c', 'Start_Date_Time__c', 'End_Date_Time__c', 'Time_Summary__c',
        'Type__c', 'Notes__c'
    ],
    generatedMaterial: [
        'Name', 'Forensic_Case__c', 'Exhibit_Type__c', 'Description__c', 'Status__c',
        'Location__c', 'Barcode_Number__c', 'Seal_Reference__c', 'Sealed_By__c',
        'Sealed_Date_Time__c', 'Encryption_Type__c', 'Encryption_Password__c', 'Media_Size_GB__c'
    ],
    archive: [
        'Name', 'Forensic_Case__c', 'Type__c', 'Media_Type__c', 'Location__c',
        'Assigned_Staff__c', 'Conducted_By__c', 'Start_Date__c', 'Completed_Date__c',
        'Archive_Until_Date__c', 'Next_Verification_Date__c', 'Exhibit_Reference__c',
        'Seal_Number__c', 'Sealed_By__c', 'Seal_Date_Time__c', 'Notes__c'
    ],
    continuity: [
        'Name', 'Exhibit__c', 'Location__c', 'Status__c', 'Requested_By__c',
        'Decision_Maker__c', 'Approved_Declined_Date_Time__c', 'Previous_Continuity__c',
        'CreatedDate'
    ]
};

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

// Build a SELECT clause for the curated fields, resolving lookups to <rel>.Name.
async function buildSelect(ctx, obj, fields, descOpt) {
    var d = descOpt || await describe(ctx, obj);
    var byName = Object.create(null);
    (d.fields || []).forEach(function (f) { byName[f.name.toLowerCase()] = f; });

    var selects = ['Id'];
    var refMap = Object.create(null);
    fields.forEach(function (fld) {
        var meta = byName[fld.toLowerCase()];
        if (!meta) return;
        if (meta.type === 'reference' && meta.relationshipName) {
            selects.push(meta.relationshipName + '.Name');
            refMap[meta.name] = meta.relationshipName;
        } else {
            selects.push(meta.name);
        }
    });

    var seen = Object.create(null);
    selects = selects.filter(function (s) {
        var k = s.toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
    });
    return { selects: selects, refMap: refMap };
}

// Flatten resolved lookups: record.RecordType.Name -> record.RecordTypeId, etc.
function normalize(rec, refMap) {
    var out = {};
    for (var k in rec) { if (k === 'attributes') continue; out[k] = rec[k]; }
    for (var fld in refMap) {
        var rel = refMap[fld];
        var relObj = rec[rel];
        out[fld] = (relObj && relObj.Name != null) ? relObj.Name
            : (rec[fld] != null ? rec[fld] : null);
        if (rel !== fld) delete out[rel];
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
    var caseSel = await buildSelect(ctx, caseObject, FIELDS['case'], parentDesc);
    var caseRows = await soql(ctx, 'SELECT ' + caseSel.selects.join(',') + ' FROM ' + caseObject +
        " WHERE Id = '" + caseId + "' LIMIT 1");
    if (!caseRows.length) throw new Error('Case record not found');
    var caseRecord = normalize(caseRows[0], caseSel.refMap);

    async function childSection(key) {
        var loc = resolveChild(parentDesc, OBJECT_CANDIDATES[key], override[key]);
        if (!loc) { ctx.warnings.push('Could not locate object for "' + key + '"'); return { supplied: false, records: [] }; }
        try {
            var sel = await buildSelect(ctx, loc.object, FIELDS[key]);
            var rows = await soql(ctx, 'SELECT ' + sel.selects.join(',') + ' FROM ' + loc.object +
                " WHERE " + loc.linkField + " = '" + caseId + "' ORDER BY Name LIMIT 2000");
            return {
                supplied: true,
                object: loc.object,
                records: rows.map(function (r) { return normalize(r, sel.refMap); })
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
        var sel = await buildSelect(ctx, loc.object, FIELDS.continuity);
        var inList = '(' + ids.map(function (id) { return "'" + id + "'"; }).join(',') + ')';
        var rows = await soql(ctx, 'SELECT ' + sel.selects.join(',') + ' FROM ' + loc.object +
            ' WHERE ' + loc.linkField + ' IN ' + inList + ' ORDER BY Name LIMIT 2000');
        return { supplied: true, records: rows.map(function (r) { return normalize(r, sel.refMap); }) };
    } catch (e) {
        ctx.warnings.push('Continuity query failed: ' + e.message);
        return { supplied: false, records: [] };
    }
}

return { fetchCaseBundle: fetchCaseBundle };

})();
