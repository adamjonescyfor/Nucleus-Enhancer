// ==================================================
// CYFOR Nucleus Enhancer — Salesforce Template Sync
// Fetches templates from NucleusTemplate__c via REST API with TTL caching.
//
// Field API names are DISCOVERED from the object describe (Salesforce
// auto-generates names from labels, e.g. "Version Label" -> Version_Label__c,
// which a hardcoded VersionLabel__c would miss). resolveTemplateFields() is
// exported so the CRUD path writes to the exact same field names.
// Exported as self.SfTemplates.
// ==================================================

(function () {

var CONFIG_KEY    = 'sfOAuthConfig';
var TOKENS_KEY    = 'sfOAuthTokens';
var CACHE_KEY     = 'sfRemoteTemplates';
var SYNCED_AT_KEY = 'sfTemplatesSyncedAt';
var CACHE_TTL_MS  = 20 * 60 * 1000; // 20 minutes

// concept -> normalised name candidates (see SfUtils.normalizeFieldName).
var TEMPLATE_CONCEPTS = {
    content:       ['content'],
    category:      ['category'],
    active:        ['isactive', 'active'],
    versionLabel:  ['versionlabel', 'version'],
    status:        ['status'],
    changeReason:  ['changereason', 'reasonforchange', 'reason'],
    effectiveDate: ['effectivedate'],
    reviewDueDate: ['reviewduedate', 'reviewdate'],
    documentId:    ['documentid', 'docid']
};

// Describe NucleusTemplate__c once and map concepts -> real field API names.
// Falls back to sensible defaults if describe fails.
async function resolveTemplateFields(base, token, obj) {
    var map = {
        obj: obj, content: 'Content__c', category: 'Category__c', active: 'IsActive__c',
        team: 'Team__c', teamRel: 'Team__r',
        versionLabel: null, status: null, changeReason: null,
        effectiveDate: null, reviewDueDate: null, documentId: null
    };
    try {
        var d = await self.SfUtils.describeObject(base, token, obj);
        var fields = d.fields || [];
        var resolved = self.SfUtils.resolveFields(fields, TEMPLATE_CONCEPTS);
        Object.keys(resolved).forEach(function (k) { if (resolved[k]) map[k] = resolved[k]; });
        var teamRef = self.SfUtils.findReferenceField(fields, 'NucleusTeam__c');
        if (teamRef) { map.team = teamRef.name; map.teamRel = teamRef.relationshipName; }
    } catch (e) { /* keep defaults */ }
    return map;
}

function buildQuery(map, teamCode) {
    var esc = self.SfUtils ? self.SfUtils.soqlEscape : function (v) { return String(v == null ? '' : v); };
    var sel = ['Id', 'Name'];
    if (map.content) sel.push(map.content);
    if (map.category) sel.push(map.category);
    if (map.teamRel) sel.push(map.teamRel + '.TeamCode__c');
    sel.push('LastModifiedBy.Name');
    ['versionLabel', 'status', 'changeReason', 'effectiveDate', 'reviewDueDate', 'documentId']
        .forEach(function (k) { if (map[k]) sel.push(map[k]); });

    var teamField = map.team || 'Team__c';
    var teamFilter = (teamCode && map.teamRel)
        ? '(' + teamField + " = null OR " + map.teamRel + ".TeamCode__c = '" + esc(teamCode) + "')"
        : teamField + ' = null';

    return 'SELECT ' + sel.join(', ')
         + ' FROM ' + map.obj
         + ' WHERE ' + (map.active || 'IsActive__c') + ' = true'
         + ' AND ' + teamFilter
         + ' ORDER BY Name ASC';
}

async function fetchRemoteTemplates(forceRefresh) {
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

    var accessToken;
    try { accessToken = await self.SfOAuth.getValidAccessToken(); }
    catch (e) { return { ok: false, error: e.message }; }

    if (forceRefresh && self.SfUtils && self.SfUtils.clearDescribeCache) self.SfUtils.clearDescribeCache();

    var results = await chrome.storage.local.get([CONFIG_KEY, TOKENS_KEY, 'sfOAuthUser']);
    var config  = results[CONFIG_KEY]    || {};
    var tokens  = results[TOKENS_KEY]    || {};
    var sfUser  = results['sfOAuthUser'] || {};

    var instanceUrl = (tokens.instanceUrl || '').replace(/\/$/, '');
    if (!instanceUrl) return { ok: false, error: 'Not authenticated — connect via Salesforce OAuth first.' };

    var apiVersion = config.apiVersion || 'v62.0';
    var base = instanceUrl + '/services/data/' + apiVersion;
    var obj = config.templateObject || 'NucleusTemplate__c';

    // Refresh team membership + admin status each sync (may have changed).
    if (self.SfTeam && sfUser.id) {
        try {
            var teamInfo = await self.SfTeam.fetchUserTeamInfo(instanceUrl, accessToken, sfUser.id);
            if (teamInfo) {
                sfUser = Object.assign({}, sfUser, teamInfo);
                var up = {}; up['sfOAuthUser'] = sfUser;
                await chrome.storage.local.set(up);
            }
        } catch (e) { /* keep existing team info */ }
    }

    var teamCode = sfUser.teamCode || null;
    var map = await resolveTemplateFields(base, accessToken, obj);

    // Diagnostic: which fields were discovered (null = not found on the object).
    console.log('[CYFOR] Template fields resolved:', {
        content: map.content, category: map.category, team: map.team,
        versionLabel: map.versionLabel, status: map.status, changeReason: map.changeReason,
        effectiveDate: map.effectiveDate, reviewDueDate: map.reviewDueDate, documentId: map.documentId
    });

    var query = buildQuery(map, teamCode);
    var url = base + '/query?q=' + encodeURIComponent(query);
    var response = await doFetch(url, accessToken);

    if (response.status === 401) {
        try { accessToken = await self.SfOAuth.refreshAccessToken(); }
        catch (e) { return { ok: false, error: 'Authentication expired. Please reconnect in the extension popup.' }; }
        response = await doFetch(url, accessToken);
    }

    if (!response.ok) {
        var errBody = await response.json().catch(function () { return []; });
        var emsg = Array.isArray(errBody) ? (errBody[0] && errBody[0].message ? errBody[0].message : response.status) : response.status;
        return { ok: false, error: 'Salesforce query failed: ' + emsg };
    }

    var data = await response.json();
    var sfRemoteTemplates = {};
    var records = data.records || [];
    for (var i = 0; i < records.length; i++) {
        var r = records[i];
        var name = r.Name;
        var body = (map.content && r[map.content]) || '';
        if (!name || !body) continue;

        var entry = {
            id:                r.Id || '',
            content:           body,
            category:          (map.category && r[map.category]) || '',
            teamCode:          (map.teamRel && r[map.teamRel] && r[map.teamRel].TeamCode__c) || null,
            lastChangedByName: (r.LastModifiedBy && r.LastModifiedBy.Name) || ''
        };
        if (map.versionLabel)  entry.versionLabel  = r[map.versionLabel]  || '1.0';
        if (map.status)        entry.status        = r[map.status]        || 'Active';
        if (map.changeReason)  entry.changeReason  = r[map.changeReason]  || '';
        if (map.effectiveDate) entry.effectiveDate = r[map.effectiveDate] || null;
        if (map.reviewDueDate) entry.reviewDueDate = r[map.reviewDueDate] || null;
        if (map.documentId)    entry.documentId    = r[map.documentId]    || '';
        sfRemoteTemplates[name] = entry;
    }

    var syncedAt = Date.now();
    var toStore = {};
    toStore[CACHE_KEY] = sfRemoteTemplates;
    toStore[SYNCED_AT_KEY] = syncedAt;
    await chrome.storage.local.set(toStore);

    return { ok: true, fromCache: false, templates: sfRemoteTemplates, syncedAt: syncedAt, fields: map };
}

function doFetch(url, accessToken) {
    return fetch(url, {
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' }
    }).catch(function (e) {
        return { ok: false, status: 0, json: function () { return Promise.resolve({ message: e.message }); } };
    });
}

self.SfTemplates = {
    fetchRemoteTemplates: fetchRemoteTemplates,
    resolveTemplateFields: resolveTemplateFields
};

}());
