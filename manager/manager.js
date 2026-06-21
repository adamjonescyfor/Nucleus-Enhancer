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
var bulkSelected       = new Set(); // template names ticked for bulk actions (admins)
var multiTeamEnabled   = false;  // true when the Salesforce multi-select team field exists
var editorTeamCodes    = [];     // team codes ticked in the editor's multi-team picker
var contentMaxLen      = 0;      // real max length of the Content field (from describe)
var acksAvailable      = false;  // read-acknowledgement feature live? (NucleusTemplateAck__c exists)
var myAcks             = {};     // "templateId|version" the current user has acknowledged

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
    if (contentEl) contentEl.addEventListener('input', function () { updateEditorVersionUI(); updateContentCount(); });
    setupContentToolbar();
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

    // Bulk actions (admins)
    var checkAll = document.getElementById('mgr-check-all');
    if (checkAll) checkAll.addEventListener('change', function () {
        visibleTemplateNames().forEach(function (n) {
            if (checkAll.checked) bulkSelected.add(n); else bulkSelected.delete(n);
        });
        renderTemplateList();
    });
    document.getElementById('btn-bulk-clear').addEventListener('click', function () {
        bulkSelected.clear();
        renderTemplateList();
    });
    document.getElementById('btn-bulk-status').addEventListener('click', function () { bulkApply('status'); });
    document.getElementById('btn-bulk-team').addEventListener('click', function () { bulkApply('team'); });
    document.getElementById('btn-bulk-delete').addEventListener('click', bulkDelete);
    ['mgr-bulk-status', 'mgr-bulk-team'].forEach(function (id) {
        CyforSelect.enhance(document.getElementById(id));
    });

    // Usage filters + sortable columns
    ['mgr-usage-template', 'mgr-usage-user'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { CyforSelect.enhance(el); el.addEventListener('change', renderUsage); }
    });
    var usageSearch = document.getElementById('mgr-usage-search');
    if (usageSearch) usageSearch.addEventListener('input', renderUsage);
    var usageClearF = document.getElementById('btn-usage-filter-clear');
    if (usageClearF) usageClearF.addEventListener('click', function () {
        var s = document.getElementById('mgr-usage-search'); if (s) s.value = '';
        ['mgr-usage-template', 'mgr-usage-user'].forEach(function (id) {
            var el = document.getElementById(id); if (el) { el.value = ''; syncCustomSelect(id); }
        });
        renderUsage();
    });
    document.querySelectorAll('.mgr-usage-th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () { setUsageSort(th.getAttribute('data-sort')); });
    });

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
    usage:     { panel: 'mgr-usage-panel',    title: 'Usage',     sub: 'Which templates are being inserted, and where.' },
    acks:      { panel: 'mgr-acks-panel',     title: 'Acknowledgements', sub: 'Who has read & understood each controlled template — and who is outstanding.' },
    settings:  { panel: 'mgr-settings-panel', title: 'About',     sub: 'Who you’re signed in as, the Salesforce connection, and how this works.' }
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
    if (view === 'acks')     renderAckMatrix();
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
        multiTeamEnabled = !!(response.fields && response.fields.teamsMulti);
        contentMaxLen    = (response.fields && response.fields.contentMaxLength) || 0;
        applyTeamControlMode();
        bulkSelected.clear(); // stale names mustn't survive a reload
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

        loadMyAcks(function () { renderAckBanner(); renderTemplateList(); }); // QMS acks (dormant if unconfigured)
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
            loadMyAcks(function () { renderAckBanner(); renderTemplateList(); }); // QMS acks (dormant if unconfigured)
        });
    });
}

// Topbar identity chip (name + team + avatar initial).
function renderIdentity() {
    var box = document.getElementById('mgr-identity');
    if (!box) return;
    var name = currentUser.fullName || currentUser.username || currentUser.email || (readOnly ? 'Member' : 'Admin');
    document.getElementById('mgr-identity-name').textContent = name;
    // List every team the user belongs to (multi-team membership), falling back to
    // the single primary team for an older session record.
    var idTeams = (currentUser.teams && currentUser.teams.length)
        ? currentUser.teams.map(function (t) { return t.teamName; }).filter(Boolean)
        : (currentUser.teamName ? [currentUser.teamName] : []);
    document.getElementById('mgr-identity-team').textContent =
        (idTeams.length ? idTeams.join(' · ') : (readOnly ? '—' : 'All teams'))
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
    populateBulkSelectors();
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
    buildTeamCheckboxes();
    populateBulkSelectors();
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

// ── Multi-team picker (active only when the Salesforce multi-team field exists) ──

// Show the single-team dropdown or the multi-team checkbox list to match the org.
function applyTeamControlMode() {
    var single = document.getElementById('mgr-scope-single-field');
    var multi  = document.getElementById('mgr-scope-multi-field');
    if (single) single.hidden = multiTeamEnabled;
    if (multi)  multi.hidden  = !multiTeamEnabled;
}

// (Re)build the team checkboxes from the active teams, restoring the editor's
// current selection (kept in editorTeamCodes so it survives an async team load).
function buildTeamCheckboxes() {
    var box = document.getElementById('mgr-scope-multi');
    if (!box) return;
    var checked = {};
    editorTeamCodes.forEach(function (c) { checked[c] = true; });
    // Keep any codes the template targets that aren't in the active teams list.
    var codes = allTeams.map(function (t) { return t.teamCode; }).filter(Boolean);
    editorTeamCodes.forEach(function (c) { if (codes.indexOf(c) === -1) codes.push(c); });
    box.innerHTML = '';
    codes.forEach(function (code) {
        var team = allTeams.filter(function (t) { return t.teamCode === code; })[0];
        var lbl = document.createElement('label');
        lbl.className = 'mgr-team-multi-opt';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = code;
        cb.checked = !!checked[code];
        cb.addEventListener('change', function () { editorTeamCodes = collectMultiTeamCodes(); });
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + (team ? team.name : code) + ' (' + code + ')'));
        box.appendChild(lbl);
    });
}

function collectMultiTeamCodes() {
    var box = document.getElementById('mgr-scope-multi');
    if (!box) return [];
    return Array.prototype.slice
        .call(box.querySelectorAll('input[type="checkbox"]:checked'))
        .map(function (c) { return c.value; });
}

// Seed the editor's team selection (single dropdown + multi checkboxes both, so
// whichever control is visible is correct) from a template's stored teams.
function setEditorTeams(teamId, teamName, teamCodes) {
    ensureTeamOption(teamId, teamName);
    var sel = document.getElementById('mgr-scope');
    if (sel) sel.value = teamId || '';
    syncCustomSelect('mgr-scope');
    editorTeamCodes = Array.isArray(teamCodes) ? teamCodes.slice() : [];
    buildTeamCheckboxes();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

// Names currently visible in the table (filter applied) — shared with bulk ops.
function visibleTemplateNames() {
    var q = ((document.getElementById('mgr-filter') || {}).value || '').trim().toLowerCase();
    return Object.keys(allTemplates).filter(function (name) {
        if (!q) return true;
        var t = allTemplates[name];
        var hay = (name + ' ' + (t.category || '') + ' ' + (t.teamName || 'global') + ' ' + (t.teamCodes || []).join(' ') + ' ' + (t.status || '')).toLowerCase();
        return hay.indexOf(q) !== -1;
    }).sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
}

// ── Read-acknowledgements (QMS) ────────────────────────────────────────────────
// Dormant until NucleusTemplateAck__c exists; every helper is a no-op when the
// feature is unavailable, so nothing here changes behaviour for existing orgs.

function ackKey(t) { return (t.id || '') + '|' + (t.versionLabel || ''); }

// A controlled document: flagged RequiresAck, currently Active, with an id+version.
function isControlledDoc(t) {
    return !!(t && t.requiresAck && (t.status || 'Active').toLowerCase() === 'active' && t.id && t.versionLabel);
}

// The current user's team codes (multi-team aware).
function myTeamCodes() {
    return (currentUser.teams && currentUser.teams.length)
        ? currentUser.teams.map(function (x) { return x.teamCode; }).filter(Boolean)
        : (currentUser.teamCode ? [currentUser.teamCode] : []);
}

// Is this template in the user's own scope? Global → everyone; otherwise it must
// target one of their teams. (For members allTemplates is already their scope, so
// this only matters for admins, whose dataset spans every team.)
function templateInMyScope(t) {
    var codes = (t.teamCodes && t.teamCodes.length) ? t.teamCodes : (t.teamCode ? [t.teamCode] : []);
    if (!codes.length) return true;
    var mine = myTeamCodes();
    return codes.some(function (c) { return mine.indexOf(c) !== -1; });
}

// Does the user still owe an acknowledgement for this template's CURRENT version?
function needsMyAck(t) {
    return acksAvailable && isControlledDoc(t) && templateInMyScope(t) && !myAcks[ackKey(t)];
}

function outstandingAckNames() {
    return Object.keys(allTemplates).filter(function (n) { return needsMyAck(allTemplates[n]); });
}

// Load the current user's acknowledgements; flips acksAvailable on if the feature
// is live. Safe no-op otherwise.
function loadMyAcks(cb) {
    chrome.runtime.sendMessage({ action: 'acks.mine' }, function (r) {
        acksAvailable = !chrome.runtime.lastError && !!(r && r.available === true);
        myAcks = {};
        if (acksAvailable) (r.acks || []).forEach(function (k) { myAcks[k] = true; });
        // The admin matrix tab appears only once the feature is live, for admins.
        var acksNav = document.querySelector('.mgr-nav-item[data-view="acks"]');
        if (acksNav) acksNav.style.display = (acksAvailable && !readOnly) ? '' : 'none';
        if (cb) cb();
    });
}

// Banner at the top of the Templates panel: how many controlled docs you owe.
function renderAckBanner() {
    var el = document.getElementById('mgr-ack-banner');
    if (!el) return;
    var n = acksAvailable ? outstandingAckNames().length : 0;
    if (!n) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.textContent = '⚠ ' + n + ' controlled template' + (n === 1 ? '' : 's')
        + ' need your “read & understood” acknowledgement — open one to read and confirm.';
}

// Acknowledge a template's current version (after the user has opened/read it).
function acknowledgeTemplate(t, onDone) {
    chrome.runtime.sendMessage(
        { action: 'acks.acknowledge', templateId: t.id, versionLabel: t.versionLabel },
        function (r) {
            if (!chrome.runtime.lastError && r && r.ok) {
                myAcks[ackKey(t)] = true;
                renderAckBanner();
                renderTemplateList();
                if (onDone) onDone(true);
            } else {
                var msg = (r && r.error && r.error !== 'NOT_AVAILABLE') ? r.error : 'Could not save the acknowledgement.';
                mgrModal({ title: 'Acknowledgement failed', body: msg, confirmLabel: 'Close', alert: true });
                if (onDone) onDone(false);
            }
        }
    );
}

// Admin matrix: who has acknowledged each controlled template's current version,
// and who is outstanding (scoped to the members of the template's assigned teams).
function renderAckMatrix() {
    var box = document.getElementById('mgr-acks-body');
    if (!box) return;
    box.innerHTML = '<p class="mgr-state-msg">Loading…</p>';

    chrome.runtime.sendMessage({ action: 'acks.matrix' }, function (r) {
        if (chrome.runtime.lastError || !r || !r.ok) {
            box.innerHTML = '<p class="mgr-state-msg">' +
                ((r && r.error === 'PERMISSION_DENIED') ? 'Template admins only.' : 'Could not load acknowledgements.') + '</p>';
            return;
        }
        if (!r.available) {
            box.innerHTML = '<p class="mgr-state-msg">Read-acknowledgement isn’t set up in Salesforce yet ' +
                '(the <code>NucleusTemplateAck__c</code> object doesn’t exist).</p>';
            return;
        }

        var members = r.members || [];   // [{ userId, name, teamCodes }]
        var acks    = r.acks    || [];   // [{ templateId, version, userId, name }]

        // template+version → { userId: true } who acknowledged it.
        var ackedBy = {};
        acks.forEach(function (a) {
            var k = a.templateId + '|' + a.version;
            (ackedBy[k] = ackedBy[k] || {})[a.userId] = true;
        });

        var controlled = [];
        Object.keys(allTemplates).forEach(function (name) {
            if (isControlledDoc(allTemplates[name])) controlled.push({ name: name, t: allTemplates[name] });
        });
        controlled.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });

        if (!controlled.length) {
            box.innerHTML = '<p class="mgr-state-msg">No controlled documents yet. Tick ' +
                '<strong>Requires acknowledgement</strong> on a template to start tracking read &amp; understood sign-off.</p>';
            return;
        }

        var rows = controlled.map(function (c) {
            var t     = c.t;
            var codes = (t.teamCodes && t.teamCodes.length) ? t.teamCodes : (t.teamCode ? [t.teamCode] : []);
            var required = members.filter(function (m) {
                if (!codes.length) return true; // Global → everyone
                return m.teamCodes.some(function (mc) { return codes.indexOf(mc) !== -1; });
            });
            var acked = ackedBy[t.id + '|' + t.versionLabel] || {};
            var outstanding = required.filter(function (m) { return !acked[m.userId]; });
            var done = required.length - outstanding.length;
            var pct  = required.length ? Math.round(done / required.length * 100) : 100;
            var statusCell = outstanding.length
                ? '<span class="mgr-ack-out">' + outstanding.length + ' outstanding</span>'
                : '<span class="mgr-ack-ok">All acknowledged ✓</span>';
            var outCell = outstanding.length
                ? outstanding.map(function (m) { return escHtml(m.name || '(unknown)'); }).sort().join(', ')
                : '—';
            return '<tr><td>' + escHtml(c.name) + '</td><td>v' + escHtml(t.versionLabel) + '</td>'
                 + '<td>' + done + ' / ' + required.length + ' (' + pct + '%)</td>'
                 + '<td>' + statusCell + '</td><td>' + outCell + '</td></tr>';
        }).join('');

        box.innerHTML = '<table class="mgr-table mgr-ack-table"><thead><tr>'
            + '<th>Template</th><th>Version</th><th>Acknowledged</th><th>Status</th><th>Outstanding</th>'
            + '</tr></thead><tbody>' + rows + '</tbody></table>';
    });
}

function renderTemplateList() {
    var tbody   = document.getElementById('mgr-template-rows');
    var emptyEl = document.getElementById('mgr-empty');
    var tableEl = document.getElementById('mgr-template-table');
    tbody.innerHTML = '';

    var q = ((document.getElementById('mgr-filter') || {}).value || '').trim().toLowerCase();
    var names = visibleTemplateNames();
    var teamCode = currentUser.teamCode || null;

    // Bulk-select column only exists for admins.
    var thCheck = document.getElementById('mgr-th-check');
    if (thCheck) thCheck.style.display = readOnly ? 'none' : '';

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
        var isMyTeam = teamCode && (t.teamCode === teamCode || (t.teamCodes || []).indexOf(teamCode) !== -1);

        var tr = document.createElement('tr');

        // Bulk-select checkbox (admins only)
        if (!readOnly) {
            var checkTd = document.createElement('td');
            checkTd.className = 'mgr-col-check';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = bulkSelected.has(name);
            cb.setAttribute('aria-label', 'Select ' + name);
            (function (n) {
                cb.addEventListener('change', function () {
                    if (cb.checked) bulkSelected.add(n); else bulkSelected.delete(n);
                    updateBulkBar();
                });
            }(name));
            checkTd.appendChild(cb);
            tr.appendChild(checkTd);
        }

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

        // Name (+ QMS acknowledgement chip for controlled documents)
        var nameTd = document.createElement('td');
        nameTd.textContent = name;
        if (acksAvailable && isControlledDoc(t) && templateInMyScope(t)) {
            var acked = !!myAcks[ackKey(t)];
            var chip  = document.createElement('span');
            chip.className   = 'mgr-ack-chip ' + (acked ? 'mgr-ack-chip--done' : 'mgr-ack-chip--due');
            chip.textContent = acked ? '✓ Acknowledged' : 'Acknowledge';
            chip.title       = (acked ? 'You have acknowledged v' : 'Read & acknowledge v') + t.versionLabel;
            nameTd.appendChild(document.createTextNode(' '));
            nameTd.appendChild(chip);
        }
        tr.appendChild(nameTd);

        // Version
        var verTd = document.createElement('td');
        verTd.className   = 'mgr-cell-version';
        verTd.textContent = t.versionLabel ? 'v' + t.versionLabel : '—';
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
        var hasMulti = t.teamCodes && t.teamCodes.length;
        var teamVal = hasMulti ? t.teamCodes.join(', ') : (t.teamName || t.teamCode || null);
        var scoped  = hasMulti || t.teamId || t.teamCode;
        badge.className   = scoped ? 'mgr-scope-badge mgr-scope-badge--team' : 'mgr-scope-badge';
        if (isMyTeam) badge.className += ' mgr-scope-badge--own';
        badge.textContent = teamVal || 'Global';
        if (hasMulti) badge.title = t.teamCodes.join(', ');
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

    // Keep header checkbox + bulk bar in sync with the (possibly filtered) view.
    var checkAllEl = document.getElementById('mgr-check-all');
    if (checkAllEl) {
        checkAllEl.checked = names.length > 0 && names.every(function (n) { return bulkSelected.has(n); });
    }
    updateBulkBar();
}

// ── Bulk actions (admins) ─────────────────────────────────────────────────────

function updateBulkBar() {
    var bar = document.getElementById('mgr-bulk-bar');
    if (!bar) return;
    if (readOnly || bulkSelected.size === 0) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    document.getElementById('mgr-bulk-count').textContent = bulkSelected.size + ' selected';
}

// Rebuild the bulk Status/Team pickers from the live option sets.
function populateBulkSelectors() {
    var st = document.getElementById('mgr-bulk-status');
    if (st) {
        st.innerHTML = '';
        (statusOptions.length ? statusOptions : ['Draft', 'Active', 'Under Review', 'Superseded', 'Retired'])
            .forEach(function (s) {
                var o = document.createElement('option');
                o.value = s; o.textContent = s;
                st.appendChild(o);
            });
        syncCustomSelect('mgr-bulk-status');
    }
    var tm = document.getElementById('mgr-bulk-team');
    if (tm) {
        tm.innerHTML = '';
        var g = document.createElement('option');
        g.value = ''; g.textContent = 'Global (all teams)';
        tm.appendChild(g);
        allTeams.forEach(function (t) {
            if (multiTeamEnabled && !t.teamCode) return; // multi mode keys on team code
            var o = document.createElement('option');
            o.value = multiTeamEnabled ? t.teamCode : t.id;
            o.textContent = t.name + (t.teamCode ? ' (' + t.teamCode + ')' : '');
            tm.appendChild(o);
        });
        syncCustomSelect('mgr-bulk-team');
    }
}

function sendMsg(action, payload) {
    return new Promise(function (resolve) {
        chrome.runtime.sendMessage({ action: action, payload: payload }, function (r) {
            if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
            else resolve(r || { ok: false, error: 'No response' });
        });
    });
}

// Apply a status or team change to every selected template, sequentially.
// METADATA-ONLY updates: same versionLabel, no change reason — so no version
// snapshots are created (matches the single-edit behaviour and the Flow).
function bulkApply(kind) {
    var names = Array.from(bulkSelected).filter(function (n) { return allTemplates[n]; });
    if (!names.length) return;

    var sel   = document.getElementById(kind === 'status' ? 'mgr-bulk-status' : 'mgr-bulk-team');
    var value = sel ? sel.value : '';
    var label = kind === 'status'
        ? 'Set status to "' + (value || '—') + '"'
        : 'Move to ' + ((sel.options[sel.selectedIndex] || {}).textContent || 'Global');

    mgrModal({
        title: 'Apply to ' + names.length + ' template' + (names.length === 1 ? '' : 's') + '?',
        body: label + ' for:\n' + names.slice(0, 10).join(', ')
            + (names.length > 10 ? ' … and ' + (names.length - 10) + ' more' : ''),
        confirmLabel: 'Apply',
        cancelLabel: 'Cancel'
    }).then(function (ok) {
        if (!ok) return;
        runBulk(names, function (t, name) {
            var p = {
                id:            t.id,
                name:          name,
                content:       t.content,
                category:      t.category || '',
                versionLabel:  t.versionLabel,
                status:        kind === 'status' ? value : (t.status || 'Active'),
                changeReason:  '',
                effectiveDate: t.effectiveDate || null,
                reviewDueDate: t.reviewDueDate || null,
                teamId:        kind === 'team' ? value : (t.teamId || '')
            };
            if (multiTeamEnabled) {
                // Multi-team org: a team move sets that one code; other bulk actions
                // (e.g. status) keep the template's existing teams.
                p.teamCodes = (kind === 'team') ? (value ? [value] : []) : (t.teamCodes || []);
                delete p.teamId;
            }
            return sendMsg('sfTemplates.update', p);
        });
    });
}

function bulkDelete() {
    var names = Array.from(bulkSelected).filter(function (n) { return allTemplates[n]; });
    if (!names.length) return;

    mgrModal({
        title: 'Delete ' + names.length + ' template' + (names.length === 1 ? '' : 's') + '?',
        body: 'This permanently deletes (with version history):\n'
            + names.slice(0, 10).join(', ')
            + (names.length > 10 ? ' … and ' + (names.length - 10) + ' more' : '')
            + '\n\nDeleted records sit in the Salesforce Recycle Bin for ~15 days. '
            + 'For templates that were genuinely in use, Retire them instead.',
        confirmLabel: 'Delete all',
        cancelLabel: 'Cancel',
        danger: true
    }).then(function (ok) {
        if (!ok) return;
        runBulk(names, function (t) {
            return sendMsg('sfTemplates.delete', { id: t.id });
        });
    });
}

// Sequential runner with live progress + a failure report at the end.
async function runBulk(names, opFn) {
    var countEl  = document.getElementById('mgr-bulk-count');
    var failures = [];
    for (var i = 0; i < names.length; i++) {
        if (countEl) countEl.textContent = 'Working… ' + (i + 1) + '/' + names.length;
        var t = allTemplates[names[i]];
        if (!t) continue;
        var r = await opFn(t, names[i]);
        if (!r || !r.ok) failures.push(names[i] + ' — ' + ((r && r.error) || 'failed'));
    }
    bulkSelected.clear();
    if (failures.length) {
        mgrAlert(failures.length + ' of ' + names.length + ' failed:\n'
            + failures.slice(0, 8).join('\n')
            + (failures.length > 8 ? '\n… and ' + (failures.length - 8) + ' more' : ''),
            'Bulk action finished with errors');
    }
    loadTemplates();
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
    document.getElementById('mgr-change-reason').value = '';
    setContentHtml('');
    document.getElementById('mgr-status').value        = 'Active';
    document.getElementById('mgr-effective-date').value = isoToBritish(today());
    document.getElementById('mgr-review-date').value   = isoToBritish(addMonths(today(), REVIEW_PERIOD_MONTHS));

    var docIdEl = document.getElementById('mgr-doc-id');
    docIdEl.value       = '';
    docIdEl.readOnly    = true;            // assigned by Salesforce, not by hand
    docIdEl.placeholder = 'Assigned by Salesforce on save';

    var newSfLink = document.getElementById('mgr-editor-sf-link');
    if (newSfLink) newSfLink.style.display = 'none';

    // Default new templates to the admin's own team (or Global if none).
    setEditorTeams(currentUser.teamId, currentUser.teamName,
                   currentUser.teamCode ? [currentUser.teamCode] : []);

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

    document.getElementById('mgr-editor-heading').textContent = 'Edit: ' + name;
    document.getElementById('mgr-name').value          = name;
    document.getElementById('mgr-category').value      = t.category      || '';
    setContentHtml(t.content || '');
    editorOriginalContent = getContentHtml();   // normalised baseline for change detection
    document.getElementById('mgr-change-reason').value = '';
    ensureStatusOption(t.status);
    document.getElementById('mgr-status').value        = t.status        || 'Active';
    // A new version becomes effective today; pre-fill so the controlled-document
    // dates are never left blank (matches the background defaulting on save).
    var effPrefill = t.effectiveDate || today();
    document.getElementById('mgr-effective-date').value = isoToBritish(effPrefill);
    document.getElementById('mgr-review-date').value   = isoToBritish(t.reviewDueDate || addMonths(effPrefill, REVIEW_PERIOD_MONTHS));

    var docIdEl = document.getElementById('mgr-doc-id');
    docIdEl.value    = t.documentId || t.id || '';
    docIdEl.readOnly = true;            // Salesforce-managed identifier

    var editSfLink = document.getElementById('mgr-editor-sf-link');
    var editSfUrl  = sfRecordUrl(t.id);
    if (editSfLink) {
        if (editSfUrl) { editSfLink.href = editSfUrl; editSfLink.style.display = ''; }
        else editSfLink.style.display = 'none';
    }

    // Pre-select the template's current team(s) (none = Global).
    setEditorTeams(t.teamId, t.teamName, t.teamCodes);

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
// ── Rich-text content editor (contenteditable #mgr-content) ──────────────────
// Templates may be plain text (legacy) or sanitised HTML (formatting). These
// read/write the contenteditable and keep stored content Salesforce-safe.
function setContentHtml(content) {
    var el = document.getElementById('mgr-content');
    if (!el) return;
    var raw = String(content || '');
    if (!raw.trim()) { el.innerHTML = ''; updateContentCount(); return; }   // empty → placeholder
    if (window.CyforSanitize && CyforSanitize.looksLikeHtml(raw)) {
        el.innerHTML = CyforSanitize.html(raw);
    } else {
        el.innerHTML = raw.split('\n')                   // plain text → paragraphs
            .map(function (line) { return '<p>' + (escHtml(line) || '<br>') + '</p>'; })
            .join('');
    }
    updateContentCount();
}

// Live character count of the SAVED form (sanitised HTML) against the field max,
// so the tight ~32 KB Content limit is visible before Salesforce rejects a save.
function updateContentCount() {
    var el = document.getElementById('mgr-rte-count');
    if (!el) return;
    var used = getContentHtml().length;
    el.textContent = contentMaxLen
        ? (used.toLocaleString() + ' / ' + contentMaxLen.toLocaleString() + ' characters')
        : (used.toLocaleString() + ' characters');
    el.classList.toggle('is-over', !!contentMaxLen && used > contentMaxLen);
}
function getContentText() {
    var el = document.getElementById('mgr-content');
    return el ? (el.textContent || '') : '';
}
function getContentHtml() {
    var el = document.getElementById('mgr-content');
    if (!el) return '';
    if (!(el.textContent || '').trim()) return '';       // empty editor → empty content
    return window.CyforSanitize ? CyforSanitize.html(el.innerHTML) : el.innerHTML;
}

// Wire the formatting toolbar to the contenteditable. Selects/colour lose the
// editor selection, so we save/restore it around them.
function setupContentToolbar() {
    var editor  = document.getElementById('mgr-content');
    var toolbar = document.getElementById('mgr-rte-toolbar');
    if (!editor || !toolbar) return;

    // Use <p> (not <div>) for new lines — cleaner HTML that Salesforce's Quill
    // editor accepts faithfully on insertion.
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* ignore */ }

    var savedRange = null;
    var saveSel = function () {
        var sel = window.getSelection();
        if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    };
    var exec = function (cmd, val) {
        editor.focus();
        if (savedRange) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
        try { document.execCommand(cmd, false, val); } catch (e) { /* ignore */ }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        saveSel();
    };

    editor.addEventListener('keyup', saveSel);
    editor.addEventListener('mouseup', saveSel);
    toolbar.addEventListener('mousedown', saveSel, true); // capture the selection before focus leaves

    toolbar.querySelectorAll('.mgr-rte-btn[data-cmd]').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep selection
        btn.addEventListener('click', function () { exec(btn.getAttribute('data-cmd')); });
    });
    var font = document.getElementById('mgr-rte-font');
    if (font) font.addEventListener('change', function () { if (font.value) exec('fontName', font.value); });

    // execCommand's fontSize only supports 1–7; to apply an exact px size (matching
    // Salesforce's 8–36 scale) we tag the selection with the size-7 sentinel, then
    // rewrite those <font> nodes to an inline px style.
    var applyFontSize = function (px) {
        exec('fontSize', '7');
        editor.querySelectorAll('font[size="7"]').forEach(function (f) {
            f.removeAttribute('size');
            f.style.fontSize = px;
        });
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    };
    var size = document.getElementById('mgr-rte-size');
    if (size) size.addEventListener('change', function () { if (size.value) applyFontSize(size.value); });

    var color    = document.getElementById('mgr-rte-color');
    var colorBar = document.getElementById('mgr-rte-color-bar');
    var setColorSwatch = function (hex) { if (colorBar && hex) colorBar.style.background = hex; };
    if (color) color.addEventListener('input', function () { exec('foreColor', color.value); setColorSwatch(color.value); });

    // Insert link — wraps the selection, or drops the URL in if nothing is selected.
    var linkBtn = document.getElementById('mgr-rte-link');
    if (linkBtn) {
        linkBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        linkBtn.addEventListener('click', function () {
            var url = window.prompt('Link URL:', 'https://');
            if (!url) return;
            url = url.trim();
            if (!/^(https?:|mailto:|tel:)/i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
            if (!savedRange || savedRange.collapsed) {
                exec('insertHTML', '<a href="' + url.replace(/"/g, '%22') + '">' + url.replace(/[<>]/g, '') + '</a>');
            } else {
                exec('createLink', url);
            }
        });
    }

    // Insert image from the file picker. The Content field is small (~32 KB), so
    // the picture is auto-shrunk (dimensions, then JPEG quality) until it fits the
    // room left in the template before being embedded.
    var embedImageFile = function (file) {
        var budget = (contentMaxLen || 32768) - getContentHtml().length - 1500;
        if (budget < 2500) {
            setEditorStatus('Not enough room left in this template to add an image — trim the text first.', 'error');
            return;
        }
        var objUrl = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(objUrl);
            var best = null;
            var scales = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.22, 0.15, 0.1];
            for (var s = 0; s < scales.length && !best; s++) {
                var cw = Math.max(1, Math.round(img.width  * scales[s]));
                var ch = Math.max(1, Math.round(img.height * scales[s]));
                // PNG first (keeps transparency)…
                var cv = document.createElement('canvas');
                cv.width = cw; cv.height = ch;
                cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
                var png = cv.toDataURL('image/png');
                if (png.length <= budget) { best = png; break; }
                // …else JPEG on a white background at decreasing quality.
                var cj = document.createElement('canvas');
                cj.width = cw; cj.height = ch;
                var jx = cj.getContext('2d');
                jx.fillStyle = '#ffffff'; jx.fillRect(0, 0, cw, ch);
                jx.drawImage(img, 0, 0, cw, ch);
                [0.85, 0.7, 0.55, 0.4].forEach(function (q) {
                    if (best) return;
                    var jpg = cj.toDataURL('image/jpeg', q);
                    if (jpg.length <= budget) best = jpg;
                });
            }
            if (!best) {
                setEditorStatus('That image is too large to fit this template even after shrinking — use a smaller image, or trim the text.', 'error');
                return;
            }
            exec('insertImage', best);
        };
        img.onerror = function () { URL.revokeObjectURL(objUrl); setEditorStatus('Could not read that image file.', 'error'); };
        img.src = objUrl;
    };
    var imageBtn  = document.getElementById('mgr-rte-image');
    var imageFile = document.getElementById('mgr-rte-image-file');
    if (imageBtn && imageFile) {
        imageBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        imageBtn.addEventListener('click', function () { imageFile.click(); });
        imageFile.addEventListener('change', function () {
            var file = imageFile.files && imageFile.files[0];
            imageFile.value = '';
            if (file) embedImageFile(file);
        });
    }

    // ── Live selection readout (like Word): reflect the formatting of the text at
    // the cursor / selection in the toolbar; blank a control when the selection
    // spans more than one value. ────────────────────────────────────────────────
    var rgbToHex = function (rgb) {
        var m = String(rgb || '').match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return '';
        return '#' + [m[1], m[2], m[3]].map(function (n) {
            var h = (+n).toString(16); return h.length === 1 ? '0' + h : h;
        }).join('');
    };
    var nodeOf = function (n) { return n && n.nodeType === 3 ? n.parentElement : n; };
    // The colour the text will ACTUALLY be: the nearest explicit colour set on it,
    // or black if none (the default). NOT the computed colour — in dark mode that's
    // white for default text, which would mislead, since it's black in Salesforce.
    var effectiveColor = function (node) {
        var el = nodeOf(node);
        while (el && el !== editor && editor.contains(el)) {
            if (el.style && el.style.color) return rgbToHex(window.getComputedStyle(el).color) || '#000000';
            el = el.parentElement;
        }
        return '#000000';
    };
    var markActive = function (cmd, on) {
        var btn = toolbar.querySelector('.mgr-rte-btn[data-cmd="' + cmd + '"]');
        if (btn) btn.classList.toggle('is-active', !!on);
    };
    var updateToolbarState = function () {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return;
        ['bold', 'italic', 'underline', 'strikeThrough',
         'insertUnorderedList', 'insertOrderedList',
         'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].forEach(function (cmd) {
            var on = false; try { on = document.queryCommandState(cmd); } catch (e) {}
            markActive(cmd, on);
        });
        var a = nodeOf(sel.anchorNode), fo = nodeOf(sel.focusNode);
        if (!a) return;
        var csA = window.getComputedStyle(a);
        var csF = fo ? window.getComputedStyle(fo) : csA;
        if (font) {
            var sameFam = csA.fontFamily === csF.fontFamily;
            var match = sameFam ? Array.prototype.filter.call(font.options, function (o) {
                return o.value && csA.fontFamily.toLowerCase().indexOf(o.value.toLowerCase()) !== -1;
            })[0] : null;
            font.value = match ? match.value : '';
        }
        if (size) {
            var pxA = Math.round(parseFloat(csA.fontSize)) + 'px';
            var pxF = Math.round(parseFloat(csF.fontSize)) + 'px';
            var known = Array.prototype.some.call(size.options, function (o) { return o.value === pxA; });
            size.value = (pxA === pxF && known) ? pxA : '';
        }
        if (color) { var hex = effectiveColor(sel.anchorNode); color.value = hex; setColorSwatch(hex); }
    };
    document.addEventListener('selectionchange', function () {
        var an = window.getSelection().anchorNode;
        if (document.activeElement === editor || (an && editor.contains(an))) updateToolbarState();
    });
    editor.addEventListener('keyup', updateToolbarState);
    editor.addEventListener('mouseup', updateToolbarState);
    editor.addEventListener('focus', updateToolbarState);

    // Paste keeps formatting but sanitised (Word junk / tables / scripts removed).
    editor.addEventListener('paste', function (e) {
        var cb = e.clipboardData;
        if (!cb) return;
        e.preventDefault();
        var html = cb.getData('text/html');
        if (html && window.CyforSanitize) document.execCommand('insertHTML', false, CyforSanitize.html(html));
        else document.execCommand('insertText', false, cb.getData('text/plain') || '');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function updateEditorVersionUI() {
    if (!currentEditId) return;
    var changed     = getContentHtml() !== editorOriginalContent;
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
    meta.push((t.teamCodes && t.teamCodes.length) ? t.teamCodes.join(', ') : (t.teamName || t.teamCode || 'Global'));
    if (t.reviewDueDate) meta.push('Review due ' + formatDate(t.reviewDueDate));
    var rich = window.CyforSanitize && CyforSanitize.looksLikeHtml(t.content);

    var controlled   = acksAvailable && isControlledDoc(t) && templateInMyScope(t);
    var alreadyAcked = controlled && !!myAcks[ackKey(t)];
    var body = meta.join('  ·  ');
    if (alreadyAcked) body += '   ·   ✓ You have acknowledged v' + t.versionLabel;

    var opts = {
        title:   name,
        body:    body,
        preBody: rich ? null : (t.content || '(empty)'),
        preHtml: rich ? t.content : null
    };

    if (controlled && !alreadyAcked) {
        // Controlled document the user still owes — make them confirm they've read
        // & understood THIS version before the button does anything.
        opts.alert        = false;
        opts.confirmLabel = 'I have read & understood v' + t.versionLabel;
        opts.cancelLabel  = 'Close';
        mgrModal(opts).then(function (ok) { if (ok) acknowledgeTemplate(t); });
    } else {
        opts.alert        = true;
        opts.confirmLabel = 'Close';
        mgrModal(opts);
    }
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
    setContentHtml(t.content || '');
    document.getElementById('mgr-change-reason').value =
        'Cloned from "' + name + '"' + (t.versionLabel ? ' v' + t.versionLabel : '');
    // Drafts stay out of analysts' sync until an admin activates them.
    ensureStatusOption('Draft');
    document.getElementById('mgr-status').value = 'Draft';
    setEditorTeams(t.teamId, t.teamName, t.teamCodes);
    syncCustomSelect('mgr-status');
    document.getElementById('mgr-name').focus();
}

function saveTemplate() {
    var name         = (document.getElementById('mgr-name').value          || '').trim();
    var category     = (document.getElementById('mgr-category').value      || '').trim();
    var content      =  getContentHtml();
    var changeReason = (document.getElementById('mgr-change-reason').value || '').trim();
    var status       =  document.getElementById('mgr-status').value        || 'Active';
    var effRaw       = (document.getElementById('mgr-effective-date').value || '').trim();
    var revRaw       = (document.getElementById('mgr-review-date').value    || '').trim();
    var teamId       = (document.getElementById('mgr-scope') || {}).value;   // '' = Global
    var teamCodes    = multiTeamEnabled ? collectMultiTeamCodes() : null;    // [] = Global

    if (!name)                    { setEditorStatus('Name is required.', 'error'); return; }
    if (!getContentText().trim()) { setEditorStatus('Content is required.', 'error'); return; }
    if (contentMaxLen && content.length > contentMaxLen) {
        setEditorStatus('Content is too long: ' + content.length.toLocaleString() + ' / '
            + contentMaxLen.toLocaleString() + ' characters (formatting counts too). '
            + 'Trim it, or link images by URL instead of large formatting.', 'error');
        return;
    }

    var effectiveDate = effRaw ? britishToIso(effRaw) : null;
    var reviewDueDate = revRaw ? britishToIso(revRaw) : null;
    if (effRaw && !effectiveDate) { setEditorStatus('Effective Date must be a real date in DD/MM/YYYY format.', 'error'); return; }
    if (revRaw && !reviewDueDate) { setEditorStatus('Review Due Date must be a real date in DD/MM/YYYY format.', 'error'); return; }

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
    // In multi-team mode the picklist codes are the source of truth (the background
    // then clears the legacy single lookup). teamId is left for the single-team org.
    if (multiTeamEnabled) payload.teamCodes = teamCodes;

    chrome.runtime.sendMessage({ action: action, payload: payload }, function (response) {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save to Salesforce';

        if (chrome.runtime.lastError || !response || !response.ok) {
            var err = (response && response.error) || 'Save failed — please try again.';
            if (/too large|data value too large/i.test(err)) {
                err = 'This template is too long for Salesforce to store'
                    + (contentMaxLen ? ' (max ' + contentMaxLen.toLocaleString() + ' characters' : ' (limited')
                    + ', and formatting/links count too). Trim the content, or link any image by URL.';
            }
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
        if (opts.preHtml) {
            var richBox = document.createElement('div');
            richBox.className = 'mgr-modal-rich';
            richBox.innerHTML = window.CyforSanitize ? CyforSanitize.html(opts.preHtml) : '';
            dialog.appendChild(richBox);
        } else if (opts.preBody) {
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
        verTd.className   = 'mgr-cell-version';
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
    var start = britishToIso((document.getElementById('mgr-history-start').value || '').trim());
    var end   = britishToIso((document.getElementById('mgr-history-end').value   || '').trim());
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
    // Diff readable plain text, not HTML markup, for rich templates.
    if (window.CyforSanitize) {
        fromContent = CyforSanitize.toText(fromContent);
        toContent   = CyforSanitize.toText(toContent);
    }
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

// Native <input type="date"> renders in the browser's locale (US for many of our
// users), so the editor date fields are plain text in DD/MM/YYYY and we convert
// to/from the ISO (yyyy-mm-dd) Salesforce expects.
function isoToBritish(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
}
function britishToIso(str) {
    var m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    var dd = +m[1], mm = +m[2], yyyy = +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    var d = new Date(yyyy, mm - 1, dd);                 // rejects 31/04, 29/02 non-leap, etc.
    if (d.getFullYear() !== yyyy || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return '';
    return yyyy + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
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
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// British date + 24h time WITH seconds, from an epoch-ms timestamp (usage log,
// health banner). Spelled-out month so it can never be misread as US format.
function formatStamp(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-GB', { hour12: false });
}

// Numeric "DD/MM/YYYY HH:MM:SS" form for the Usage search, so "17/06/2026",
// "14:47" and "17/06/2026 14:47" all match an entry's timestamp.
function usageStamp(ts) {
    if (!ts) return '';
    var d = new Date(ts), p = function (n) { return ('0' + n).slice(-2); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');   // also escape ' so it's safe in single-quoted attrs too
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
    var warnEl = document.getElementById('mgr-usage-warn');
    if (!readOnly) {
        chrome.runtime.sendMessage({ action: 'usage.listOrg' }, function (r) {
            if (!chrome.runtime.lastError && r && r.ok && r.available) {
                if (descEl) {
                    descEl.textContent = 'Org-wide template insertions (newest first, up to 200) — '
                        + 'recorded in Salesforce from every connected device.';
                }
                if (clearBtn) clearBtn.style.display = 'none'; // org records aren't clearable here
                setUsageData(r.entries || []);
                showUsageHealth(warnEl);
                return;
            }
            if (warnEl) warnEl.style.display = 'none';
            loadLocalUsage(descEl, clearBtn);
        });
    } else {
        if (warnEl) warnEl.style.display = 'none';
        loadLocalUsage(descEl, clearBtn);
    }
}

// Quietly warn admins when Salesforce is currently REJECTING org-wide usage
// writes (object read-only / "In Development" / a validation rule) — without
// this the dropped insertions are invisible. Self-clears once a write succeeds.
function showUsageHealth(warnEl) {
    if (!warnEl) return;
    chrome.storage.local.get(['usageLogError'], function (res) {
        var err = (!chrome.runtime.lastError && res) ? res.usageLogError : null;
        if (!err) { warnEl.style.display = 'none'; return; }
        var when = err.ts ? formatStamp(err.ts) : 'recently';
        warnEl.textContent = 'Heads up — Salesforce is currently rejecting new usage writes'
            + (err.code ? ' (' + err.code + ')' : '')
            + ', so insertions since ' + when + ' aren’t being recorded org-wide. This usually '
            + 'means the NucleusTemplateUsage__c object is read-only or its Deployment Status is '
            + '“In Development”. Logging resumes automatically once that’s fixed.';
        warnEl.style.display = '';
    });
}

function loadLocalUsage(descEl, clearBtn) {
    if (descEl) {
        descEl.textContent = 'Local template-insertion log for this device (most recent first) — '
            + 'stored on this machine only, not synced across devices. Record links appear when '
            + 'the insert happened on a record’s own page; inserts made in a pop-up form over '
            + 'a list don’t carry a record reference.';
    }
    if (clearBtn) clearBtn.style.display = '';
    chrome.storage.local.get([USAGE_KEY], function (res) {
        var log = (res && Array.isArray(res[USAGE_KEY])) ? res[USAGE_KEY] : [];
        setUsageData(log);
    });
}

var usageAll  = [];                          // full current dataset (org-wide or local)
var usageSort = { key: 'ts', dir: 'desc' };  // default: newest first

function setUsageData(entries) {
    usageAll = Array.isArray(entries) ? entries : [];
    populateUsageFilters();
    renderUsage();
}

// Fill the Template / User filter dropdowns from the current data; show the
// filter bar only when there's data, and the User filter only when more than one
// person appears (i.e. the org-wide log, not a single-user device log).
function populateUsageFilters() {
    var templates = {}, users = {};
    usageAll.forEach(function (e) {
        if (e.template) templates[e.template] = true;
        if (e.user)     users[e.user] = true;
    });
    var tNames = Object.keys(templates).sort();
    var uNames = Object.keys(users).sort();

    fillFilterSelect('mgr-usage-template', tNames, 'All templates');
    fillFilterSelect('mgr-usage-user',     uNames, 'All users');

    var userSel  = document.getElementById('mgr-usage-user');
    var userWrap = userSel && userSel.closest('.cyf-cs');
    if (userWrap) userWrap.style.display = uNames.length > 1 ? '' : 'none';

    var bar = document.getElementById('mgr-usage-filters');
    if (bar) bar.style.display = usageAll.length ? '' : 'none';
}

function fillFilterSelect(id, values, allLabel) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '';
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = allLabel; sel.appendChild(o0);
    values.forEach(function (v) {
        var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
    });
    if (prev && values.indexOf(prev) >= 0) sel.value = prev; // keep selection across reloads
    syncCustomSelect(id);
}

function setUsageSort(key) {
    if (usageSort.key === key) usageSort.dir = (usageSort.dir === 'asc') ? 'desc' : 'asc';
    else { usageSort.key = key; usageSort.dir = (key === 'ts') ? 'desc' : 'asc'; }  // dates newest-first, text A→Z
    renderUsage();
}

function updateUsageSortIndicators() {
    ['ts', 'template', 'user'].forEach(function (k) {
        var ind = document.querySelector('.mgr-usage-th[data-sort="' + k + '"] .mgr-sort-ind');
        if (ind) ind.textContent = (usageSort.key === k) ? (usageSort.dir === 'asc' ? '▲' : '▼') : '';
    });
}

function renderUsage() {
    var table = document.getElementById('mgr-usage-table');
    var empty = document.getElementById('mgr-usage-empty');
    var rows  = document.getElementById('mgr-usage-rows');
    if (!rows) return;
    rows.innerHTML = '';

    var q  = ((document.getElementById('mgr-usage-search')   || {}).value || '').trim().toLowerCase();
    var tf =  (document.getElementById('mgr-usage-template') || {}).value || '';
    var uf =  (document.getElementById('mgr-usage-user')     || {}).value || '';

    var list = usageAll.filter(function (e) {
        if (tf && e.template !== tf) return false;
        if (uf && e.user !== uf) return false;
        if (q) {
            var hay = ((e.template || '') + ' ' + (e.user || '') + ' ' + (e.recordId || '') + ' ' +
                       usageStamp(e.ts) + ' ' + formatStamp(e.ts)).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    });

    var dir = usageSort.dir === 'asc' ? 1 : -1, key = usageSort.key;
    list.sort(function (a, b) {
        if (key === 'ts') return ((a.ts || 0) - (b.ts || 0)) * dir;
        var av = String(a[key] || '').toLowerCase(), bv = String(b[key] || '').toLowerCase();
        return av < bv ? -dir : (av > bv ? dir : 0);
    });
    updateUsageSortIndicators();

    if (!list.length) {
        table.style.display = 'none';
        empty.style.display = '';
        empty.textContent = usageAll.length ? 'No insertions match your filters.'
                                            : 'No template insertions recorded yet.';
        return;
    }
    empty.style.display = 'none';
    table.style.display = '';

    rows.innerHTML = list.map(function (e) {
        var when = formatStamp(e.ts);
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
        chrome.storage.local.set(payload, function () { setUsageData([]); });
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
        'usage':         'mgr-usage-panel',
        'acks':          'mgr-acks-panel'
    };
    Object.keys(panels).forEach(function (key) {
        var el = document.getElementById(panels[key]);
        if (el) el.style.display = (key === state) ? '' : 'none';
    });

    // Topbar title/subtitle: derive from the nav view; editor/history set their own.
    var meta = { 'list': VIEW_META.templates, 'reviews': VIEW_META.reviews,
                 'usage': VIEW_META.usage, 'acks': VIEW_META.acks, 'settings': VIEW_META.settings }[state];
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
