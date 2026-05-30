// ==================================================
// CYFOR Nucleus Enhancer — Disclosure Report Generator
// JavaScript port of standard_forensic_disclosure_report_generator_v2.py
//
// Produces a client-facing, commercially-sanitised HTML
// "Standard Forensic Case Management Disclosure Report"
// from live Salesforce records. Context-agnostic (no DOM
// dependency) so it can run in a content script or worker.
//
// Public API (on the global object):
//   DisclosureReport.build(data)            -> HTML string
//   DisclosureReport.suggestFilename(c, d)  -> filename string
//   DisclosureReport.REPORT_TITLE
// ==================================================

(function (global) {

var REPORT_TITLE = 'Standard Forensic Case Management Disclosure Report';
var DEFAULT_CLASSIFICATION = 'OFFICIAL SENSITIVE';

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// ── Commercial sensitivity and internal content filters ───────────────────────

var COMMERCIAL_PATTERN = new RegExp(
    '\\b(' +
    'invoice|invoices|invoiced|invoicing|' +
    'billing|billable|billed|' +
    'charge|charges|charged|charging|' +
    'cost|costs|costed|' +
    'price|prices|pricing|' +
    'fee|fees|' +
    'quote|quotes|quoted|quotation|' +
    'revenue|' +
    'payment|payments|' +
    'purchase\\s+order|purchase\\s+orders|' +
    'po\\s+number|po\\s+numbers' +
    ')\\b|' +
    '£|GBP|USD|EUR|\\$|€|' +
    '\\b\\d+(?:\\.\\d{2})?\\s*(?:gbp|pounds|sterling|usd|eur)\\b',
    'i'
);

var FORBIDDEN_CLIENT_TEXT = [
    'Source and Cleaning Notes',
    'Source Notes',
    'Cleaning Notes',
    'Generation Notes',
    'Generated Notes',
    'Data Copying Notes'
];

var REMOVE_EXACT_FIELDS = setOf([
    'Id', 'OwnerId', 'IsDeleted', 'CreatedById', 'LastModifiedById', 'SystemModstamp',
    'LastViewedDate', 'LastReferencedDate', 'LastActivityDate',
    'Crime_Number__c', 'Invoice_Requested_c__c', 'Overtime__c', 'Overtime_Rate__c',
    'Authorised_By__c', 'Exhibit_Type_Name_Formula__c', 'Exhibt_Type_Image_URL__c',
    'Exhibt_Type_Image__c', 'Exhibit_Type_Image_URL__c', 'Exhibit_Type_Image__c',
    'media_Asset_generated__c', 'Project_Case_Alias__c', 'Case_Record_Link_Formula__c',
    'Quote__c', 'Revenue_Group__c', 'Expected_Billing_Month__c'
]);

var REMOVE_FIELD_CONTAINS = ['Image_URL', 'Type_Image', 'Formula__c', '_Formula__c'];

// ── Approved client-facing field lists ────────────────────────────────────────

var CASE_OVERVIEW_FIELDS = [
    'Name', 'Account__c', 'Submission_Reference__c', 'Access_Level__c', 'Status__c',
    'Job_Type__c', 'Case_Primary_Owner__c', 'Contact_Reference__c', 'OIC_eMail__c',
    'Created_Date_Time__c', 'Start_Date_Time__c', 'Completed_Date_Time__c',
    'Close_Date_Time__c', 'Returned_Date_Time__c', 'Due_Date_Time__c',
    'Turnaround_Time_TRT__c', 'Estimated_Duration_hrs__c', 'Total_Logged_Time_hrs__c',
    'Crime_Category__c', 'Specific_Crimes__c'
];

var EXHIBIT_FIELDS = [
    'Name', 'Forensic_Case__c', 'Type__c', 'Description__c', 'Parent_Exhibit__c',
    'Property_Number__c', 'Barcode_Number__c', 'Original_Seal_Reference__c',
    'ReSeal_Reference__c', 'Status__c', 'Forensic_Location__c', 'Receipt_Date_Time__c',
    'Check_In_Date_Time__c', 'Re_Sealed_By__c', 'Re_Sealed_Date_Time__c',
    'Exhibit_Notes__c', 'Custodian__c', 'To_Be_Destroyed__c'
];

var CONTINUITY_FIELDS = [
    'Name', 'Exhibit__c', 'Location__c', 'Status__c', 'Requested_By__c',
    'Decision_Maker__c', 'Approved_Declined_Date_Time__c', 'Previous_Continuity__c',
    'CreatedDate'
];

var GENERATED_MATERIAL_FIELDS = [
    'Name', 'Forensic_Case__c', 'Exhibit_Type__c', 'Description__c', 'Status__c',
    'Location__c', 'Barcode_Number__c', 'Seal_Reference__c', 'Sealed_By__c',
    'Sealed_Date_Time__c', 'Encryption_Type__c', 'Encryption_Password__c',
    'Media_Size_GB__c'
];

var PROCESS_FIELDS = [
    'Name', 'RecordTypeId', 'Forensic_Case__c', 'Exhibit__c', 'Exhibit_Type__c',
    'Status__c', 'Type__c', 'Completed_By__c', 'Start_Date_Time__c', 'End_Date_Time__c',
    'Notes__c', 'Damage_Details__c', 'Device_Colour__c', 'Manufacturer__c', 'Model__c',
    'Operating_Sytem__c', 'Extraction_Method__c', 'Extraction_Software__c',
    'Imaging_Software__c', 'Imaging_Workstation__c', 'Extraction_Workstation__c',
    'MD5_Checksum__c', 'SHA1_Checksum__c', 'ICCID__c', 'IMEI_1__c', 'IMEI_2__c',
    'IMSI__c', 'Network_Operator__c'
];

var TIME_ENTRY_FIELDS = [
    'Name', 'Forensic_Case__c', 'Process_Step__c', 'Exhibit__c', 'Logged_Time_For__c',
    'Duration_hrs__c', 'Start_Date_Time__c', 'End_Date_Time__c', 'Time_Summary__c',
    'Type__c', 'Notes__c'
];

var ARCHIVE_FIELDS = [
    'Name', 'Forensic_Case__c', 'Type__c', 'Media_Type__c', 'Location__c',
    'Assigned_Staff__c', 'Conducted_By__c', 'Start_Date__c', 'Completed_Date__c',
    'Archive_Until_Date__c', 'Next_Verification_Date__c', 'Exhibit_Reference__c',
    'Seal_Number__c', 'Sealed_By__c', 'Seal_Date_Time__c', 'Notes__c'
];

var ACRONYMS = setOf([
    'BIOS', 'SIM', 'USB', 'QA', 'MD5', 'SHA1', 'URL', 'IMEI', 'ICCID', 'IMSI', 'PIN',
    'VHDX', 'IIOC', 'SOP', 'SLA', 'CMS', 'OIC', 'TRT', 'NFA', 'DFU', 'HDD', 'NAS'
]);

var DATE_FIELDS = setOf([
    'CreatedDate', 'LastModifiedDate', 'Approved_Declined_Date_Time__c',
    'Start_Date_Time__c', 'End_Date_Time__c', 'Check_In_Date_Time__c',
    'Receipt_Date_Time__c', 'Re_Sealed_Date_Time__c', 'Created_Date_Time__c',
    'Completed_Date_Time__c', 'Close_Date_Time__c', 'Due_Date_Time__c',
    'Returned_Date_Time__c', 'Sealed_Date_Time__c', 'Start_Date__c', 'Completed_Date__c',
    'Archive_Until_Date__c', 'Next_Verification_Date__c', 'Seal_Date_Time__c'
]);

var KNOWN_HEADINGS = setOf([
    'Circumstances', 'Circs', 'Exhibit', 'Exhibits', 'Exhibit(s)', 'Objectives',
    'Datasets Required', 'Data to be provided', 'Generic Data', 'Requested Data',
    'Details of Note', 'Details of interest', 'Tools', 'Mobile', 'Previous Work',
    'Limitations', 'Disclosure', 'Photograph', 'Pre-imaging Steps', 'Additional Notes',
    'Continuity Information', 'Faraday Box'
]);

// ── Small helpers ─────────────────────────────────────────────────────────────

function setOf(arr) { var s = Object.create(null); for (var i = 0; i < arr.length; i++) s[arr[i]] = true; return s; }
function has(set, key) { return Object.prototype.hasOwnProperty.call(set, key); }

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decodeEntities(s) {
    return String(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'")
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
        .replace(/&amp;/g, '&');
}

function collapse(text) {
    return decodeEntities(text).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Rich text parsing and formatting ──────────────────────────────────────────

function htmlToBlocks(html) {
    var s = html;
    s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
    s = s.replace(/<\s*li\b[^>]*>/gi, '\n- ');
    s = s.replace(/<\s*\/\s*(p|div|h[1-4]|li|ul|ol|tr|table)\s*>/gi, '\n');
    s = s.replace(/<\s*(p|div|h[1-4]|tr|table)\b[^>]*>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    return s.split(/\n+/).map(collapse).filter(Boolean);
}

function htmlBlocks(value) {
    if (value === null || value === undefined) return [];
    if (typeof value === 'boolean') return [value ? 'Yes' : 'No'];
    if (typeof value !== 'string') return [String(value)];

    var text = value.trim();
    if (!text) return [];

    if (text.indexOf('<') >= 0 && text.indexOf('>') >= 0) {
        return htmlToBlocks(text);
    }
    return text.split(/\n+/).map(collapse).filter(Boolean);
}

function plainText(value) { return htmlBlocks(value).join('\n'); }

function containsCommercial(value) { return COMMERCIAL_PATTERN.test(plainText(value)); }

function filterBlocks(blocks) {
    return blocks.filter(function (b) { return !containsCommercial(b); });
}

function formatDatetime(value) {
    var text = plainText(value);
    if (!text) return '';
    var m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:[+-]\d{4})?)?$/);
    if (!m) return text;
    var year = +m[1], month = +m[2], day = m[3], hour = m[4], minute = m[5];
    var dt = new Date(Date.UTC(year, month - 1, +day));
    if (isNaN(dt.getTime())) return text;
    var dateText = day + ' ' + MONTHS[month - 1] + ' ' + year;
    if (hour) return dateText + ' ' + hour + ':' + minute;
    return dateText;
}

function isDateField(key) {
    return has(DATE_FIELDS, key) || key.indexOf('Date_Time') >= 0 || /_Date__c$/.test(key);
}

function formatValue(key, value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (isDateField(key)) return formatDatetime(value);
    return plainText(value);
}

function humaniseLabel(key) {
    var label = key.replace(/__c$/, '').replace(/__r/g, '').replace(/_/g, ' ');
    label = label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();

    var words = label.split(' ').map(function (word) {
        var upper = word.toUpperCase();
        if (has(ACRONYMS, upper)) return upper;
        if (word.toLowerCase() === 'hrs') return 'Hours';
        if (word.toLowerCase() === 'email' || word === 'eMail') return 'Email';
        return word.charAt(0).toUpperCase() + word.slice(1);
    });

    var output = words.join(' ');
    output = output.replace('Approved Declined Date Time', 'Approved or Declined Date Time');
    output = output.replace('Duration Hrs', 'Duration Hours');
    return output;
}

function isInternalField(key) {
    if (has(REMOVE_EXACT_FIELDS, key)) return true;
    for (var i = 0; i < REMOVE_FIELD_CONTAINS.length; i++) {
        if (key.indexOf(REMOVE_FIELD_CONTAINS[i]) >= 0) return true;
    }
    var label = humaniseLabel(key).toLowerCase();
    for (var j = 0; j < FORBIDDEN_CLIENT_TEXT.length; j++) {
        if (label.indexOf(FORBIDDEN_CLIENT_TEXT[j].toLowerCase()) >= 0) return true;
    }
    return false;
}

function isHeadingLine(line) {
    var clean = line.trim().replace(/:+$/, '').trim();
    if (has(KNOWN_HEADINGS, clean)) return true;
    if (/:$/.test(line) && clean.length <= 70) return true;
    return false;
}

function renderReadableText(value, mode) {
    mode = mode || 'notes';
    var blocks = filterBlocks(htmlBlocks(value));
    if (!blocks.length) return '<p class="muted">No information supplied.</p>';

    var output = [], listOpen = false, subOpen = false;

    function closeList() { if (listOpen) { output.push('</ul>'); listOpen = false; } }
    function addItem(t) {
        if (!listOpen) { output.push('<ul class="clean-list">'); listOpen = true; }
        output.push('<li>' + escapeHtml(t) + '</li>');
    }
    function closeSub() { closeList(); if (subOpen) { output.push('</div>'); subOpen = false; } }

    for (var i = 0; i < blocks.length; i++) {
        var line = blocks[i].replace(/\*\*/g, '').trim();
        if (!line) continue;

        var timeline = /^([A-Z]{1,4}\d?\s*-\s*)?\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(line)
            || /^[A-Z]{1,4}\d?\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}\b/.test(line);

        if (mode === 'background') {
            if (timeline) { addItem(line); }
            else { closeList(); output.push('<p>' + escapeHtml(line) + '</p>'); }

        } else if (mode === 'strategy') {
            if (isHeadingLine(line)) {
                closeSub();
                output.push('<div class="text-subsection"><h3>' + escapeHtml(line.replace(/:+$/, '')) + '</h3>');
                subOpen = true;
            } else if (line.length <= 90 && !/[.!?]$/.test(line) && !/^\d/.test(line)) {
                if (!subOpen) { output.push('<div class="text-subsection">'); subOpen = true; }
                addItem(line);
            } else {
                closeList();
                if (!subOpen) { output.push('<div class="text-subsection">'); subOpen = true; }
                output.push('<p>' + escapeHtml(line) + '</p>');
            }

        } else {
            if (isHeadingLine(line)) {
                closeList();
                output.push('<h3>' + escapeHtml(line.replace(/:+$/, '')) + '</h3>');
            } else if (line.indexOf('- ') === 0 || line.indexOf('• ') === 0) {
                addItem(line.slice(2).trim());
            } else if (/\s-\s/.test(line) && line.length < 240) {
                addItem(line);
            } else {
                closeList();
                output.push('<p>' + escapeHtml(line) + '</p>');
            }
        }
    }

    if (mode === 'strategy') closeSub(); else closeList();
    return output.join('\n');
}

function valueToHtml(key, value) {
    if (/Notes__c$/.test(key) || value.indexOf('\n') >= 0) return renderReadableText(value, 'notes');
    return escapeHtml(value);
}

// ── HTML rendering ────────────────────────────────────────────────────────────

function tableFor(record, fields) {
    var rows = [];
    for (var i = 0; i < fields.length; i++) {
        var key = fields[i];
        if (!(key in record)) continue;
        if (isInternalField(key)) continue;

        var value = formatValue(key, record[key]);
        if (!value) continue;
        if (containsCommercial(humaniseLabel(key)) || containsCommercial(value)) continue;

        rows.push('<tr><th>' + escapeHtml(humaniseLabel(key)) + '</th><td>' + valueToHtml(key, value) + '</td></tr>');
    }
    if (!rows.length) return '<p class="muted">No Records</p>';
    return '<table class="detail-table"><tbody>' + rows.join('\n') + '</tbody></table>';
}

function recordCard(record, fields) {
    var title = formatValue('Name', record['Name']) || 'Record';
    var subParts = [
        formatValue('Status__c', record['Status__c']),
        formatValue('Exhibit__c', record['Exhibit__c']),
        formatValue('RecordTypeId', record['RecordTypeId'])
    ].filter(Boolean);
    var subtitle = subParts.join(' | ');
    var subHtml = subtitle ? '<p class="card-subtitle">' + escapeHtml(subtitle) + '</p>' : '';

    return '<article class="record-card"><h3>' + escapeHtml(title) + '</h3>' + subHtml + tableFor(record, fields) + '</article>';
}

function recordsCards(records, fields) {
    if (!records.length) return '<p class="muted">No Records</p>';
    return records.map(function (r) { return recordCard(r, fields); }).join('\n');
}

function groupRecords(records, groupKey, fields) {
    if (!records.length) return '<p class="muted">No Records</p>';
    var grouped = Object.create(null);
    records.forEach(function (rec) {
        var g = formatValue(groupKey, rec[groupKey]) || 'General / Unspecified';
        (grouped[g] = grouped[g] || []).push(rec);
    });
    var out = [];
    Object.keys(grouped).sort().forEach(function (g) {
        out.push('<div class="group-block"><h3>' + escapeHtml(g) + '</h3>');
        out.push(recordsCards(grouped[g], fields));
        out.push('</div>');
    });
    return out.join('\n');
}

function renderContinuity(exhibits, records) {
    if (!records.length) return '<p class="muted">No Records</p>';
    var order = exhibits.filter(function (e) { return e['Name']; })
        .map(function (e) { return formatValue('Name', e['Name']); });

    var grouped = Object.create(null);
    records.forEach(function (rec) {
        var ref = formatValue('Exhibit__c', rec['Exhibit__c']) || 'Unspecified';
        (grouped[ref] = grouped[ref] || []).push(rec);
    });

    var ordered = order.filter(function (x) { return grouped[x]; });
    Object.keys(grouped).sort().forEach(function (k) { if (ordered.indexOf(k) < 0) ordered.push(k); });

    var out = [];
    ordered.forEach(function (ref) {
        var recs = grouped[ref].slice().sort(function (a, b) {
            var ka = String(a['Approved_Declined_Date_Time__c'] || a['CreatedDate'] || '');
            var kb = String(b['Approved_Declined_Date_Time__c'] || b['CreatedDate'] || '');
            return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        out.push('<div class="group-block"><h3>' + escapeHtml(ref) + '</h3>');
        out.push(recordsCards(recs, CONTINUITY_FIELDS));
        out.push('</div>');
    });
    return out.join('\n');
}

function byChronoKey(a, b) {
    var ka = String(a['Start_Date_Time__c'] || a['CreatedDate'] || a['Name'] || '');
    var kb = String(b['Start_Date_Time__c'] || b['CreatedDate'] || b['Name'] || '');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function normaliseClassification(value) {
    var text = String(value || DEFAULT_CLASSIFICATION).trim();
    text = text.replace(/ - /g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ');
    return text.toUpperCase();
}

function formatLongDate(d) {
    var day = ('0' + d.getDate()).slice(-2);
    return day + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

function wordmark() {
    return '<div class="logo-wordmark">' +
        '<span class="wm-cyfor">CYFOR</span>' +
        '<span class="wm-bar"></span>' +
        '<span class="wm-forensics">FORENSICS</span>' +
        '<div class="wm-sub">DIGITAL EVIDENCE</div>' +
        '</div>';
}

function css() {
    return '\n' +
':root {\n' +
'  --navy: #061b3a;\n' +
'  --blue: #0057a8;\n' +
'  --cyan: #00aeef;\n' +
'  --text: #1d2939;\n' +
'  --muted: #667085;\n' +
'  --line: #d0d5dd;\n' +
'  --bg: #f3f6fb;\n' +
'  --card: #ffffff;\n' +
'}\n' +
'* { box-sizing: border-box; }\n' +
'html { scroll-behavior: smooth; }\n' +
'body {\n' +
'  margin: 0;\n' +
'  background: var(--bg);\n' +
'  color: var(--text);\n' +
'  font-family: Arial, Helvetica, sans-serif;\n' +
'  line-height: 1.5;\n' +
'}\n' +
'.report-header {\n' +
'  background: linear-gradient(135deg, #061b3a 0%, #0b3e78 62%, #0057a8 100%);\n' +
'  color: white;\n' +
'  padding: 28px 34px 32px;\n' +
'  border-bottom: 5px solid var(--cyan);\n' +
'}\n' +
'.header-inner { max-width: 1220px; margin: 0 auto; }\n' +
'.logo-panel {\n' +
'  background: white;\n' +
'  border-radius: 12px;\n' +
'  padding: 14px 18px;\n' +
'  display: inline-flex;\n' +
'  box-shadow: 0 12px 28px rgba(0,0,0,.16);\n' +
'  margin-bottom: 22px;\n' +
'}\n' +
'.logo { width: 520px; max-width: 78vw; height: auto; display: block; }\n' +
'.logo-wordmark { display: flex; align-items: center; gap: 12px; font-family: Arial, Helvetica, sans-serif; }\n' +
'.wm-cyfor { font-size: 42px; font-weight: 900; font-style: italic; color: #0057a8; letter-spacing: .02em; }\n' +
'.wm-bar { width: 4px; height: 38px; background: linear-gradient(180deg,#00aeef,#0057a8); border-radius: 2px; }\n' +
'.wm-forensics { font-size: 30px; font-weight: 700; letter-spacing: .14em; color: #0b3e78; }\n' +
'.wm-sub { width: 100%; margin-top: 4px; font-size: 14px; letter-spacing: .42em; color: #667085; font-weight: 700; }\n' +
'.classification {\n' +
'  display: inline-block;\n' +
'  background: rgba(255,255,255,.14);\n' +
'  border: 1px solid rgba(255,255,255,.42);\n' +
'  border-radius: 999px;\n' +
'  padding: 7px 14px;\n' +
'  font-weight: 800;\n' +
'  letter-spacing: .08em;\n' +
'  font-size: 12px;\n' +
'  text-transform: uppercase;\n' +
'}\n' +
'h1 { font-size: 34px; line-height: 1.1; margin: 18px 0 10px; }\n' +
'.header-meta { margin: 0; color: rgba(255,255,255,.88); }\n' +
'.nav {\n' +
'  position: sticky; top: 0; z-index: 20;\n' +
'  background: rgba(255,255,255,.97);\n' +
'  border-bottom: 1px solid var(--line);\n' +
'  padding: 12px 24px;\n' +
'  display: flex; gap: 8px; flex-wrap: wrap;\n' +
'  box-shadow: 0 4px 14px rgba(16,24,40,.06);\n' +
'}\n' +
'.nav a {\n' +
'  border: 1px solid #c7d7eb; border-radius: 999px; background: #fff;\n' +
'  color: #07529b; text-decoration: none; font-size: 13px; font-weight: 700; padding: 8px 12px;\n' +
'}\n' +
'main { max-width: 1220px; margin: 24px auto 42px; padding: 0 24px; }\n' +
'.section-card {\n' +
'  background: var(--card); border: 1px solid var(--line); border-radius: 18px;\n' +
'  margin: 0 0 20px; box-shadow: 0 14px 34px rgba(16,24,40,.07); overflow: hidden;\n' +
'}\n' +
'.section-title {\n' +
'  background: linear-gradient(90deg, #f8fbff, #eef6ff);\n' +
'  border-bottom: 1px solid var(--line); padding: 16px 20px;\n' +
'  display: flex; justify-content: space-between; align-items: center; gap: 12px;\n' +
'}\n' +
'.section-title h2 { margin: 0; color: var(--navy); font-size: 24px; }\n' +
'.section-title a { color: #07529b; font-weight: 700; text-decoration: none; font-size: 13px; }\n' +
'.section-body { padding: 20px; }\n' +
'.record-card {\n' +
'  border: 1px solid #d7e0ec; border-radius: 14px; background: white;\n' +
'  padding: 15px 16px; margin: 12px 0; box-shadow: 0 6px 16px rgba(16,24,40,.035);\n' +
'}\n' +
'.record-card h3 { margin: 0 0 4px; color: var(--navy); font-size: 19px; }\n' +
'.card-subtitle { margin: 0 0 12px; color: var(--muted); font-size: 13px; }\n' +
'.group-block {\n' +
'  border: 1px solid #dde7f3; background: #fbfdff; border-radius: 15px;\n' +
'  padding: 14px 16px; margin: 14px 0 18px;\n' +
'}\n' +
'.group-block > h3 { margin: 0 0 10px; color: #0b3e78; border-bottom: 1px solid #d7e0ec; padding-bottom: 8px; }\n' +
'.detail-table { width: 100%; border-collapse: collapse; table-layout: fixed; }\n' +
'.detail-table th, .detail-table td {\n' +
'  border-bottom: 1px solid #e4e7ec; padding: 9px 10px; text-align: left; vertical-align: top;\n' +
'}\n' +
'.detail-table th { width: 30%; background: #f8fafc; color: #344054; font-weight: 400; }\n' +
'.detail-table td { word-wrap: break-word; overflow-wrap: anywhere; }\n' +
'.section-body p { margin: 0 0 12px; }\n' +
'.section-body ul { margin: 7px 0 13px 22px; padding: 0; }\n' +
'.section-body li { margin: 5px 0; }\n' +
'.text-subsection {\n' +
'  border-left: 4px solid #c7d7eb; background: #fbfdff; border-radius: 10px;\n' +
'  padding: 12px 14px; margin: 12px 0;\n' +
'}\n' +
'.text-subsection h3 { margin: 0 0 8px; color: #0b3e78; font-size: 17px; }\n' +
'.text-subsection p:last-child { margin-bottom: 0; }\n' +
'.clean-list { margin-left: 22px; }\n' +
'.muted { color: var(--muted); font-style: italic; }\n' +
'footer { max-width: 1220px; margin: 0 auto; padding: 22px 24px 38px; text-align: center; color: #475467; }\n' +
'.footer-classification { font-weight: 900; color: var(--navy); letter-spacing: .08em; margin-top: 10px; }\n' +
'@media print {\n' +
'  .nav { position: static; }\n' +
'  .section-card { break-inside: avoid; box-shadow: none; }\n' +
'  body { background: white; }\n' +
'}\n';
}

// ── Report assembly ───────────────────────────────────────────────────────────

function asInput(x) {
    if (!x) return { supplied: false, records: [] };
    return { supplied: !!x.supplied, records: x.records || [] };
}

function build(data) {
    data = data || {};
    var caseRecord = data.caseRecord || {};
    var exhibits = asInput(data.exhibits);
    var continuity = asInput(data.continuity);
    var generatedMaterial = asInput(data.generatedMaterial);
    var process = asInput(data.process);
    var timeEntries = asInput(data.timeEntries);
    var archive = asInput(data.archive);
    var generatedDate = data.generatedDate || new Date();

    var classification = normaliseClassification(caseRecord['Access_Level__c'] || caseRecord['Access_Level_Name__c']);
    var caseRef = formatValue('Name', caseRecord['Name']) || 'Forensic Case';
    var client = formatValue('Account__c', caseRecord['Account__c']);
    var generatedText = formatLongDate(generatedDate);

    var sections = [
        { id: 'overview', title: 'Case Overview', html: tableFor(caseRecord, CASE_OVERVIEW_FIELDS) },
        { id: 'case-background', title: 'Case Background', html: renderReadableText(caseRecord['Case_Background__c'], 'background') },
        { id: 'forensic-strategy', title: 'Forensic Strategy', html: renderReadableText(caseRecord['Forensic_Strategy__c'], 'strategy') },
        { id: 'exhibits', title: 'Exhibits', html: recordsCards(exhibits.records, EXHIBIT_FIELDS) }
    ];

    if (continuity.supplied || continuity.records.length) {
        sections.push({ id: 'exhibit-continuity', title: 'Exhibit Continuity', html: renderContinuity(exhibits.records, continuity.records) });
    }
    if (generatedMaterial.supplied) {
        sections.push({ id: 'generated-material', title: 'Generated Material', html: recordsCards(generatedMaterial.records, GENERATED_MATERIAL_FIELDS) });
    }
    if (process.supplied) {
        sections.push({ id: 'process-records', title: 'Process Records', html: groupRecords(process.records.slice().sort(byChronoKey), 'RecordTypeId', PROCESS_FIELDS) });
    }
    if (timeEntries.supplied) {
        sections.push({ id: 'time-entries', title: 'Time Entries', html: groupRecords(timeEntries.records.slice().sort(byChronoKey), 'Process_Step__c', TIME_ENTRY_FIELDS) });
    }
    if (archive.supplied) {
        sections.push({ id: 'forensic-case-archive', title: 'Forensic Case Archive', html: recordsCards(archive.records, ARCHIVE_FIELDS) });
    }

    var nav = sections.map(function (s) { return '<a href="#' + s.id + '">' + escapeHtml(s.title) + '</a>'; }).join('\n');
    var sectionsHtml = sections.map(function (s) {
        return '\n<section id="' + s.id + '" class="section-card">\n' +
            '  <div class="section-title"><h2>' + escapeHtml(s.title) + '</h2><a href="#top">Back to top</a></div>\n' +
            '  <div class="section-body">' + s.html + '</div>\n' +
            '</section>\n';
    }).join('\n');

    var logoHtml = data.logoDataUri
        ? '<img class="logo" src="' + data.logoDataUri + '" alt="CYFOR Forensics Digital Evidence">'
        : wordmark();
    var clientFragment = client ? ' | Client: <strong>' + escapeHtml(client) + '</strong>' : '';

    return '<!doctype html>\n' +
        '<html lang="en">\n' +
        '<head>\n' +
        '<meta charset="utf-8">\n' +
        '<title>' + escapeHtml(REPORT_TITLE) + '</title>\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        '<style>' + css() + '</style>\n' +
        '</head>\n' +
        '<body>\n' +
        '<header id="top" class="report-header">\n' +
        '  <div class="header-inner">\n' +
        '    <div class="logo-panel">' + logoHtml + '</div>\n' +
        '    <br>\n' +
        '    <span class="classification">' + escapeHtml(classification) + '</span>\n' +
        '    <h1>' + escapeHtml(REPORT_TITLE) + '</h1>\n' +
        '    <p class="header-meta">Case: <strong>' + escapeHtml(caseRef) + '</strong>' + clientFragment + ' | Generated: <strong>' + escapeHtml(generatedText) + '</strong></p>\n' +
        '  </div>\n' +
        '</header>\n' +
        '<nav class="nav">' + nav + '</nav>\n' +
        '<main>\n' + sectionsHtml + '\n</main>\n' +
        '<footer>\n' +
        '  <p>&copy; CYFOR Group. ' + escapeHtml(REPORT_TITLE) + '. Generated ' + escapeHtml(generatedText) + '.</p>\n' +
        '  <p class="footer-classification">' + escapeHtml(classification) + '</p>\n' +
        '</footer>\n' +
        '</body>\n' +
        '</html>\n';
}

function safeCaseFilename(caseRef) {
    return String(caseRef).replace(/[<>:"/\\|?*]+/g, '_').trim() || 'Forensic Case';
}

function suggestFilename(caseRecord, date) {
    var ref = safeCaseFilename(formatValue('Name', (caseRecord || {})['Name']) || 'Forensic Case');
    return ref + ' - ' + REPORT_TITLE + ' - ' + formatLongDate(date || new Date()) + '.html';
}

global.DisclosureReport = {
    build: build,
    suggestFilename: suggestFilename,
    REPORT_TITLE: REPORT_TITLE
};

})(typeof self !== 'undefined' ? self : this);
