// ==================================================
// CYFOR Nucleus Enhancer — Salesforce Team Membership
// Queries the user's team and admin status from
// NucleusTeamMember__c after OAuth login.
// Exported as self.SfTeam for use by background.js.
// ==================================================

(function () {

async function fetchUserTeamInfo(instanceUrl, accessToken, sfUserId) {
    var escUser = (self.SfUtils ? self.SfUtils.soqlEscape(sfUserId) : String(sfUserId || ''));
    var soql = [
        "SELECT Team__r.Name, Team__r.TeamCode__c, Team__r.Id, IsAdmin__c",
        "FROM NucleusTeamMember__c",
        "WHERE User__c = '" + escUser + "'",
        "AND Team__r.IsActive__c = true",
        "LIMIT 1"
    ].join(' ');

    var cfgResult = await chrome.storage.local.get('sfOAuthConfig');
    var apiVersion = ((cfgResult.sfOAuthConfig) || {}).apiVersion || 'v62.0';

    var url = instanceUrl.replace(/\/$/, '') + '/services/data/' + apiVersion
              + '/query?q=' + encodeURIComponent(soql);

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
        return nullTeam();
    }

    if (!response.ok) {
        console.warn('[CYFOR] fetchUserTeamInfo HTTP ' + response.status);
        return nullTeam();
    }

    var data;
    try { data = await response.json(); } catch (e) { return nullTeam(); }

    var records = (data && data.records) || [];
    if (!records.length) return nullTeam();

    var rec  = records[0];
    var team = rec.Team__r || {};
    return {
        teamCode:        team.TeamCode__c || null,
        teamName:        team.Name        || null,
        teamId:          team.Id          || null,
        isTemplateAdmin: rec.IsAdmin__c   === true
    };
}

function nullTeam() {
    return { teamCode: null, teamName: null, teamId: null, isTemplateAdmin: false };
}

self.SfTeam = { fetchUserTeamInfo: fetchUserTeamInfo };

}());
