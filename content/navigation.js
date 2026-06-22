// ==================================================
// CYFOR Nucleus Enhancer — Record Navigation
// Left/right arrows to navigate between Exhibit Process
// records in the order they appeared in the list view.
// ==================================================

Cyfor.navigation = {
    _lastUrl: location.href,
    _scrapeTimeout: null,
    _counterTimeout: null,
    _counterFadeTimeout: null,
    _navPrefix: null,   // learned ID prefix of Exhibit-Process records (e.g. "a2R")
    _listCache: {},     // { contextKey: { ids:[…], at } } — avoids re-loading a list
    _CACHE_MAX: 30,     // keep the most-recent N lists (LRU); tiny storage footprint
    _CACHE_TTL: 30 * 60 * 1000, // trust a cache without a count match for 30 min

    /**
     * Check if the current page is an Exhibit Process record view.
     */
    isOnProcessPage() {
        const href = location.href;
        return href.includes('/view') && href.includes('Exhibit_Process__c');
    },

    /**
     * Extract the 15-char record ID from the current URL.
     * Returns null if not on a process page.
     */
    getCurrentRecordId() {
        const match = location.href.match(/Exhibit_Process__c\/([a-zA-Z0-9]+)\/view/);
        return match ? Cyfor.utils.normalizeId(match[1]) : null;
    },

    /** Deduped, ordered record IDs from a table's rows (HEADER + junk skipped). */
    _extractIds(rows) {
        const ids = [];
        for (const row of rows) {
            const raw = row.getAttribute('data-row-key-value');
            if (this._isRecordId(raw)) ids.push(Cyfor.utils.normalizeId(raw));
        }
        return [...new Set(ids)];
    },

    /** Store the active list for navigation, keyed by the object's ID prefix. */
    _storeList(ids) {
        if (!ids || !ids.length) return;
        const store = {};
        store['navList:' + ids[0].slice(0, 3)] = ids;
        chrome.storage.local.set(store);
    },

    /**
     * Capture the list from the SPECIFIC table the user clicks in, at click time.
     * This is far more reliable than periodically scraping every table on the page
     * (which mixed unrelated tables — e.g. "Recently Viewed" + the list — together,
     * breaking the position count and sometimes omitting the clicked record). The
     * clicked record is always part of the table it was clicked in, so the buttons
     * appear and the count is right.
     */
    _captureFromClick(e) {
        const t = e.target;
        const row = (t && t.closest) ? t.closest('tr[data-row-key-value]') : null;
        if (!row || !this._isRecordId(row.getAttribute('data-row-key-value'))) return;
        const table = row.closest('table');
        if (!table) return;

        const ids = this._extractIds(table.querySelectorAll('tr[data-row-key-value]'));
        if (!ids.length) return;

        // The visible table may be only partly loaded (lazy rows). If we already
        // have a fuller list for this context that contains the clicked record,
        // keep THAT — don't shrink the navigation list to the visible subset.
        const key = this._contextKey();
        const cached = key ? this._listCache[key] : null;
        const clickedId = Cyfor.utils.normalizeId(row.getAttribute('data-row-key-value'));
        const useCached = cached && cached.ids.length >= ids.length && cached.ids.indexOf(clickedId) !== -1;
        const list = useCached ? cached.ids : ids;
        this._storeList(list);
        Cyfor.log('nav', 'list from click', { count: list.length, cached: !!useCached });
    },

    /** True only for a 15- or 18-character Salesforce record ID. */
    _isRecordId(id) {
        return typeof id === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(id);
    },

    /**
     * Salesforce list views lazy-load rows (you saw "1 / 21" then "1 / 38" after
     * scrolling). Find an Exhibit-Process list table that hasn't been fully loaded
     * and quietly scroll it to the end so EVERY row renders, then restore the
     * scroll position and capture the complete list. Runs once per table.
     */
    maybePreload() {
        if (!Cyfor.config.enableNav) return;
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
            if (table.dataset.cyforNavLoaded) continue;            // already handled
            const row = this._firstRecordRow(table);               // skips the HEADER row
            if (!row) {
                table.dataset.cyforNavLoaded = '1';                // not a record list — skip forever
                continue;
            }
            if (this._isNavList(table)) {
                this._ensureList(table);                           // cache hit = no scroll
                return;                                            // one per cycle
            }
            // A record list, but not an Exhibit-Process one. Only mark it as "skip"
            // once we actually know the EP prefix — otherwise an EP list checked
            // before the prefix loaded would be skipped forever.
            if (this._navPrefix) table.dataset.cyforNavLoaded = '1';
        }
    },

    /** First row that is a real record (NOT Salesforce's HEADER row). */
    _firstRecordRow(table) {
        const rows = table.querySelectorAll('tr[data-row-key-value]');
        for (const r of rows) {
            if (this._isRecordId(r.getAttribute('data-row-key-value'))) return r;
        }
        return null;
    },

    /** A stable key for the list being shown (the parent record, or the list view). */
    _contextKey() {
        const rec = location.href.match(/\/lightning\/r\/[^/]+\/([a-zA-Z0-9]{15,18})\//);
        if (rec) return 'r:' + Cyfor.utils.normalizeId(rec[1]);
        if (/\/lightning\/o\/Exhibit_Process__c\//i.test(location.href)) return 'o:' + (location.search || '');
        return null;
    },

    /** Best-effort read of the related list's total item count ("42 items" / "50+ items"). */
    _listItemCount(table) {
        const card = table.closest('article.slds-card') || table.closest('.slds-card') || table.parentElement;
        if (!card) return null;
        const nodes = card.querySelectorAll('span, p, h1, h2, h3, div');
        for (const n of nodes) {
            if (n.querySelector && n.querySelector('table')) continue; // skip wrappers of the table
            const m = (n.textContent || '').trim().match(/^(\d+)(\+)?\s+items?\b/i);
            if (m) return { count: parseInt(m[1], 10), capped: !!m[2] };
        }
        return null;
    },

    /** Cache a list under a context key (LRU-capped, persisted). */
    _cacheList(key, ids) {
        if (!key || !ids || !ids.length) return;
        this._listCache[key] = { ids: ids, at: Date.now() };
        const keys = Object.keys(this._listCache);
        if (keys.length > this._CACHE_MAX) {
            keys.sort((a, b) => this._listCache[a].at - this._listCache[b].at);
            for (let i = 0; i < keys.length - this._CACHE_MAX; i++) delete this._listCache[keys[i]];
        }
        try { chrome.storage.local.set({ navListCache: this._listCache }); } catch (e) { /* ignore */ }
    },

    /**
     * Make sure the full list is available, WITHOUT re-loading it if we already
     * have it for this case. Uses the cache when the list's item count still
     * matches (no scroll/fade); otherwise loads it and caches the result.
     */
    _ensureList(table) {
        if (table.dataset.cyforNavLoaded) return;
        const key = this._contextKey();
        const cached = key ? this._listCache[key] : null;
        if (cached) {
            const cnt = this._listItemCount(table);
            // Prefer the authoritative item-count check; if the count can't be read
            // (header not ready / "50+"), fall back to a recent-enough cache.
            const countOk = cnt && !cnt.capped && cnt.count === cached.ids.length;
            const recentOk = !cnt && (Date.now() - cached.at) < this._CACHE_TTL;
            if (countOk || recentOk) {
                table.dataset.cyforNavLoaded = '1';
                this._storeList(cached.ids);
                Cyfor.log('nav', 'list from cache', { count: cached.ids.length, via: countOk ? 'count' : 'ttl' });
                return;
            }
        }
        this._preloadList(table, key);
    },

    /**
     * Is this table an Exhibit-Process list? Most reliable signal is the record-ID
     * prefix of its rows matching the EP prefix we learned from visiting any EP
     * record (Salesforce row links don't reliably contain the object name). Falls
     * back to URL/link heuristics before that prefix has been learned.
     */
    _isNavList(table) {
        const row = this._firstRecordRow(table);   // skip the HEADER row
        if (!row) return false;
        const id = row.getAttribute('data-row-key-value');
        if (this._navPrefix) return id.slice(0, 3) === this._navPrefix;
        return !!table.querySelector('a[href*="Exhibit_Process"]') || /Exhibit_Process/i.test(location.href);
    },

    /** Save the scrollTop of every scrollable ancestor of `el` (+ the page). */
    _saveScrollPositions(el) {
        const saved = [];
        let node = el;
        while (node) {
            if (node.scrollHeight - node.clientHeight > 4) saved.push([node, node.scrollTop]);
            node = node.parentElement;
        }
        const se = document.scrollingElement || document.documentElement;
        if (se) saved.push([se, se.scrollTop]);
        return saved;
    },

    _restoreScrollPositions(saved) {
        for (const pair of saved) {
            try { pair[0].scrollTop = pair[1]; } catch (e) { /* ignore */ }
        }
    },

    /**
     * Load every lazy row of a list WITHOUT the user seeing it scroll: hide the
     * list, scroll it to the end behind the scenes to load all rows, restore the
     * scroll position, then reveal it — fully loaded and back at the top.
     */
    _preloadList(table, cacheKey) {
        if (!table || table.dataset.cyforNavLoaded) return;
        table.dataset.cyforNavLoaded = '1'; // once per table (prevents re-entry)

        // Snapshot EVERY scrollable ancestor so we can put the view back exactly.
        const saved = this._saveScrollPositions(table);
        Cyfor.log('nav', 'preload start', { rows: table.querySelectorAll('tr[data-row-key-value]').length });

        // Hide the scrolling motion: dim the list out (and block clicks on it while
        // it's invisible), do the work, then dim it back in.
        const prev = { transition: table.style.transition, opacity: table.style.opacity, pointerEvents: table.style.pointerEvents };
        table.style.transition = 'opacity .1s ease';
        table.style.opacity = '0';
        table.style.pointerEvents = 'none';

        const reveal = () => {
            this._restoreScrollPositions(saved);
            table.style.opacity = '1';
            table.style.pointerEvents = prev.pointerEvents;
            // Re-apply the restore as the datatable re-renders, then drop our styles.
            Cyfor.cleanup.setTimeout(() => this._restoreScrollPositions(saved), 80);
            Cyfor.cleanup.setTimeout(() => {
                this._restoreScrollPositions(saved);
                table.style.opacity = prev.opacity;
                table.style.transition = prev.transition;
            }, 320);
        };

        let lastCount = -1, iterations = 0;
        const step = () => {
            if (Cyfor.utils.isContextInvalid()) { table.style.opacity = '1'; table.style.pointerEvents = prev.pointerEvents; return; }
            const rows = table.querySelectorAll('tr[data-row-key-value]');
            if (rows.length !== lastCount && iterations < 40) {  // keep going while rows load
                lastCount = rows.length;
                iterations++;
                const last = rows[rows.length - 1];
                if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end', behavior: 'instant' });
                Cyfor.cleanup.setTimeout(step, 200);
            } else {
                reveal();
                const ids = this._extractIds(rows);
                this._storeList(ids);
                this._cacheList(cacheKey, ids);   // remember it so we don't reload next time
                Cyfor.log('nav', 'preload done', { rows: lastCount, cached: !!cacheKey });
            }
        };
        step();
    },

    /**
     * Inject or update navigation buttons on the page.
     */
    injectButtons() {
        if (Cyfor.utils.isContextInvalid()) return;
        if (!Cyfor.config.enableNav) return;
        if (!this.isOnProcessPage()) return;
        if (document.getElementById('cyfor-nav-left')) return;

        const currentId = this.getCurrentRecordId();
        if (!currentId) return;

        const key = 'navList:' + currentId.slice(0, 3);
        chrome.storage.local.get([key], (result) => {
            if (Cyfor.utils.isContextInvalid() || !Cyfor.config.enableNav) return;

            const list = (result && result[key]) || [];
            const idx = list.indexOf(currentId);

            // Remove stale buttons before adding fresh ones
            this.removeButtons();

            // This record isn't part of a known list (landed on it directly, or
            // the last list scraped was a different object). Show no navigation
            // rather than two dead arrows.
            if (idx < 0) return;

            const prevId = idx > 0 ? list[idx - 1] : null;
            const nextId = idx < list.length - 1 ? list[idx + 1] : null;

            document.body.appendChild(this._createButton('cyfor-nav-left', '&#10094;', prevId));
            document.body.appendChild(this._createButton('cyfor-nav-right', '&#10095;', nextId));

            if (list.length > 1) {
                this._showPositionCounter(idx + 1, list.length);
            }
        });
    },

    /**
     * Remove navigation buttons from the page.
     */
    removeButtons() {
        document.getElementById('cyfor-nav-left')?.remove();
        document.getElementById('cyfor-nav-right')?.remove();
        this._removePositionCounter();
    },

    /**
     * Handle page URL changes (SPA navigation).
     */
    handlePageChange() {
        if (Cyfor.utils.isContextInvalid()) return;

        // Always clear buttons from the previous record first, so any navigation
        // (including SPA) rebuilds them fresh for the record we're now on rather
        // than leaving the old record's Prev/Next behind.
        this.removeButtons();
        if (this.isOnProcessPage() && Cyfor.config.enableNav) {
            // Learn the Exhibit-Process ID prefix from the record we're on, so list
            // pages can recognise EP lists reliably and preload them.
            const id = this.getCurrentRecordId();
            if (id && id.slice(0, 3) !== this._navPrefix) {
                this._navPrefix = id.slice(0, 3);
                try { chrome.storage.local.set({ navObjectPrefix: this._navPrefix }); } catch (e) { /* ignore */ }
            }
            this.injectButtons();
        }
    },

    /**
     * Navigate to a different record by ID.
     */
    navigateTo(id) {
        // Defensive: never navigate to a non-record value (e.g. "HEADER").
        if (!this._isRecordId(id)) { Cyfor.log('nav', 'navigate skipped — bad id', { id }); return; }
        Cyfor.log('nav', 'navigate', { to: id });
        location.href = location.href.replace(
            /Exhibit_Process__c\/[a-zA-Z0-9]+\/view/,
            `Exhibit_Process__c/${id}/view`
        );
    },

    /**
     * Create a navigation button element.
     */
    _createButton(id, arrowHtml, targetId) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.className = `cyfor-nav-btn ${id.includes('left') ? 'cyfor-nav-btn-left' : 'cyfor-nav-btn-right'}`;
        btn.innerHTML = arrowHtml;
        btn.disabled = !targetId;
        btn.setAttribute('aria-label', id.includes('left') ? 'Previous record' : 'Next record');

        if (targetId) {
            btn.title = 'Go to record';
            btn.addEventListener('click', () => this.navigateTo(targetId));
        }

        return btn;
    },

    /**
     * Show position counter (e.g. "3 / 12").
     */
    _showPositionCounter(current, total) {
        this._removePositionCounter();

        const counter = document.createElement('div');
        counter.id = 'cyfor-nav-counter';
        counter.setAttribute('aria-label', `Record ${current} of ${total}`);
        counter.textContent = `${current} / ${total}`;
        document.body.appendChild(counter);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (counter.isConnected) {
                    counter.classList.add('visible');
                }
            });
        });

        // Fade out after 3 seconds
        Cyfor.cleanup.clearTimeout(this._counterTimeout);
        this._counterTimeout = Cyfor.cleanup.setTimeout(() => {
            if (counter.isConnected) {
                counter.classList.add('fading');
            }

            Cyfor.cleanup.clearTimeout(this._counterFadeTimeout);
            this._counterFadeTimeout = Cyfor.cleanup.setTimeout(() => {
                if (counter.isConnected) counter.remove();
            }, 600);
        }, 3000);
    },

    /**
     * Remove position counter immediately.
     */
    _removePositionCounter() {
        Cyfor.cleanup.clearTimeout(this._counterTimeout);
        Cyfor.cleanup.clearTimeout(this._counterFadeTimeout);
        document.getElementById('cyfor-nav-counter')?.remove();
    },

    /**
     * Initialise navigation: keyboard shortcuts and settings listener.
     */
    init() {
        // Restore the learned EP ID prefix + the per-case list cache so preloading
        // is skipped for lists we've already loaded.
        try {
            chrome.storage.local.get(['navObjectPrefix', 'navListCache'], (r) => {
                if (r && r.navObjectPrefix) this._navPrefix = r.navObjectPrefix;
                if (r && r.navListCache && typeof r.navListCache === 'object') this._listCache = r.navListCache;
            });
        } catch (e) { /* ignore */ }

        // Keyboard shortcuts
        const keyHandler = (e) => {
            if (!Cyfor.config.enableNav || !this.isOnProcessPage()) return;

            // Don't capture when user is typing
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault();
                document.getElementById('cyfor-nav-left')?.click();
            } else if (e.altKey && e.key === 'ArrowRight') {
                e.preventDefault();
                document.getElementById('cyfor-nav-right')?.click();
            }
        };

        Cyfor.cleanup.addEventListener(document, 'keydown', keyHandler);

        // Capture the navigable list the moment a record row is clicked — the
        // reliable signal for "which list am I navigating". Capture phase so it
        // runs before Salesforce navigates away.
        Cyfor.cleanup.addEventListener(document, 'click', (e) => this._captureFromClick(e), true);

        // React to setting changes
        Cyfor.config.onChange.enableNav.push((enabled) => {
            if (enabled) {
                this.handlePageChange();
            } else {
                this.removeButtons();
            }
        });

        // Initial injection
        this.handlePageChange();
    }
};