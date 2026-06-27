// ==================================================
// CYFOR Nucleus Enhancer — Popup Orchestrator
// Shared state, helpers, and initialization.
// Auth: popup-auth.js | Columns: popup-columns.js | Templates: popup-templates.js
// ==================================================

// ==========================================
// SHARED STATE (referenced by all modules)
// ==========================================
var els = {};
var toggles = {};
var currentUserTemplates = {};
var currentMergedTemplates = {};
var currentTableContextId = null;
var currentTableColumns = [];
// Names of official (Salesforce-synced) templates — i.e. merged entries that
// are not user uploads. (Historically called "built-in"; built-ins are gone.)
var builtinTemplateKeys = [];
var officialCategories  = {};   // name → category, so Quick Insert can show categories

// Popup-side mirror of content/builtin-templates.js `Cyfor.getMergedTemplates`.
// It can't call that function directly (it lives in the content-script world and
// merges from RAW sfRemoteTemplates), so this re-derives the same precedence from
// what the popup already has: the previously-stored merged map. The single rule
// both must honour — OFFICIAL (Salesforce-synced) wins over a same-named user
// upload — is enforced here by overlaying the official keys last. Keep the two in
// sync if that precedence ever changes.
function mergeTemplates(userTemplates) {
    var merged = {};
    if (userTemplates) {
        for (var key in userTemplates) merged[key] = userTemplates[key];
    }
    builtinTemplateKeys.forEach(function (k) {
        if (currentMergedTemplates[k] !== undefined) merged[k] = currentMergedTemplates[k];
    });
    return merged;
}

// ==========================================
// SHARED HELPERS
// ==========================================
function setStatus(msg, type) {
    type = type || 'info';
    els.statusMsg.textContent = msg;
    els.statusMsg.className = 'status-msg status-' + type;
}

function readFile(file) {
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
            resolve({ name: file.name.replace(/\.txt$/i, ''), text: reader.result });
        };
        reader.onerror = function () { reject(new Error('Failed to read ' + file.name)); };
        reader.readAsText(file);
    });
}

function shakeElement(el) {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'cyforShake 0.4s ease';
    setTimeout(function () { el.style.animation = ''; }, 450);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', function () {

    // Element references
    toggles = {
        enableDate:        document.getElementById('opt-date'),
        enableContextMenu: document.getElementById('opt-context-menu'),
        enableNav:         document.getElementById('opt-nav'),
        enableFormatNotes: document.getElementById('opt-format-notes'),
        enableAutoInsert:  document.getElementById('opt-auto-insert'),
        enableCaseAlias:   document.getElementById('opt-case-alias')
    };

    els = {
        columnList:         document.getElementById('column-list'),
        btnResetCols:       document.getElementById('btn-reset-cols'),
        tableContextLbl:    document.getElementById('table-context-label'),
        folderInput:        document.getElementById('folder-input'),
        statusMsg:          document.getElementById('status-msg'),
        mappingList:        document.getElementById('mapping-list'),
        templateSelect:     document.getElementById('template-select'),
        insertBtn:          document.getElementById('btn-insert'),
        previewBtn:         document.getElementById('btn-preview'),
        clearBtn:           document.getElementById('btn-clear'),
        templateBadge:      document.getElementById('template-badge'),
        uploadArea:         document.getElementById('upload-area'),
        versionLabel:       document.getElementById('version-label'),
        connectionBar:      document.getElementById('connection-bar'),
        connectionText:     document.getElementById('connection-text'),
        previewSection:     document.getElementById('preview-section'),
        previewContent:     document.getElementById('preview-content'),
        previewClose:       document.getElementById('btn-preview-close'),
        sfTemplatesBadge:       document.getElementById('sf-templates-badge'),
        sfConnectedName:        document.getElementById('sf-connected-name'),
        sfSyncRow:              document.getElementById('sf-sync-row'),
        sfTemplateCount:        document.getElementById('sf-template-count'),
        sfSyncStatus:           document.getElementById('sf-sync-status'),
        sfProxyUrl:             document.getElementById('sf-proxy-url'),
        sfConfigStatus:         document.getElementById('sf-config-status'),
        sfOAuthConnectBtn:      document.getElementById('btn-sf-oauth-connect'),
        sfOAuthDisconnectBtn:   document.getElementById('btn-sf-oauth-disconnect'),
        sfSyncNowBtn:           document.getElementById('btn-sf-sync-now'),
        sfConfigSaveBtn:        document.getElementById('btn-sf-config-save'),
        sfConfigSection:        document.getElementById('sf-config-section')
    };

    els.versionLabel.textContent = 'v' + chrome.runtime.getManifest().version;

    // Feature toggles are per-device — stored in (and read by the content scripts
    // from) chrome.storage.local. Theme and pinned templates sync on their own.
    loadSettings(chrome.storage.local);
});

function loadSettings(settingsStore) {
    // Toggle settings come from settingsStore (local or sync)
    // Template/auth data always comes from local (content script only writes there)
    settingsStore.get(
        ['enableDate', 'enableContextMenu', 'enableNav', 'enableFormatNotes', 'enableAutoInsert', 'enableCaseAlias'],
        function (toggleResult) {
            var t = toggleResult || {};
            toggles.enableDate.checked        = t.enableDate !== false;
            toggles.enableContextMenu.checked = t.enableContextMenu !== false;
            toggles.enableNav.checked         = t.enableNav !== false;
            toggles.enableFormatNotes.checked = t.enableFormatNotes !== false;
            toggles.enableAutoInsert.checked  = t.enableAutoInsert === true;
            toggles.enableCaseAlias.checked   = t.enableCaseAlias !== false;
        }
    );

    // Template data always from local storage
    chrome.storage.local.get(
        ['nucleusTemplates', 'mergedTemplates', 'processMap', 'sfRemoteTemplates'],
        function (result) {
            var r = result || {};

            currentUserTemplates   = r.nucleusTemplates || {};
            currentMergedTemplates = r.mergedTemplates || {};
            builtinTemplateKeys    = Object.keys(currentMergedTemplates).filter(function (k) {
                return !currentUserTemplates.hasOwnProperty(k);
            });
            officialCategories = {};
            var _srt = r.sfRemoteTemplates || {};
            Object.keys(_srt).forEach(function (k) {
                if (_srt[k] && _srt[k].category) officialCategories[k] = String(_srt[k].category);
            });
            var savedMap = r.processMap || {};

            updateBadge(Object.keys(currentMergedTemplates).length);
            populateDropdown(currentMergedTemplates);
            updateClearBtn(Object.keys(currentUserTemplates).length);

            initTemplates(savedMap);
            bindColumnEvents();
            loadSfTemplatesSection();
            loadCaseReportSection();

            if (Object.keys(currentUserTemplates).length > 0) {
                var n = Object.keys(currentUserTemplates).length;
                setStatus(n + ' user template' + (n !== 1 ? 's' : '') + ' loaded · ' +
                    builtinTemplateKeys.length + ' official', 'success');
            }
        }
    );

    // Save toggles on change (per-device, local storage).
    Object.keys(toggles).forEach(function (key) {
        var el = toggles[key];
        el.addEventListener('change', function () {
            var obj = {};
            obj[key] = el.checked;
            chrome.storage.local.set(obj);

            var row = el.closest('.option-row');
            if (row) {
                // Theme-aware "saved" flash (was a hardcoded light blue that hid
                // the light text in dark mode).
                row.style.backgroundColor = 'var(--accent-soft)';
                setTimeout(function () { row.style.backgroundColor = ''; }, 300);
            }
        });
    });

    checkConnection();
}

function checkConnection() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs[0];
        if (!tab || !tab.url || tab.url.indexOf('lightning.force.com') === -1) {
            setConnection('disconnected', 'Not on a Salesforce page');
            renderNoTable();
            return;
        }

        chrome.tabs.sendMessage(tab.id, { action: 'ping' }, function (response) {
            if (chrome.runtime.lastError || !response) {
                setConnection('disconnected', 'Content script not loaded — refresh the page');
                renderNoTable();
            } else {
                setConnection('connected', 'Connected to Salesforce tab');
                initColumns();
            }
        });
    });
}

function setConnection(state, text) {
    els.connectionBar.className = 'connection-bar ' + state;
    els.connectionText.textContent = text;
}
