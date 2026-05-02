// ==================================================
// CYFOR Nucleus Enhancer — Popup Authentication
// Salesforce session identity, sign-in, sign-out,
// avatar rendering, and auth state persistence.
// ==================================================

var AUTH_STORAGE_KEY = 'salesforceAuth';

function bindAuthActions() {
    els.authSignInBtn.addEventListener('click', function () {
        refreshSalesforceAuth(true);
    });

    els.authSignOutBtn.addEventListener('click', function () {
        var resetState = {
            isSignedIn: false,
            fullName: '', username: '', email: '',
            profilePhotoUrl: '', profilePhotoDataUrl: '',
            organizationId: '', domain: '', instanceUrl: '',
            lastVerifiedAt: null
        };
        persistAuthState(resetState);
        renderAuthFromState(resetState);
    });
}

function refreshSalesforceAuth(openLoginOnFailure) {
    setAuthLoading(true);

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs[0];
        if (!tab || !tab.id || !tab.url || tab.url.indexOf('lightning.force.com') === -1) {
            setAuthLoading(false);
            renderAuthDisconnected('Open a Salesforce record tab, then click Sign In.');
            if (openLoginOnFailure) chrome.tabs.create({ url: 'https://login.salesforce.com/' });
            return;
        }

        chrome.runtime.sendMessage({ action: 'getSalesforceIdentity', tabId: tab.id, tabUrl: tab.url }, function (response) {
            setAuthLoading(false);

            if (chrome.runtime.lastError || !response || !response.ok) {
                var err = (response && response.error) || 'Could not verify Salesforce session. Open an active Lightning record tab and try again.';
                renderAuthDisconnected(err);
                if (openLoginOnFailure) chrome.tabs.create({ url: 'https://login.salesforce.com/' });
                return;
            }

            var authState = {
                isSignedIn: true,
                fullName: response.user.fullName || '',
                username: response.user.username || '',
                email: response.user.email || '',
                profilePhotoUrl: response.user.profilePhotoUrl || '',
                profilePhotoDataUrl: response.user.profilePhotoDataUrl || '',
                organizationId: response.user.organizationId || '',
                domain: response.user.domain || '',
                instanceUrl: response.user.instanceUrl || '',
                partial: response.partial === true,
                source: response.source || '',
                lastVerifiedAt: Date.now()
            };

            hydrateAuthState(tab.id, authState, function (finalAuthState) {
                persistAuthState(finalAuthState);
                renderAuthFromState(finalAuthState);
            });
        });
    });
}

function hydrateAuthState(tabId, authState, callback) {
    if (authState.fullName || authState.username || authState.email) {
        callback(authState);
        return;
    }

    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async function () {
            function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

            function queryDeep(selector, root, depth) {
                if (!root || depth > 12) return [];
                var results = [];
                try {
                    var matches = root.querySelectorAll(selector);
                    for (var i = 0; i < matches.length; i++) results.push(matches[i]);
                } catch (e) {}
                var all = [];
                try { all = root.querySelectorAll('*'); } catch (e) { all = []; }
                for (var j = 0; j < all.length; j++) {
                    if (all[j].shadowRoot) {
                        results = results.concat(queryDeep(selector, all[j].shadowRoot, depth + 1));
                    }
                }
                return results;
            }

            function sanitize(text) {
                var value = (text || '').replace(/^View profile for\s+/i, '').replace(/\s+/g, ' ').trim();
                if (!value) return '';
                if (/^(view profile|profile|user|settings|help|guidance center|guidance)$/i.test(value)) return '';
                return value;
            }

            var selectors = [
                'a.profile-link-label[href*="/lightning/r/User/"]',
                'a.profile-link-label[href*="/User/"]',
                'h1.profile-card-name a[href*="/lightning/r/User/"]',
                'h1.profile-card-name'
            ];

            function extractName() {
                for (var i = 0; i < selectors.length; i++) {
                    var els = queryDeep(selectors[i], document, 0);
                    for (var j = 0; j < els.length; j++) {
                        var text = sanitize(els[j].textContent || '');
                        if (text) return { fullName: text, source: 'script-dom' };
                    }
                }
                var titled = queryDeep('[title^="View profile for "], [aria-label^="View profile for "]', document, 0);
                for (var k = 0; k < titled.length; k++) {
                    var raw = titled[k].getAttribute('title') || titled[k].getAttribute('aria-label') || '';
                    var extracted = sanitize(raw);
                    if (extracted) return { fullName: extracted, source: 'script-dom' };
                }
                return { fullName: '', source: 'script-dom' };
            }

            var initial = extractName();
            if (initial.fullName) return initial;

            var triggers = queryDeep(
                '[title^="View profile for "], [aria-label^="View profile for "], one-app-nav-bar-user-menu button, button.slds-global-actions__item-action',
                document, 0
            );
            for (var m = 0; m < triggers.length; m++) {
                if (triggers[m] && typeof triggers[m].click === 'function') { triggers[m].click(); break; }
            }

            await wait(450);
            var afterClick = extractName();
            if (afterClick.fullName) return afterClick;
            return { fullName: '', source: 'script-dom' };
        }
    }, function (results) {
        var injected = results && results[0] && results[0].result;
        if (!chrome.runtime.lastError && injected && injected.fullName) {
            authState.fullName = injected.fullName;
            authState.source = injected.source || 'script-dom';
            callback(authState);
            return;
        }

        chrome.tabs.sendMessage(tabId, { action: 'getSalesforceIdentityDom' }, function (response) {
            if (!chrome.runtime.lastError && response && response.ok && response.user && response.user.fullName) {
                authState.fullName = response.user.fullName || '';
                authState.username = response.user.username || authState.username;
                authState.email = response.user.email || authState.email;
                authState.source = response.source || 'dom';
                callback(authState);
                return;
            }
            hydrateAuthStateFromCache(authState, callback);
        });
    });
}

function hydrateAuthStateFromCache(authState, callback) {
    if (authState.fullName || authState.username || authState.email) {
        callback(authState);
        return;
    }

    chrome.storage.local.get(['salesforceIdentityCache'], function (res) {
        var cache = (res || {}).salesforceIdentityCache;
        if (cache && cache.fullName && cache.domain === authState.domain) {
            authState.fullName = cache.fullName;
            authState.source = authState.source === 'session' ? 'cached-profile' : authState.source;
        }
        callback(authState);
    });
}

function persistAuthState(state) {
    var payload = {};
    payload[AUTH_STORAGE_KEY] = state;
    chrome.storage.local.set(payload);
}

function renderAuthDisconnected(message) {
    renderAuthFromState({
        isSignedIn: false,
        fullName: '', username: '', email: '',
        profilePhotoUrl: '', profilePhotoDataUrl: '',
        organizationId: '', domain: '', instanceUrl: '',
        lastVerifiedAt: null,
        message: message || 'Not signed in'
    });
}

function renderAuthFromState(state) {
    var s = state || {};

    function deriveNameFromEmail(email) {
        if (!email) return '';
        var localPart = String(email).split('@')[0] || '';
        var rawParts = localPart.split(/[._]+/).filter(Boolean);
        if (!rawParts.length) return '';
        return rawParts.map(function (part) {
            return part.split('-').filter(Boolean).map(function (sub) {
                return sub.charAt(0).toUpperCase() + sub.slice(1).toLowerCase();
            }).join('-');
        }).join(' ');
    }

    function initialsFromName(name, fallbackEmail) {
        var source = String(name || '').trim();
        if (!source) source = deriveNameFromEmail(fallbackEmail || '');
        if (!source) return '?';
        var words = source.split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        if (words.length === 1) return words[0].charAt(0).toUpperCase();
        return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
    }

    function setAvatar(initials, photoDataUrl, photoUrl) {
        if (!els.authAvatar) return;
        if (els.authAvatarFallback) {
            els.authAvatarFallback.textContent = initials || '?';
            els.authAvatarFallback.style.display = '';
        }
        if (!els.authAvatarImg) return;
        var sourceUrl = photoDataUrl || photoUrl || '';
        if (!sourceUrl) {
            els.authAvatarImg.style.display = 'none';
            els.authAvatarImg.removeAttribute('src');
            return;
        }
        els.authAvatarImg.onload = function () {
            els.authAvatarImg.style.display = 'block';
            if (els.authAvatarFallback) els.authAvatarFallback.style.display = 'none';
        };
        els.authAvatarImg.onerror = function () {
            els.authAvatarImg.style.display = 'none';
            els.authAvatarImg.removeAttribute('src');
            if (els.authAvatarFallback) els.authAvatarFallback.style.display = '';
        };
        els.authAvatarImg.src = sourceUrl;
    }

    if (s.isSignedIn) {
        els.authBadge.textContent = 'Connected';
        els.authBadge.className = 'badge badge-success';

        var accountEmail = s.email || '';
        var accountName = deriveNameFromEmail(accountEmail) || s.fullName || s.username || 'Connected to Salesforce';

        els.authStatus.textContent = accountName;
        els.authUser.textContent = accountEmail || ('Session active on ' + (s.domain || 'Salesforce'));
        if (els.authAvatar) {
            els.authAvatar.style.display = 'inline-flex';
            setAvatar(initialsFromName(accountName, accountEmail), s.profilePhotoDataUrl || '', s.profilePhotoUrl || '');
        }

        els.authSignInBtn.textContent = 'Refresh Session';
        els.authSignOutBtn.style.display = '';
        els.authSignOutBtn.disabled = false;
        return;
    }

    els.authBadge.textContent = 'Not signed in';
    els.authBadge.className = 'badge badge-empty';
    els.authStatus.textContent = s.message || 'Use an open Salesforce tab to connect.';
    els.authUser.textContent = 'No active Salesforce session detected.';
    if (els.authAvatar) {
        els.authAvatar.style.display = 'none';
        setAvatar('?', '', '');
    }
    els.authSignInBtn.textContent = 'Sign In via Salesforce';
    els.authSignOutBtn.style.display = 'none';
}

function setAuthLoading(isLoading) {
    els.authSignInBtn.disabled = isLoading;
    els.authSignOutBtn.disabled = isLoading;
    if (isLoading) {
        els.authStatus.textContent = 'Checking Salesforce session...';
        els.authUser.textContent = 'Please wait';
    }
}
