// ==================================================
// CYFOR Nucleus Enhancer — Template Version Archive
// Archives NucleusTemplate__c versions before each
// update and retrieves full history for audit trail.
// Exported as self.SfVersions for use by background.js.
// ==================================================

(function () {

async function getVersionHistory(templateId) {
    var stored = await chrome.storage.local.get(['sfOAuthTokens', 'sfOAuthConfig']);
    var tokens = stored['sfOAuthTokens'] || {};
    var config = stored['sfOAuthConfig'] || {};

    var instanceUrl = (tokens.instanceUrl || config.instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) return { ok: false, error: 'No instance URL configured.' };

    var accessToken;
    try { accessToken = await self.SfOAuth.getValidAccessToken(); }
    catch (e) { return { ok: false, error: e.message }; }

    var apiVersion = config.apiVersion || 'v62.0';
    var soql = [
        'SELECT Id, VersionLabel__c, Content__c, ChangeReason__c,',
        'ChangedByName__c, ChangedByEmail__c, ArchivedAt__c',
        'FROM NucleusTemplateVersion__c',
        "WHERE Template__c = '" + templateId.replace(/'/g, "\\'") + "'",
        'ORDER BY ArchivedAt__c DESC'
    ].join(' ');

    var url = instanceUrl + '/services/data/' + apiVersion + '/query?q=' + encodeURIComponent(soql);

    try {
        var response = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' }
        });

        if (!response.ok) {
            var errBody = await response.json().catch(function () { return []; });
            if (response.status === 400 && Array.isArray(errBody)) {
                var isMissing = errBody.some(function (e) {
                    return e.errorCode === 'INVALID_TYPE' || e.errorCode === 'INVALID_FIELD';
                });
                if (isMissing) return { ok: true, versions: [], unavailable: true };
            }
            return { ok: false, error: 'History query failed: ' + response.status };
        }

        var data = await response.json();
        return { ok: true, versions: data.records || [] };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function archiveCurrentVersion(payload) {
    // payload: { templateId, versionLabel, content, changeReason, changedByName, changedByEmail }
    var stored = await chrome.storage.local.get(['sfOAuthTokens', 'sfOAuthConfig']);
    var tokens = stored['sfOAuthTokens'] || {};
    var config = stored['sfOAuthConfig'] || {};

    var instanceUrl = (tokens.instanceUrl || config.instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) { console.warn('[CYFOR] archiveCurrentVersion: no instanceUrl'); return; }

    var accessToken;
    try { accessToken = await self.SfOAuth.getValidAccessToken(); }
    catch (e) { console.warn('[CYFOR] archiveCurrentVersion: auth failed:', e.message); return; }

    var apiVersion = config.apiVersion || 'v62.0';
    var url = instanceUrl + '/services/data/' + apiVersion + '/sobjects/NucleusTemplateVersion__c/';

    try {
        var response = await fetch(url, {
            method:  'POST',
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Template__c:       payload.templateId,
                VersionLabel__c:   payload.versionLabel  || '1.0',
                Content__c:        payload.content        || '',
                ChangeReason__c:   payload.changeReason   || '',
                ChangedByName__c:  payload.changedByName  || '',
                ChangedByEmail__c: payload.changedByEmail || '',
                ArchivedAt__c:     new Date().toISOString()
            })
        });

        if (!response.ok) {
            var errBody = await response.json().catch(function () { return [{}]; });
            console.warn('[CYFOR] archiveCurrentVersion failed:',
                (errBody[0] && errBody[0].message) || response.status);
        }
    } catch (e) {
        console.warn('[CYFOR] archiveCurrentVersion error:', e.message);
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

self.SfVersions = { getVersionHistory, archiveCurrentVersion };

}());
