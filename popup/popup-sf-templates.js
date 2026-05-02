// ==================================================
// CYFOR Nucleus Enhancer — Salesforce Templates (Popup)
// OAuth connect/disconnect, template sync, and
// configuration UI for the Salesforce Templates section.
// ==================================================

function loadSfTemplatesSection() {
    // Display the stable OAuth callback URL so admin can verify whitelist
    chrome.runtime.sendMessage({ action: 'sfOAuth.getRedirectUrl' }, function (response) {
        if (chrome.runtime.lastError) return;
        var urlEl = document.getElementById('sf-redirect-url');
        if (urlEl && response && response.redirectUrl) {
            urlEl.value = response.redirectUrl;
        }
    });

    // Populate saved config fields
    chrome.storage.local.get(['sfOAuthConfig', 'sfOAuthTokens', 'sfOAuthUser', 'sfRemoteTemplates', 'sfTemplatesSyncedAt'], function (r) {
        var config  = r.sfOAuthConfig || {};
        var tokens  = r.sfOAuthTokens || {};
        var user    = r.sfOAuthUser   || null;

        var clientIdEl     = document.getElementById('sf-client-id');
        var instanceUrlEl  = document.getElementById('sf-instance-url');
        if (clientIdEl    && config.clientId)    clientIdEl.value    = config.clientId;
        if (instanceUrlEl && config.instanceUrl) instanceUrlEl.value = config.instanceUrl;

        var isConnected = !!(tokens.accessToken);
        renderSfTemplatesStatus({ connected: isConnected, user: user });

        if (isConnected) {
            var count = Object.keys(r.sfRemoteTemplates || {}).length;
            updateSfTemplateCount(count);
            if (r.sfTemplatesSyncedAt) {
                setSfSyncStatus(count + ' official template' + (count !== 1 ? 's' : '') + ' · Last synced ' + formatTimeAgo(r.sfTemplatesSyncedAt), 'success');
            }
            // Auto-sync on popup open if cache is stale
            var cacheAge = r.sfTemplatesSyncedAt ? (Date.now() - r.sfTemplatesSyncedAt) : Infinity;
            if (cacheAge > 20 * 60 * 1000) {
                syncSfTemplates(false);
            }
        }
    });

    bindSfTemplateActions();
}

function bindSfTemplateActions() {
    var connectBtn    = document.getElementById('btn-sf-oauth-connect');
    var disconnectBtn = document.getElementById('btn-sf-oauth-disconnect');
    var syncBtn       = document.getElementById('btn-sf-sync-now');
    var saveBtn       = document.getElementById('btn-sf-config-save');
    var copyBtn       = document.getElementById('btn-copy-redirect');

    if (connectBtn) {
        connectBtn.addEventListener('click', function () {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting…';
            setSfSyncStatus('', '');

            chrome.runtime.sendMessage({ action: 'sfOAuth.connect' }, function (response) {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect via Salesforce OAuth';

                if (chrome.runtime.lastError || !response || !response.ok) {
                    var err = (response && response.error) || 'Connection failed';
                    if (err === 'NOT_CONFIGURED') {
                        renderSfTemplatesStatus({ connected: false, error: 'Enter your Consumer Key and Instance URL below first.' });
                        var cfgSection = document.getElementById('sf-config-section');
                        if (cfgSection) cfgSection.open = true;
                    } else {
                        renderSfTemplatesStatus({ connected: false, error: err });
                    }
                    return;
                }

                renderSfTemplatesStatus({ connected: true, user: response.user });
                syncSfTemplates(true);
            });
        });
    }

    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', function () {
            disconnectBtn.disabled = true;
            chrome.runtime.sendMessage({ action: 'sfOAuth.disconnect' }, function () {
                disconnectBtn.disabled = false;
                renderSfTemplatesStatus({ connected: false });
                updateSfTemplateCount(0);
                setSfSyncStatus('', '');
                // Recompute merged templates without remote ones
                chrome.storage.local.get(['mergedTemplates'], function (r) {
                    currentMergedTemplates = r.mergedTemplates || {};
                    populateDropdown(currentMergedTemplates);
                    updateBadge(Object.keys(currentMergedTemplates).length);
                });
            });
        });
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', function () {
            syncSfTemplates(true);
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', saveSfConfig);
    }

    var manageBtn = document.getElementById('btn-manage-templates');
    if (manageBtn) {
        manageBtn.addEventListener('click', function () {
            chrome.tabs.create({ url: chrome.runtime.getURL('manager/manager.html') });
        });
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', function () {
            var urlEl = document.getElementById('sf-redirect-url');
            if (!urlEl || !urlEl.value) return;
            navigator.clipboard.writeText(urlEl.value).then(function () {
                copyBtn.textContent = 'Copied!';
                setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
            }).catch(function () {
                urlEl.select();
                document.execCommand('copy');
                copyBtn.textContent = 'Copied!';
                setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
            });
        });
    }
}

function saveSfConfig() {
    var clientId    = (document.getElementById('sf-client-id')    || {}).value || '';
    var instanceUrl = (document.getElementById('sf-instance-url') || {}).value || '';
    var statusEl    = document.getElementById('sf-config-status');

    clientId    = clientId.trim();
    instanceUrl = instanceUrl.trim().replace(/\/$/, '');

    if (!clientId || !instanceUrl) {
        setSfConfigStatus('Consumer Key and Instance URL are both required.', 'error');
        return;
    }
    if (!/^https:\/\//i.test(instanceUrl)) {
        setSfConfigStatus('Instance URL must start with https://', 'error');
        return;
    }

    chrome.storage.local.get(['sfOAuthConfig'], function (r) {
        var existing = r.sfOAuthConfig || {};
        var updated  = Object.assign({}, existing, {
            clientId:    clientId,
            instanceUrl: instanceUrl
        });
        chrome.storage.local.set({ sfOAuthConfig: updated }, function () {
            setSfConfigStatus('Saved.', 'success');
        });
    });
}

function syncSfTemplates(forceRefresh) {
    var syncBtn = document.getElementById('btn-sf-sync-now');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'Syncing…'; }
    setSfSyncStatus('Syncing…', '');

    chrome.runtime.sendMessage({ action: 'sfTemplates.sync', forceRefresh: !!forceRefresh }, function (response) {
        if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = 'Sync Now'; }

        if (chrome.runtime.lastError || !response || !response.ok) {
            var err = (response && response.error) || 'Sync failed';
            setSfSyncStatus('Sync failed: ' + err, 'error');
            return;
        }

        var templates = response.templates || {};
        var count     = Object.keys(templates).length;
        var when      = response.fromCache ? 'Cached' : 'Just now';
        setSfSyncStatus(count + ' official template' + (count !== 1 ? 's' : '') + ' · ' + when, 'success');
        updateSfTemplateCount(count);

        // Refresh the popup's template dropdown with the newly merged set
        chrome.storage.local.get(['mergedTemplates'], function (r) {
            currentMergedTemplates = r.mergedTemplates || {};
            populateDropdown(currentMergedTemplates);
            updateBadge(Object.keys(currentMergedTemplates).length);
        });
    });
}

// ── UI state helpers ──────────────────────────────────────────────────────────

function renderSfTemplatesStatus(state) {
    var badge         = document.getElementById('sf-templates-badge');
    var nameEl        = document.getElementById('sf-connected-name');
    var connectBtn    = document.getElementById('btn-sf-oauth-connect');
    var disconnectBtn = document.getElementById('btn-sf-oauth-disconnect');
    var syncRow       = document.getElementById('sf-sync-row');

    if (!badge) return;

    if (state && state.connected) {
        badge.textContent = 'Connected';
        badge.className   = 'badge badge-success';

        var displayName = '';
        if (state.user) {
            displayName = state.user.fullName || state.user.email || state.user.username || '';
            var teamPart = state.user.teamName ? ' · ' + state.user.teamName : '';
            displayName = displayName + teamPart;
        }
        if (nameEl) nameEl.textContent = displayName ? 'Connected as ' + displayName : 'Connected to Salesforce';

        if (connectBtn)    { connectBtn.style.display    = 'none'; }
        if (disconnectBtn) { disconnectBtn.style.display = ''; }
        if (syncRow)       { syncRow.style.display       = ''; }

        var manageBtn = document.getElementById('btn-manage-templates');
        if (manageBtn) {
            manageBtn.style.display = (state.user && state.user.isTemplateAdmin) ? '' : 'none';
        }
    } else {
        badge.textContent = 'Not connected';
        badge.className   = 'badge badge-empty';

        var msg = (state && state.error) ? state.error : 'Connect to sync official templates';
        if (nameEl) nameEl.textContent = msg;

        if (connectBtn)    { connectBtn.style.display = ''; connectBtn.disabled = false; }
        if (disconnectBtn) { disconnectBtn.style.display = 'none'; }
        if (syncRow)       { syncRow.style.display = 'none'; }

        var manageBtn = document.getElementById('btn-manage-templates');
        if (manageBtn) { manageBtn.style.display = 'none'; }
    }
}

function updateSfTemplateCount(count) {
    var countEl = document.getElementById('sf-template-count');
    if (countEl) countEl.textContent = count;
}

function setSfSyncStatus(msg, type) {
    var el = document.getElementById('sf-sync-status');
    if (!el) return;
    el.textContent  = msg;
    el.className    = 'sf-sync-status' + (type ? ' status-' + type : '');
}

function setSfConfigStatus(msg, type) {
    var el = document.getElementById('sf-config-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'status-msg status-' + (type || 'info');
    setTimeout(function () {
        if (el.textContent === msg) { el.textContent = ''; el.className = 'status-msg'; }
    }, 4000);
}

function formatTimeAgo(timestamp) {
    var diff = Date.now() - timestamp;
    var mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
}
