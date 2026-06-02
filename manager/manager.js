// ==================================================
// CYFOR Template Manager — Page Logic
// Communicates with background.js via chrome.runtime.sendMessage.
// Only accessible to users with isTemplateAdmin === true.
// ==================================================

var currentEditId      = null;   // null = creating new, string = updating existing
var currentEditVersion = null;   // version label of the template being edited
var currentHistoryName = null;   // template name whose history is being viewed
var allTemplates       = {};     // name → { id, content, category, teamCode, ...fields }
var currentUser        = {};     // sfOAuthUser

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

    loadTemplates();
});

// ── Data loading ──────────────────────────────────────────────────────────────

function loadTemplates() {
    showState('loading');

    chrome.runtime.sendMessage({ action: 'sfTemplates.list' }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok) {
            showState('not-connected');
            return;
        }

        currentUser  = response.user      || {};
        allTemplates = response.templates || {};

        if (!currentUser.isTemplateAdmin) {
            showState('not-admin');
            return;
        }

        var titleEl = document.getElementById('mgr-title');
        if (titleEl && currentUser.teamName) {
            titleEl.textContent = 'CYFOR Template Manager — ' + currentUser.teamName;
        }

        document.getElementById('btn-new-template').disabled = false;

        var descEl = document.getElementById('mgr-list-desc');
        if (descEl) {
            var teamLabel = currentUser.teamName || 'your team';
            descEl.textContent = 'Showing templates for ' + teamLabel +
                ' and shared global templates. You can edit and delete your team\'s templates.' +
                ' Global templates are read-only.';
        }

        renderTemplateList();
        showState('list');
    });
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
        var statusVal = (t.status || 'Active').toLowerCase();
        statBadge.className   = 'mgr-status-badge mgr-status-badge--' + statusVal;
        statBadge.textContent = t.status || 'Active';
        statTd.appendChild(statBadge);
        tr.appendChild(statTd);

        // Category
        var catTd = document.createElement('td');
        catTd.textContent = t.category || '—';
        tr.appendChild(catTd);

        // Scope
        var scopeTd = document.createElement('td');
        var badge   = document.createElement('span');
        badge.className   = isMyTeam ? 'mgr-scope-badge mgr-scope-badge--team' : 'mgr-scope-badge';
        badge.textContent = isMyTeam ? (currentUser.teamName || 'Team') : 'Global';
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

        var editBtn = document.createElement('button');
        editBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
        editBtn.textContent = 'Edit';
        editBtn.disabled    = !isMyTeam;
        editBtn.setAttribute('aria-label', 'Edit ' + name);

        var histBtn = document.createElement('button');
        histBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
        histBtn.textContent = 'History';
        histBtn.setAttribute('aria-label', 'Version history for ' + name);

        var delBtn = document.createElement('button');
        delBtn.className   = 'mgr-btn mgr-btn-danger mgr-btn-sm';
        delBtn.textContent = 'Delete';
        delBtn.disabled    = !isMyTeam;
        delBtn.setAttribute('aria-label', 'Delete ' + name);

        actionsWrap.appendChild(editBtn);
        actionsWrap.appendChild(histBtn);
        actionsWrap.appendChild(delBtn);
        actionsTd.appendChild(actionsWrap);
        tr.appendChild(actionsTd);

        if (isMyTeam) {
            (function (n) {
                editBtn.addEventListener('click', function () { openEditEditor(n); });
                delBtn.addEventListener('click',  function () { confirmDelete(n); });
            }(name));
        }

        (function (n) {
            histBtn.addEventListener('click', function () { openHistory(n); });
        }(name));

        tbody.appendChild(tr);
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

    setScopeSelect('team');

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
    document.getElementById('mgr-status').value        = t.status        || 'Active';
    // A new version becomes effective today; pre-fill so the controlled-document
    // dates are never left blank (matches the background defaulting on save).
    var effPrefill = t.effectiveDate || today();
    document.getElementById('mgr-effective-date').value = effPrefill;
    document.getElementById('mgr-review-date').value   = t.reviewDueDate || addMonths(effPrefill, REVIEW_PERIOD_MONTHS);

    var docIdEl = document.getElementById('mgr-doc-id');
    docIdEl.value    = t.documentId || t.id || '';
    docIdEl.readOnly = true;            // Salesforce-managed identifier

    // teamCode present = tagged to a team (the admin's own); empty = Global.
    setScopeSelect(t.teamCode ? 'team' : 'global');

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
    var teamScope    = (document.getElementById('mgr-scope') || {}).value   || 'team';

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
            teamScope:    teamScope
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
            teamScope:    teamScope,
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

    document.getElementById('mgr-history-loading').style.display     = '';
    document.getElementById('mgr-history-unavailable').style.display = 'none';
    document.getElementById('mgr-history-empty').style.display       = 'none';
    document.getElementById('mgr-history-table-wrap').style.display  = 'none';
    document.getElementById('mgr-diff-panel').style.display          = 'none';

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
            return;
        }

        renderHistoryTable(name, versions, t);
        document.getElementById('mgr-history-table-wrap').style.display = '';
    });
}

function renderHistoryTable(name, versions, currentTemplate) {
    var tbody = document.getElementById('mgr-history-rows');
    tbody.innerHTML = '';

    versions.forEach(function (v) {
        var tr = document.createElement('tr');

        var verTd = document.createElement('td');
        verTd.textContent      = v.VersionLabel__c ? 'v' + v.VersionLabel__c : '—';
        verTd.style.fontFamily = "'Menlo','Consolas',monospace";
        verTd.style.fontSize   = '12px';
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
                showDiff(archivedVersion, archivedContent, currentTemplate.content, currentTemplate.versionLabel);
            });
        }(v.Content__c || '', v.VersionLabel__c || '?'));

        tbody.appendChild(tr);
    });
}

function showDiff(fromVersion, fromContent, toContent, toVersion) {
    var oldLines = (fromContent || '').split('\n');
    var newLines = (toContent   || '').split('\n');
    var diff     = computeDiff(oldLines, newLines);

    var added   = diff.filter(function (d) { return d.type === 'added';   }).length;
    var removed = diff.filter(function (d) { return d.type === 'removed'; }).length;

    document.getElementById('mgr-diff-title').textContent =
        'Changes from v' + fromVersion + ' → current (v' + (toVersion || '?') + ')';
    document.getElementById('mgr-diff-stats').textContent =
        '+' + added + ' line' + (added !== 1 ? 's' : '') + ' added,  ' +
        removed + ' line' + (removed !== 1 ? 's' : '') + ' removed';

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

// Set the editor's Scope dropdown and label the "team" option with the admin's
// actual team. If the admin has no team, only Global is meaningful.
function setScopeSelect(scope) {
    var sel = document.getElementById('mgr-scope');
    if (!sel) return;
    var teamOpt = sel.querySelector('option[value="team"]');
    if (teamOpt) {
        teamOpt.textContent = currentUser.teamName ? ('My team (' + currentUser.teamName + ')') : 'My team';
        teamOpt.disabled = !currentUser.teamId;
    }
    sel.value = (scope === 'global' || !currentUser.teamId) ? 'global' : 'team';
}

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
