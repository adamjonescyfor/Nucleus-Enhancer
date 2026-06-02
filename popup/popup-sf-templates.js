// ==================================================
// CYFOR Nucleus Enhancer — Salesforce Templates (Popup)
// OAuth connect/disconnect, template sync, and
// configuration UI for the Salesforce Templates section.
// ==================================================

function loadSfTemplatesSection() {
    // Populate saved config fields (fall back to compiled-in defaults from config.js)
    chrome.storage.local.get(['sfOAuthConfig', 'sfOAuthTokens', 'sfOAuthUser', 'sfRemoteTemplates', 'sfTemplatesSyncedAt'], function (r) {
        var config = r.sfOAuthConfig || {};
        var tokens = r.sfOAuthTokens || {};
        var user   = r.sfOAuthUser   || null;

        // If proxy URL was never saved, apply compiled default or hardcoded fallback
        var compiled  = (typeof CYFOR_CONFIG !== 'undefined') ? CYFOR_CONFIG : {};
        var needsSave = false;
        if (!config.oauthProxyUrl) {
            config.oauthProxyUrl = compiled.oauthProxyUrl || 'https://cyfor-oauth-proxy.nucleusenhancer.workers.dev';
            needsSave = true;
        }
        if (needsSave) {
            chrome.storage.local.set({ sfOAuthConfig: Object.assign({
                templateObject: 'NucleusTemplate__c',
                contentField:   'Content__c',
                categoryField:  'Category__c',
                activeField:    'IsActive__c',
                apiVersion:     'v62.0'
            }, config) });
        }

        var proxyUrlEl = document.getElementById('sf-proxy-url');
        if (proxyUrlEl && config.oauthProxyUrl) proxyUrlEl.value = config.oauthProxyUrl;

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

    if (connectBtn) {
        connectBtn.addEventListener('click', function () {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting…';
            setSfSyncStatus('', '');

            chrome.runtime.sendMessage({ action: 'sfOAuth.connect' }, function (response) {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect Salesforce';

                if (chrome.runtime.lastError || !response || !response.ok) {
                    var err = (response && response.error) || 'Connection failed';
                    if (err === 'NOT_CONFIGURED') {
                        renderSfTemplatesStatus({ connected: false, error: 'Enter the OAuth Proxy URL below first.' });
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

}

function saveSfConfig() {
    var proxyUrl = (document.getElementById('sf-proxy-url') || {}).value || '';
    proxyUrl = proxyUrl.trim().replace(/\/$/, '');

    if (!proxyUrl) {
        setSfConfigStatus('OAuth Proxy URL is required.', 'error');
        return;
    }
    if (!/^https:\/\//i.test(proxyUrl)) {
        setSfConfigStatus('Proxy URL must start with https://', 'error');
        return;
    }

    chrome.storage.local.get(['sfOAuthConfig'], function (r) {
        var existing = r.sfOAuthConfig || {};
        var updated  = Object.assign({}, existing, { oauthProxyUrl: proxyUrl });
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

        chrome.storage.local.get(['mergedTemplates', 'sfOAuthUser'], function (r) {
            currentMergedTemplates = r.mergedTemplates || {};
            populateDropdown(currentMergedTemplates);
            updateBadge(Object.keys(currentMergedTemplates).length);
            // Team membership/admin status may have refreshed during sync, so
            // re-render the connection row to update the team badge + the
            // "Manage Templates" button without needing to reopen the popup.
            renderSfTemplatesStatus({ connected: true, user: r.sfOAuthUser || null });
        });
    });
}

// ── UI state helpers ──────────────────────────────────────────────────────────

function renderSfTemplatesStatus(state) {
    var badge         = document.getElementById('sf-templates-badge');
    var nameEl        = document.getElementById('sf-connected-name');
    var emailEl       = document.getElementById('sf-connected-email');
    var connectBtn    = document.getElementById('btn-sf-oauth-connect');
    var disconnectBtn = document.getElementById('btn-sf-oauth-disconnect');
    var syncBtn       = document.getElementById('btn-sf-sync-now');
    var syncRow       = document.getElementById('sf-sync-row');
    var manageBtn     = document.getElementById('btn-manage-templates');
    var avatar        = document.getElementById('sf-avatar');

    if (!badge) return;
    var user = (state && state.user) || null;

    function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }

    if (state && state.connected) {
        badge.textContent = 'Connected';
        badge.className   = 'badge badge-success';

        var name = user ? (user.fullName || user.username || user.email || '') : '';
        var team = (user && user.teamName) ? ' · ' + user.teamName : '';
        if (nameEl) nameEl.textContent = name ? name + team : 'Connected to Salesforce';
        if (emailEl) {
            emailEl.textContent = (user && user.email) ? user.email : '';
            show(emailEl, !!(user && user.email));
        }

        // Avatar: show initials immediately, then swap in the real profile photo
        // once the background fetches it (the Salesforce photo URL needs the
        // OAuth token, so a plain <img src> can't load it directly).
        if (avatar) {
            var img      = document.getElementById('sf-avatar-img');
            var fallback = document.getElementById('sf-avatar-fallback');
            if (fallback) fallback.textContent = (name ? name.trim().charAt(0) : '?').toUpperCase();
            show(avatar, true);

            function showInitials() { if (img) img.style.display = 'none'; if (fallback) fallback.style.display = ''; }
            function showPhoto()    { if (img) img.style.display = ''; if (fallback) fallback.style.display = 'none'; }

            if (img) {
                img.onerror = showInitials;
                img.onload  = showPhoto;
                // If a previous render already loaded the photo, keep it shown
                // (re-assigning the same src would not re-fire onload).
                if (img.src && img.complete && img.naturalWidth > 0) {
                    showPhoto();
                } else {
                    showInitials();
                    try {
                        chrome.runtime.sendMessage({ action: 'sfOAuth.getProfilePhoto' }, function (r) {
                            if (chrome.runtime.lastError) return;
                            if (!(r && r.ok && r.dataUrl && img)) return; // no photo → initials stay
                            if (img.src === r.dataUrl && img.complete && img.naturalWidth > 0) {
                                showPhoto();
                            } else {
                                img.src = r.dataUrl;
                            }
                        });
                    } catch (e) { /* ignore — initials remain */ }
                }
            } else {
                showInitials();
            }
        }

        show(connectBtn, false);
        show(disconnectBtn, true);
        show(syncBtn, true);
        show(syncRow, true);
        show(manageBtn, !!(user && user.isTemplateAdmin));
    } else {
        badge.textContent = 'Not connected';
        badge.className   = 'badge badge-empty';

        if (nameEl) nameEl.textContent = (state && state.error) ? state.error : "Connect to sync your team's official templates.";
        show(emailEl, false);
        show(avatar, false);

        if (connectBtn) connectBtn.disabled = false;
        show(connectBtn, true);
        show(disconnectBtn, false);
        show(syncBtn, false);
        show(syncRow, false);
        show(manageBtn, false);
    }
}

function updateSfTemplateCount(count) {
    var countEl = document.getElementById('sf-template-count');
    if (countEl) countEl.textContent = count;
}

function setSfSyncStatus(msg, type) {
    var el = document.getElementById('sf-sync-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'sf-sync-status' + (type ? ' status-' + type : '');
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
