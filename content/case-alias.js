// ==================================================
// CYFOR Nucleus Enhancer — Case project/alias annotation
// Surfaces the Forensic Case "Project" (alias) in places Salesforce doesn't show
// it — e.g. Task record pages and the "Recently Viewed" list — by annotating
// Forensic Case record links with their alias. Links that already sit in a list
// with a "Project" column (e.g. Examiner Team, All) are left alone. The alias is
// fetched (and cached) via the background; the field is describe-discovered.
// ==================================================

Cyfor.caseAlias = {
    _cache:     {},     // caseId -> alias string ('' = fetched, none)
    _pending:   {},     // caseId -> true (fetch in flight)
    _available: true,   // flips false if the org has no discoverable Project field
    _keyPrefix: null,   // Forensic Case id key-prefix (e.g. "a2X") — from the describe
    _CACHE_MAX: 2000,
    _settling:  false,  // a "settle" re-scan sequence is already queued

    init() {
        var self = this;
        // Live toggle: re-annotate when switched on, remove annotations when switched
        // off — no page refresh needed.
        if (Cyfor.config.onChange && Cyfor.config.onChange.enableCaseAlias) {
            Cyfor.config.onChange.enableCaseAlias.push(function () {
                if (Cyfor.config.enableCaseAlias) self._refresh();
                else self._clear();
            });
        }
    },

    // Annotate visible Forensic Case links with their project/alias.
    scan() {
        if (!this._available || !Cyfor.config.enableCaseAlias || Cyfor.utils.isContextInvalid()) return;
        try { this._scan(); } catch (e) { /* a flaky/odd DOM must never break the page */ }
    },

    _scan() {

        // Case-name links use the id-only form /lightning/r/<id>/view (no object
        // name), so once we know the Forensic Case key-prefix we target it directly;
        // until then we scan all record links and let the background query filter.
        // Shadow-piercing — record pages (e.g. a Task's "Related To") nest links in
        // shadow roots a flat query would miss.
        var sel = this._keyPrefix
            ? 'a[href*="/lightning/r/' + this._keyPrefix + '"], a[href*="/Forensic_Case__c/"]'
            : 'a[href*="/lightning/r/"]';
        var links = Cyfor.utils.querySelectorAllDeep(sel);
        if (!links.length) return;

        // The record THIS page is showing (a case's own record page). Skip links that
        // point to it — otherwise we'd annotate the breadcrumb and every related-list
        // quick link (Files, Case Expenses, …), which all reference the current case.
        var currentId = this._caseId(location.href);

        var toFetch = [], seen = {};
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var id = this._caseId(a.getAttribute('href'));
            if (!id) continue;
            if (currentId && id === currentId) continue;                       // the page's own record
            if (this._keyPrefix && id.slice(0, 3) !== this._keyPrefix) continue; // not a Forensic Case
            var cached = this._cache[id];
            if (cached !== undefined) {
                this._reconcile(a, cached); // re-checked every scan, so timing races self-heal
            } else if (!this._pending[id] && !seen[id]) {
                seen[id] = true;
                toFetch.push(id);
            }
        }
        if (toFetch.length) this._fetch(toFetch.slice(0, 200));
    },

    // Extract a record id from a Lightning record href — handles both the id-only
    // form (/lightning/r/<id>/view) and the object-named form.
    _caseId(href) {
        var m = (href || '').match(/\/lightning\/r\/(?:Forensic_Case__c\/)?([a-zA-Z0-9]{15,18})(?:\/|$|\?)/);
        return m ? m[1] : null;
    },

    // Reconcile the annotation with the CURRENT row state: add the alias when it's
    // not already shown, remove it if a Project column in the same row now shows it.
    // Run on every scan, so annotating before Lightning finished rendering the
    // Project cell self-corrects on the next pass instead of sticking.
    _reconcile(link, project) {
        var sib = link.nextElementSibling;
        var existing = (sib && sib.classList && sib.classList.contains('cyfor-case-alias')) ? sib : null;
        var show = !!project && !this._shownInRow(link, project);

        if (show && !existing) {
            var span = document.createElement('span');
            span.className   = 'cyfor-case-alias';
            span.textContent = project;            // text node — XSS-safe
            span.title       = 'Project / alias: ' + project;
            link.insertAdjacentElement('afterend', span);
        } else if (!show && existing) {
            existing.remove();                     // e.g. a Project column appeared / re-rendered
        }
    },

    // True if the project is already displayed as its own column in the link's row (a
    // dedicated "Project" column, as on Examiner Team / All). We match a cell whose
    // WHOLE value is the project — not a substring — so a task Subject like
    // "Rathlin - data copy" (which merely contains the alias) doesn't suppress it.
    // The case-name cell (link + our own annotation) is excluded so we never match
    // ourselves. Works regardless of how Lightning structures the column headers.
    _shownInRow(link, project) {
        var row = link.closest && link.closest('tr');
        if (!row) return false;                    // not a list row (e.g. a Task page) — always show
        var nameCell = link.closest('td, th');
        var want = (project || '').replace(/\s+/g, ' ').trim();
        var cells = row.children;
        for (var i = 0; i < cells.length; i++) {
            if (cells[i] === nameCell) continue;   // skip the name cell (link + our span live here)
            if ((cells[i].textContent || '').replace(/\s+/g, ' ').trim() === want) return true;
        }
        return false;
    },

    _fetch(ids) {
        var self = this;
        ids.forEach(function (id) { self._pending[id] = true; });
        chrome.runtime.sendMessage({ action: 'caseAlias.fetch', ids: ids }, function (r) {
            if (Cyfor.utils.isContextInvalid()) return;
            if (chrome.runtime.lastError || !r || !r.ok) {
                ids.forEach(function (id) { delete self._pending[id]; });
                return;
            }
            if (!r.available) {            // org has no Project field — stop entirely
                self._available = false;
                ids.forEach(function (id) { delete self._pending[id]; });
                return;
            }
            if (r.keyPrefix) self._keyPrefix = r.keyPrefix; // now target case links precisely
            var projects = r.projects || {};
            self._trim();
            ids.forEach(function (id) {
                self._cache[id] = projects[id] || '';
                delete self._pending[id];
            });
            self.scan();        // annotate the now-cached links
            self._settleScan(); // …and again as late-rendering Project cells fill in
            if (Cyfor.log) Cyfor.log('cases', 'alias fetched', { count: ids.length });
        });
    },

    // Lightning fills a row's Project-cell VALUE as a text update on an existing cell
    // — no element is added, so the MutationObserver doesn't flag it and no scan fires
    // to notice the alias is now a duplicate. Re-reconcile a few times as the page
    // settles to catch that. Debounced so a burst of fetches queues only one sequence.
    _settleScan() {
        var self = this;
        if (self._settling) return;
        self._settling = true;
        var delays = [350, 1000, 2200];
        delays.forEach(function (ms, idx) {
            setTimeout(function () {
                if (idx === delays.length - 1) self._settling = false;
                self.scan(); // scan() already guards toggle/availability/context
            }, ms);
        });
    },

    // Called from main.js on SPA navigation: the data may be cached (no fetch), but
    // the new view's cells still render progressively — so settle the same way.
    onNavigate() { if (Cyfor.config.enableCaseAlias) this._settleScan(); },

    _trim() {
        if (Object.keys(this._cache).length > this._CACHE_MAX) this._cache = {}; // simple bound
    },

    // Live-toggle OFF: remove every annotation. Shadow-piercing; never throws.
    _clear() {
        try {
            Cyfor.utils.querySelectorAllDeep('.cyfor-case-alias').forEach(function (el) { el.remove(); });
        } catch (e) { /* best-effort */ }
    },

    // Live-toggle ON: re-scan; _reconcile re-adds the aliases that belong (cached
    // ones reappear immediately) and skips any shown in a Project column.
    _refresh() { this.scan(); }
};
