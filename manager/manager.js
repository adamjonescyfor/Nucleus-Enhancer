// ==================================================
// CYFOR Template Manager — Page Logic
// Communicates with background.js via chrome.runtime.sendMessage.
// Only accessible to users with isTemplateAdmin === true.
// ==================================================

var currentEditId  = null;  // null = creating new, string = updating existing
var allTemplates   = {};    // name → { id, content, category, teamCode }
var currentUser    = {};    // sfOAuthUser with team + admin fields

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btn-back').addEventListener('click', function () {
        window.close();
    });
    document.getElementById('btn-new-template').addEventListener('click', openNewEditor);
    document.getElementById('btn-editor-save').addEventListener('click', saveTemplate);
    document.getElementById('btn-editor-cancel').addEventListener('click', closeEditor);

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
                ' and shared global templates. You can edit and delete your team\'s templates. Global templates (shared across all teams) are read-only here.';
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

    var names     = Object.keys(allTemplates).sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    var teamCode  = currentUser.teamCode || null;

    if (!names.length) {
        if (emptyEl)  emptyEl.style.display  = '';
        if (tableEl)  tableEl.style.display  = 'none';
        return;
    }

    if (emptyEl)  emptyEl.style.display  = 'none';
    if (tableEl)  tableEl.style.display  = '';

    names.forEach(function (name) {
        var t         = allTemplates[name];
        var isMyTeam  = teamCode && t.teamCode === teamCode;
        var isGlobal  = !t.teamCode;
        var scopeLabel = isMyTeam ? (currentUser.teamName || 'Team') : 'Global';
        var scopeClass = isMyTeam ? 'mgr-scope-badge mgr-scope-badge--team' : 'mgr-scope-badge';

        var tr = document.createElement('tr');

        var nameTd = document.createElement('td');
        nameTd.textContent = name;

        var catTd = document.createElement('td');
        catTd.textContent = t.category || '—';

        var scopeTd = document.createElement('td');
        var badge = document.createElement('span');
        badge.className   = scopeClass;
        badge.textContent = scopeLabel;
        scopeTd.appendChild(badge);

        var actionsTd = document.createElement('td');
        actionsTd.className = 'mgr-col-actions';
        var actionsWrap = document.createElement('div');
        actionsWrap.className = 'mgr-col-actions-cell';

        var editBtn = document.createElement('button');
        editBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
        editBtn.textContent = 'Edit';
        editBtn.disabled    = !isMyTeam;
        editBtn.setAttribute('aria-label', 'Edit ' + name);

        var delBtn = document.createElement('button');
        delBtn.className   = 'mgr-btn mgr-btn-danger mgr-btn-sm';
        delBtn.textContent = 'Delete';
        delBtn.disabled    = !isMyTeam;
        delBtn.setAttribute('aria-label', 'Delete ' + name);

        if (isMyTeam) {
            (function (n) {
                editBtn.addEventListener('click', function () { openEditEditor(n); });
                delBtn.addEventListener('click',  function () { confirmDelete(n); });
            }(name));
        }

        actionsWrap.appendChild(editBtn);
        actionsWrap.appendChild(delBtn);
        actionsTd.appendChild(actionsWrap);

        tr.appendChild(nameTd);
        tr.appendChild(catTd);
        tr.appendChild(scopeTd);
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    });
}

// ── Editor ────────────────────────────────────────────────────────────────────

function openNewEditor() {
    currentEditId = null;
    document.getElementById('mgr-editor-heading').textContent = 'New Template';
    document.getElementById('mgr-name').value     = '';
    document.getElementById('mgr-category').value = '';
    document.getElementById('mgr-content').value  = '';
    setEditorStatus('', '');
    showState('editor');
    document.getElementById('mgr-name').focus();
}

function openEditEditor(name) {
    var t = allTemplates[name];
    if (!t) return;
    currentEditId = t.id;
    document.getElementById('mgr-editor-heading').textContent = 'Edit: ' + name;
    document.getElementById('mgr-name').value     = name;
    document.getElementById('mgr-category').value = t.category || '';
    document.getElementById('mgr-content').value  = t.content  || '';
    setEditorStatus('', '');
    showState('editor');
    document.getElementById('mgr-name').focus();
}

function closeEditor() {
    currentEditId = null;
    showState('list');
}

function saveTemplate() {
    var name     = (document.getElementById('mgr-name').value     || '').trim();
    var category = (document.getElementById('mgr-category').value || '').trim();
    var content  =  document.getElementById('mgr-content').value;

    if (!name)    { setEditorStatus('Name is required.', 'error'); return; }
    if (!content.trim()) { setEditorStatus('Content is required.', 'error'); return; }

    var saveBtn = document.getElementById('btn-editor-save');
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';
    setEditorStatus('', '');

    var action, payload;
    if (currentEditId) {
        action  = 'sfTemplates.update';
        payload = { id: currentEditId, name: name, content: content, category: category };
    } else {
        action  = 'sfTemplates.create';
        payload = { name: name, content: content, category: category };
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

    if (!window.confirm('Delete "' + name + '"?\n\nThis permanently removes the template from Salesforce. Team members will no longer see it after their next sync.')) {
        return;
    }

    chrome.runtime.sendMessage({ action: 'sfTemplates.delete', payload: { id: t.id } }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok) {
            var err = (response && response.error) || 'Delete failed';
            window.alert('Could not delete "' + name + '": ' + err);
            return;
        }
        loadTemplates();
    });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function showState(state) {
    var panels = {
        'loading':       'mgr-loading',
        'not-connected': 'mgr-not-connected',
        'not-admin':     'mgr-not-admin',
        'list':          'mgr-list-panel',
        'editor':        'mgr-editor-panel'
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
