// ==================================================
// CYFOR Nucleus Enhancer — Main Orchestrator
// Wires all features together, manages the global
// MutationObserver, and handles lifecycle.
// ==================================================

Cyfor.main = {
    _lastUrl: location.href,
    _observer: null,
    _debouncedHandler: null,
    _scrapeDebounced: null,
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
            self._debouncedHandler();

            // Re-scan columns only when a lightning-datatable is newly inserted
            var prefs = Cyfor.config && Cyfor.config.tableColumnPrefs;
            if (prefs && Object.keys(prefs).length > 0) {
                for (var i = 0; i < mutations.length; i++) {
                    var added = mutations[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var node = added[j];
                        if (node.nodeType !== 1) continue;
                        var tag = node.tagName ? node.tagName.toLowerCase() : '';
                        if (tag === 'lightning-datatable' ||
                            (node.querySelector && node.querySelector('lightning-datatable'))) {
                            self._columnScanDebounced();
                            return;
                        }
                    }
                }
            }
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

        var url = location.href;
        if (url !== this._lastUrl) {
            this._lastUrl = url;
            this._onNavigate();
        }

        this._scrapeIfNeeded();

        if (Cyfor.config.enableNav &&
            Cyfor.navigation.isOnProcessPage() &&
            !document.getElementById('cyfor-nav-left')) {
            Cyfor.navigation.injectButtons();
        }

        Cyfor.downloads.scan();

        if (Cyfor.config.enableFormatNotes) {
            Cyfor.notes.formatAll();
        }

        Cyfor.templates._scanEditors();
    },

    _onNavigate: function () {
        this._identityCached = false;
        Cyfor.navigation.handlePageChange();
        Cyfor.columns.processAll();

        if (Cyfor.config.enableFormatNotes) {
            Cyfor.notes.formatAll();
        }

        Cyfor.downloads._processed = new WeakSet();

        if (Cyfor.contextMenu) Cyfor.contextMenu.hide();
    },

    _scrapeIfNeeded: function () {
        var rows = document.querySelectorAll('tr[data-row-key-value]');
        if (rows.length === 0) return;

        if (!this._scrapeDebounced) {
            this._scrapeDebounced = Cyfor.utils.debounce(function (r) {
                if (!Cyfor.utils.isContextInvalid()) {
                    Cyfor.navigation.scrapeProcessList(r);
                }
            }, Cyfor.constants.SCRAPE_DEBOUNCE_MS);

            Cyfor.cleanup.register(function () {
                this._scrapeDebounced.cancel();
            }.bind(this));
        }

        this._scrapeDebounced(rows);
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
