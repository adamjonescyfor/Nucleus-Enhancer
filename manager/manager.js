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

var TEAM_PREFIX = {
    digital_forensics: 'DF',
    cell_site:         'CS',
    ediscovery:        'ED',
    cyber:             'CY'
};

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

        // Doc ID
        var docTd = document.createElement('td');
        docTd.textContent  = t.documentId || '—';
        docTd.style.color  = t.documentId ? '' : 'var(--text-muted)';
        docTd.style.fontFamily = t.documentId ? "'Menlo','Consolas',monospace" : '';
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
    document.getElementById('mgr-review-date').value   = '';

    var docIdEl = document.getElementById('mgr-doc-id');
    docIdEl.value    = generateDocId();
    docIdEl.readOnly = false;

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
    document.getElementById('mgr-effective-date').value = t.effectiveDate || '';
    document.getElementById('mgr-review-date').value   = t.reviewDueDate  || '';

    var docIdEl = document.getElementById('mgr-doc-id');
    docIdEl.value    = t.documentId || '';
    docIdEl.readOnly = !!t.documentId;

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
            reviewDueDate: reviewDueDate
        };
    } else {
        action  = 'sfTemplates.create';
        payload = {
            name:         name,
            content:      content,
            category:     category,
            versionLabel: '1.0',
            documentId:   (document.getElementById('mgr-doc-id').value || '').trim(),
            status:       status,
            changeReason: changeReason,
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

function confirmDelete(name) {
    var t = allTemplates[name];
    if (!t || !t.id) return;

    if (!window.confirm(
        'Delete "' + name + '"?\n\n' +
        'This permanently removes the template from Salesforce. ' +
        'Team members will no longer see it after their next sync. ' +
        'Version history records will also be deleted.'
    )) return;

    chrome.runtime.sendMessage({ action: 'sfTemplates.delete', payload: { id: t.id } }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok) {
            var err = (response && response.error) || 'Delete failed';
            window.alert('Could not delete "' + name + '": ' + err);
            return;
        }
        loadTemplates();
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

function generateDocId() {
    var teamCode = currentUser.teamCode || '';
    var prefix   = (TEAM_PREFIX[teamCode] || teamCode.toUpperCase().slice(0, 2) || 'XX') + '-TPL-';
    var max      = 0;
    Object.values(allTemplates).forEach(function (t) {
        if (t.documentId && t.documentId.indexOf(prefix) === 0) {
            var num = parseInt(t.documentId.slice(prefix.length), 10);
            if (!isNaN(num) && num > max) max = num;
        }
    });
    return prefix + String(max + 1).padStart(3, '0');
}

function today() {
    return new Date().toISOString().slice(0, 10);
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

function showState(state) {
    var panels = {
        'loading':       'mgr-loading',
        'not-connected': 'mgr-not-connected',
        'not-admin':     'mgr-not-admin',
        'list':          'mgr-list-panel',
        'editor':        'mgr-editor-panel',
        'history':       'mgr-history-panel'
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
