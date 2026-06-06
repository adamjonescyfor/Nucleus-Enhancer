// ████████████████████████████████████████████████████████████████████████████
// MG22A / MG22B REPORT GENERATION — OWNED BY MITUL (work in progress)
// This whole file is part of the MG22 feature, currently hidden behind the
// MG22_ENABLED flag in content/case-report.js. Hidden, NOT deleted — left intact
// for Mitul. Related: report/mg-extract.js, lib/docx-fill.js, and the report.*
// handlers + generateReport() in background.js.
// ████████████████████████████████████████████████████████████████████████████
// ==================================================
// CYFOR Nucleus Enhancer — MG22 report-template fetch (background)
// Lists NucleusReportTemplate__c records (team-scoped, like text templates)
// and downloads the attached .docx (Salesforce File / ContentVersion) as bytes
// for the fill engine. Read-only — admins upload the files via Salesforce.
//
// Exposes: self.SfReportTemplates.{ listReportTemplates, fetchTemplateFile }
// ==================================================

self.SfReportTemplates = (function () {

    async function makeCtx() {
        var token = await self.SfOAuth.getValidAccessToken();
        var stored = await chrome.storage.local.get(['sfOAuthTokens', 'sfOAuthConfig', 'sfOAuthUser']);
        var instanceUrl = ((stored.sfOAuthTokens || {}).instanceUrl || '').replace(/\/$/, '');
        if (!instanceUrl) throw new Error('NOT_AUTHENTICATED');
        var apiVersion = (stored.sfOAuthConfig || {}).apiVersion || 'v62.0';
        return {
            base:  instanceUrl + '/services/data/' + apiVersion,
            token: token,
            user:  stored.sfOAuthUser || {}
        };
    }

    function esc(v) {
        return self.SfUtils ? self.SfUtils.soqlEscape(v) : String(v == null ? '' : v);
    }

    async function soql(ctx, q) {
        var res = await fetch(ctx.base + '/query/?q=' + encodeURIComponent(q), {
            headers: { Authorization: 'Bearer ' + ctx.token, Accept: 'application/json' }
        });
        if (!res.ok) throw new Error('Salesforce query failed (' + res.status + ')');
        return (await res.json()).records || [];
    }

    async function listReportTemplates() {
        var ctx = await makeCtx();
        var teamCode = ctx.user.teamCode || null;
        var where = 'IsActive__c = true';
        where += teamCode
            ? " AND (Team__c = null OR Team__r.TeamCode__c = '" + esc(teamCode) + "')"
            : ' AND Team__c = null';

        var q = 'SELECT Id, Name, ReportType__c, Region__c FROM NucleusReportTemplate__c'
              + ' WHERE ' + where + ' ORDER BY Name ASC';
        var rows = await soql(ctx, q);
        return rows.map(function (r) {
            return { id: r.Id, name: r.Name, reportType: r.ReportType__c || '', region: r.Region__c || '' };
        });
    }

    async function fetchTemplateFile(recordId) {
        if (self.SfUtils && !self.SfUtils.isValidSfId(recordId)) throw new Error('Invalid report template id');
        var ctx = await makeCtx();

        var links = await soql(ctx,
            "SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '" + esc(recordId) + "'");
        if (!links.length) throw new Error('No Word file is attached to this report template in Salesforce.');

        var docId = links[0].ContentDocumentId;
        var vers = await soql(ctx,
            "SELECT Id FROM ContentVersion WHERE ContentDocumentId = '" + esc(docId) + "' AND IsLatest = true");
        if (!vers.length) throw new Error('Template file version not found.');

        var res = await fetch(ctx.base + '/sobjects/ContentVersion/' + vers[0].Id + '/VersionData', {
            headers: { Authorization: 'Bearer ' + ctx.token }
        });
        if (!res.ok) throw new Error('Could not download template file (' + res.status + ').');
        return new Uint8Array(await res.arrayBuffer());
    }

    // Pull plain text from a .docx file attached to the case whose title matches
    // titleRe (e.g. an MG21). Returns '' if none / on any error.
    async function fetchCaseDocText(caseId, titleRe) {
        if (self.SfUtils && !self.SfUtils.isValidSfId(caseId)) return '';
        try {
            var ctx = await makeCtx();
            var links = await soql(ctx,
                "SELECT ContentDocument.Title, ContentDocument.FileExtension, ContentDocument.LatestPublishedVersionId"
                + " FROM ContentDocumentLink WHERE LinkedEntityId = '" + esc(caseId) + "'");
            var match = null;
            for (var i = 0; i < links.length; i++) {
                var cd = links[i].ContentDocument || {};
                if (titleRe.test(String(cd.Title || '')) && /docx?$/i.test(String(cd.FileExtension || ''))) { match = cd; break; }
            }
            if (!match || !match.LatestPublishedVersionId || !self.fflate) return '';
            var res = await fetch(ctx.base + '/sobjects/ContentVersion/' + match.LatestPublishedVersionId + '/VersionData',
                { headers: { Authorization: 'Bearer ' + ctx.token } });
            if (!res.ok) return '';
            var f = self.fflate.unzipSync(new Uint8Array(await res.arrayBuffer()));
            if (!f['word/document.xml']) return '';
            return self.fflate.strFromU8(f['word/document.xml']).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        } catch (e) { return ''; }
    }

    // Best-effort occurrence number + date of offence from an MG21 doc's text.
    // (Patterns are generic — tune once a real MG21 is available.)
    function parseMg21(text) {
        if (!text) return {};
        var occ = (text.match(/\b(?:Crime|Occurrence|URN|Crime\/Occ(?:urrence)?)\.?\s*(?:No|Number|Ref(?:erence)?)?\.?\s*[:#]?\s*([A-Z]{0,3}[\/\-]?\d[\w\/\-]{3,})/i) || [])[1] || '';
        var doff = (text.match(/\bDate\s*of\s*(?:Offence|Incident)\b\s*[:]?\s*((?:\d{1,2}[\/\-.\s])?\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4})/i) || [])[1] || '';
        return { occurrenceNo: occ.trim(), dateOfOffence: doff.trim() };
    }

    async function fetchMg21Data(caseId) {
        var text = await fetchCaseDocText(caseId, /MG\s*-?\s*21/i);
        return parseMg21(text);
    }

    return {
        listReportTemplates: listReportTemplates,
        fetchTemplateFile: fetchTemplateFile,
        fetchMg21Data: fetchMg21Data
    };

})();
