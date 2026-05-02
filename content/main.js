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

                console.log(
                    '%c[CYFOR]%c Nucleus Enhancer loaded',
                    'color:#0070d2;font-weight:700',
                    'color:inherit'
                );
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
        this._cacheProfileIdentity();

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
                console.log('[CYFOR] Context invalidated \u2014 cleaning up');
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

    _cacheProfileIdentity: function () {
        if (this._identityCached) return;

        var selectors = [
            'a.profile-link-label[href*="/lightning/r/User/"]',
            'a.profile-link-label[href*="/User/"]',
            'h1.profile-card-name a[href*="/lightning/r/User/"]',
            'h1.profile-card-name'
        ];

        var profileName = '';

        for (var i = 0; i < selectors.length; i++) {
            var matches = Cyfor.utils.querySelectorAllDeep(selectors[i], document.body, 12);
            for (var j = 0; j < matches.length; j++) {
                var text = (matches[j].textContent || '').trim();
                if (text && !/^(view profile|profile)$/i.test(text)) {
                    profileName = text;
                    break;
                }
            }
            if (profileName) break;
        }

        if (!profileName) {
            var titledEls = Cyfor.utils.querySelectorAllDeep('[title^="View profile for "], [aria-label^="View profile for "]', document.body, 12);
            for (var k = 0; k < titledEls.length; k++) {
                var raw = titledEls[k].getAttribute('title') || titledEls[k].getAttribute('aria-label') || '';
                var extracted = raw.replace(/^View profile for\s+/i, '').trim();
                if (extracted) {
                    profileName = extracted;
                    break;
                }
            }
        }

        if (!profileName || profileName === this._lastCachedProfileName) return;

        this._lastCachedProfileName = profileName;
        this._identityCached = true;
        chrome.storage.local.set({
            salesforceIdentityCache: {
                domain: location.hostname,
                fullName: profileName,
                lastSeenAt: Date.now()
            }
        });
    }
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

        if (msg.action === 'getSalesforceIdentityDom') {
            resolveSalesforceIdentityFromDom()
                .then(function (domId) {
                    if (domId.fullName || domId.username || domId.email) {
                        sendResponse({
                            ok: true, source: 'dom', partial: true,
                            user: {
                                id: '', fullName: domId.fullName || '',
                                username: domId.username || '', email: domId.email || '',
                                organizationId: '', domain: location.hostname, instanceUrl: location.origin
                            }
                        });
                    } else {
                        sendResponse({ ok: false });
                    }
                })
                .catch(function () {
                    sendResponse({ ok: false });
                });
            return true;
        }
    };
    chrome.runtime.onMessage.addListener(pingHandler);
    Cyfor.cleanup.register(function () {
        try { chrome.runtime.onMessage.removeListener(pingHandler); } catch (e) {}
    });
} catch (e) {}

function extractIdentityFromDom() {
    var exactSelectors = [
        'a.profile-link-label[href*="/lightning/r/User/"]',
        'a.profile-link-label[href*="/User/"]',
        'h1.profile-card-name a[href*="/lightning/r/User/"]',
        'h1.profile-card-name'
    ];

    for (var i = 0; i < exactSelectors.length; i++) {
        var exactEls = Cyfor.utils.querySelectorAllDeep(exactSelectors[i], document.body, 12);
        for (var j = 0; j < exactEls.length; j++) {
            var exactText = sanitizeUserLabel(exactEls[j].textContent || '');
            if (exactText) {
                return { fullName: exactText, username: '', email: '' };
            }
        }
    }

    // Use shadow-DOM-aware search for elements whose title/aria-label explicitly
    // says "View profile for <name>" — this is the most reliable Salesforce signal.
    var profileSelectors = [
        'button[title^="View profile for "]',
        'a[title^="View profile for "]',
        'button[aria-label^="View profile for "]'
    ];

    for (var k = 0; k < profileSelectors.length; k++) {
        var els = Cyfor.utils.querySelectorAllDeep(profileSelectors[k], document.body, 12);
        for (var m = 0; m < els.length; m++) {
            var name = sanitizeUserLabel(
                els[m].getAttribute('title') || els[m].getAttribute('aria-label') || ''
            );
            if (name) return { fullName: name, username: '', email: '' };
        }
    }

    // Secondary: .profileName span inside the user-menu component
    var profileNameEls = Cyfor.utils.querySelectorAllDeep('.profileName', document.body, 12);
    for (var n = 0; n < profileNameEls.length; n++) {
        var pn = sanitizeUserLabel(profileNameEls[n].textContent || '');
        if (pn) return { fullName: pn, username: '', email: '' };
    }

    return { fullName: '', username: '', email: '' };
}

function resolveSalesforceIdentityFromDom() {
    return new Promise(function (resolve) {
        var directIdentity = extractIdentityFromDom();
        if (directIdentity.fullName || directIdentity.username || directIdentity.email) {
            resolve(directIdentity);
            return;
        }

        var triggers = Cyfor.utils.querySelectorAllDeep(
            '[title^="View profile for "], [aria-label^="View profile for "], one-app-nav-bar-user-menu button, button.slds-global-actions__item-action',
            document.body,
            12
        );

        var clicked = false;
        for (var i = 0; i < triggers.length; i++) {
            if (triggers[i] && typeof triggers[i].click === 'function') {
                triggers[i].click();
                clicked = true;
                break;
            }
        }

        if (!clicked) {
            resolve(directIdentity);
            return;
        }

        setTimeout(function () {
            resolve(extractIdentityFromDom());
        }, 400);
    });
}

function sanitizeUserLabel(text) {

    var value = (text || '')
        .replace(/^View profile for\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!value) return '';
    // Block known Salesforce UI chrome labels that are not user names
    var BLOCKLIST = /^(profile|user|settings|help|guidance|guidance center|setup|search|notifications|home|apps|back|more|menu)$/i;
    if (BLOCKLIST.test(value)) return '';
    if (value.length < 2) return '';
    return value;
}

// ========================================
// BOOT
// ========================================
Cyfor.main.boot();
