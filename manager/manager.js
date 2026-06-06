// ==================================================
// CYFOR Template Manager — Page Logic
// Communicates with background.js via chrome.runtime.sendMessage.
// Only accessible to users with isTemplateAdmin === true.
// ==================================================

var currentEditId      = null;   // null = creating new, string = updating existing
var currentEditVersion = null;   // version label of the template being edited
var currentHistoryName = null;   // template name whose history is being viewed
var allTemplates       = {};     // name → { id, content, category, teamId, teamName, ...fields }
var currentUser        = {};     // sfOAuthUser
var allTeams           = [];     // [{ id, name, teamCode }] — for the "assign to any team" picker
var statusOptions      = [];     // status picklist values (from describe) or default lifecycle
var currentVersions    = [];     // archived versions for the template open in History
var currentHistoryTemplate = null; // the live template whose History is open

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btn-back').addEventListener('click', function () {
        chrome.tabs.getCurrent(function (tab) {
            if (tab) { chrome.tabs.remove(tab.id); } else { window.close(); }
        });
    });

    document.getElementById('btn-new-template').addEventListener('click', openNewEditor);
    document.getElementById('btn-editor-save').addEventListener('click', saveTemplate);
    document.getElementById('btn-editor-cancel').addEventListener('click', closeEditor);
    document.getElementById('btn-history-back').addEventListener('click', function () { showState('list'); });
    document.getElementById('btn-usage').addEventListener('click', openUsage);
    document.getElementById('btn-usage-back').addEventListener('click', function () { showState('list'); });
    document.getElementById('btn-usage-clear').addEventListener('click', clearUsage);
    document.getElementById('btn-diff-close').addEventListener('click', function () {
        document.getElementById('mgr-diff-panel').style.display = 'none';
    });

    // History search / date filter (4b)
    ['mgr-history-search', 'mgr-history-start', 'mgr-history-end'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', applyHistoryFilter);
    });
    document.getElementById('btn-history-export').addEventListener('click', exportHistoryCsv);

    // Compare any two versions (4c)
    document.getElementById('btn-compare-run').addEventListener('click', runCompare);

    loadTemplates();
});

// ── Data loading ──────────────────────────────────────────────────────────────

function loadTemplates() {
    showState('loading');

    // Admin "manage all teams" view — every template (all teams + global, all
    // statuses), live from Salesforce.
    chrome.runtime.sendMessage({ action: 'sfTemplates.listAll' }, function (response) {
        if (chrome.runtime.lastError || !response) {
            showState('not-connected');
            return;
        }
        if (!response.ok) {
            if (response.error === 'PERMISSION_DENIED') {
                currentUser = response.user || {};
                showState('not-admin');
            } else {
                showState('not-connected');
            }
            return;
        }

        currentUser   = response.user      || {};
        allTemplates  = response.templates || {};
        statusOptions = (response.statusOptions && response.statusOptions.length)
            ? response.statusOptions
            : ['Draft', 'Active', 'Under Review', 'Superseded', 'Retired'];

        if (!currentUser.isTemplateAdmin) {
            showState('not-admin');
            return;
        }

        var titleEl = document.getElementById('mgr-title');
        if (titleEl) {
            titleEl.textContent = currentUser.teamName
                ? 'CYFOR Template Manager — ' + currentUser.teamName + ' (admin)'
                : 'CYFOR Template Manager';
        }

        document.getElementById('btn-new-template').disabled = false;

        var descEl = document.getElementById('mgr-list-desc');
        if (descEl) {
            descEl.textContent = 'Managing all teams’ templates and shared global templates. '
                + 'As an admin you can create, edit, delete and re-assign any template to any team or Global.';
        }

        populateStatusOptions();
        renderTemplateList();
        renderReviewDashboard();
        showState('list');

        loadTeams(); // non-blocking — populates the "assign to any team" picker
    });
}

// Active teams for the editor's team picker (admins can assign to any team).
function loadTeams() {
    chrome.runtime.sendMessage({ action: 'sfTeams.list' }, function (r) {
        allTeams = (!chrome.runtime.lastError && r && r.ok && r.teams) ? r.teams : [];
        populateScopeOptions();
    });
}

// Rebuild the editor Status dropdown from the real picklist values (or defaults).
function populateStatusOptions() {
    var sel = document.getElementById('mgr-status');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '';
    statusOptions.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = s;
        sel.appendChild(o);
    });
    if (statusOptions.indexOf(current) >= 0) sel.value = current;
    else if (statusOptions.indexOf('Active') >= 0) sel.value = 'Active';
}

// Make sure a template's existing status is selectable even if it's not in the
// configured option list (e.g. a legacy value) — so editing never silently
// changes it.
function ensureStatusOption(status) {
    if (!status) return;
    var sel = document.getElementById('mgr-status');
    if (!sel) return;
    var exists = Array.prototype.some.call(sel.options, function (o) { return o.value === status; });
    if (!exists) {
        var o = document.createElement('option');
        o.value = status; o.textContent = status;
        sel.appendChild(o);
    }
}

// Rebuild the editor Team dropdown: Global + every active team.
function populateScopeOptions() {
    var sel = document.getElementById('mgr-scope');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '';
    var g = document.createElement('option');
    g.value = ''; g.textContent = 'Global (all teams)';
    sel.appendChild(g);
    allTeams.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name + (t.teamCode ? ' (' + t.teamCode + ')' : '');
        sel.appendChild(o);
    });
    if (current) sel.value = current; // restore selection if still valid
}

// Guarantee a team is selectable even if the teams list hasn't loaded yet (race)
// or the template points at a team not in the active list — so the assignment is
// never silently lost to Global on save.
function ensureTeamOption(teamId, teamName) {
    if (!teamId) return;
    var sel = document.getElementById('mgr-scope');
    if (!sel) return;
    var exists = Array.prototype.some.call(sel.options, function (o) { return o.value === teamId; });
    if (!exists) {
        var o = document.createElement('option');
        o.value = teamId; o.textContent = (teamName || 'Team') + ' (current)';
        sel.appendChild(o);
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderTemplateList() {
    var tbody   = document.getElementById('mgr-template-rows');
    var emptyEl = document.getElementById('mgr-empty');
    var tableEl = document.getElementById('mgr-template-table');
    tbody.innerHTML = '';

    var names    = Object.keys(allTemplates).sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    var teamCode = currentUser.teamCode || null;

    if (!names.length) {
        if (emptyEl)  emptyEl.style.display  = '';
        if (tableEl)  tableEl.style.display  = 'none';
        return;
    }

    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';

    var today  = new Date();
    today.setHours(0, 0, 0, 0);
    var in30   = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    names.forEach(function (name) {
        var t        = allTemplates[name];
        var isMyTeam = teamCode && t.teamCode === teamCode;

        var tr = document.createElement('tr');

        // Doc ID — the custom DocumentId__c if present (e.g. a Salesforce Auto
        // Number), otherwise the system record Id as the stable identifier.
        var docVal = t.documentId || t.id || '';
        var docTd = document.createElement('td');
        docTd.textContent  = docVal || '—';
        docTd.style.color  = docVal ? '' : 'var(--text-muted)';
        docTd.style.fontFamily = docVal ? "'Menlo','Consolas',monospace" : '';
        docTd.style.fontSize   = '12px';
        tr.appendChild(docTd);

        // Name
        var nameTd = document.createElement('td');
        nameTd.textContent = name;
        tr.appendChild(nameTd);

        // Version
        var verTd = document.createElement('td');
        verTd.textContent  = t.versionLabel ? 'v' + t.versionLabel : '—';
        verTd.style.fontFamily = "'Menlo','Consolas',monospace";
        verTd.style.fontSize   = '12px';
        verTd.style.color      = t.versionLabel ? '' : 'var(--text-muted)';
        tr.appendChild(verTd);

        // Status
        var statTd    = document.createElement('td');
        var statBadge = document.createElement('span');
        var statusVal = (t.status || 'Active').toLowerCase().replace(/\s+/g, '-');
        statBadge.className   = 'mgr-status-badge mgr-status-badge--' + statusVal;
        statBadge.textContent = t.status || 'Active';
        statTd.appendChild(statBadge);
        tr.appendChild(statTd);

        // Category
        var catTd = document.createElement('td');
        catTd.textContent = t.category || '—';
        tr.appendChild(catTd);

        // Scope — show the actual team name (or Global); highlight the admin's own.
        var scopeTd = document.createElement('td');
        var badge   = document.createElement('span');
        badge.className   = t.teamId ? 'mgr-scope-badge mgr-scope-badge--team' : 'mgr-scope-badge';
        if (isMyTeam) badge.className += ' mgr-scope-badge--own';
        badge.textContent = t.teamName || 'Global';
        scopeTd.appendChild(badge);
        tr.appendChild(scopeTd);

        // Review Due
        var revTd = document.createElement('td');
        if (t.reviewDueDate) {
            var due = new Date(t.reviewDueDate);
            due.setHours(0, 0, 0, 0);
            revTd.textContent = formatDate(t.reviewDueDate);
            if (due < today) {
                revTd.className = 'mgr-review-overdue';
                revTd.title     = 'Review overdue';
            } else if (due <= in30) {
                revTd.className = 'mgr-review-warn';
                revTd.title     = 'Review due within 30 days';
            } else {
                revTd.className = 'mgr-review-ok';
            }
        } else {
            revTd.textContent  = '—';
            revTd.style.color  = 'var(--text-muted)';
        }
        tr.appendChild(revTd);

        // Actions
        var actionsTd  = document.createElement('td');
        actionsTd.className = 'mgr-col-actions';
        var actionsWrap = document.createElement('div');
        actionsWrap.className = 'mgr-col-actions-cell';

        // Admins can edit/delete ANY team's + global templates (the whole manager
        // is already admin-gated).
        var editBtn = document.createElement('button');
        editBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
        editBtn.textContent = 'Edit';
        editBtn.setAttribute('aria-label', 'Edit ' + name);

        var histBtn = document.createElement('button');
        histBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
        histBtn.textContent = 'History';
        histBtn.setAttribute('aria-label', 'Version history for ' + name);

        var delBtn = document.createElement('button');
        delBtn.className   = 'mgr-btn mgr-btn-danger mgr-btn-sm';
        delBtn.textContent = 'Delete';
        delBtn.setAttribute('aria-label', 'Delete ' + name);

        actionsWrap.appendChild(editBtn);
        actionsWrap.appendChild(histBtn);
        actionsWrap.appendChild(delBtn);
        actionsTd.appendChild(actionsWrap);
        tr.appendChild(actionsTd);

        (function (n) {
            editBtn.addEventListener('click', function () { openEditEditor(n); });
            delBtn.addEventListener('click',  function () { confirmDelete(n); });
            histBtn.addEventListener('click', function () { openHistory(n); });
        }(name));

        tbody.appendChild(tr);
    });
}

// ── Review-due dashboard (4a) ─────────────────────────────────────────────────
// Surfaces templates overdue / due-soon for review across every team, so nothing
// lapses. Hidden when there's nothing to flag. Superseded/Retired are excluded.
function renderReviewDashboard() {
    var dash    = document.getElementById('mgr-review-dash');
    var summary = document.getElementById('mgr-review-dash-summary');
    var body    = document.getElementById('mgr-review-dash-body');
    if (!dash || !summary || !body) return;

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var items = [];
    Object.keys(allTemplates).forEach(function (name) {
        var t = allTemplates[name];
        if (!t.reviewDueDate) return;
        var status = (t.status || '').toLowerCase();
        if (status === 'superseded' || status === 'retired') return;
        var due = new Date(t.reviewDueDate + 'T00:00:00');
        if (isNaN(due.getTime())) return;
        due.setHours(0, 0, 0, 0);
        items.push({ name: name, team: t.teamName || 'Global', due: t.reviewDueDate,
                     days: Math.round((due - today) / 86400000) });
    });
    items.sort(function (a, b) { return a.days - b.days; });

    var overdue = items.filter(function (i) { return i.days < 0; });
    var due30   = items.filter(function (i) { return i.days >= 0 && i.days <= 30; });
    var due60   = items.filter(function (i) { return i.days > 30 && i.days <= 60; });

    var flagged = overdue.concat(due30, due60);
    if (!flagged.length) { dash.style.display = 'none'; return; }
    dash.style.display = '';

    summary.innerHTML = 'Review status — '
        + '<strong class="mgr-rev-overdue">' + overdue.length + ' overdue</strong>, '
        + '<strong class="mgr-rev-warn">' + due30.length + ' due ≤30d</strong>, '
        + due60.length + ' due ≤60d';

    body.innerHTML = '';
    flagged.forEach(function (i) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'mgr-review-item ' +
            (i.days < 0 ? 'mgr-review-item--overdue' : i.days <= 30 ? 'mgr-review-item--warn' : '');
        var when = i.days < 0 ? (Math.abs(i.days) + 'd overdue') : ('in ' + i.days + 'd');
        var nameSpan = document.createElement('span');
        nameSpan.className = 'mgr-review-item-name'; nameSpan.textContent = i.name;
        var teamSpan = document.createElement('span');
        teamSpan.className = 'mgr-review-item-team'; teamSpan.textContent = i.team;
        var dueSpan = document.createElement('span');
        dueSpan.className = 'mgr-review-item-due'; dueSpan.textContent = formatDate(i.due) + ' · ' + when;
        row.appendChild(nameSpan); row.appendChild(teamSpan); row.appendChild(dueSpan);
        row.addEventListener('click', function () { openEditEditor(i.name); });
        body.appendChild(row);
    });
}

// ── Editor ────────────────────────────────────────────────────────────────────

function openNewEditor() {
    currentEditId      = null;
    currentEditVersion = null;

    document.getElementById('mgr-editor-heading').textContent = 'New Template';
    document.getElementById('mgr-name').value          = '';
    document.getElementById('mgr-category').value      = '';
    document.getElementById('mgr-content').value       = '';
    document.getElementById('mgr-change-reason').value = '';
    document.getElementById('mgr-status').value        = 'Active';
    document.getElementById('mgr-effective-date').value = today();
    document.getElementById('mgr-review-date').value   = addMonths(today(), REVIEW_PERIOD_MONTHS);

    var docIdEl = document.getElementById('mgr-doc-id');
    docIdEl.value       = '';
    docIdEl.readOnly    = true;            // assigned by Salesforce, not by hand
    docIdEl.placeholder = 'Assigned by Salesforce on save';

    // Default new templates to the admin's own team (or Global if none).
    ensureTeamOption(currentUser.teamId, currentUser.teamName);
    document.getElementById('mgr-scope').value = currentUser.teamId || '';

    document.getElementById('mgr-version-display').textContent = 'v1.0';
    document.getElementById('mgr-version-bump').style.display  = 'none';

    var hintEl = document.getElementById('mgr-change-reason-hint');
    if (hintEl) hintEl.textContent = '(document the purpose of this template)';

    setEditorStatus('', '');
    showState('editor');
    document.getElementById('mgr-name').focus();
}

function openEditEditor(name) {
    var t = allTemplates[name];
    if (!t) return;

    currentEditId      = t.id;
    currentEditVersion = t.versionLabel || '1.0';

    document.getElementById('mgr-editor-heading').textContent = 'Edit: ' + name;
    document.getElementById('mgr-name').value          = name;
    document.getElementById('mgr-category').value      = t.category      || '';
    document.getElementById('mgr-content').value       = t.content       || '';
    document.getElementById('mgr-change-reason').value = '';
    ensureStatusOption(t.status);
    document.getElementById('mgr-status').value        = t.status        || 'Active';
    // A new version becomes effective today; pre-fill so the controlled-document
    // dates are never left blank (matches the background defaulting on save).
    var effPrefill = t.effectiveDate || today();
    document.getElementById('mgr-effective-date').value = effPrefill;
    document.getElementById('mgr-review-date').value   = t.reviewDueDate || addMonths(effPrefill, REVIEW_PERIOD_MONTHS);

    var docIdEl = document.getElementById('mgr-doc-id');
    docIdEl.value    = t.documentId || t.id || '';
    docIdEl.readOnly = true;            // Salesforce-managed identifier

    // Pre-select the template's current team (empty value = Global).
    ensureTeamOption(t.teamId, t.teamName);
    document.getElementById('mgr-scope').value = t.teamId || '';

    document.getElementById('mgr-version-display').textContent = 'v' + currentEditVersion;
    document.getElementById('mgr-version-bump').style.display  = '';

    var hintEl = document.getElementById('mgr-change-reason-hint');
    if (hintEl) hintEl.textContent = '(required — describe what changed and why)';

    setEditorStatus('', '');
    showState('editor');
    document.getElementById('mgr-name').focus();
}

function closeEditor() {
    currentEditId      = null;
    currentEditVersion = null;
    showState('list');
}

function saveTemplate() {
    var name         = (document.getElementById('mgr-name').value          || '').trim();
    var category     = (document.getElementById('mgr-category').value      || '').trim();
    var content      =  document.getElementById('mgr-content').value;
    var changeReason = (document.getElementById('mgr-change-reason').value || '').trim();
    var status       =  document.getElementById('mgr-status').value        || 'Active';
    var effectiveDate = document.getElementById('mgr-effective-date').value || null;
    var reviewDueDate = document.getElementById('mgr-review-date').value    || null;
    var teamId       = (document.getElementById('mgr-scope') || {}).value;   // '' = Global

    if (!name)           { setEditorStatus('Name is required.', 'error'); return; }
    if (!content.trim()) { setEditorStatus('Content is required.', 'error'); return; }
    if (!changeReason)   { setEditorStatus('Reason is required for the audit trail.', 'error'); return; }

    var saveBtn = document.getElementById('btn-editor-save');
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';
    setEditorStatus('', '');

    var action, payload;

    if (currentEditId) {
        var bumpInput  = document.querySelector('input[name="version-bump"]:checked');
        var newVersion = bumpVersion(currentEditVersion, bumpInput ? bumpInput.value : 'minor');

        action  = 'sfTemplates.update';
        payload = {
            id:           currentEditId,
            name:         name,
            content:      content,
            category:     category,
            versionLabel: newVersion,
            status:       status,
            changeReason: changeReason,
            effectiveDate: effectiveDate,
            reviewDueDate: reviewDueDate,
            teamId:       teamId
        };
    } else {
        action  = 'sfTemplates.create';
        payload = {
            name:         name,
            content:      content,
            category:     category,
            versionLabel: '1.0',
            documentId:   '',   // assigned by Salesforce (Auto Number) — not generated client-side
            status:       status,
            changeReason: changeReason,
            teamId:       teamId,
            effectiveDate: effectiveDate,
            reviewDueDate: reviewDueDate
        };
    }

    chrome.runtime.sendMessage({ action: action, payload: payload }, function (response) {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save to Salesforce';

        if (chrome.runtime.lastError || !response || !response.ok) {
            var err = (response && response.error) || 'Save failed — please try again.';
            setEditorStatus('Error: ' + err, 'error');
            return;
        }

        loadTemplates();
    });
}

// ── Branded modal (replaces window.confirm / window.alert) ─────────────────────
function mgrModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        var backdrop = document.createElement('div');
        backdrop.className = 'mgr-modal-backdrop';

        var dialog = document.createElement('div');
        dialog.className = 'mgr-modal';
        dialog.setAttribute('role', opts.alert ? 'alertdialog' : 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        var h = document.createElement('h3');
        h.className = 'mgr-modal-title';
        h.textContent = opts.title || (opts.alert ? 'Notice' : 'Confirm');
        dialog.appendChild(h);

        var p = document.createElement('p');
        p.className = 'mgr-modal-body';
        p.textContent = opts.body || '';
        dialog.appendChild(p);

        var actions = document.createElement('div');
        actions.className = 'mgr-modal-actions';

        var cancelBtn = null;
        if (!opts.alert) {
            cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'mgr-btn mgr-btn-secondary';
            cancelBtn.textContent = opts.cancelLabel || 'Cancel';
            actions.appendChild(cancelBtn);
        }

        var confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'mgr-btn ' + (opts.danger ? 'mgr-btn-danger' : 'mgr-btn-primary');
        confirmBtn.textContent = opts.confirmLabel || 'OK';
        actions.appendChild(confirmBtn);

        dialog.appendChild(actions);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        var lastFocus = document.activeElement;

        function close(result) {
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
            if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
            resolve(result);
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
            if (e.key === 'Tab') {
                var btns = dialog.querySelectorAll('button');
                if (!btns.length) return;
                var first = btns[0], last = btns[btns.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }

        confirmBtn.addEventListener('click', function () { close(true); });
        if (cancelBtn) cancelBtn.addEventListener('click', function () { close(false); });
        backdrop.addEventListener('mousedown', function (e) {
            if (e.target === backdrop && !opts.alert) close(false);
        });
        document.addEventListener('keydown', onKey, true);

        // Focus Cancel by default for destructive prompts so Enter doesn't delete.
        (opts.danger && cancelBtn ? cancelBtn : confirmBtn).focus();
    });
}

function mgrAlert(message, title) {
    return mgrModal({ title: title || 'Notice', body: message, confirmLabel: 'OK', alert: true });
}

function confirmDelete(name) {
    var t = allTemplates[name];
    if (!t || !t.id) return;

    mgrModal({
        title: 'Delete template?',
        body: 'Delete "' + name + '"? This permanently removes the template from Salesforce. '
            + 'Team members will no longer see it after their next sync, and its version history '
            + 'records will also be deleted.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        danger: true
    }).then(function (ok) {
        if (!ok) return;
        chrome.runtime.sendMessage({ action: 'sfTemplates.delete', payload: { id: t.id } }, function (response) {
            if (chrome.runtime.lastError || !response || !response.ok) {
                var err = (response && response.error) || 'Delete failed';
                mgrAlert('Could not delete "' + name + '": ' + err, 'Delete failed');
                return;
            }
            loadTemplates();
        });
    });
}

// ── Version history ───────────────────────────────────────────────────────────

function openHistory(name) {
    var t = allTemplates[name];
    if (!t) return;

    currentHistoryName = name;

    document.getElementById('mgr-history-heading').textContent = 'Version History: ' + name;

    var parts = [];
    if (t.documentId)        parts.push('<strong>Doc ID:</strong> '        + escHtml(t.documentId));
    if (t.versionLabel)      parts.push('<strong>Current:</strong> v'      + escHtml(t.versionLabel));
    if (t.status)            parts.push('<strong>Status:</strong> '        + escHtml(t.status));
    if (t.lastChangedByName) parts.push('<strong>Last changed by:</strong> ' + escHtml(t.lastChangedByName));
    document.getElementById('mgr-history-meta').innerHTML = parts.join(' &nbsp;&nbsp; ');

    currentVersions        = [];
    currentHistoryTemplate = t;

    document.getElementById('mgr-history-loading').style.display     = '';
    document.getElementById('mgr-history-unavailable').style.display = 'none';
    document.getElementById('mgr-history-empty').style.display       = 'none';
    document.getElementById('mgr-history-table-wrap').style.display  = 'none';
    document.getElementById('mgr-history-controls').style.display    = 'none';
    document.getElementById('mgr-compare-bar').style.display         = 'none';
    document.getElementById('mgr-diff-panel').style.display          = 'none';
    document.getElementById('mgr-history-search').value = '';
    document.getElementById('mgr-history-start').value  = '';
    document.getElementById('mgr-history-end').value    = '';

    showState('history');

    chrome.runtime.sendMessage({ action: 'sfTemplates.versions.get', templateId: t.id }, function (response) {
        document.getElementById('mgr-history-loading').style.display = 'none';

        if (chrome.runtime.lastError || !response || !response.ok) {
            document.getElementById('mgr-history-empty').style.display = '';
            return;
        }

        if (response.unavailable) {
            document.getElementById('mgr-history-unavailable').style.display = '';
            return;
        }

        var versions = response.versions || [];
        if (!versions.length) {
            document.getElementById('mgr-history-empty').style.display = '';
            // Still allow comparing — but with only "Current" there's nothing to
            // diff, so keep the compare bar hidden when there are no archives.
            return;
        }

        currentVersions = versions;
        renderHistoryTable(versions);
        document.getElementById('mgr-history-table-wrap').style.display = '';
        document.getElementById('mgr-history-controls').style.display   = '';
        populateCompareBar();
        document.getElementById('mgr-compare-bar').style.display = '';
    });
}

// Renders the (optionally filtered) version rows. Uses currentVersions for the
// supersede chain and currentHistoryTemplate for the "Compare with current".
function renderHistoryTable(versions) {
    var tbody = document.getElementById('mgr-history-rows');
    var current = currentHistoryTemplate || {};
    tbody.innerHTML = '';

    if (!versions.length) {
        var tr0 = document.createElement('tr');
        var td0 = document.createElement('td');
        td0.colSpan = 5;
        td0.className = 'mgr-history-noresult';
        td0.textContent = 'No versions match the current filter.';
        tr0.appendChild(td0);
        tbody.appendChild(tr0);
        return;
    }

    versions.forEach(function (v) {
        var tr = document.createElement('tr');

        var verTd = document.createElement('td');
        verTd.style.fontFamily = "'Menlo','Consolas',monospace";
        verTd.style.fontSize   = '12px';
        verTd.textContent = v.VersionLabel__c ? 'v' + v.VersionLabel__c : '—';
        // Supersede chain (4d): each archived version was superseded by the next
        // newer version in currentVersions, or by the live template at the top.
        var idx = currentVersions.indexOf(v);
        var supBy = idx === 0 ? (current.versionLabel || '') : ((currentVersions[idx - 1] || {}).VersionLabel__c || '');
        if (supBy) {
            var sup = document.createElement('div');
            sup.className = 'mgr-history-superseded';
            sup.textContent = '→ superseded by v' + supBy;
            verTd.appendChild(sup);
        }
        tr.appendChild(verTd);

        var dateTd = document.createElement('td');
        dateTd.textContent  = v.ArchivedAt__c ? formatDateTime(v.ArchivedAt__c) : '—';
        dateTd.style.fontSize = '12px';
        tr.appendChild(dateTd);

        var byTd = document.createElement('td');
        byTd.textContent    = v.ChangedByName__c || v.ChangedByEmail__c || '—';
        byTd.style.fontSize = '12px';
        byTd.title          = v.ChangedByEmail__c || '';
        tr.appendChild(byTd);

        var reasonTd = document.createElement('td');
        reasonTd.textContent  = v.ChangeReason__c || '—';
        reasonTd.style.fontSize = '12px';
        reasonTd.style.color    = v.ChangeReason__c ? '' : 'var(--text-muted)';
        tr.appendChild(reasonTd);

        var actionsTd = document.createElement('td');
        actionsTd.className   = 'mgr-col-actions';
        var wrap = document.createElement('div');
        wrap.className = 'mgr-col-actions-cell';

        var diffBtn = document.createElement('button');
        diffBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
        diffBtn.textContent = 'Compare';
        diffBtn.setAttribute('aria-label', 'Compare v' + (v.VersionLabel__c || '?') + ' with current');
        wrap.appendChild(diffBtn);
        actionsTd.appendChild(wrap);
        tr.appendChild(actionsTd);

        (function (archivedContent, archivedVersion) {
            diffBtn.addEventListener('click', function () {
                showDiff('v' + archivedVersion, archivedContent,
                         'Current (v' + (current.versionLabel || '?') + ')', current.content || '');
            });
        }(v.Content__c || '', v.VersionLabel__c || '?'));

        tbody.appendChild(tr);
    });
}

// ── History search / date filter + CSV export (4b) ────────────────────────────

function filteredVersions() {
    var q     = (document.getElementById('mgr-history-search').value || '').trim().toLowerCase();
    var start = document.getElementById('mgr-history-start').value;
    var end   = document.getElementById('mgr-history-end').value;
    var startTs = start ? new Date(start + 'T00:00:00').getTime() : null;
    var endTs   = end   ? new Date(end   + 'T23:59:59').getTime() : null;

    return currentVersions.filter(function (v) {
        if (q) {
            var hay = ('v' + (v.VersionLabel__c || '') + ' ' + (v.ChangeReason__c || '') + ' ' +
                       (v.ChangedByName__c || '') + ' ' + (v.ChangedByEmail__c || '')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        if (startTs || endTs) {
            var ts = v.ArchivedAt__c ? new Date(v.ArchivedAt__c).getTime() : NaN;
            if (isNaN(ts)) return false;
            if (startTs && ts < startTs) return false;
            if (endTs && ts > endTs) return false;
        }
        return true;
    });
}

function applyHistoryFilter() {
    renderHistoryTable(filteredVersions());
}

function csvCell(value) {
    var s = String(value == null ? '' : value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportHistoryCsv() {
    var rows = filteredVersions();
    if (!rows.length) { mgrAlert('Nothing to export for the current filter.', 'Export'); return; }

    var header = ['Version', 'Archived', 'Changed By', 'Email', 'Reason for Change'];
    var lines  = [header.map(csvCell).join(',')];
    rows.forEach(function (v) {
        lines.push([
            v.VersionLabel__c || '',
            v.ArchivedAt__c ? formatDateTime(v.ArchivedAt__c) : '',
            v.ChangedByName__c || '',
            v.ChangedByEmail__c || '',
            v.ChangeReason__c || ''
        ].map(csvCell).join(','));
    });

    var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    var safeName = (currentHistoryName || 'template').replace(/[^\w.-]+/g, '_');
    a.href = url;
    a.download = safeName + '_version-history.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// ── Compare any two versions (4c) ─────────────────────────────────────────────

// Selectable items: every archived version + the live "Current".
function compareItems() {
    var current = currentHistoryTemplate || {};
    var items = [{
        label:   'Current (v' + (current.versionLabel || '?') + ')',
        content: current.content || ''
    }];
    currentVersions.forEach(function (v) {
        items.push({ label: 'v' + (v.VersionLabel__c || '?'), content: v.Content__c || '' });
    });
    return items;
}

function populateCompareBar() {
    var items = compareItems();
    var fromSel = document.getElementById('mgr-compare-from');
    var toSel   = document.getElementById('mgr-compare-to');
    fromSel.innerHTML = '';
    toSel.innerHTML   = '';
    items.forEach(function (it, i) {
        var o1 = document.createElement('option'); o1.value = i; o1.textContent = it.label; fromSel.appendChild(o1);
        var o2 = document.createElement('option'); o2.value = i; o2.textContent = it.label; toSel.appendChild(o2);
    });
    // Default: previous (first archived = index 1) → Current (index 0).
    fromSel.value = items.length > 1 ? '1' : '0';
    toSel.value   = '0';
}

function runCompare() {
    var items = compareItems();
    var from  = items[parseInt(document.getElementById('mgr-compare-from').value, 10)] || items[0];
    var to    = items[parseInt(document.getElementById('mgr-compare-to').value, 10)] || items[0];
    if (from === to) { mgrAlert('Pick two different versions to compare.', 'Compare'); return; }
    showDiff(from.label, from.content, to.label, to.content);
}

function showDiff(fromLabel, fromContent, toLabel, toContent) {
    var oldLines = (fromContent || '').split('\n');
    var newLines = (toContent   || '').split('\n');
    var diff     = computeDiff(oldLines, newLines);

    var added   = diff.filter(function (d) { return d.type === 'added';   }).length;
    var removed = diff.filter(function (d) { return d.type === 'removed'; }).length;

    var unchanged = diff.length - added - removed;
    document.getElementById('mgr-diff-title').textContent =
        'Changes: ' + fromLabel + ' → ' + toLabel;
    document.getElementById('mgr-diff-stats').textContent =
        '+' + added + ' added,  −' + removed + ' removed,  ' + unchanged + ' unchanged';

    var container = document.getElementById('mgr-diff-content');
    container.innerHTML = '';

    diff.forEach(function (entry) {
        var row    = document.createElement('div');
        row.className = 'mgr-diff-line mgr-diff-line--' + entry.type;

        var gutter = document.createElement('span');
        gutter.className   = 'mgr-diff-line-gutter';
        gutter.textContent = entry.type === 'added' ? '+' : entry.type === 'removed' ? '–' : ' ';

        var text = document.createElement('span');
        text.className   = 'mgr-diff-line-text';
        text.textContent = entry.line;

        row.appendChild(gutter);
        row.appendChild(text);
        container.appendChild(row);
    });

    var panel = document.getElementById('mgr-diff-panel');
    panel.style.display = '';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Diff algorithm (LCS-based) ────────────────────────────────────────────────

function computeDiff(oldLines, newLines) {
    var m = oldLines.length;
    var n = newLines.length;

    var dp = new Array(m + 1);
    for (var i = 0; i <= m; i++) {
        dp[i] = new Int32Array(n + 1);
    }
    for (var i = 1; i <= m; i++) {
        for (var j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
            }
        }
    }

    var result = [];
    var i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            result.unshift({ type: 'same', line: oldLines[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.unshift({ type: 'added', line: newLines[j - 1] });
            j--;
        } else {
            result.unshift({ type: 'removed', line: oldLines[i - 1] });
            i--;
        }
    }
    return result;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function bumpVersion(current, type) {
    var parts = (current || '1.0').split('.');
    var major = parseInt(parts[0], 10) || 1;
    var minor = parseInt(parts[1], 10) || 0;
    return type === 'major' ? (major + 1) + '.0' : major + '.' + (minor + 1);
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

// Add N months to an ISO date (YYYY-MM-DD); used to suggest the review-due date.
function addMonths(isoDate, months) {
    var d = new Date((isoDate || today()) + 'T00:00:00Z');
    if (isNaN(d.getTime())) d = new Date();
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
}
var REVIEW_PERIOD_MONTHS = 12;

function formatDate(isoDate) {
    if (!isoDate) return '';
    var d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── UI helpers ────────────────────────────────────────────────────────────────

// ── Usage log (local, per-device) ─────────────────────────────────────────────
var USAGE_KEY = 'templateUsageLog';

function openUsage() {
    showState('usage');
    chrome.storage.local.get([USAGE_KEY], function (res) {
        var log = (res && Array.isArray(res[USAGE_KEY])) ? res[USAGE_KEY] : [];
        renderUsage(log);
    });
}

function renderUsage(log) {
    var table = document.getElementById('mgr-usage-table');
    var empty = document.getElementById('mgr-usage-empty');
    var rows  = document.getElementById('mgr-usage-rows');
    rows.innerHTML = '';

    if (!log.length) {
        table.style.display = 'none';
        empty.style.display = '';
        return;
    }
    empty.style.display = 'none';
    table.style.display = '';

    var sorted = log.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    rows.innerHTML = sorted.map(function (e) {
        var when = e.ts ? new Date(e.ts).toLocaleString() : '';
        var safeUrl = (typeof e.url === 'string' && /^https:\/\//i.test(e.url)) ? e.url : '';
        var rec = e.recordId
            ? (safeUrl
                ? '<a href="' + escHtml(safeUrl) + '" target="_blank" rel="noopener">' + escHtml(e.recordId) + '</a>'
                : escHtml(e.recordId))
            : '—';
        return '<tr><td>' + escHtml(when) + '</td><td>' + escHtml(e.template || '') +
            '</td><td>' + rec + '</td><td>' + escHtml(e.user || '—') + '</td></tr>';
    }).join('');
}

function clearUsage() {
    mgrModal({
        title: 'Clear usage log?',
        body: 'Remove all locally recorded template-insertion entries on this device? This cannot be undone.',
        confirmLabel: 'Clear',
        cancelLabel: 'Cancel',
        danger: true
    }).then(function (ok) {
        if (!ok) return;
        var payload = {};
        payload[USAGE_KEY] = [];
        chrome.storage.local.set(payload, function () { renderUsage([]); });
    });
}

function showState(state) {
    var panels = {
        'loading':       'mgr-loading',
        'not-connected': 'mgr-not-connected',
        'not-admin':     'mgr-not-admin',
        'list':          'mgr-list-panel',
        'editor':        'mgr-editor-panel',
        'history':       'mgr-history-panel',
        'usage':         'mgr-usage-panel'
    };
    Object.keys(panels).forEach(function (key) {
        var el = document.getElementById(panels[key]);
        if (el) el.style.display = (key === state) ? '' : 'none';
    });
}

function setEditorStatus(msg, type) {
    var el = document.getElementById('mgr-editor-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'mgr-status-msg' + (type ? ' status-' + type : '');
}
