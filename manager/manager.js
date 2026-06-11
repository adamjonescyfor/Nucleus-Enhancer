// ==================================================
// CYFOR Template Manager — Page Logic
// Communicates with background.js via chrome.runtime.sendMessage.
// Only accessible to users with isTemplateAdmin === true.
// ==================================================

var currentEditId      = null;   // null = creating new, string = updating existing
var currentEditVersion = null;   // version label of the template being edited
var editorOriginalContent = ''; // content as opened — used to tell content vs metadata-only edits
var currentHistoryName = null;   // template name whose history is being viewed
var allTemplates       = {};     // name → { id, content, category, teamId, teamName, ...fields }
var currentUser        = {};     // sfOAuthUser
var allTeams           = [];     // [{ id, name, teamCode }] — for the "assign to any team" picker
var statusOptions      = [];     // status picklist values (from describe) or default lifecycle
var currentVersions    = [];     // archived versions for the template open in History
var currentHistoryTemplate = null; // the live template whose History is open
var readOnly           = false;  // non-admin "View Templates" mode (no create/edit/delete)

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btn-back').addEventListener('click', function () {
        chrome.tabs.getCurrent(function (tab) {
            if (tab) { chrome.tabs.remove(tab.id); } else { window.close(); }
        });
    });

    // Sidebar navigation
    document.querySelectorAll('.mgr-nav-item').forEach(function (item) {
        item.addEventListener('click', function () { setView(item.getAttribute('data-view')); });
    });

    document.getElementById('btn-new-template').addEventListener('click', openNewEditor);
    document.getElementById('btn-editor-save').addEventListener('click', saveTemplate);
    document.getElementById('btn-editor-cancel').addEventListener('click', closeEditor);

    // Only a CONTENT change creates a new version (matching the Salesforce Flow).
    // Re-evaluate the version/reason UI live as the body or bump option changes.
    var contentEl = document.getElementById('mgr-content');
    if (contentEl) contentEl.addEventListener('input', updateEditorVersionUI);
    document.querySelectorAll('input[name="version-bump"]').forEach(function (r) {
        r.addEventListener('change', updateEditorVersionUI);
    });
    document.getElementById('btn-history-back').addEventListener('click', function () { setView('templates'); });
    document.getElementById('btn-usage-clear').addEventListener('click', clearUsage);
    document.getElementById('btn-settings-refresh').addEventListener('click', function () { loadTemplates(); });
    document.getElementById('btn-diff-close').addEventListener('click', function () {
        document.getElementById('mgr-diff-panel').style.display = 'none';
    });

    // Live template filter
    var filterEl = document.getElementById('mgr-filter');
    if (filterEl) filterEl.addEventListener('input', renderTemplateList);

    // History search / date filter (4b)
    ['mgr-history-search', 'mgr-history-start', 'mgr-history-end'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', applyHistoryFilter);
    });
    document.getElementById('btn-history-export').addEventListener('click', exportHistoryCsv);

    // Compare any two versions (4c)
    document.getElementById('btn-compare-run').addEventListener('click', runCompare);

    // Custom dropdowns (shared component) — native <select> option lists are
    // unstyleable on Chrome/Linux, so every select is rendered as a themed listbox.
    ['mgr-status', 'mgr-scope', 'mgr-compare-from', 'mgr-compare-to'].forEach(function (id) {
        CyforSelect.enhance(document.getElementById(id));
    });

    loadTemplates();
});

// Thin wrapper around the shared component (window.CyforSelect) so the rest of
// the manager can refresh a custom dropdown's label after changing its <select>.
function syncCustomSelect(id) { if (window.CyforSelect) CyforSelect.sync(id); }

// ── View / sidebar navigation ──────────────────────────────────────────────────

var VIEW_META = {
    templates: { panel: 'mgr-list-panel',     title: 'Templates', sub: '' },
    reviews:   { panel: 'mgr-reviews-panel',  title: 'Reviews',   sub: 'Documents overdue or due for review soon.' },
    usage:     { panel: 'mgr-usage-panel',    title: 'Usage',     sub: 'Where templates have been inserted on this device.' },
    settings:  { panel: 'mgr-settings-panel', title: 'Settings',  sub: 'Connection and Salesforce details.' }
};

// Switch the main nav view (Templates / Reviews / Usage / Settings). Editor and
// History are separate overlay states reached from within Templates.
function setView(view) {
    if (!VIEW_META[view]) view = 'templates';
    if (readOnly && view === 'reviews') view = 'templates'; // admin-only dataset
    document.querySelectorAll('.mgr-nav-item').forEach(function (item) {
        item.classList.toggle('is-active', item.getAttribute('data-view') === view);
    });
    if (view === 'usage')    openUsage();
    if (view === 'settings') renderSettings();
    if (view === 'reviews')  renderReviews();
    showState(view === 'templates' ? 'list' : view);
}

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
                // Not a template admin — fall back to the read-only viewer so
                // analysts can still see versions, review dates and history.
                loadReadOnly();
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
            loadReadOnly();
            return;
        }

        renderIdentity();
        document.getElementById('btn-new-template').disabled = false;

        var descEl = document.getElementById('mgr-list-desc');
        if (descEl) {
            descEl.textContent = 'Managing every team’s templates and shared global templates — '
                + 'create, edit, delete and re-assign any template to any team or Global.';
        }

        populateStatusOptions();
        renderStats();
        renderTemplateList();
        updateReviewBadge();
        setView('templates');

        loadTeams(); // non-blocking — populates the "assign to any team" picker
    });
}

// Read-only viewer for non-admins: their team's + global ACTIVE templates via the
// same non-gated, team-scoped sync the popup uses. View content + version history;
// no create/edit/delete and no direct Salesforce record links.
function loadReadOnly() {
    readOnly = true;
    VIEW_META.templates.sub = 'Read-only — templates are managed by your team’s template admins.';

    // Reviews is built from the all-teams admin dataset — hide it for members.
    var reviewsNav = document.querySelector('.mgr-nav-item[data-view="reviews"]');
    if (reviewsNav) reviewsNav.style.display = 'none';
    var newBtn = document.getElementById('btn-new-template');
    if (newBtn) newBtn.style.display = 'none';

    chrome.storage.local.get(['sfOAuthUser'], function (res) {
        currentUser = (res && res.sfOAuthUser) || {};
        chrome.runtime.sendMessage({ action: 'sfTemplates.sync', forceRefresh: false }, function (r) {
            if (chrome.runtime.lastError || !r || !r.ok) {
                showState('not-connected');
                return;
            }
            allTemplates = r.templates || {};
            renderIdentity();

            var descEl = document.getElementById('mgr-list-desc');
            if (descEl) {
                descEl.textContent = 'Your team’s active templates plus Global — view content, '
                    + 'versions and history. Contact a template admin to request changes.';
            }

            renderStats();
            renderTemplateList();
            setView('templates');
        });
    });
}

// Topbar identity chip (name + team + avatar initial).
function renderIdentity() {
    var box = document.getElementById('mgr-identity');
    if (!box) return;
    var name = currentUser.fullName || currentUser.username || currentUser.email || (readOnly ? 'Member' : 'Admin');
    document.getElementById('mgr-identity-name').textContent = name;
    document.getElementById('mgr-identity-team').textContent =
        (currentUser.teamName ? currentUser.teamName : (readOnly ? '—' : 'All teams'))
        + (readOnly ? ' · member' : ' · admin');
    var av = document.getElementById('mgr-identity-avatar');
    if (av) av.textContent = name.trim().charAt(0).toUpperCase();
    box.style.display = '';
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
    syncCustomSelect('mgr-status');
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
    syncCustomSelect('mgr-scope');
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

    var q = ((document.getElementById('mgr-filter') || {}).value || '').trim().toLowerCase();
    var names = Object.keys(allTemplates).filter(function (name) {
        if (!q) return true;
        var t = allTemplates[name];
        var hay = (name + ' ' + (t.category || '') + ' ' + (t.teamName || 'global') + ' ' + (t.status || '')).toLowerCase();
        return hay.indexOf(q) !== -1;
    }).sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    var teamCode = currentUser.teamCode || null;

    if (!names.length) {
        if (emptyEl) {
            emptyEl.style.display = '';
            emptyEl.innerHTML = q
                ? 'No templates match “' + escHtml(q) + '”.'
                : (readOnly
                    ? 'No templates are published for your team yet.'
                    : 'No templates yet. Click <strong>+ New Template</strong> to create one.');
        }
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
        // Number), otherwise the system record Id. Rendered as a link to the live
        // Salesforce record so admins can see the data is held in Salesforce.
        var docVal = t.documentId || t.id || '';
        var docTd = document.createElement('td');
        docTd.className = 'mgr-cell-docid';
        // Read-only mode shows the ID as plain text (no direct Salesforce links).
        var sfUrl = readOnly ? null : sfRecordUrl(t.id);
        if (docVal && sfUrl) {
            var a = document.createElement('a');
            a.className = 'mgr-doclink';
            a.href = sfUrl;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = docVal;
            a.title = 'Open in Salesforce — ' + docVal;
            docTd.appendChild(a);
        } else {
            docTd.textContent = docVal || '—';
            if (!docVal) docTd.style.color = 'var(--text-muted)';
        }
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

        // Scope — show the actual team name (or Global); highlight the user's own.
        // Read-only entries come from the team-scoped sync, which carries teamCode
        // (not teamName/teamId) — fall back accordingly.
        var scopeTd = document.createElement('td');
        var badge   = document.createElement('span');
        var teamVal = t.teamName || t.teamCode || null;
        badge.className   = (t.teamId || t.teamCode) ? 'mgr-scope-badge mgr-scope-badge--team' : 'mgr-scope-badge';
        if (isMyTeam) badge.className += ' mgr-scope-badge--own';
        badge.textContent = teamVal || 'Global';
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

        var histBtn = document.createElement('button');
        histBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
        histBtn.textContent = 'History';
        histBtn.setAttribute('aria-label', 'Version history for ' + name);

        if (readOnly) {
            // Members: view content + history, nothing destructive.
            var viewBtn = document.createElement('button');
            viewBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
            viewBtn.textContent = 'View';
            viewBtn.setAttribute('aria-label', 'View ' + name);
            actionsWrap.appendChild(viewBtn);
            actionsWrap.appendChild(histBtn);
            (function (n) {
                viewBtn.addEventListener('click', function () { openViewModal(n); });
                histBtn.addEventListener('click', function () { openHistory(n); });
            }(name));
        } else {
            // Admins can edit/clone/delete ANY team's + global templates (the
            // write paths are admin-gated in the background).
            var editBtn = document.createElement('button');
            editBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
            editBtn.textContent = 'Edit';
            editBtn.setAttribute('aria-label', 'Edit ' + name);

            var cloneBtn = document.createElement('button');
            cloneBtn.className   = 'mgr-btn mgr-btn-secondary mgr-btn-sm';
            cloneBtn.textContent = 'Clone';
            cloneBtn.setAttribute('aria-label', 'Clone ' + name + ' as a draft');
            cloneBtn.title = 'Create a new draft template from a copy of this one';

            var delBtn = document.createElement('button');
            delBtn.className   = 'mgr-btn mgr-btn-danger mgr-btn-sm';
            delBtn.textContent = 'Delete';
            delBtn.setAttribute('aria-label', 'Delete ' + name);

            actionsWrap.appendChild(editBtn);
            actionsWrap.appendChild(cloneBtn);
            actionsWrap.appendChild(histBtn);
            actionsWrap.appendChild(delBtn);
            (function (n) {
                editBtn.addEventListener('click',  function () { openEditEditor(n); });
                cloneBtn.addEventListener('click', function () { openCloneEditor(n); });
                delBtn.addEventListener('click',   function () { confirmDelete(n); });
                histBtn.addEventListener('click',  function () { openHistory(n); });
            }(name));
        }

        actionsTd.appendChild(actionsWrap);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
    });
}

// ── Stat hero (Templates view) ────────────────────────────────────────────────
// Compute the headline counts once; reused by the hero, the Reviews view and the
// sidebar badge.
function reviewSnapshot() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var active = 0, drafts = 0, teams = {};
    var overdue = [], due30 = [], due60 = [];
    Object.keys(allTemplates).forEach(function (name) {
        var t = allTemplates[name];
        var status = (t.status || '').toLowerCase();
        if (status === 'active') active++;
        if (status === 'draft') drafts++;
        if (t.teamId) teams[t.teamId] = true;
        if (!t.reviewDueDate || status === 'superseded' || status === 'retired') return;
        var due = new Date(t.reviewDueDate + 'T00:00:00');
        if (isNaN(due.getTime())) return;
        due.setHours(0, 0, 0, 0);
        var days = Math.round((due - today) / 86400000);
        var item = { name: name, team: t.teamName || 'Global', due: t.reviewDueDate, days: days };
        if (days < 0) overdue.push(item);
        else if (days <= 30) due30.push(item);
        else if (days <= 60) due60.push(item);
    });
    var byDays = function (a, b) { return a.days - b.days; };
    overdue.sort(byDays); due30.sort(byDays); due60.sort(byDays);
    return {
        total: Object.keys(allTemplates).length, active: active, drafts: drafts,
        teamCount: Object.keys(teams).length, overdue: overdue, due30: due30, due60: due60
    };
}

function renderStats() {
    var el = document.getElementById('mgr-stats');
    if (!el) return;
    var s = reviewSnapshot();
    var cards = [
        { label: 'Templates', value: s.total,           tone: '' },
        { label: 'Active',    value: s.active,           tone: 'ok' },
        { label: 'Due ≤30d',  value: s.due30.length,     tone: s.due30.length ? 'warn' : '' },
        { label: 'Overdue',   value: s.overdue.length,   tone: s.overdue.length ? 'bad' : '' },
        { label: 'Teams',     value: s.teamCount,        tone: '' }
    ];
    el.innerHTML = '';
    cards.forEach(function (c) {
        var card = document.createElement('div');
        card.className = 'mgr-stat' + (c.tone ? ' mgr-stat--' + c.tone : '');
        var v = document.createElement('div'); v.className = 'mgr-stat-value'; v.textContent = c.value;
        var l = document.createElement('div'); l.className = 'mgr-stat-label'; l.textContent = c.label;
        card.appendChild(v); card.appendChild(l);
        if (c.label === 'Overdue' || c.label === 'Due ≤30d') {
            card.setAttribute('role', 'button');
            card.tabIndex = 0;
            card.addEventListener('click', function () { setView('reviews'); });
        }
        el.appendChild(card);
    });

    updateSideStats();
}

// Compact at-a-glance counts in the sidebar (fills the space under the nav and
// keeps the headline numbers visible from every view, not just Templates).
function updateSideStats() {
    var box = document.getElementById('mgr-side-stats');
    if (!box) return;
    var s = reviewSnapshot();
    var rows = [
        ['Active templates', s.active, ''],
        ['Due ≤30 days',     s.due30.length,   s.due30.length ? 'warn' : ''],
        ['Overdue',          s.overdue.length, s.overdue.length ? 'bad' : '']
    ];
    if (!readOnly) rows.push(['Teams', s.teamCount, '']);

    box.querySelectorAll('.mgr-side-stat').forEach(function (n) { n.remove(); });
    rows.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'mgr-side-stat' + (r[2] ? ' mgr-side-stat--' + r[2] : '');
        var l = document.createElement('span'); l.className = 'mgr-side-stat-label'; l.textContent = r[0];
        var v = document.createElement('span'); v.className = 'mgr-side-stat-value'; v.textContent = r[1];
        row.appendChild(l); row.appendChild(v);
        box.appendChild(row);
    });
    box.style.display = '';
}

function updateReviewBadge() {
    var s = reviewSnapshot();
    var n = s.overdue.length + s.due30.length;
    var badge = document.getElementById('mgr-nav-review-badge');
    if (!badge) return;
    badge.textContent = n;
    badge.style.display = n ? '' : 'none';
    badge.classList.toggle('mgr-nav-badge--bad', s.overdue.length > 0);
}

// ── Reviews view (4a) ─────────────────────────────────────────────────────────
function renderReviews() {
    var body  = document.getElementById('mgr-reviews-body');
    var empty = document.getElementById('mgr-reviews-empty');
    if (!body || !empty) return;
    var s = reviewSnapshot();
    var groups = [
        { key: 'overdue', title: 'Overdue',        items: s.overdue, tone: 'bad'  },
        { key: 'due30',   title: 'Due within 30 days', items: s.due30, tone: 'warn' },
        { key: 'due60',   title: 'Due within 60 days', items: s.due60, tone: ''    }
    ];
    var anything = s.overdue.length + s.due30.length + s.due60.length;
    body.innerHTML = '';
    empty.style.display = anything ? 'none' : '';

    groups.forEach(function (g) {
        if (!g.items.length) return;
        var group = document.createElement('div');
        group.className = 'mgr-review-group';
        var h = document.createElement('div');
        h.className = 'mgr-review-group-head mgr-review-group-head--' + g.tone;
        h.innerHTML = '<span>' + g.title + '</span><span class="mgr-review-group-count">' + g.items.length + '</span>';
        group.appendChild(h);

        g.items.forEach(function (i) {
            var row = document.createElement('button');
            row.type = 'button';
            row.className = 'mgr-review-item mgr-review-item--' + g.tone;
            var when = i.days < 0 ? (Math.abs(i.days) + 'd overdue') : ('in ' + i.days + 'd');
            var nameSpan = document.createElement('span');
            nameSpan.className = 'mgr-review-item-name'; nameSpan.textContent = i.name;
            var teamSpan = document.createElement('span');
            teamSpan.className = 'mgr-review-item-team'; teamSpan.textContent = i.team;
            var dueSpan = document.createElement('span');
            dueSpan.className = 'mgr-review-item-due'; dueSpan.textContent = formatDate(i.due) + ' · ' + when;
            row.appendChild(nameSpan); row.appendChild(teamSpan); row.appendChild(dueSpan);
            row.addEventListener('click', function () { openEditEditor(i.name); });
            group.appendChild(row);
        });
        body.appendChild(group);
    });
}

// ── Settings view ─────────────────────────────────────────────────────────────
function renderSettings() {
    var dl = document.getElementById('mgr-settings-info');
    if (!dl) return;
    var rows = [
        ['Signed in as', currentUser.fullName || currentUser.username || '—'],
        ['Email',        currentUser.email || '—'],
        ['Team',         currentUser.teamName || 'No team (Global only)'],
        ['Role',         currentUser.isTemplateAdmin ? 'Template admin' : 'Member'],
        ['Templates',    String(Object.keys(allTemplates).length)],
        ['Status values', (statusOptions || []).join(', ') || '—']
    ];
    dl.innerHTML = '';
    rows.forEach(function (r) {
        var dt = document.createElement('dt'); dt.textContent = r[0];
        var dd = document.createElement('dd'); dd.textContent = r[1];
        dl.appendChild(dt); dl.appendChild(dd);
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

    var newSfLink = document.getElementById('mgr-editor-sf-link');
    if (newSfLink) newSfLink.style.display = 'none';

    // Default new templates to the admin's own team (or Global if none).
    ensureTeamOption(currentUser.teamId, currentUser.teamName);
    document.getElementById('mgr-scope').value = currentUser.teamId || '';

    document.getElementById('mgr-version-display').textContent = 'v1.0';
    document.getElementById('mgr-version-bump').style.display  = 'none';

    var hintEl = document.getElementById('mgr-change-reason-hint');
    if (hintEl) hintEl.textContent = '(describe the purpose of this template)';
    // A new template always needs a reason — make sure the asterisk shows even if
    // a previous metadata-only edit had hidden it.
    var newReq = document.getElementById('mgr-change-reason-req');
    if (newReq) newReq.style.display = '';

    syncCustomSelect('mgr-status');
    syncCustomSelect('mgr-scope');
    setEditorStatus('', '');
    showState('editor');
    document.getElementById('mgr-name').focus();
}

function openEditEditor(name) {
    var t = allTemplates[name];
    if (!t) return;

    currentEditId      = t.id;
    currentEditVersion = t.versionLabel || '1.0';
    editorOriginalContent = t.content || '';

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

    var editSfLink = document.getElementById('mgr-editor-sf-link');
    var editSfUrl  = sfRecordUrl(t.id);
    if (editSfLink) {
        if (editSfUrl) { editSfLink.href = editSfUrl; editSfLink.style.display = ''; }
        else editSfLink.style.display = 'none';
    }

    // Pre-select the template's current team (empty value = Global).
    ensureTeamOption(t.teamId, t.teamName);
    document.getElementById('mgr-scope').value = t.teamId || '';

    // The reason hint is CONSTANT (it states the rule once); only the asterisk and
    // the version preview change as you edit — updateEditorVersionUI() keeps those live.
    document.getElementById('mgr-version-display').textContent = 'v' + currentEditVersion;
    var editHint = document.getElementById('mgr-change-reason-hint');
    if (editHint) editHint.textContent = '(required only when you change the content — status, team & date edits don’t create a new version)';
    updateEditorVersionUI();

    syncCustomSelect('mgr-status');
    syncCustomSelect('mgr-scope');
    setEditorStatus('', '');
    showState('editor');
    document.getElementById('mgr-name').focus();
}

// Reflect whether the open edit changes CONTENT (→ new version + reason required)
// or only metadata (status/team/category/dates → no version bump, reason optional).
// No-op in create mode (a new template always starts a v1.0 with a reason).
function updateEditorVersionUI() {
    if (!currentEditId) return;
    var changed     = document.getElementById('mgr-content').value !== editorOriginalContent;
    var bumpWrap    = document.getElementById('mgr-version-bump');
    var versionDisp = document.getElementById('mgr-version-display');
    var reasonReq   = document.getElementById('mgr-change-reason-req');

    // The hint text stays constant (set in openEditEditor). Only the required
    // asterisk and the version preview reflect whether the content has changed.
    bumpWrap.style.display = changed ? '' : 'none';
    if (reasonReq) reasonReq.style.display = changed ? '' : 'none';

    if (changed) {
        var bumpInput = document.querySelector('input[name="version-bump"]:checked');
        var newV = bumpVersion(currentEditVersion, bumpInput ? bumpInput.value : 'minor');
        versionDisp.textContent = 'v' + currentEditVersion + ' → v' + newV;
    } else {
        versionDisp.textContent = 'v' + currentEditVersion;
    }
}

function closeEditor() {
    currentEditId      = null;
    currentEditVersion = null;
    setView('templates');
}

// Read-only template viewer (non-admin mode) — content + meta in a modal.
function openViewModal(name) {
    var t = allTemplates[name];
    if (!t) return;
    var meta = [];
    if (t.versionLabel)  meta.push('v' + t.versionLabel);
    if (t.category)      meta.push(t.category);
    meta.push(t.teamName || t.teamCode || 'Global');
    if (t.reviewDueDate) meta.push('Review due ' + formatDate(t.reviewDueDate));
    mgrModal({
        title:        name,
        body:         meta.join('  ·  '),
        preBody:      t.content || '(empty)',
        confirmLabel: 'Close',
        alert:        true
    });
}

// Clone an existing template into the new-template editor as a Draft (admins).
function openCloneEditor(name) {
    var t = allTemplates[name];
    if (!t) return;

    openNewEditor(); // resets all fields + create-mode state, then we prefill

    // De-dupe the copy's name against existing templates.
    var newName = name + ' (Copy)';
    var n = 2;
    while (allTemplates[newName]) { newName = name + ' (Copy ' + n + ')'; n++; }

    document.getElementById('mgr-editor-heading').textContent = 'New Template — cloned from “' + name + '”';
    document.getElementById('mgr-name').value          = newName;
    document.getElementById('mgr-category').value      = t.category || '';
    document.getElementById('mgr-content').value       = t.content  || '';
    document.getElementById('mgr-change-reason').value =
        'Cloned from "' + name + '"' + (t.versionLabel ? ' v' + t.versionLabel : '');
    // Drafts stay out of analysts' sync until an admin activates them.
    ensureStatusOption('Draft');
    document.getElementById('mgr-status').value = 'Draft';
    ensureTeamOption(t.teamId, t.teamName);
    document.getElementById('mgr-scope').value  = t.teamId || '';
    syncCustomSelect('mgr-status');
    syncCustomSelect('mgr-scope');
    document.getElementById('mgr-name').focus();
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

    // A reason (and version bump) is only required when CONTENT changes — that's
    // what the Salesforce Flow snapshots. Metadata-only edits (status/team/dates)
    // save without a bump or reason. A brand-new template always needs a reason.
    var isEdit         = !!currentEditId;
    var contentChanged = isEdit ? (content !== editorOriginalContent) : true;
    if (!changeReason && (!isEdit || contentChanged)) {
        setEditorStatus(isEdit
            ? 'Reason is required when the content changes.'
            : 'Reason is required for the audit trail.', 'error');
        return;
    }

    var saveBtn = document.getElementById('btn-editor-save');
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';
    setEditorStatus('', '');

    var action, payload;

    if (currentEditId) {
        // Bump the version ONLY when content changed; a metadata-only edit keeps
        // the current version (so the Flow doesn't snapshot and history stays clean).
        var newVersion = currentEditVersion;
        if (contentChanged) {
            var bumpInput = document.querySelector('input[name="version-bump"]:checked');
            newVersion = bumpVersion(currentEditVersion, bumpInput ? bumpInput.value : 'minor');
        }

        action  = 'sfTemplates.update';
        payload = {
            id:           currentEditId,
            name:         name,
            content:      content,
            category:     category,
            versionLabel: newVersion,
            status:       status,
            changeReason: contentChanged ? changeReason : '',
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

        // Optional monospace, scrollable content block (template viewing).
        if (opts.preBody) {
            var pre = document.createElement('pre');
            pre.className = 'mgr-modal-pre';
            pre.textContent = opts.preBody;
            dialog.appendChild(pre);
            dialog.classList.add('mgr-modal--wide');
        }

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
        body: 'Delete "' + name + '" and its version history from Salesforce? '
            + 'Team members lose it on their next sync. Deleted records sit in the Salesforce '
            + 'Recycle Bin for ~15 days, then they’re gone for good.\n\n'
            + 'Tip: if this template was ever genuinely in use, set its Status to Retired instead '
            + '(Edit → Status) — that removes it from analysts while keeping the full audit trail.',
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
    syncCustomSelect('mgr-compare-from');
    syncCustomSelect('mgr-compare-to');
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

// Link to the live Salesforce record for a template ('' if instanceUrl unknown).
function sfRecordUrl(id) {
    var base = (currentUser.instanceUrl || '').replace(/\/$/, '');
    if (!base || !id) return '';
    return base + '/lightning/r/NucleusTemplate__c/' + id + '/view';
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
    var descEl   = document.getElementById('mgr-usage-desc');
    var clearBtn = document.getElementById('btn-usage-clear');

    // Admins get the ORG-WIDE log automatically once the Salesforce
    // NucleusTemplateUsage__c object exists (docs/salesforce-usage-object.md);
    // until then — and always for members — fall back to the local device log.
    if (!readOnly) {
        chrome.runtime.sendMessage({ action: 'usage.listOrg' }, function (r) {
            if (!chrome.runtime.lastError && r && r.ok && r.available) {
                if (descEl) {
                    descEl.textContent = 'Org-wide template insertions (newest first, up to 200) — '
                        + 'recorded in Salesforce from every connected device.';
                }
                if (clearBtn) clearBtn.style.display = 'none'; // org records aren't clearable here
                renderUsage(r.entries || []);
                return;
            }
            loadLocalUsage(descEl, clearBtn);
        });
    } else {
        loadLocalUsage(descEl, clearBtn);
    }
}

function loadLocalUsage(descEl, clearBtn) {
    if (descEl) {
        descEl.textContent = 'Local template-insertion log for this device (most recent first) — '
            + 'stored on this machine only, not synced across devices.';
    }
    if (clearBtn) clearBtn.style.display = '';
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
        // Only link to genuine RECORD pages. Inserts made in a "New …" modal carry
        // the creation-page URL — opening that later just spawns a blank form.
        var linkable = safeUrl && /\/lightning\/r\//.test(safeUrl);
        var rec = e.recordId
            ? (linkable
                ? '<a href="' + escHtml(safeUrl) + '" target="_blank" rel="noopener">' + escHtml(e.recordId) + '</a>'
                : escHtml(e.recordId))
            : (linkable
                ? '<a href="' + escHtml(safeUrl) + '" target="_blank" rel="noopener">Open</a>'
                : '—');
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
        'list':          'mgr-list-panel',
        'reviews':       'mgr-reviews-panel',
        'settings':      'mgr-settings-panel',
        'editor':        'mgr-editor-panel',
        'history':       'mgr-history-panel',
        'usage':         'mgr-usage-panel'
    };
    Object.keys(panels).forEach(function (key) {
        var el = document.getElementById(panels[key]);
        if (el) el.style.display = (key === state) ? '' : 'none';
    });

    // Topbar title/subtitle: derive from the nav view; editor/history set their own.
    var meta = { 'list': VIEW_META.templates, 'reviews': VIEW_META.reviews,
                 'usage': VIEW_META.usage, 'settings': VIEW_META.settings }[state];
    var titleEl = document.getElementById('mgr-view-title');
    var subEl   = document.getElementById('mgr-view-sub');
    if (meta && titleEl) {
        titleEl.textContent = meta.title;
        if (subEl) subEl.textContent = meta.sub;
    } else if (titleEl && state === 'editor') {
        titleEl.textContent = currentEditId ? 'Edit template' : 'New template';
        if (subEl) subEl.textContent = '';
    } else if (titleEl && state === 'history') {
        titleEl.textContent = 'Version history';
        if (subEl) subEl.textContent = '';
    }

    // "+ New Template" only belongs on the Templates view (and never in read-only mode).
    var newBtn = document.getElementById('btn-new-template');
    if (newBtn) newBtn.style.display = (state === 'list' && !readOnly) ? '' : 'none';
}

function setEditorStatus(msg, type) {
    var el = document.getElementById('mgr-editor-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'mgr-status-msg' + (type ? ' status-' + type : '');
}
