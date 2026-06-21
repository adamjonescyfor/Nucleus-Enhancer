// ==================================================
// CYFOR Nucleus Enhancer — Salesforce Team Membership
// Queries the user's team and admin status from
// NucleusTeamMember__c after OAuth login.
// Exported as self.SfTeam for use by background.js.
// ==================================================

(function () {

async function fetchUserTeamInfo(instanceUrl, accessToken, sfUserId) {
    var escUser = (self.SfUtils ? self.SfUtils.soqlEscape(sfUserId) : String(sfUserId || ''));
    // Fetch ALL active memberships (a user can belong to more than one team).
    // Ordered by name so the "primary" team (kept for backward-compat) is stable.
    var soql = [
        "SELECT Team__r.Name, Team__r.TeamCode__c, Team__r.Id, IsAdmin__c",
        "FROM NucleusTeamMember__c",
        "WHERE User__c = '" + escUser + "'",
        "AND Team__r.IsActive__c = true",
        "ORDER BY Team__r.Name ASC",
        "LIMIT 50"
    ].join(' ');

    var cfgResult = await chrome.storage.local.get('sfOAuthConfig');
    var apiVersion = ((cfgResult.sfOAuthConfig) || {}).apiVersion || 'v62.0';

    var url = instanceUrl.replace(/\/$/, '') + '/services/data/' + apiVersion
              + '/query?q=' + encodeURIComponent(soql);

    // Returns null on a FETCH FAILURE (network/HTTP/parse) so callers can keep
    // any existing team info, vs nullTeam() which means "definitely no membership".
    var response;
    try {
        response = await fetch(url, {
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Accept': 'application/json'
            }
        });
    } catch (e) {
        console.warn('[CYFOR] fetchUserTeamInfo network error:', e.message);
        return null;
    }

    if (!response.ok) {
        console.warn('[CYFOR] fetchUserTeamInfo HTTP ' + response.status);
        return null;
    }

    var data;
    try { data = await response.json(); } catch (e) { return null; }

    var records = (data && data.records) || [];
    if (!records.length) return nullTeam();

    // Build the de-duplicated membership list (a stray duplicate membership record
    // shouldn't double a team up).
    var seen  = {};
    var teams = [];
    records.forEach(function (rec) {
        var t  = rec.Team__r || {};
        var id = t.Id || t.TeamCode__c || t.Name;
        if (!id || seen[id]) return;
        seen[id] = true;
        teams.push({
            teamId:   t.Id          || null,
            teamName: t.Name        || null,
            teamCode: t.TeamCode__c || null,
            isAdmin:  rec.IsAdmin__c === true
        });
    });
    if (!teams.length) return nullTeam();

    var primary = teams[0]; // stable (ordered by name) — the single-team fields below
    return {
        // Primary team — kept as the top-level fields so everything that reads a
        // single team (templates query fallback, manager default, etc.) is unchanged.
        teamCode:        primary.teamCode,
        teamName:        primary.teamName,
        teamId:          primary.teamId,
        // Admin if the user is a template admin in ANY of their teams.
        isTemplateAdmin: teams.some(function (t) { return t.isAdmin; }),
        // Full membership list — drives multi-team template visibility and the
        // popup's "Team A · Team B" identity line. Single-team users get [one].
        teams:           teams
    };
}

function nullTeam() {
    return { teamCode: null, teamName: null, teamId: null, isTemplateAdmin: false, teams: [] };
}

// All active teams — used by the manager's "assign to any team" picker (admins).
// Returns [] on any failure (the picker just falls back to Global only).
async function fetchAllTeams(instanceUrl, accessToken) {
    var cfgResult  = await chrome.storage.local.get('sfOAuthConfig');
    var apiVersion = ((cfgResult.sfOAuthConfig) || {}).apiVersion || 'v62.0';
    var soql = 'SELECT Id, Name, TeamCode__c FROM NucleusTeam__c WHERE IsActive__c = true ORDER BY Name ASC';
    var url  = instanceUrl.replace(/\/$/, '') + '/services/data/' + apiVersion
             + '/query?q=' + encodeURIComponent(soql);

    var response;
    try {
        response = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' }
        });
    } catch (e) {
        console.warn('[CYFOR] fetchAllTeams network error:', e.message);
        return [];
    }
    if (!response.ok) { console.warn('[CYFOR] fetchAllTeams HTTP ' + response.status); return []; }

    var data;
    try { data = await response.json(); } catch (e) { return []; }
    return ((data && data.records) || []).map(function (r) {
        return { id: r.Id, name: r.Name, teamCode: r.TeamCode__c || null };
    });
}

self.SfTeam = { fetchUserTeamInfo: fetchUserTeamInfo, fetchAllTeams: fetchAllTeams };

}());
