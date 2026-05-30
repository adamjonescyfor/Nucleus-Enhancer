// ==================================================
// CYFOR Nucleus Enhancer — Disclosure Report Generator
// Reproduces the CTO's reference "Standard Forensic Case
// Management Disclosure Report" layout (KPI tiles, summary
// tables, grouped records, styled notes, full field detail)
// while stripping commercially sensitive information.
//
// Context-agnostic (no DOM dependency) so it can run in a
// content script or worker.
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

// ── Commercial sensitivity filter ─────────────────────────────────────────────

var COMMERCIAL_PATTERN = new RegExp(
    '\\b(' +
    'invoice|invoices|invoiced|invoicing|billing|billable|billed|' +
    'charge|charges|charged|charging|cost|costs|costed|' +
    'price|prices|pricing|fee|fees|quote|quotes|quoted|quotation|revenue|' +
    'payment|payments|purchase\\s+order|purchase\\s+orders|po\\s+number|po\\s+numbers' +
    ')\\b|' +
    '£|GBP|USD|EUR|\\$|€|' +
    '\\b\\d+(?:\\.\\d{2})?\\s*(?:gbp|pounds|sterling|usd|eur)\\b',
    'i'
);

// Fields never shown in detail tables.
var INTERNAL_FIELDS = setOf([
    'Id', 'OwnerId', 'IsDeleted', 'SystemModstamp',
    'LastViewedDate', 'LastReferencedDate', 'LastActivityDate',
    'Crime_Number__c', 'Invoice_Requested_c__c',
    'Overtime__c', 'Overtime_Rate__c', 'Authorised_By__c',
    'Forensic_Strategy__c', 'Case_Background__c',
    'Forensic_Strategy_Notes_template__c',
    'Exhibit_Alerts__c', 'Case_Alerts__c',
    'media_Asset_generated__c', 'Project_Case_Alias__c',
    'Case_Record_Link_Formula__c', 'Exhibit_Type_Name_Formula__c'
]);

var REMOVE_FIELD_CONTAINS = ['Image_URL', 'Type_Image', 'Formula__c', '__r'];

// Commercial fields blocked when stripCommercial is on.
var COMMERCIAL_FIELDS = setOf(['Quote__c', 'Revenue_Group__c', 'Expected_Billing_Month__c']);

// ── Preferred field ordering (leading fields shown first, then the rest) ───────

var CASE_PREFERRED = [
    'Name', 'Access_Level__c', 'Account__c', 'Contact_Reference__c', 'OIC_eMail__c',
    'Job_Type__c', 'Crime_Category__c', 'Specific_Crimes__c', 'Status__c',
    'Submission_Reference__c', 'Case_Primary_Owner__c', 'Created_Date_Time__c',
    'Start_Date_Time__c', 'Due_Date_Time__c', 'Completed_Date_Time__c',
    'Returned_Date_Time__c', 'Turnaround_Time_TRT__c', 'Estimated_Duration_hrs__c',
    'Total_Logged_Time_hrs__c'
];

var EXHIBIT_PREFERRED = [
    'Name', 'Forensic_Case__c', 'Type__c', 'Description__c', 'Exhibit_Notes__c',
    'Parent_Exhibit__c', 'Property_Number__c', 'Barcode_Number__c',
    'Original_Seal_Reference__c', 'ReSeal_Reference__c', 'Receipt_Date_Time__c',
    'Check_In_Date_Time__c', 'Status__c', 'Forensic_Location__c', 'Re_Sealed_By__c',
    'Re_Sealed_Date_Time__c'
];

var CONTINUITY_PREFERRED = [
    'Name', 'Exhibit__c', 'Status__c', 'Location__c', 'Requested_By__c',
    'Decision_Maker__c', 'Approved_Declined_Date_Time__c', 'Previous_Continuity__c'
];

var GENERATED_PREFERRED = [
    'Name', 'Forensic_Case__c', 'Exhibit_Type__c', 'Description__c', 'Barcode_Number__c',
    'Seal_Reference__c', 'Sealed_By__c', 'Sealed_Date_Time__c', 'Encryption_Type__c',
    'Encryption_Password__c', 'Media_Size_GB__c', 'Status__c', 'Location__c'
];

var ARCHIVE_PREFERRED = [
    'Name', 'Forensic_Case__c', 'Type__c', 'Media_Type__c', 'Location__c',
    'Assigned_Staff__c', 'Conducted_By__c', 'Start_Date__c', 'Completed_Date__c',
    'Archive_Until_Date__c', 'Next_Verification_Date__c', 'Exhibit_Reference__c',
    'Seal_Number__c', 'Sealed_By__c', 'Seal_Date_Time__c', 'Notes__c'
];

var PROCESS_PREFERRED = [
    'Name', 'RecordTypeId', 'Forensic_Case__c', 'Exhibit__c', 'Exhibit_Type__c',
    'Type__c', 'Status__c', 'Start_Date_Time__c', 'End_Date_Time__c', 'Completed_By__c'
];

var ACRONYMS = setOf([
    'BIOS', 'SIM', 'USB', 'QA', 'MD5', 'SHA1', 'URL', 'IMEI', 'ICCID', 'IMSI', 'PIN',
    'VHDX', 'IIOC', 'SOP', 'SLA', 'CMS', 'OIC', 'DFU'
]);

var DATE_FIELDS = setOf([
    'CreatedDate', 'LastModifiedDate', 'Approved_Declined_Date_Time__c',
    'Start_Date_Time__c', 'End_Date_Time__c', 'Check_In_Date_Time__c',
    'Receipt_Date_Time__c', 'Re_Sealed_Date_Time__c', 'Created_Date_Time__c',
    'Completed_Date_Time__c', 'Close_Date_Time__c', 'Due_Date_Time__c',
    'Returned_Date_Time__c', 'Sealed_Date_Time__c', 'Start_Date__c', 'Completed_Date__c',
    'Archive_Until_Date__c', 'Next_Verification_Date__c', 'Seal_Date_Time__c',
    'Actual_Date_Time__c', 'Device_Date_Time__c'
]);

var KNOWN_HEADINGS = setOf([
    'Circumstances', 'Circs', 'Exhibit', 'Exhibits', 'Exhibit(s)', 'Objectives',
    'Datasets Required', 'Data to be provided', 'Generic Data', 'Requested Data',
    'Details of Note', 'Details of interest', 'Tools', 'Mobile', 'Previous Work',
    'Limitations', 'Disclosure', 'Photograph', 'Photographs', 'Pre-imaging Steps',
    'Additional Notes', 'Continuity Information', 'Faraday Box', 'Handset'
]);

var LABEL_OVERRIDES = {
    'CreatedById': 'Created By',
    'LastModifiedById': 'Last Modified By',
    'Operating_Sytem__c': 'Operating System'
};

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
    if (typeof value === 'boolean') return value ? ['Yes'] : [];
    if (typeof value !== 'string') return [String(value)];
    var text = value.trim();
    if (!text) return [];
    if (text.indexOf('<') >= 0 && text.indexOf('>') >= 0) return htmlToBlocks(text);
    return text.split(/\n+/).map(collapse).filter(Boolean);
}

function plainText(value) { return htmlBlocks(value).join('\n'); }

function containsCommercial(value) { return COMMERCIAL_PATTERN.test(plainText(value)); }

function formatDatetime(value) {
    var text = plainText(value);
    if (!text) return '';
    var m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:[+-]\d{4}|Z)?)?$/);
    if (!m) return text;
    var year = +m[1], month = +m[2], day = m[3], hour = m[4], minute = m[5];
    var dt = new Date(Date.UTC(year, month - 1, +day));
    if (isNaN(dt.getTime())) return text;
    var dateText = day + ' ' + MONTHS[month - 1] + ' ' + year;
    return hour ? dateText + ' ' + hour + ':' + minute : dateText;
}

function isDateField(key) {
    return has(DATE_FIELDS, key) || key.indexOf('Date_Time') >= 0 || /_Date__c$/.test(key);
}

function formatValue(key, value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : '';
    if (isDateField(key)) return formatDatetime(value);
    return plainText(value);
}

function humaniseLabel(key) {
    if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
    var label = key.replace(/__c$/, '').replace(/__r$/, '').replace(/_/g, ' ');
    label = label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
    var words = label.split(' ').map(function (w) {
        if (!w) return w;
        var up = w.toUpperCase();
        if (has(ACRONYMS, up)) return up;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
    return words.join(' ').replace('Approved Declined', 'Approved/Declined');
}

function isBlockedField(key, opts) {
    if (has(INTERNAL_FIELDS, key)) return true;
    for (var i = 0; i < REMOVE_FIELD_CONTAINS.length; i++) {
        if (key.indexOf(REMOVE_FIELD_CONTAINS[i]) >= 0) return true;
    }
    if (opts.stripCommercial && has(COMMERCIAL_FIELDS, key)) return true;
    return false;
}

function fv(key, rec) { return formatValue(key, rec ? rec[key] : null); }

// ── Notes rendering (headings, key/value note-lines, paragraphs) ──────────────

function renderNotes(value, opts) {
    var blocks = htmlBlocks(value);
    if (opts && opts.stripCommercial) {
        blocks = blocks.filter(function (b) { return !containsCommercial(b); });
    }
    if (!blocks.length) return '';

    var out = [];
    blocks.forEach(function (raw) {
        var line = raw.replace(/\*\*/g, '').trim();
        if (!line) return;

        if (/:\s*$/.test(line)) {
            out.push('<h4>' + escapeHtml(line.replace(/[\s:]+$/, '')) + '</h4>');
        } else if (/[-–—]\s*$/.test(line)) {
            out.push('<h4>' + escapeHtml(line.replace(/[\s\-–—]+$/, '')) + '</h4>');
        } else if (has(KNOWN_HEADINGS, line)) {
            out.push('<h4>' + escapeHtml(line) + '</h4>');
        } else if (/\s[-–—]\s/.test(line)) {
            out.push('<p class="note-line">' + escapeHtml(line) + '</p>');
        } else {
            out.push('<p>' + escapeHtml(line) + '</p>');
        }
    });
    return out.join('');
}

function notesBlock(value, opts, emptyMsg) {
    var inner = renderNotes(value, opts);
    if (inner) return '<div class="notes">' + inner + '</div>';
    return '<p class="muted">' + escapeHtml(emptyMsg) + '</p>';
}

// ── Tables ────────────────────────────────────────────────────────────────────

function detailTable(record, preferred, opts) {
    var rows = [];
    var seen = Object.create(null);

    function addRow(key) {
        if (seen[key]) return;
        if (!(key in record)) return;
        seen[key] = true;
        if (isBlockedField(key, opts)) return;
        if (opts.excludeNotes && key === 'Notes__c') return;
        var raw = record[key];
        if (typeof raw === 'string' && /<(img|a)\b/i.test(raw)) return;
        var value = formatValue(key, raw);
        if (!value) return;
        if (opts.stripCommercial && (containsCommercial(humaniseLabel(key)) || containsCommercial(value))) return;
        rows.push('<tr><th>' + escapeHtml(humaniseLabel(key)) + '</th><td>' +
            escapeHtml(value).replace(/\n/g, '<br>') + '</td></tr>');
    }

    (preferred || []).forEach(addRow);
    Object.keys(record).forEach(addRow);

    if (!rows.length) return '<p class="muted">No Records</p>';
    return '<table class="detail-table"><tbody>' + rows.join('') + '</tbody></table>';
}

function summaryTable(headers, rows) {
    if (!rows.length) return '';
    var thead = '<thead><tr>' + headers.map(function (h) { return '<th>' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + escapeHtml(c || '').replace(/\n/g, '<br>') + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody>';
    return '<table class="summary-table">' + thead + tbody + '</table>';
}

function recordCard(rec, subtitle, preferred, opts, notesField) {
    var html = '<article class="record-card"><div class="record-head"><h3>' +
        escapeHtml(fv('Name', rec)) + '</h3><span>' + escapeHtml(subtitle || '') + '</span></div>';
    if (notesField) {
        var notes = renderNotes(rec[notesField], opts);
        if (notes) html += '<h4>Notes</h4><div class="notes">' + notes + '</div>';
    }
    var tableOpts = notesField ? assign({ excludeNotes: true }, opts) : opts;
    html += detailTable(rec, preferred, tableOpts) + '</article>';
    return html;
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function cmp(a, b) { a = String(a == null ? '' : a); b = String(b == null ? '' : b); return a < b ? -1 : a > b ? 1 : 0; }
function byName(a, b) { return cmp(a['Name'], b['Name']); }
function byStart(a, b) { return cmp(a['Start_Date_Time__c'] || a['CreatedDate'] || a['Name'], b['Start_Date_Time__c'] || b['CreatedDate'] || b['Name']); }
function byApproved(a, b) { return cmp(a['Approved_Declined_Date_Time__c'] || a['CreatedDate'], b['Approved_Declined_Date_Time__c'] || b['CreatedDate']); }

// ── Sections ──────────────────────────────────────────────────────────────────

function overviewSection(c, opts) {
    var kpi = '<div class="kpi-grid">' +
        kpiTile(fv('Name', c), 'Case Reference') +
        kpiTile(fv('Account__c', c), 'Client') +
        kpiTile(fv('Status__c', c), 'Case Status') +
        kpiTile(fv('Total_Logged_Time_hrs__c', c), 'Logged Hours') +
        '</div>';
    return kpi + detailTable(c, CASE_PREFERRED, opts);
}

function kpiTile(value, label) {
    return '<div><strong>' + escapeHtml(value || '—') + '</strong><span>' + escapeHtml(label) + '</span></div>';
}

function exhibitsSection(input, opts) {
    var recs = input.records.slice().sort(byName);
    if (!recs.length) return '<p class="muted">No Records</p>';
    var sumRows = recs.map(function (e) {
        return [fv('Name', e), fv('Type__c', e), plainText(e['Description__c'] || e['Exhibit_Notes__c'] || ''),
            fv('Property_Number__c', e), fv('Original_Seal_Reference__c', e), fv('ReSeal_Reference__c', e),
            fv('Status__c', e), fv('Forensic_Location__c', e)];
    });
    var html = summaryTable(['Reference', 'Type', 'Description', 'Property Number', 'Original Seal', 'Re Seal', 'Status', 'Location'], sumRows);
    recs.forEach(function (e) { html += recordCard(e, fv('Type__c', e), EXHIBIT_PREFERRED, opts, null); });
    return html;
}

function continuitySection(exhibits, input, opts) {
    var recs = input.records;
    if (!recs.length) return '<p class="muted">No Records</p>';

    var grouped = Object.create(null);
    recs.forEach(function (r) { var k = fv('Exhibit__c', r) || 'Unspecified'; (grouped[k] = grouped[k] || []).push(r); });

    var order = exhibits.records.filter(function (e) { return e['Name']; }).map(function (e) { return fv('Name', e); });
    var ordered = order.filter(function (x) { return grouped[x]; });
    Object.keys(grouped).sort().forEach(function (k) { if (ordered.indexOf(k) < 0) ordered.push(k); });

    var html = '';
    ordered.forEach(function (ref) {
        var list = grouped[ref].slice().sort(byApproved);
        html += '<div class="group"><h3>' + escapeHtml(ref) + ' <span class="count">' +
            list.length + (list.length === 1 ? ' record' : ' records') + '</span></h3>';
        var sumRows = list.map(function (r) {
            return [fv('Name', r), fv('Status__c', r), fv('Location__c', r), fv('Requested_By__c', r),
                fv('Approved_Declined_Date_Time__c', r), fv('CreatedDate', r), fv('CreatedById', r)];
        });
        html += summaryTable(['Continuity Ref', 'Status', 'Location', 'Requested By', 'Approved/Declined Date', 'Created Date', 'Created By'], sumRows);
        list.forEach(function (r) { html += recordCard(r, fv('Status__c', r), CONTINUITY_PREFERRED, opts, null); });
        html += '</div>';
    });
    return html;
}

function generatedSection(input, opts) {
    var recs = input.records;
    if (!recs.length) return '<p class="muted">No Records</p>';
    var sumRows = recs.map(function (r) {
        return [fv('Name', r), fv('Exhibit_Type__c', r), plainText(r['Description__c'] || ''),
            fv('Seal_Reference__c', r), fv('Encryption_Type__c', r), fv('Status__c', r), fv('Location__c', r)];
    });
    var html = summaryTable(['Name', 'Type', 'Description', 'Seal Reference', 'Encryption', 'Status', 'Location'], sumRows);
    recs.forEach(function (r) { html += recordCard(r, fv('Exhibit_Type__c', r), GENERATED_PREFERRED, opts, null); });
    return html;
}

function archiveSection(input, opts) {
    var recs = input.records;
    if (!recs.length) return '<p class="muted">No Records</p>';
    if (recs.length === 1) return detailTable(recs[0], ARCHIVE_PREFERRED, opts);
    return recs.map(function (r) { return recordCard(r, fv('Type__c', r), ARCHIVE_PREFERRED, opts, null); }).join('');
}

function processSection(input, opts) {
    var recs = input.records;
    if (!recs.length) return '<p class="muted">No Records</p>';
    var grouped = Object.create(null);
    recs.forEach(function (r) { var g = fv('RecordTypeId', r) || 'General / Unspecified'; (grouped[g] = grouped[g] || []).push(r); });

    var html = '';
    Object.keys(grouped).sort().forEach(function (g) {
        var list = grouped[g].slice().sort(byStart);
        html += '<div class="group"><h3>' + escapeHtml(g) + ' <span class="count">' + list.length + ' records</span></h3>';
        list.forEach(function (r) {
            var subtitle = [fv('Start_Date_Time__c', r), fv('Exhibit__c', r), fv('Status__c', r)].filter(Boolean).join(' · ');
            html += recordCard(r, subtitle, PROCESS_PREFERRED, opts, 'Notes__c');
        });
        html += '</div>';
    });
    return html;
}

function timeSection(input) {
    var recs = input.records.slice().sort(byStart);
    if (!recs.length) return '<p class="muted">No Records</p>';
    var sumRows = recs.map(function (r) {
        return [fv('Start_Date_Time__c', r), fv('End_Date_Time__c', r), fv('Process_Step__c', r),
            fv('Exhibit__c', r), fv('Duration_hrs__c', r), fv('Logged_Time_For__c', r), plainText(r['Notes__c'] || '')];
    });
    return summaryTable(['Start', 'End', 'Process Step', 'Exhibit', 'Hours', 'Logged For', 'Notes'], sumRows);
}

// ── Presentation ──────────────────────────────────────────────────────────────

function normaliseClassification(value) {
    var text = String(value || DEFAULT_CLASSIFICATION).trim();
    text = text.replace(/ - /g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ');
    return text.toUpperCase();
}

function formatLongDate(d) {
    return ('0' + d.getDate()).slice(-2) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

function wordmark() {
    return '<div class="logo-wordmark"><span class="wm-cyfor">CYFOR</span><span class="wm-bar"></span>' +
        '<span><span class="wm-forensics">FORENSICS</span><span class="wm-sub">DIGITAL EVIDENCE</span></span></div>';
}

function css() {
    return '\n' +
':root{--blue:#003865;--mid:#0057a8;--light:#eef6ff;--line:#d8e2ef;--text:#122033;--muted:#5d6b7c;--card:#fff;--bg:#f4f7fb;}\n' +
'*{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:var(--text);line-height:1.45} a{color:var(--mid)}\n' +
'.header{background:linear-gradient(135deg,#00284f,#005aa6);color:white;padding:32px 42px 34px;position:relative;overflow:hidden}.header:after{content:"";position:absolute;right:-80px;top:-80px;width:280px;height:280px;border-radius:50%;background:rgba(255,255,255,.08)}\n' +
'.logo-box{background:white;border-radius:10px;padding:12px 16px;display:inline-block;margin-bottom:22px;box-shadow:0 8px 24px rgba(0,0,0,.15)} .logo{height:72px;display:block}\n' +
'.logo-wordmark{display:flex;align-items:center;gap:10px}.logo-wordmark .wm-cyfor{font-size:34px;font-weight:900;font-style:italic;color:#0057a8}.logo-wordmark .wm-bar{width:3px;height:30px;background:linear-gradient(180deg,#00aeef,#0057a8);border-radius:2px}.logo-wordmark .wm-forensics{font-size:24px;font-weight:700;letter-spacing:.12em;color:#0b3e78}.logo-wordmark .wm-sub{display:block;font-size:11px;letter-spacing:.35em;color:#5d6b7c;font-weight:700;margin-top:2px}\n' +
'.classification{display:inline-block;margin-left:16px;vertical-align:top;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:8px 14px;font-weight:bold;letter-spacing:.05em}\n' +
'h1{font-size:34px;margin:0 0 8px}.meta{opacity:.92;font-size:15px}.nav{position:sticky;top:0;z-index:5;background:white;border-bottom:1px solid var(--line);padding:10px 34px;box-shadow:0 4px 12px rgba(0,0,0,.06)}.nav a{display:inline-block;text-decoration:none;background:var(--light);border:1px solid var(--line);border-radius:999px;padding:8px 12px;margin:4px;color:var(--blue);font-weight:bold;font-size:13px}\n' +
'main{max-width:1240px;margin:24px auto;padding:0 20px}.card,.record-card{background:var(--card);border:1px solid var(--line);border-radius:14px;margin:18px 0;padding:22px;box-shadow:0 6px 18px rgba(12,39,75,.05)}\n' +
'h2{margin:0 0 16px;color:var(--blue);font-size:24px;border-bottom:2px solid var(--line);padding-bottom:10px} h3{margin:0;color:#173b62;font-size:18px} h4{margin:18px 0 6px;color:#173b62;font-size:15px}\n' +
'.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:8px 0 20px}.kpi-grid div{background:linear-gradient(180deg,#fafdff,#eef6ff);border:1px solid var(--line);border-radius:12px;padding:18px}.kpi-grid strong{display:block;font-size:25px;color:var(--blue)}.kpi-grid span{color:var(--muted);font-size:13px}\n' +
'.detail-table,.summary-table{width:100%;border-collapse:collapse;margin:12px 0;table-layout:auto}.detail-table th{width:260px;text-align:left;background:#f5f8fc;color:#2c4564;border:1px solid var(--line);padding:9px;vertical-align:top}.detail-table td,.summary-table td,.summary-table th{border:1px solid var(--line);padding:9px;vertical-align:top}.summary-table th{background:#eaf2fb;color:#14385c;text-align:left;position:sticky;top:58px}\n' +
'.record-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}.record-head span,.count{color:var(--muted);font-size:13px;font-weight:normal}.group{margin:24px 0}.muted{color:var(--muted)}\n' +
'.notes{background:#fbfdff;border-left:4px solid var(--mid);padding:12px 16px;margin:12px 0;border-radius:8px}.notes p{margin:6px 0}.note-line{padding:6px 8px;background:#f7faff;border:1px solid #e0ebf7;border-radius:8px}\n' +
'.back{display:inline-block;margin-top:14px;text-decoration:none;font-weight:bold}.footer{margin:34px auto 0;max-width:1240px;padding:22px 20px 30px;color:#42556c;text-align:center}.footer .copyright{border-top:1px solid var(--line);padding-top:18px}.footer .classification-bottom{font-weight:bold;color:#003865;letter-spacing:.08em;margin-top:12px}\n' +
'@media print{.nav{position:static}.card,.record-card{break-inside:avoid;box-shadow:none}body{background:white}.summary-table th{position:static}}\n';
}

// ── Assembly ──────────────────────────────────────────────────────────────────

function asInput(x) {
    if (!x) return { supplied: false, records: [], object: null };
    return { supplied: !!x.supplied, records: x.records || [], object: x.object || null };
}

function assign(target, src) { for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k]; return target; }

function build(data) {
    data = data || {};
    var opts = { stripCommercial: data.stripCommercial !== false };
    var c = data.caseRecord || {};
    var exhibits = asInput(data.exhibits);
    var continuity = asInput(data.continuity);
    var gm = asInput(data.generatedMaterial);
    var process = asInput(data.process);
    var time = asInput(data.timeEntries);
    var archive = asInput(data.archive);
    var generatedDate = data.generatedDate || new Date();

    var classification = normaliseClassification(c['Access_Level__c'] || c['Access_Level_Name__c']);
    var caseRef = fv('Name', c) || 'Forensic Case';
    var client = fv('Account__c', c);
    var generatedText = formatLongDate(generatedDate);

    var sections = [
        { id: 'overview', title: 'Case Overview', html: overviewSection(c, opts) },
        { id: 'background', title: 'Case Background', html: notesBlock(c['Case_Background__c'], opts, 'No case background was supplied in the case record.') },
        { id: 'strategy', title: 'Forensic Strategy', html: notesBlock(c['Forensic_Strategy__c'], opts, 'No forensic strategy was supplied in the case record.') },
        { id: 'exhibits', title: 'Exhibits', html: exhibitsSection(exhibits, opts) }
    ];
    if (continuity.supplied || continuity.records.length) {
        sections.push({ id: 'continuity', title: 'Exhibit Continuity', html: continuitySection(exhibits, continuity, opts) });
    }
    if (gm.supplied) sections.push({ id: 'generated', title: 'Generated Material', html: generatedSection(gm, opts) });
    if (archive.supplied) sections.push({ id: 'archive', title: 'Forensic Case Archive', html: archiveSection(archive, opts) });
    if (process.supplied) sections.push({ id: 'process', title: 'Process Records', html: processSection(process, opts) });
    if (time.supplied) sections.push({ id: 'time', title: 'Time Entries', html: timeSection(time) });

    var nav = sections.map(function (s) { return '<a href="#' + s.id + '">' + escapeHtml(s.title) + '</a>'; }).join('');
    var sectionsHtml = sections.map(function (s) {
        return '<section id="' + s.id + '" class="card"><h2>' + escapeHtml(s.title) + '</h2>\n' +
            s.html + '\n<a class="back" href="#top">Back to top</a></section>\n';
    }).join('');

    var logoHtml = data.logoDataUri
        ? '<img class="logo" src="' + data.logoDataUri + '" alt="CYFOR Forensics Digital Evidence logo">'
        : wordmark();

    var metaParts = ['Case ' + escapeHtml(caseRef)];
    if (client) metaParts.push('Client ' + escapeHtml(client));
    metaParts.push('Generated ' + escapeHtml(generatedText));

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>' + escapeHtml(REPORT_TITLE) + '</title><style>' + css() + '</style></head>' +
        '<body id="top">\n' +
        '<header class="header"><div class="logo-box">' + logoHtml + '</div>' +
        '<span class="classification">' + escapeHtml(classification) + '</span>' +
        '<h1>' + escapeHtml(REPORT_TITLE) + '</h1>' +
        '<div class="meta">' + metaParts.join(' · ') + '</div></header>\n' +
        '<nav class="nav">' + nav + '</nav><main>\n' +
        sectionsHtml +
        '</main><footer class="footer"><div class="copyright">&copy; CYFOR Group. ' +
        escapeHtml(REPORT_TITLE) + ' · Generated ' + escapeHtml(generatedText) + '</div>' +
        '<div class="classification-bottom">' + escapeHtml(classification) + '</div></footer></body></html>';
}

function safeCaseFilename(caseRef) {
    return String(caseRef).replace(/[<>:"/\\|?*]+/g, '_').trim() || 'Forensic Case';
}

function suggestFilename(caseRecord, date) {
    var ref = safeCaseFilename(fv('Name', caseRecord || {}) || 'Forensic Case');
    return ref + ' - ' + REPORT_TITLE + ' - ' + formatLongDate(date || new Date()) + '.html';
}

global.DisclosureReport = {
    build: build,
    suggestFilename: suggestFilename,
    REPORT_TITLE: REPORT_TITLE
};

})(typeof self !== 'undefined' ? self : this);
