// ==================================================
// CYFOR Nucleus Enhancer — Salesforce Template Sync
// Fetches templates from a Salesforce Custom Object
// via REST API with TTL-based local caching.
// Exported as self.SfTemplates for use by background.js.
// ==================================================

(function () {

var CONFIG_KEY   = 'sfOAuthConfig';
var TOKENS_KEY   = 'sfOAuthTokens';
var CACHE_KEY    = 'sfRemoteTemplates';
var SYNCED_AT_KEY = 'sfTemplatesSyncedAt';
var CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

function buildQuery(config, teamCode) {
    var obj      = config.templateObject || 'NucleusTemplate__c';
    var content  = config.contentField   || 'Content__c';
    var category = config.categoryField  || 'Category__c';
    var active   = config.activeField    || 'IsActive__c';

    var teamFilter = teamCode
        ? "(Team__c = null OR Team__r.TeamCode__c = '" + teamCode + "')"
        : 'Team__c = null';

    return 'SELECT Id, Name, ' + content + ', ' + category + ', Team__r.TeamCode__c'
         + ' FROM ' + obj
         + ' WHERE ' + active + ' = true'
         + ' AND ' + teamFilter
         + ' ORDER BY Name ASC';
}

async function fetchRemoteTemplates(forceRefresh) {
    // Check TTL cache first
    if (!forceRefresh) {
        var cacheResult = await chrome.storage.local.get([CACHE_KEY, SYNCED_AT_KEY]);
        var cachedAt = cacheResult[SYNCED_AT_KEY];
        if (cachedAt && (Date.now() - cachedAt) < CACHE_TTL_MS) {
            var cached = cacheResult[CACHE_KEY];
            if (cached && typeof cached === 'object') {
                return { ok: true, fromCache: true, templates: cached, syncedAt: cachedAt };
            }
        }
    }

    // Get valid access token (auto-refreshes if needed)
    var accessToken;
    try {
        accessToken = await self.SfOAuth.getValidAccessToken();
    } catch (e) {
        return { ok: false, error: e.message };
    }

    var results = await chrome.storage.local.get([CONFIG_KEY, TOKENS_KEY, 'sfOAuthUser']);
    var config  = results[CONFIG_KEY]    || {};
    var tokens  = results[TOKENS_KEY]   || {};
    var sfUser  = results['sfOAuthUser'] || {};

    var instanceUrl = (tokens.instanceUrl || config.instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) return { ok: false, error: 'No Salesforce instance URL configured.' };

    var teamCode   = sfUser.teamCode || null;
    var apiVersion = config.apiVersion || 'v62.0';
    var query      = buildQuery(config, teamCode);
    var url        = instanceUrl + '/services/data/' + apiVersion + '/query?q=' + encodeURIComponent(query);

    var response = await doFetch(url, accessToken);

    // Auto-retry once on 401 (token might have been silently revoked)
    if (response.status === 401) {
        try {
            accessToken = await self.SfOAuth.refreshAccessToken();
        } catch (e) {
            return { ok: false, error: 'Authentication expired. Please reconnect in the extension popup.' };
        }
        response = await doFetch(url, accessToken);
    }

    if (!response.ok) {
        var errBody = await response.json().catch(function () { return []; });
        var msg = Array.isArray(errBody)
            ? (errBody[0] && errBody[0].message ? errBody[0].message : response.status)
            : response.status;
        return { ok: false, error: 'Salesforce query failed: ' + msg };
    }

    var data = await response.json();

    var contentField  = config.contentField  || 'Content__c';
    var categoryField = config.categoryField || 'Category__c';

    var sfRemoteTemplates = {};
    var records = data.records || [];
    for (var i = 0; i < records.length; i++) {
        var record      = records[i];
        var name        = record.Name;
        var body        = record[contentField]  || '';
        var cat         = record[categoryField] || '';
        var recId       = record.Id             || '';
        var recTeamCode = (record['Team__r'] && record['Team__r']['TeamCode__c']) || null;
        if (name && body) {
            sfRemoteTemplates[name] = { id: recId, content: body, category: cat, teamCode: recTeamCode };
        }
    }

    var syncedAt = Date.now();
    var toStore  = {};
    toStore[CACHE_KEY]    = sfRemoteTemplates;
    toStore[SYNCED_AT_KEY] = syncedAt;
    await chrome.storage.local.set(toStore);

    return { ok: true, fromCache: false, templates: sfRemoteTemplates, syncedAt: syncedAt };
}

function doFetch(url, accessToken) {
    return fetch(url, {
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Accept':        'application/json'
        }
    }).catch(function (e) {
        return { ok: false, status: 0, json: function () { return Promise.resolve({ message: e.message }); } };
    });
}

// ── Export ────────────────────────────────────────────────────────────────────

self.SfTemplates = {
    fetchRemoteTemplates: fetchRemoteTemplates
};

}());
