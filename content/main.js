// ==================================================
// CYFOR Nucleus Enhancer — Main Orchestrator
// Wires all features together, manages the global
// MutationObserver, and handles lifecycle.
// ==================================================

Cyfor.main = {
    _lastUrl: location.href,
    _observer: null,
    _debouncedHandler: null,
    _lastCachedProfileName: '',
    _identityCached: false,

    boot: function () {
        var self = this;
        try {
            if (Cyfor.utils.isContextInvalid()) return;

            Cyfor.config.load(function () {
                Cyfor.config.startListening();
                self._initFeatures();
                self._startObserver();
                self._bindLifecycle();
            });
        } catch (e) {
            console.warn('[CYFOR] Boot failed:', e);
        }
    },

    _initFeatures: function () {
        Cyfor.undo.init();
        Cyfor.datetime.init();
        Cyfor.navigation.init();
        Cyfor.notes.init();
        Cyfor.templates.init();
        Cyfor.contextMenu.init();
        Cyfor.downloads.init();
        Cyfor.columns.init(); // Init context-aware column reordering
        Cyfor.caseAlias.init(); // Init case project/alias annotation
    },

    _startObserver: function () {
        var self = this;
        this._debouncedHandler = Cyfor.utils.throttle(function () {
            self._onDomChange();
        }, Cyfor.constants.OBSERVER_THROTTLE_MS);

        this._columnScanDebounced = Cyfor.utils.debounce(function () {
            Cyfor.columns.processAll();
        }, Cyfor.constants.COLUMN_SCAN_DEBOUNCE_MS);

        this._observer = new MutationObserver(function (mutations) {
            // Single pass over the mutations to learn two things:
            //  (a) did the light DOM gain any element nodes? — the expensive
            //      shadow-piercing scanners in _onDomChange only need to run then
            //      (most Lightning mutations are attribute/text-only);
            //  (b) was a lightning-datatable inserted? — triggers a column re-scan.
            var addedEl = false;
            var datatableAdded = false;
            var prefs = Cyfor.config && Cyfor.config.tableColumnPrefs;
            var checkDatatable = !!(prefs && Object.keys(prefs).length > 0);

            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue;        // element nodes only
                    addedEl = true;
                    if (checkDatatable && !datatableAdded) {
                        var tag = node.tagName ? node.tagName.toLowerCase() : '';
                        if (tag === 'lightning-datatable' ||
                            (node.querySelector && node.querySelector('lightning-datatable'))) {
                            datatableAdded = true;
                        }
                    }
                }
                if (addedEl && (datatableAdded || !checkDatatable)) break; // nothing more to learn
            }

            if (addedEl) self._domAdded = true;   // consumed + reset in _onDomChange
            self._debouncedHandler();
            if (datatableAdded) self._columnScanDebounced();
        });

        this._observer.observe(document.body, {
            subtree: true,
            childList: true
        });

        Cyfor.observer = this._observer;
        Cyfor.observerTarget = document.body;
        Cyfor.observerOptions = { subtree: true, childList: true };
        Cyfor.cleanup.register(function () {
            self._observer.disconnect();
            self._debouncedHandler.cancel();
            if (self._columnScanDebounced) self._columnScanDebounced.cancel();
        });
    },

    _onDomChange: function () {
        if (Cyfor.utils.isContextInvalid()) {
            Cyfor.cleanup.destroyAll();
            return;
        }

        // Consume the "elements were added" signal accumulated since the last run.
        var domAdded = this._domAdded;
        this._domAdded = false;

        var url = location.href;
        var navigated = (url !== this._lastUrl);
        if (navigated) {
            this._lastUrl = url;
            this._onNavigate();
        }

        if (Cyfor.config.enableNav &&
            Cyfor.navigation.isOnProcessPage() &&
            !document.getElementById('cyfor-nav-left')) {
            Cyfor.navigation.injectButtons();
        }

        // The shadow-piercing scanners (downloads / notes / editors) are the
        // expensive part — only run them when the light DOM actually gained
        // elements, or we just navigated. This skips the bulk of Lightning's
        // attribute/text-only mutations where a rescan would find nothing new.
        if (!domAdded && !navigated) return;

        Cyfor.downloads.scan();

        if (Cyfor.config.enableFormatNotes) {
            Cyfor.notes.formatAll();
        }

        Cyfor.templates._scanEditors();

        // Fully load an Exhibit-Process list (lazy rows) so navigation counts are
        // complete — no-op for non-EP lists and already-loaded tables.
        if (Cyfor.config.enableNav) Cyfor.navigation.maybePreload();

        // Annotate Forensic Case links with their project/alias where Salesforce
        // doesn't already show it (Task pages, Recently Viewed, etc.).
        if (Cyfor.config.enableCaseAlias) Cyfor.caseAlias.scan();
    },

    _onNavigate: function () {
        this._identityCached = false;
        Cyfor.navigation.handlePageChange();
        Cyfor.columns.processAll();

        if (Cyfor.config.enableFormatNotes) {
            Cyfor.notes.formatAll();
        }

        Cyfor.downloads._processed = new WeakSet();

        if (Cyfor.config.enableCaseAlias) Cyfor.caseAlias.onNavigate();

        if (Cyfor.contextMenu) Cyfor.contextMenu.hide();
    },

    _bindLifecycle: function () {
        var self = this;

        Cyfor.cleanup.addEventListener(window, 'beforeunload', function () {
            Cyfor.cleanup.destroyAll();
        });

        Cyfor.cleanup.addEventListener(document, 'visibilitychange', function () {
            if (document.hidden) {
                self._onTabHidden();
            } else {
                self._onTabVisible();
            }
        });

        Cyfor.cleanup.setInterval(function () {
            if (Cyfor.utils.isContextInvalid()) {
                Cyfor.cleanup.destroyAll();
            }
        }, Cyfor.constants.CONTEXT_CHECK_INTERVAL_MS);
    },

    _onTabHidden: function () {
        if (Cyfor.contextMenu) Cyfor.contextMenu.hide();
    },

    _onTabVisible: function () {
        if (Cyfor.config.enableFormatNotes) {
            Cyfor.notes.handleState();
        }
        Cyfor.templates.start();
    },

};

// ========================================
// PING HANDLER
// ========================================
try {
    var pingHandler = function (msg, sender, sendResponse) {
        if (msg.action === 'ping') {
            sendResponse({ ok: true, status: 'alive' });
            return true;
        }

    };
    chrome.runtime.onMessage.addListener(pingHandler);
    Cyfor.cleanup.register(function () {
        try { chrome.runtime.onMessage.removeListener(pingHandler); } catch (e) {}
    });
} catch (e) {}


// ========================================
// BOOT
// ========================================
Cyfor.main.boot();
