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
    _pollTimer: null,     // ongoing re-scan timer (null = not scheduled)
    _lastLinkCount: 0,    // case links the last scan saw (drives the poll's fast/idle cadence)
    _activeUntil: 0,      // poll in its FAST cadence until this epoch-ms (set on nav/fetch/row churn)

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
        // Some list views (the Tasks split view especially) render their case links deep
        // in shadow DOM, fill the hrefs in late, and re-render rows — none of which the
        // light-DOM MutationObserver sees, and there is no reliable "rendering done"
        // signal. So keep a low-frequency re-scan running for the page's lifetime; it is
        // idempotent and self-paces down to a quiet heartbeat once the view is steady.
        this._startPoll();
    },

    // Annotate visible Forensic Case links with their project/alias.
    scan() {
        if (!this._available || !Cyfor.config.enableCaseAlias || Cyfor.utils.isContextInvalid()) return;
        try { this._scan(); } catch (e) { /* a flaky/odd DOM must never break the page */ }
    },

    _scan() {

        // Case links come in TWO flavours and we must match both:
        //  1. Modern LWC links — /lightning/r/<id>/view (id-only) or the object-named form.
        //  2. Legacy Aura "special links" used by the Tasks split-view list — the case id
        //     lives in data-recordid and the href is "javascript:void(0)". THIS is the one
        //     the "Related To" column uses, and missing it is why aliases never showed
        //     there (the extension only ever matched unrelated cached /lightning/r/ rows).
        // Once the key-prefix is known we target it directly; until then we scan broadly
        // and let the background query filter. Shadow-piercing — these links nest deep.
        var sel = this._keyPrefix
            ? 'a[href*="/lightning/r/' + this._keyPrefix + '"], a[href*="/Forensic_Case__c/"], a[data-recordid^="' + this._keyPrefix + '"]'
            : 'a[href*="/lightning/r/"], a[data-recordid]';
        // Depth 14 (vs the default 10): the Tasks split view nests its "Related To"
        // case links right at depth 10, so a little headroom guards against a render
        // that lands one level deeper. The walk still stops early where nothing nests
        // that far, so the margin is effectively free on shallower pages.
        var links = Cyfor.utils.querySelectorAllDeep(sel, document.body, 14);
        if (!links.length) { this._lastLinkCount = 0; return; }

        // The record THIS page is showing (a case's own record page). Skip links that
        // point to it — otherwise we'd annotate the breadcrumb and every related-list
        // quick link (Files, Case Expenses, …), which all reference the current case.
        var currentId   = this._caseId(location.href);
        var currentId15 = currentId ? currentId.slice(0, 15) : null; // 15-char base (15/18 id forms)

        var toFetch = [], seen = {}, caseLinks = 0;
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var id = this._idOf(a);
            if (!id) continue;
            var href = (a.getAttribute && a.getAttribute('href')) || '';
            // Never annotate the page's OWN record (breadcrumb / highlights) or its
            // related-list quick-links (Files, Exhibits, … — href carries /related/), and
            // actively REMOVE any stray span on them. During an SPA navigation the page's
            // own links briefly look "foreign" (the URL has already moved to the
            // destination), get annotated, and bfcache preserves that on Back — so cleaning
            // here lets the next scan self-heal it, and the /related/ test is URL-independent.
            if (/\/related\//.test(href) || (currentId15 && id.slice(0, 15) === currentId15)) {
                this._removeAlias(a);
                continue;
            }
            if (this._keyPrefix && id.slice(0, 3) !== this._keyPrefix) continue; // not a Forensic Case
            caseLinks++;
            var cached = this._cache[id];
            if (cached !== undefined) {
                this._reconcile(a, cached); // re-checked every scan, so timing races self-heal
            } else if (!this._pending[id] && !seen[id]) {
                seen[id] = true;
                toFetch.push(id);
            }
        }
        // A changing row count (a re-render) or new fetches mean the view is still
        // settling — hold the poll in its fast cadence for a while so late rows get
        // caught promptly instead of waiting for the idle heartbeat.
        if (caseLinks !== this._lastLinkCount || toFetch.length) this._activeUntil = Date.now() + 25000;
        this._lastLinkCount = caseLinks;
        if (toFetch.length) this._fetch(toFetch.slice(0, 200));
    },

    // The record id for a case link. Legacy Aura "special links" (the Tasks split-view
    // "Related To" column) carry it in data-recordid and have a useless javascript:void
    // href; modern links carry it in the href. Prefer the explicit attribute, then parse.
    _idOf(a) {
        var rid = a.getAttribute && a.getAttribute('data-recordid');
        if (rid && /^[a-zA-Z0-9]{15,18}$/.test(rid)) return rid;
        return this._caseId(a.getAttribute && a.getAttribute('href'));
    },

    // Extract a record id from a Lightning record href — handles both the id-only
    // form (/lightning/r/<id>/view) and the object-named form.
    _caseId(href) {
        var m = (href || '').match(/\/lightning\/r\/(?:Forensic_Case__c\/)?([a-zA-Z0-9]{15,18})(?:\/|$|\?)/);
        return m ? m[1] : null;
    },

    // Remove any alias we previously added inside a link — used to clean up a stray
    // annotation on the page's own record or a related-list quick-link (e.g. one left by
    // an SPA-navigation race and restored from bfcache on Back).
    _removeAlias(link) {
        var span = link.querySelector && link.querySelector('.cyfor-case-alias');
        if (span) span.remove();
    },

    // Reconcile the annotation with the CURRENT row state: add the alias when it's
    // not already shown, remove it if a Project column in the same row now shows it.
    // Run on every scan, so annotating before Lightning finished rendering the
    // Project cell self-corrects on the next pass instead of sticking.
    _reconcile(link, project) {
        // Put the alias INSIDE the <a>, after its text — not as a sibling. In the
        // polymorphic "Related To" lookup column the ENTIRE cell-content chain
        // (slds-grid_align-spread → slds-truncate → force-lookup → …) computes to zero
        // width; the case number is visible only because the <a>'s own text overflows
        // that chain. A sibling span — anywhere in the chain — collapses to zero width
        // (the bug we kept chasing). A child of the <a> rides the very same text flow as
        // the visible number, so it shows wherever the number shows. In plain columns it
        // just trails the link text, which is what we want anyway.
        var existing = null, kids = link.children;
        for (var k = 0; k < kids.length; k++) {
            if (kids[k].classList && kids[k].classList.contains('cyfor-case-alias')) { existing = kids[k]; break; }
        }
        var show = !!project && !this._shownInRow(link, project);

        if (show && !existing) {
            var span = document.createElement('span');
            span.className   = 'cyfor-case-alias';
            span.textContent = project;            // text node — XSS-safe
            span.title       = 'Project / alias: ' + project;
            link.appendChild(span);
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
            self._activeUntil = Date.now() + 25000; // keep re-scanning as late cells fill in
            self.scan();                            // annotate the now-cached links
            if (Cyfor.log) Cyfor.log('cases', 'alias fetched', { count: ids.length });
        });
    },

    // Ongoing re-scan for the page's lifetime. Case links live in shadow DOM and render
    // PROGRESSIVELY — an <a> is added first and its href filled later — and busy views
    // (the Tasks split view) keep re-rendering rows; the light-DOM/childList observer
    // sees none of it and there's no "rendering done" signal, so a fixed-window settle
    // always quits too early on the slow lists. Instead we never stop: poll fast (1.5s)
    // while the view is churning or fetches are in flight, and drop to a quiet 8s
    // heartbeat once steady (which still re-annotates any later re-render). Each scan is
    // idempotent and skipped on hidden tabs, and the loop ends only when the extension
    // context is torn down (a fresh page load re-arms it from init()).
    _startPoll() {
        var self = this;
        if (self._pollTimer) return; // already running
        function tick() {
            self._pollTimer = null;
            if (Cyfor.utils.isContextInvalid()) return; // context gone — re-armed on next load
            if (document.visibilityState !== 'hidden') self.scan();
            var fast = Date.now() < self._activeUntil || Object.keys(self._pending).length > 0;
            self._pollTimer = setTimeout(tick, fast ? 1500 : 8000);
        }
        self._pollTimer = setTimeout(tick, 600);
    },

    // Called from main.js on SPA navigation: the data may be cached (no fetch), but the
    // new view's cells still render progressively — scan now and keep the poll fast.
    onNavigate() {
        if (!Cyfor.config.enableCaseAlias) return;
        this._activeUntil = Date.now() + 25000;
        this.scan();
        this._startPoll(); // normally already running; harmless if so
    },

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
