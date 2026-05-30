// ==================================================
// CYFOR Nucleus Enhancer — Template usage log (content)
// Records each template insertion to a capped ring buffer in
// chrome.storage.local for a local audit trail. The manager page
// reads this back under "Usage". v1 is local-only (per device);
// an org-wide, cross-device version would push to a Salesforce
// NucleusTemplateUsage__c object (admin-created), mirroring the
// team objects — not built in v1.
//
// Exposes: Cyfor.usage.record(templateName)
// ==================================================

Cyfor.usage = {
    KEY: 'templateUsageLog',
    MAX: 500,
    _user: null,
    _userLoaded: false,

    _loadUser: function () {
        if (this._userLoaded) return;
        this._userLoaded = true;
        var self = this;
        try {
            chrome.storage.local.get(['sfOAuthUser'], function (res) {
                if (chrome.runtime.lastError) return;
                var u = res && res.sfOAuthUser;
                self._user = (u && (u.fullName || u.username || u.email)) || null;
            });
        } catch (e) { /* ignore */ }
    },

    _recordId: function () {
        var m = location.href.match(/\/lightning\/r\/[^/]+\/([^/]+)\/view/);
        return m ? m[1] : null;
    },

    record: function (templateName) {
        if (!templateName) return;
        this._loadUser();
        var self = this;
        var entry = {
            template: String(templateName).slice(0, 200),
            ts: Date.now(),
            url: location.href,
            recordId: this._recordId(),
            user: this._user || null
        };
        try {
            chrome.storage.local.get([this.KEY], function (res) {
                if (chrome.runtime.lastError) return;
                var log = Array.isArray(res[self.KEY]) ? res[self.KEY] : [];
                log.push(entry);
                if (log.length > self.MAX) log = log.slice(log.length - self.MAX);
                var payload = {};
                payload[self.KEY] = log;
                chrome.storage.local.set(payload);
            });
        } catch (e) { /* ignore */ }
    }
};
