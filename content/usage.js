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
    MAX: 1000,   // ring buffer — oldest entries drop off automatically; never grows past this

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

    // Record id from the URL. Only available when the insert happens on a
    // record's own page (/lightning/r/<Object>/<Id>/…). Inserts made in a
    // modal opened over a LIST view have no record id in the URL — that's why
    // many usage entries show '—' for Record; the URL column still captures
    // where it happened.
    _recordId: function () {
        var m = location.href.match(/\/lightning\/r\/[^/]+\/([a-zA-Z0-9]{15,18})(?:\/|$)/);
        return m ? m[1] : null;
    },

    // Object API name + id of the current record page, or null. Lets the deferred
    // path skip the PARENT record (e.g. the case shown briefly after Save) and
    // attribute the insert only to a NEW record of the object being created.
    _recordRef: function () {
        var m = location.href.match(/\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]{15,18})(?:\/|$)/);
        return m ? { object: m[1], id: m[2] } : null;
    },

    // Tunables for the deferred-correlation path (see record()).
    WINDOW_MS:  120000,   // how long to wait for the just-saved record to appear
    POLL_MS:    400,
    _pending:   null,     // a record-less modal insert awaiting its saved record
    _expectObj: null,     // object API name we expect the saved record to be
    _modalOpen: false,    // a create/edit modal was open at insert time
    _queried:   false,    // already asked Salesforce for the created record
    _deadline:  0,
    _pollTimer: null,

    // Is a Salesforce create/edit modal currently OPEN? Restricted to the SLDS
    // open-modal markers so it flips to false on close (some containers linger in
    // the DOM as empty shells, which would otherwise read as "always open").
    _inModal: function () {
        return !!document.querySelector(
            '.slds-modal.slds-fade-in-open, section[role="dialog"].slds-modal'
        );
    },

    record: function (templateName) {
        if (!templateName) return;
        this._loadUser();
        var entry = {
            template: String(templateName).slice(0, 200),
            ts: Date.now(),
            url: location.href,
            recordId: this._recordId(),
            user: this._user || null
        };
        // On a record's own page we already know the record → log now.
        // Inside a "New …" modal the record doesn't exist yet, so hold the entry
        // and enrich it with the record the user lands on after Save (e.g. New
        // Process modal → the new EP-xxxx page). Anywhere else with no record in
        // the URL, log immediately as before (there's no id to be had).
        var route = entry.recordId ? 'flush(has-id)' : (this._inModal() ? 'defer(modal)' : 'flush(no-id)');
        Cyfor.log('usage', 'record', { template: entry.template, recordId: entry.recordId, route });
        if (entry.recordId)       this._flush(entry);
        else if (this._inModal()) this._defer(entry);
        else                      this._flush(entry);
    },

    // Hold a record-less modal insert. The org usage object is insert-only (no
    // Edit), so we DEFER the single write rather than patch it later: poll for
    // the user landing on a record page (the just-saved record), then write once
    // — with the id if found, or without it on timeout / tab close. Best-effort:
    // it attributes the insert to the FIRST record page reached within the
    // window, matching the insert → Save → land-on-new-record flow.
    _defer: function (entry) {
        if (this._pending) this._flush(this._pending); // never lose a previous one
        this._pending  = entry;
        this._deadline = Date.now() + this.WINDOW_MS;
        // Object being created, from the list/modal URL (/lightning/o/<Object>/…),
        // so we wait for the NEW record of THAT type and ignore the parent case.
        var om = (entry.url || '').match(/\/lightning\/o\/([^/]+)\//);
        this._expectObj = om ? om[1] : null;
        this._modalOpen = true;   // we only defer when a modal is open
        this._queried   = false;
        var self = this;
        if (!this._pollTimer) {
            this._pollTimer = setInterval(function () { self._tick(); }, this.POLL_MS);
        }
    },

    // The success toast shown after Save ("Process "EP-…" was created") links to
    // the just-created record — the MOST reliable signal, because creating from a
    // list/related list drops you back on the list and never navigates to it.
    _toastRecord: function () {
        var a = document.querySelector(
            '.slds-notify_toast a[href*="/lightning/r/"], .forceToastMessage a[href*="/lightning/r/"], .toastMessage a[href*="/lightning/r/"]'
        );
        var href = a ? (a.getAttribute('href') || '') : '';
        var m = href.match(/\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]{15,18})/);
        if (!m) return null;
        return { object: m[1], id: m[2], url: location.origin + '/lightning/r/' + m[1] + '/' + m[2] + '/view' };
    },

    _tick: function () {
        if (!this._pending) { this._stopPoll(); return; }
        // Fast path: a readable toast link, or the record page we land on. Match
        // the expected object so we skip the parent case shown after Save.
        var ref = this._toastRecord() || this._recordRef();
        if (ref && (!this._expectObj || ref.object === this._expectObj)) {
            this._enrich(ref.id, ref.url || location.href);
            return;
        }
        // Robust path: once the modal has CLOSED (Save committed the record), ask
        // Salesforce which record we just created. Works even when Save returns to
        // the list and the toast link can't be read, and is record-type-agnostic.
        if (this._expectObj && !this._queried && this._modalOpen && !this._inModal()) {
            this._queried = true;
            this._queryLatest();
            return;
        }
        if (Date.now() > this._deadline) this._flushPending(); // gave up — log without a record
    },

    _enrich: function (id, url) {
        if (!this._pending) return;
        this._pending.recordId = id;
        this._pending.url      = url;
        this._flushPending();
    },

    // Ask the background for the just-created record's id. A short delay lets the
    // record finish committing before we query; if it returns nothing (e.g. the
    // modal was cancelled) we leave the entry to enrich by nav or time out.
    _queryLatest: function () {
        var self = this, p = this._pending, obj = this._expectObj;
        if (!p || !obj) return;
        setTimeout(function () {
            if (!self._pending || self._pending !== p) return; // already resolved
            try {
                chrome.runtime.sendMessage(
                    { action: 'usage.findLatest', object: obj, sinceTs: p.ts },
                    function (resp) {
                        void chrome.runtime.lastError;
                        if (!self._pending || self._pending !== p) return;
                        if (resp && resp.ok && resp.id) {
                            self._enrich(resp.id, location.origin + '/lightning/r/' + obj + '/' + resp.id + '/view');
                        }
                        // else: keep waiting for nav / toast / timeout
                    }
                );
            } catch (e) { /* ignore */ }
        }, 700);
    },

    _flushPending: function () {
        var p = this._pending;
        this._pending   = null;
        this._expectObj = null;
        this._modalOpen = false;
        this._queried   = false;
        this._stopPoll();
        if (p) this._flush(p);
    },

    _stopPoll: function () {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    },

    // Write to the local device log + fire-and-forget the org-wide mirror. The
    // background writes a NucleusTemplateUsage__c record IF that object exists,
    // else it's a silent no-op. Must never affect the insert itself.
    _flush: function (entry) {
        var self = this;
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

        try {
            chrome.runtime.sendMessage({ action: 'usage.push', entry: entry }, function () {
                void chrome.runtime.lastError; // swallow "no receiver" etc.
            });
        } catch (e) { /* ignore */ }
    }
};

// If the tab closes or hard-navigates before the saved record appears, still
// log whatever's pending (unenriched) on a best-effort basis.
try {
    window.addEventListener('pagehide', function () { Cyfor.usage._flushPending(); });
} catch (e) { /* ignore */ }

// Prime the user name at load: it resolves asynchronously, so without this the
// FIRST insert after a page load raced the lookup and logged user = null
// ("—" in the manager's Usage view); later inserts had it cached.
Cyfor.usage._loadUser();
