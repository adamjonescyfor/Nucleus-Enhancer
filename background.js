// ==================================================
// CYFOR Nucleus Enhancer — Background Service Worker
// Relays keyboard commands, downloads files,
// and manages extension lifecycle events.
// ==================================================

try {
    importScripts('config.js');
} catch (e) {
    // config.js is gitignored; fall back to empty defaults
    self.CYFOR_CONFIG = { oauthProxyUrl: '' };
}

try {
    importScripts(
        'background/sf-utils.js', 'background/sf-oauth.js', 'background/sf-templates.js',
        'background/sf-team.js', 'background/sf-versions.js', 'report/case-report-fetch.js',
        // MG22A/MG22B report generation — OWNED BY MITUL (feature hidden via the
        // MG22_ENABLED flag in content/case-report.js). These modules stay loaded
        // so the feature is one flag-flip away; they're inert while the button is hidden.
        'lib/fflate.min.js', 'lib/docx-fill.js', 'report/mg-extract.js', 'background/sf-report-templates.js'
    );
} catch (e) {
    console.error('[CYFOR] Failed to load OAuth modules:', e);
}

const DEFAULT_COLUMN_ORDER = [
    'Process Ref', 'Record Type', 'Type', 'Exhibit',
    'Exhibit Type', 'Status', 'Start Date/Time',
    'End Date/Time', 'Completed By', 'Notes'
];

// Relay registered keyboard commands to the active tab
chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id || !tab.url?.includes('lightning.force.com')) return;
        chrome.tabs.sendMessage(tab.id, { action: command }).catch(() => {});
    });
});

// Set default settings on first install
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.storage.local.set({
            enableDate: true,
            enableContextMenu: true,
            enableNav: true,
            enableFormatNotes: true,
            enableAutoInsert: false,
            tableColumnPrefs: {},
            nucleusTemplates: {},
            processMap: {},
            templateCount: 0,
            downloadFolder: 'CYFOR Photographs',
            sfOAuthConfig: {
                oauthProxyUrl:  (self.CYFOR_CONFIG && self.CYFOR_CONFIG.oauthProxyUrl) || 'https://cyfor-oauth-proxy.nucleusenhancer.workers.dev',
                templateObject: 'NucleusTemplate__c',
                contentField:   'Content__c',
                categoryField:  'Category__c',
                activeField:    'IsActive__c',
                apiVersion:     'v62.0'
            },
            sfOAuthUser:        null,
            sfRemoteTemplates:  {},
            sfTemplatesSyncedAt: null
        });
    } else if (details.reason === 'update') {
        // Ensure new toggle has a value on upgrade
        chrome.storage.local.get(['enableContextMenu'], (res) => {
            if (typeof res.enableContextMenu === 'undefined') {
                chrome.storage.local.set({ enableContextMenu: true });
            }
        });
    }
});

// ── Self-heal already-open Salesforce tabs on install/update ───────────────────
// Chrome does NOT re-inject content scripts into tabs that were already open when
// the extension installs or updates (incl. a dev reload / auto-update). Those
// tabs keep the OLD, now-invalidated runtime context (chrome.runtime.id is gone),
// so the in-page features go dead until the user manually refreshes. Re-injecting
// the declared scripts + CSS gives those tabs a fresh, working context with no
// refresh. The content scripts guard their DOM injections (existing-element /
// namespace checks), so re-running is idempotent.
async function reinjectContentScripts() {
    if (!chrome.scripting || !chrome.runtime.getManifest) return;
    var specs = chrome.runtime.getManifest().content_scripts || [];
    for (var s = 0; s < specs.length; s++) {
        var spec = specs[s];
        var matches = spec.matches || [];
        if (!matches.length) continue;
        var tabs;
        try { tabs = await chrome.tabs.query({ url: matches }); }
        catch (e) { continue; }
        for (var t = 0; t < tabs.length; t++) {
            var tabId = tabs[t].id;
            if (tabId == null) continue;
            try {
                if (spec.css && spec.css.length) {
                    await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: spec.css });
                }
                if (spec.js && spec.js.length) {
                    // One call preserves load order (utils before its dependents).
                    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: spec.js });
                }
            } catch (e) { /* tab not injectable (navigating, discarded, perms) — skip */ }
        }
    }
}
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' || details.reason === 'update') reinjectContentScripts();
});

// ── Background template sync ──────────────────────────────────────────────────
// Keeps every connected device current without the user opening the popup, so an
// admin's template change reaches everyone within BG_SYNC_MINUTES.
//
// Cost: templates are fetched DIRECTLY from Salesforce (not via the Cloudflare
// worker), so this poll adds NO worker requests — the worker is only hit by the
// occasional OAuth token refresh (~once per ~2h token lifetime, independent of
// sync frequency). The poll is further gated to connected users who actually have
// a Salesforce tab open, so idle installs make zero requests.
var BG_SYNC_ALARM   = 'cyforTemplateSync';
var BG_SYNC_MINUTES = 20;

// Create the alarm only if it doesn't already exist, so frequent service-worker
// restarts can't keep resetting (and thus never firing) the timer.
function ensureSyncAlarm() {
    try {
        chrome.alarms.get(BG_SYNC_ALARM, (existing) => {
            if (!existing) chrome.alarms.create(BG_SYNC_ALARM, { periodInMinutes: BG_SYNC_MINUTES });
        });
    } catch (e) { /* alarms unavailable */ }
}
chrome.runtime.onInstalled.addListener(ensureSyncAlarm);
chrome.runtime.onStartup.addListener(ensureSyncAlarm);
ensureSyncAlarm(); // also on service-worker spin-up

// True only when the user has Salesforce open (so we don't poll for idle installs).
// Fails open if the query can't run, so we never silently stop syncing.
function hasSalesforceTabOpen() {
    return new Promise((resolve) => {
        try {
            chrome.tabs.query(
                { url: ['https://*.lightning.force.com/*', 'https://*.my.salesforce.com/*'] },
                (tabs) => {
                    if (chrome.runtime.lastError) { resolve(true); return; }
                    resolve(Array.isArray(tabs) && tabs.length > 0);
                }
            );
        } catch (e) { resolve(true); }
    });
}

async function runBackgroundSync() {
    if (!self.SfOAuth || !self.SfTemplates) return;
    var stored = await chrome.storage.local.get(['sfOAuthTokens']);
    if (!stored.sfOAuthTokens || !stored.sfOAuthTokens.accessToken) return; // not connected
    if (!(await hasSalesforceTabOpen())) return;                            // not actively using SF
    try { await self.SfTemplates.fetchRemoteTemplates(true); } catch (e) { /* retry next cycle */ }
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === BG_SYNC_ALARM) runBackgroundSync();
});

// ── Lazy report-script injection ──────────────────────────────────────────────
// The disclosure-report generator + its in-page button injector are only useful
// on Forensic Case record pages, so they are NOT in manifest content_scripts.
// They're injected on demand here (and ensured before a popup-triggered export),
// which keeps ~47 KB of script + a per-page MutationObserver/1s timer off every
// other Salesforce page. The scripts self-guard (window.__cyforCaseReportLoaded),
// so re-injection is harmless.
var REPORT_FILES = ['report/disclosure-report.js', 'content/case-report.js'];
var injectedReportTabs = new Set();

function isForensicCaseUrl(url) {
    var m = (url || '').match(/\/lightning\/r\/([^/]+)\/[^/]+\/view/);
    return !!(m && /forensic.*case/i.test(m[1]));
}

function injectReportScripts(tabId) {
    return chrome.scripting.executeScript({ target: { tabId: tabId }, files: REPORT_FILES })
        .then(() => { injectedReportTabs.add(tabId); return true; })
        .catch(() => false); // tab navigated away / not injectable
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // A full navigation starting tears down the page (and our injected script) —
    // allow re-injection on the next 'complete'.
    if (changeInfo.status === 'loading') injectedReportTabs.delete(tabId);

    // Inject on full load (status complete) AND on Lightning SPA URL changes.
    var url = changeInfo.url || (changeInfo.status === 'complete' ? (tab && tab.url) : null);
    if (!url || !isForensicCaseUrl(url) || injectedReportTabs.has(tabId)) return;
    injectReportScripts(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => injectedReportTabs.delete(tabId));

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Defense-in-depth: only handle messages from this extension's own content
    // scripts and pages (web-page JS can't reach onMessage, but this documents
    // and enforces the boundary regardless).
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (!message || !message.action) return;

    // Health check
    if (message.action === 'ping') {
        sendResponse({ status: 'ok', version: chrome.runtime.getManifest().version });
        return true;
    }

    // Download a single file via chrome.downloads
    if (message.action === 'downloadOne') {
        downloadOneFile(message)
            .then((result) => sendResponse(result))
            .catch((err) => {
                console.warn('[CYFOR] downloadOne error:', err);
                sendResponse({
                    success: false,
                    downloadId: null,
                    error: err.message || 'Download failed'
                });
            });
        return true;
    }

    // Launch Salesforce OAuth PKCE flow
    if (message.action === 'sfOAuth.connect') {
        if (!self.SfOAuth) { sendResponse({ ok: false, error: 'OAuth module not loaded' }); return true; }
        self.SfOAuth.launchOAuthFlow()
            .then((result) => sendResponse(result))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // Disconnect (clear tokens + revoke)
    if (message.action === 'sfOAuth.disconnect') {
        if (!self.SfOAuth) { sendResponse({ ok: false }); return true; }
        self.SfOAuth.disconnectOAuth()
            .then(() => sendResponse({ ok: true }))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // Fetch the connected user's Salesforce profile photo as a data URL
    if (message.action === 'sfOAuth.getProfilePhoto') {
        if (!self.SfOAuth || !self.SfOAuth.getProfilePhotoDataUrl) { sendResponse({ ok: false }); return true; }
        self.SfOAuth.getProfilePhotoDataUrl()
            .then((dataUrl) => sendResponse({ ok: true, dataUrl: dataUrl }))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // Fetch/sync templates from Salesforce
    if (message.action === 'sfTemplates.sync') {
        if (!self.SfTemplates) { sendResponse({ ok: false, error: 'Templates module not loaded' }); return true; }
        self.SfTemplates.fetchRemoteTemplates(message.forceRefresh === true)
            .then((result) => sendResponse(result))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // List templates for the manager page (includes id, teamCode, UKAS fields per entry)
    if (message.action === 'sfTemplates.list') {
        chrome.storage.local.get(['sfRemoteTemplates', 'sfOAuthUser'], function (r) {
            sendResponse({
                ok:        true,
                templates: r.sfRemoteTemplates || {},
                user:      r.sfOAuthUser       || {}
            });
        });
        return true;
    }

    // Admin "manage all teams" view — live query of EVERY template (all teams +
    // global, all statuses). Used by the manager (not the popup sync).
    if (message.action === 'sfTemplates.listAll') {
        if (!self.SfTemplates || !self.SfTemplates.fetchAllTemplatesForAdmin) {
            sendResponse({ ok: false, error: 'Templates module not loaded' }); return true;
        }
        self.SfTemplates.fetchAllTemplatesForAdmin()
            .then((r) => sendResponse(r))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    // List all active teams — for the manager's "assign to any team" picker.
    if (message.action === 'sfTeams.list') {
        (async function () {
            try {
                var stored = await chrome.storage.local.get('sfOAuthTokens');
                var instanceUrl = ((stored.sfOAuthTokens || {}).instanceUrl || '').replace(/\/$/, '');
                if (!instanceUrl || !self.SfTeam || !self.SfTeam.fetchAllTeams) {
                    sendResponse({ ok: false, teams: [] }); return;
                }
                var token = await self.SfOAuth.getValidAccessToken();
                var teams = await self.SfTeam.fetchAllTeams(instanceUrl, token);
                sendResponse({ ok: true, teams: teams });
            } catch (e) { sendResponse({ ok: false, teams: [], error: e.message }); }
        })();
        return true;
    }

    // Fetch version history for a single template
    if (message.action === 'sfTemplates.versions.get') {
        if (!self.SfVersions) { sendResponse({ ok: false, error: 'Versions module not loaded' }); return true; }
        self.SfVersions.getVersionHistory(message.templateId)
            .then((r) => sendResponse(r))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    // Create a new template in Salesforce
    if (message.action === 'sfTemplates.create') {
        sfTemplateCrud('create', message.payload)
            .then((r) => sendResponse(r))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    // Update an existing template in Salesforce
    if (message.action === 'sfTemplates.update') {
        sfTemplateCrud('update', message.payload)
            .then((r) => sendResponse(r))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    // Delete a template from Salesforce
    if (message.action === 'sfTemplates.delete') {
        sfTemplateCrud('delete', message.payload)
            .then((r) => sendResponse(r))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    // Open file explorer showing a specific download
    if (message.action === 'showDownload') {
        try {
            if (message.downloadId) {
                chrome.downloads.show(message.downloadId);
            } else {
                chrome.downloads.showDefaultFolder();
            }
        } catch (e) {
            console.warn('[CYFOR] showDownload error:', e);
        }
        sendResponse({ ok: true });
        return true;
    }

    // Ensure the lazy-injected report scripts are present in a tab before the
    // popup triggers an export (covers the race where the popup opens the instant
    // a case page loads, before onUpdated injection has run).
    if (message.action === 'caseReport.ensureInjected') {
        var tid = (typeof message.tabId === 'number') ? message.tabId
                : (sender.tab && sender.tab.id);
        if (typeof tid !== 'number') { sendResponse({ ok: false }); return true; }
        injectReportScripts(tid).then((ok) => sendResponse({ ok: ok }));
        return true;
    }

    // Live-fetch a Forensic Case bundle for the disclosure report generator
    if (message.action === 'caseReport.fetch') {
        if (!self.CaseReportFetch) { sendResponse({ ok: false, error: 'Case report module not loaded' }); return true; }
        self.CaseReportFetch.fetchCaseBundle({ caseObject: message.caseObject, caseId: message.caseId })
            .then((data) => sendResponse({ ok: true, data: data }))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // ════════════════════════════════════════════════════════════════════════
    // MG22A / MG22B report handlers — OWNED BY MITUL (WIP; UI hidden via the
    // MG22_ENABLED flag in content/case-report.js). These remain registered but
    // are never reached while the button is hidden. Left intact for Mitul.
    // ════════════════════════════════════════════════════════════════════════
    // List the MG22 report templates available to this user (team-scoped)
    if (message.action === 'report.listTemplates') {
        if (!self.SfReportTemplates) { sendResponse({ ok: false, error: 'Report module not loaded' }); return true; }
        self.SfReportTemplates.listReportTemplates()
            .then((templates) => sendResponse({ ok: true, templates: templates }))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // Generate a filled .docx report from a template + the live case data
    if (message.action === 'report.generate') {
        generateReport(message)
            .then((r) => sendResponse(r))
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
    }
});

// MG22A / MG22B (Mitul): fetch template + case bundle, map to placeholders, fill
// the .docx, return base64. Reached only when the MG22 UI flag is enabled.
async function generateReport(message) {
    if (!self.SfReportTemplates || !self.CaseReportFetch || !self.MgExtract || !self.DocxFill) {
        throw new Error('Report modules not loaded');
    }
    const templateBytes = await self.SfReportTemplates.fetchTemplateFile(message.templateId);
    const bundle = await self.CaseReportFetch.fetchCaseBundle({
        caseObject: message.caseObject, caseId: message.caseId
    });
    const stored = await chrome.storage.local.get(['sfOAuthUser', 'mgReportConfig']);
    const data = self.MgExtract.buildReportData(bundle, stored.sfOAuthUser || {}, stored.mgReportConfig || {}, new Date());

    // Fill occurrence no / date of offence from an MG21 attached to the case,
    // if the Salesforce fields didn't supply them. Best-effort, never fatal.
    try {
        if (!data.occurrenceNo || !data.dateOfOffence) {
            const mg21 = await self.SfReportTemplates.fetchMg21Data(message.caseId);
            if (mg21.occurrenceNo && !data.occurrenceNo) data.occurrenceNo = mg21.occurrenceNo;
            if (mg21.dateOfOffence && !data.dateOfOffence) data.dateOfOffence = mg21.dateOfOffence;
        }
    } catch (e) { /* MG21 optional */ }

    const filled = self.DocxFill.fill(templateBytes, data);
    const caseRef = (data.caseReference || 'Case').replace(/[<>:"/\\|?*]+/g, '_');
    const label = (message.templateName || 'Report').replace(/[<>:"/\\|?*]+/g, '_');
    return {
        ok: true,
        base64: uint8ToBase64(filled),
        filename: caseRef + ' - ' + label + '.docx',
        meta: { warnings: (bundle.meta && bundle.meta.warnings) || [] }
    };
}

// Service-worker-safe base64 of a Uint8Array (chunked to avoid call-stack limits).
function uint8ToBase64(u8) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
        binary += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunk, u8.length)));
    }
    return btoa(binary);
}

// ── UKAS document-control date helpers ────────────────────────────────────────
// Effective Date and Review Due Date must never be blank on a controlled
// document, so we default them: effective = today, review = effective + N months.
function todayIso() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (Salesforce Date)
}
function addMonthsIso(isoDate, months) {
    var d = new Date((isoDate || todayIso()) + 'T00:00:00Z');
    if (isNaN(d.getTime())) d = new Date();
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
}
var REVIEW_PERIOD_MONTHS = 12;

/**
 * Translate a Salesforce delete failure (errorCode or raw message) into a clear,
 * actionable message. Salesforce sharing/permissions aren't something the
 * extension can grant — so for access errors we point the user at an admin.
 */
function friendlyDeleteError(codeOrMsg, fallback, subject) {
    var s = String(codeOrMsg || '').toUpperCase();
    if (s.indexOf('INSUFFICIENT_ACCESS') !== -1 || s.indexOf('INSUFFICIENT ACCESS') !== -1) {
        if (subject === 'versions') {
            // A template with history can't be deleted until its child version
            // records are — which needs Delete on the version OBJECT (and, if any
            // were created by someone else's edit, Modify All to cross ownership).
            return 'Couldn’t delete this template’s version history in Salesforce, so the '
                 + 'template can’t be removed. You need Delete access on the Nucleus Template '
                 + 'Version object — ask a Salesforce admin to grant Delete (or “Modify All”) on '
                 + 'NucleusTemplateVersion__c. (Some versions may have been created by another '
                 + 'user’s edit, which also requires Modify All.)';
        }
        return 'You don’t have permission to delete this template in Salesforce. '
             + 'It may be owned by another user or team — ask a Salesforce admin to '
             + 'delete it or grant you delete access (or “Modify All” on NucleusTemplate__c).';
    }
    if (s.indexOf('DELETE_FAILED') !== -1 || s.indexOf('REFERENCED') !== -1 || s.indexOf('RESTRICT') !== -1) {
        return 'This template is still referenced by other records in Salesforce, so it '
             + 'can’t be deleted. Remove those references first, or ask a Salesforce admin.';
    }
    return fallback || String(codeOrMsg || 'Delete failed');
}

/**
 * Create, update, or delete a NucleusTemplate__c record via Salesforce REST API.
 * Only proceeds if the stored sfOAuthUser has isTemplateAdmin === true.
 * When UKAS fields are available, includes version control data and archives
 * the previous version to NucleusTemplateVersion__c before any update.
 */
async function sfTemplateCrud(op, payload) {
    var stored = await chrome.storage.local.get(
        ['sfOAuthUser', 'sfOAuthConfig', 'sfOAuthTokens', 'sfRemoteTemplates']
    );
    var user      = stored['sfOAuthUser']      || {};
    var config    = stored['sfOAuthConfig']    || {};
    var tokens    = stored['sfOAuthTokens']    || {};
    var templates = stored['sfRemoteTemplates'] || {};

    if (!user.isTemplateAdmin) throw new Error('PERMISSION_DENIED');

    var instanceUrl = (tokens.instanceUrl || config.instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) throw new Error('No Salesforce instance URL');

    var accessToken;
    try { accessToken = await self.SfOAuth.getValidAccessToken(); }
    catch (e) { throw new Error('NOT_AUTHENTICATED'); }

    var apiVersion = config.apiVersion || 'v62.0';
    var base       = instanceUrl + '/services/data/' + apiVersion;
    var obj        = config.templateObject || 'NucleusTemplate__c';
    var baseUrl    = base + '/sobjects/' + obj;

    // Discover the real field API names (same resolution the sync uses), so we
    // write to the fields that actually exist regardless of how they're named.
    var map = await self.SfTemplates.resolveTemplateFields(base, accessToken, obj);

    // Team assignment: admins can target any team by Id ('' / null = Global).
    // Falls back to the legacy teamScope / own-team behaviour if no teamId given.
    var resolveTeamId = function () {
        if (payload.teamId !== undefined && payload.teamId !== null) return payload.teamId || null;
        if (payload.teamScope === 'global') return null;
        return user.teamId || null;
    };
    // Only "Active" status publishes to analysts (others stay hidden from sync).
    var isActiveForStatus = function () { return (payload.status || 'Active') === 'Active'; };

    var response, errBody;

    if (op === 'create') {
        var createBody = { Name: payload.name };
        if (map.content)  createBody[map.content]  = payload.content;
        if (map.category) createBody[map.category] = payload.category || '';
        if (map.active)   createBody[map.active]   = isActiveForStatus();
        if (map.team)     createBody[map.team]     = resolveTeamId();
        if (map.versionLabel)  createBody[map.versionLabel]  = payload.versionLabel || '1.0';
        if (map.status)        createBody[map.status]        = payload.status || 'Active';
        if (map.changeReason)  createBody[map.changeReason]  = payload.changeReason || 'Initial version';
        if (map.documentId && payload.documentId)   createBody[map.documentId]    = payload.documentId;
        // UKAS dates are always populated (never blank): default effective=today,
        // review=effective + review period.
        var createEffective = payload.effectiveDate || todayIso();
        var createReview    = payload.reviewDueDate || addMonthsIso(createEffective, REVIEW_PERIOD_MONTHS);
        if (map.effectiveDate) createBody[map.effectiveDate] = createEffective;
        if (map.reviewDueDate) createBody[map.reviewDueDate] = createReview;

        response = await fetch(baseUrl + '/', {
            method:  'POST',
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
            body:    JSON.stringify(createBody)
        });
        if (!response.ok) {
            errBody = await response.json().catch(function () { return [{}]; });
            throw new Error(errBody[0] && errBody[0].message ? errBody[0].message : 'Create failed: ' + response.status);
        }
        var created = await response.json();
        await self.SfTemplates.fetchRemoteTemplates(true);
        return { ok: true, id: created.id };

    } else if (op === 'update') {
        // NOTE: version snapshots are created by the Salesforce Flow on Content
        // change (docs/salesforce-version-history-flow.md) — the extension must
        // NOT archive here too, or every edit would snapshot twice.

        var updateBody = { Name: payload.name };
        if (map.content)  updateBody[map.content]  = payload.content;
        if (map.category) updateBody[map.category] = payload.category || '';
        if (map.active)   updateBody[map.active]   = isActiveForStatus();
        if (map.team)     updateBody[map.team]     = resolveTeamId();
        if (map.versionLabel)  updateBody[map.versionLabel]  = payload.versionLabel || '1.1';
        if (map.status)        updateBody[map.status]        = payload.status || 'Active';
        // Only write a change reason when one was supplied (content edits). A
        // metadata-only edit sends no reason and must not blank the existing one.
        if (map.changeReason && payload.changeReason) updateBody[map.changeReason] = payload.changeReason;
        // A new version becomes effective when it's saved; default to today and
        // recompute the review date so neither field is ever left blank.
        var updateEffective = payload.effectiveDate || todayIso();
        var updateReview    = payload.reviewDueDate || addMonthsIso(updateEffective, REVIEW_PERIOD_MONTHS);
        if (map.effectiveDate) updateBody[map.effectiveDate] = updateEffective;
        if (map.reviewDueDate) updateBody[map.reviewDueDate] = updateReview;

        response = await fetch(baseUrl + '/' + payload.id, {
            method:  'PATCH',
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
            body:    JSON.stringify(updateBody)
        });
        if (!response.ok) {
            errBody = await response.json().catch(function () { return [{}]; });
            throw new Error(errBody[0] && errBody[0].message ? errBody[0].message : 'Update failed: ' + response.status);
        }
        await self.SfTemplates.fetchRemoteTemplates(true);
        return { ok: true };

    } else if (op === 'delete') {
        // Remove child version snapshots first — the NucleusTemplate__c lookup on
        // NucleusTemplateVersion__c restricts the parent delete while they exist.
        if (self.SfVersions) {
            var vres = await self.SfVersions.deleteVersionsForTemplate(payload.id);
            if (vres && vres.ok === false) {
                throw new Error(friendlyDeleteError(vres.error,
                    'Couldn’t remove this template’s version history: ' + vres.error, 'versions'));
            }
        }

        response = await fetch(baseUrl + '/' + payload.id, {
            method:  'DELETE',
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });
        if (!response.ok) {
            errBody = await response.json().catch(function () { return [{}]; });
            var rawMsg = (errBody[0] && errBody[0].message) ? errBody[0].message : ('Delete failed: ' + response.status);
            var code   = errBody[0] && errBody[0].errorCode;
            throw new Error(friendlyDeleteError(code || rawMsg, rawMsg));
        }
        await self.SfTemplates.fetchRemoteTemplates(true);
        return { ok: true };
    }

    throw new Error('Unknown CRUD operation: ' + op);
}

/**
 * Download a single file using chrome.downloads.download().
 */
async function downloadOneFile(msg) {
    const { url, filename, subfolder } = msg;

    const cleanFolder = (subfolder || '')
        .trim()
        .replace(/^[/\\]+|[/\\]+$/g, '')
        .replace(/[<>:"|?*\x00-\x1F]/g, '_')
        .replace(/[/\\]{2,}/g, '/');

    const options = {
        url: url,
        conflictAction: 'uniquify'
    };

    if (filename) {
        options.filename = cleanFolder ? cleanFolder + '/' + filename : filename;
    } else if (cleanFolder) {
        options.filename = cleanFolder + '/photograph';
    }

    const downloadId = await chrome.downloads.download(options);

    const result = await new Promise((resolve) => {
        setTimeout(async () => {
            try {
                const [item] = await chrome.downloads.search({ id: downloadId });
                if (item && item.error) {
                    resolve({ success: false, downloadId: downloadId, error: item.error });
                } else if (item && item.state === 'interrupted') {
                    resolve({ success: false, downloadId: downloadId, error: item.error || 'Download interrupted' });
                } else {
                    resolve({ success: true, downloadId: downloadId });
                }
            } catch (e) {
                resolve({ success: true, downloadId: downloadId });
            }
        }, 300);
    });

    return result;
}
