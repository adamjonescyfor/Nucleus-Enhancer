// ████████████████████████████████████████████████████████████████████████████
// MG22A / MG22B REPORT GENERATION — OWNED BY MITUL (work in progress)
// This whole file is part of the MG22 feature, which is currently hidden behind
// the MG22_ENABLED flag in content/case-report.js. Hidden, NOT deleted — left
// intact for Mitul to continue. Related: background/sf-report-templates.js,
// lib/docx-fill.js, lib/fflate.min.js, and the report.* handlers in background.js.
// ████████████████████████████████████████████████████████████████████████████
// ==================================================
// CYFOR Nucleus Enhancer — MG22 data extraction
// Turns a live case bundle (from case-report-fetch) into a flat
// { placeholderTag: value } map for the .docx fill engine.
//
// Robust by design: rather than hardcoding exact field API names, it
// classifies the relevant process entries (pre-imaging / imaging, mobile / SIM)
// and SCANS each record's fields by name pattern (so IMEI_1__c, Make__c,
// Serial_No__c, ICCID__c, IMSI__c, Telephone_No__c, Electronic_IMEI__c etc. are
// matched regardless of the exact suffix), then falls back to a regex pass over
// the entry notes for anything with no field (e.g. the full ICCID). All of this
// is overridable via chrome.storage.local `mgReportConfig`.
//
// Exposes: self.MgExtract.buildReportData(bundle, user, config, now)
// ==================================================

self.MgExtract = (function () {

    function val(rec, fields) {
        if (!rec) return '';
        var list = Array.isArray(fields) ? fields : [fields];
        for (var i = 0; i < list.length; i++) {
            var v = rec[list[i]];
            if (v != null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
    }

    function notesOf(rec) {
        return val(rec, ['Notes__c', 'Note__c', 'Comments__c']);
    }

    // First field on `rec` whose API name matches `pattern` and whose value
    // passes the optional valueTest.
    function scanField(rec, pattern, valueTest) {
        if (!rec) return '';
        for (var k in rec) {
            if (k === 'attributes') continue;
            if (!pattern.test(k)) continue;
            var v = rec[k];
            if (v == null || String(v).trim() === '') continue;
            if (valueTest && !valueTest(String(v))) continue;
            return String(v).trim();
        }
        return '';
    }

    function digits(text, min, max) {
        if (!text) return '';
        var re = new RegExp('\\d{' + min + (max ? ',' + max : '') + '}');
        var m = String(text).match(re);
        return m ? m[0] : '';
    }

    // Second 15-digit IMEI in a string like "IMEI 1: ... IMEI 2: ...".
    function secondImei(text) {
        var all = String(text || '').match(/\d{15}/g) || [];
        return all.length > 1 ? all[1] : (all[0] || '');
    }

    // First process entry matching a record-type pattern (and optional exhibit
    // type), skipping any whose record type matches notRe (e.g. exclude
    // "Pre-imaging" when we want "Imaging" — /imaging/ matches both).
    function pick(records, rtRe, exRe, notRe) {
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            var rt = String(r.RecordTypeId || r.Process_Type__c || r.Name || '');
            var ex = String(r.Exhibit_Type__c || r.Type__c || '');
            if (notRe && notRe.test(rt)) continue;
            if (rtRe.test(rt) && (!exRe || exRe.test(ex))) return r;
        }
        return null;
    }

    function fmtDate(value) {
        if (!value) return '';
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    // Drop the alpha office prefix from a case name: "LP-26-00049" -> "26-00049".
    function stripCasePrefix(name) {
        return String(name || '').replace(/^[A-Za-z]{1,4}[-\s]?/, '').trim();
    }

    // Best-effort "relates to (person)" from forensic-strategy free text.
    function findPerson(text) {
        if (!text) return '';
        // Find a Suspect/Defendant label, then the next capitalised name that
        // sits on a single line (so we don't run into the following heading).
        var m = String(text).match(
            /\b(?:Suspect|Defendant|Subject|Accused|Victim|POI)\b[\s\S]{0,40}?\b([A-Z][a-z]+(?:[ \t]+[A-Z][A-Za-z'’\-]+){1,2})/);
        return m ? m[1].trim() : '';
    }

    var MOBILE = /mobile|device|phone|handset|tablet|computer|laptop/i;
    var SIM = /\bsim\b/i;

    // Extract one device's fields, scoped to that exhibit's own process entries
    // (and its child SIM/media). `dev` is an exhibit record (or {Name:''} for a
    // no-exhibit fallback, in which case all process entries are used).
    function extractDevice(dev, exhibits, process) {
        var name = String((dev && dev.Name) || '');
        var entries = name ? process.filter(function (p) { return String(p.Exhibit__c || '') === name; }) : process;
        var preM = pick(entries, /pre.?imag/i, MOBILE) || pick(entries, /pre.?imag/i);
        var imgM = pick(entries, /imaging/i, MOBILE, /pre.?imag/i) || pick(entries, /imaging/i, null, /pre.?imag/i);

        var children = exhibits.filter(function (e) {
            var en = String(e.Name || ''), pe = String(e.Parent_Exhibit__c || '');
            return name && (pe === name || (en !== name && en.indexOf(name + '-') === 0));
        });
        var simChildren = children.filter(function (e) { return SIM.test(String(e.Type__c || e.Name || '')); });
        var mediaChildren = children.filter(function (e) { return /sd.?card|removable|memory|micro.?sd/i.test(String(e.Type__c || e.Description__c || '')); });
        var simEntries = [];
        simChildren.forEach(function (s) {
            var sn = String(s.Name || '');
            process.forEach(function (p) { if (String(p.Exhibit__c || '') === sn) simEntries.push(p); });
        });
        var preSim = pick(simEntries, /pre.?imag/i);
        var imgSim = pick(simEntries, /imaging/i, null, /pre.?imag/i);

        var preNotes = notesOf(preM);
        var manufacturer = scanField(preM, /manufactur/i);
        var marketing = scanField(preM, /(^|_)make(_|$)/i);
        var aNumber = (preNotes.match(/\bA\d{4}\b/) || [])[0] || '';
        var modelNumber = aNumber || scanField(preM, /(^|_)model(_|$)/i) || '';
        var simNotes = [notesOf(preSim), notesOf(imgSim)].filter(Boolean).join('\n');

        var d = {};
        d.exhibitRef = name || val(preM, ['Exhibit__c']);
        d.make = manufacturer || marketing;
        d.makeName = marketing;
        d.model = modelNumber || marketing;
        d.makeModel = ([manufacturer, marketing].filter(Boolean).join(' ') + (modelNumber && modelNumber !== marketing ? ' (' + modelNumber + ')' : '')).trim();
        d.deviceType = val(dev, ['Type__c']) || scanField(preM, /device.?type|exhibit.?type/i);
        d.serial = scanField(preM, /serial/i);
        d.description = val(dev, ['Description__c', 'Exhibit_Notes__c']);
        d.additionalItems = scanField(preM, /accessor|additional|unexpected/i);

        var simParts = [];
        if (simChildren.length) simParts.push(simChildren.length + ' x SIM card' + (simChildren.length > 1 ? 's' : ''));
        if (mediaChildren.length) simParts.push(mediaChildren.length + ' x removable media');
        if (!simParts.length && (preSim || scanField(preM, /(^|_)sim.?card(_|$)/i) === 'Yes')) simParts.push('1 x SIM card');
        d.simCards = simParts.join(', ');

        d.imeiSticker = digits(scanField(preM, /imei/i), 15, 15) || (preNotes.match(/\bIMEI[^\d]{0,12}(\d{15})/i) || [])[1] || '';
        d.imeiDevice = secondImei(scanField(imgM, /imei/i)) || d.imeiSticker;
        d.iccidPrinted = scanField(preSim, /iccid/i) || (simNotes.match(/\bICCID[^\d]{0,12}(\d{18,20})/i) || [])[1] || '';
        d.iccidExtracted = (simNotes.match(/\bICCID[^\d]{0,12}(\d{18,20})/i) || [])[1] || d.iccidPrinted;
        d.imsi = digits(scanField(imgSim, /imsi/i) || scanField(preSim, /imsi/i), 14, 15) || (simNotes.match(/\bIMSI[^\d]{0,12}(\d{14,15})/i) || [])[1] || '';
        d.msisdn = scanField(imgSim, /telephone|msisdn|phone|mobile.?no/i) || scanField(preSim, /telephone|msisdn|phone|mobile.?no/i) || (simNotes.match(/\b(?:MSISDN|Telephone)[:\s]*(\+?\d[\d\s]{7,14}\d)/i) || [])[1] || '';
        d.toolPrimary = scanField(imgM, /extraction.?software|tool/i);

        Object.keys(d).forEach(function (k) { if (d[k] == null) d[k] = ''; });
        return d;
    }

    function buildReportData(bundle, user, cfg, now) {
        bundle = bundle || {};
        cfg = cfg || {};
        now = now || new Date();

        var c        = bundle.caseRecord || {};
        var process  = (bundle.process && bundle.process.records) || [];
        var exhibits = (bundle.exhibits && bundle.exhibits.records) || [];
        var cf = cfg.caseFields || {};

        var data = {};

        // ── Header (case-level) ──
        var caseName = val(c, ['Name']);
        data.caseReference     = stripCasePrefix(caseName);   // "LP-26-00049" -> "26-00049"
        data.caseReferenceFull = caseName;
        data.forensicProvRef   = val(c, cf.forensicProvRef  || ['Submission_Reference__c']) || data.caseReference;
        data.policeForce       = val(c, cf.policeForce      || ['Account__c', 'Police_Force__c', 'Force__c']);
        data.location          = cfg.location || 'CYFOR';

        var strategy = pick(process, /forensic.?strateg/i, null);
        var strategyText = notesOf(strategy) || val(c, ['Forensic_Strategy__c']);
        data.relatesTo         = val(c, cf.relatesTo || ['Suspect__c', 'Defendant__c', 'Subject__c', 'Relates_To__c'])
                                 || findPerson(strategyText);
        data.occurrenceNo     = val(c, cf.occurrenceNo     || ['Occurrence_Number__c', 'Crime_Number__c', 'Force_Reference__c']);
        data.forceForensicRef = val(c, cf.forceForensicRef || ['Force_Forensic_Reference__c', 'Force_Reference__c', 'Contact_Reference__c']);
        data.dateOfOffence    = fmtDate(val(c, cf.dateOfOffence || ['Date_of_Offence__c', 'Offence_Date__c', 'Incident_Date__c']));
        data.otherRef1        = val(c, cf.otherRef1 || []);
        data.otherRef2        = val(c, cf.otherRef2 || []);
        data.reportProvidedBy = (user && (user.fullName || user.username || user.email)) || val(c, ['Case_Primary_Owner__c']);
        data.dateOfReport     = fmtDate(now);

        // ── Devices: one per parent device exhibit (child SIM/media noted inline) ──
        var deviceExhibits = exhibits.filter(function (e) {
            var t = String(e.Type__c || e.Name || '');
            if (SIM.test(t) || /sd.?card|removable|memory.?card|micro.?sd/i.test(t)) return false;
            if (e.Parent_Exhibit__c) return false;
            return true;
        });
        if (!deviceExhibits.length) deviceExhibits = exhibits.length ? [exhibits[0]] : [{ Name: '' }];

        data.devices = deviceExhibits.map(function (e) { return extractDevice(e, exhibits, process); });
        data.deviceCount = data.devices.length;

        // Flatten the first device so single-device (non-looped) templates still work.
        var d0 = data.devices[0] || {};
        Object.keys(d0).forEach(function (k) { if (!(k in data)) data[k] = d0[k]; });

        // ── MG22B narrative extras ──
        var generated = (bundle.generatedMaterial && bundle.generatedMaterial.records) || [];
        data.generatedExhibitRef = val(generated[0] || {}, ['Name', 'Reference__c']);

        Object.keys(data).forEach(function (k) { if (data[k] == null) data[k] = ''; });
        return data;
    }

    return {
        buildReportData: buildReportData,
        _internals: { scanField: scanField, pick: pick, secondImei: secondImei }
    };

})();
