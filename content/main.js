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
        }, 300);

        this._observer = new MutationObserver(this._debouncedHandler);

        this._observer.observe(document.body, {
            subtree: true,
            childList: true
        });

        Cyfor.observer = this._observer;
        Cyfor.cleanup.register(function () {
            self._observer.disconnect();
            self._debouncedHandler.cancel();
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

        // Trigger table updates whenever DOM structure significantly mutates
        Cyfor.columns.processAll(); 
    },

    _onNavigate: function () {
        Cyfor.navigation.handlePageChange();

        if (Cyfor.config.enableFormatNotes) {
            Cyfor.notes.formatAll();
        }

        Cyfor.downloads._processed = new WeakSet();

        // Close any open context menu when navigating
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
            }, 1000);

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
        }, 10000);
    },

    _onTabHidden: function () {
        if (Cyfor.notes._intervalId != null) {
            Cyfor.cleanup.clearInterval(Cyfor.notes._intervalId);
            Cyfor.notes._intervalId = null;
        }
        Cyfor.templates.stop();
        if (Cyfor.contextMenu) Cyfor.contextMenu.hide();
    },

    _onTabVisible: function () {
        if (Cyfor.config.enableFormatNotes) {
            Cyfor.notes.handleState();
        }
        Cyfor.templates.start();
    },

    _cacheProfileIdentity: function () {
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

async function getSalesforceIdentity() {
    try {
        var origins = [location.origin];
        if (location.hostname.indexOf('.lightning.force.com') !== -1) {
            origins.push('https://' + location.hostname.replace('.lightning.force.com', '.my.salesforce.com'));
        }

        var lastErr = null;
        for (var i = 0; i < origins.length; i++) {
            try {
                var restResult = await fetchIdentityFromOrigin(origins[i]);
                restResult.source = 'rest';
                return restResult;
            } catch (err) {
                console.log('[CYFOR] REST identity failed for', origins[i], ':', err.message);
                lastErr = err;
            }
        }

        for (var j = 0; j < origins.length; j++) {
            try {
                var oauthResult = await fetchOAuthUserInfoFromOrigin(origins[j]);
                oauthResult.source = 'oauth';
                return oauthResult;
            } catch (err2) {
                console.log('[CYFOR] OAuth userinfo failed for', origins[j], ':', err2.message);
                lastErr = err2;
            }
        }

        if (lastErr && (lastErr.code === 401 || lastErr.code === 403)) {
            return { ok: false, error: 'Salesforce session expired. Please sign in again.' };
        }

        var domIdentity = extractIdentityFromDom();
        console.log('[CYFOR] DOM identity result:', domIdentity);
        if (domIdentity.fullName || domIdentity.username || domIdentity.email) {
            return {
                ok: true,
                source: 'dom',
                user: {
                    id: '',
                    fullName: domIdentity.fullName || '',
                    username: domIdentity.username || '',
                    email: domIdentity.email || '',
                    organizationId: '',
                    domain: location.hostname,
                    instanceUrl: location.origin
                },
                partial: true
            };
        }

        // All API methods failed — still treat active Lightning session as connected.
        console.log('[CYFOR] All identity methods failed, using session-only fallback.');
        return {
            ok: true,
            source: 'session',
            user: {
                id: '',
                fullName: '',
                username: '',
                email: '',
                organizationId: '',
                domain: location.hostname,
                instanceUrl: location.origin
            },
            partial: true
        };
    } catch (e) {
        return {
            ok: false,
            error: (e && e.message) || 'Could not verify Salesforce session.'
        };
    }
}

async function fetchOAuthUserInfoFromOrigin(origin) {
    var res = await fetch(origin + '/services/oauth2/userinfo', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) {
        var oauthErr = new Error('Salesforce OAuth userinfo failed (' + res.status + ')');
        oauthErr.code = res.status;
        throw oauthErr;
    }

    var user = await res.json();
    return {
        ok: true,
        user: {
            id: user.user_id || '',
            fullName: user.name || '',
            username: user.preferred_username || '',
            email: user.email || '',
            organizationId: user.organization_id || '',
            domain: (new URL(origin)).hostname,
            instanceUrl: origin
        },
        partial: true
    };
}

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

async function fetchIdentityFromOrigin(origin) {
    var versionsRes = await fetch(origin + '/services/data/', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
    });

    if (!versionsRes.ok) {
        var versionsErr = new Error('Salesforce API endpoint not reachable (' + versionsRes.status + ')');
        versionsErr.code = versionsRes.status;
        throw versionsErr;
    }

    var versions = await versionsRes.json();
    var latestVersion = '60.0';
    if (Array.isArray(versions) && versions.length > 0 && versions[versions.length - 1].version) {
        latestVersion = versions[versions.length - 1].version;
    }

    var meRes = await fetch(origin + '/services/data/v' + latestVersion + '/chatter/users/me', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
    });

    if (!meRes.ok) {
        var meErr = new Error('Salesforce user lookup failed (' + meRes.status + ')');
        meErr.code = meRes.status;
        throw meErr;
    }

    var user = await meRes.json();
    return {
        ok: true,
        user: {
            id: user.id || '',
            fullName: user.name || '',
            username: user.username || '',
            email: user.email || '',
            organizationId: user.organizationId || '',
            domain: (new URL(origin)).hostname,
            instanceUrl: origin
        }
    };
}

// ========================================
// BOOT
// ========================================
Cyfor.main.boot();
