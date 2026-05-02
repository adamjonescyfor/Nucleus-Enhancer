// ==================================================
// CYFOR Nucleus Enhancer — Background Service Worker
// Relays keyboard commands, downloads files,
// and manages extension lifecycle events.
// ==================================================

const DEFAULT_COLUMN_ORDER = [
    'Process Ref', 'Record Type', 'Type', 'Exhibit',
    'Exhibit Type', 'Status', 'Start Date/Time',
    'End Date/Time', 'Completed By', 'Notes'
];

// Relay registered keyboard commands to the active tab
chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id || !tab.url?.includes('lightning.force.com')) return;
        chrome.tabs.sendMessage(tab.id, { action: command }).catch(() => {});
    });
});

// Set default settings on first install
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.storage.local.set({
            enableDate: true,
            enableContextMenu: true,
            enableNav: true,
            enableFormatNotes: true,
            enableAutoInsert: false,
            tableColumnPrefs: {},
            nucleusTemplates: {},
            processMap: {},
            templateCount: 0,
            downloadFolder: 'CYFOR Photographs'
        });
    } else if (details.reason === 'update') {
        // Ensure new toggle has a value on upgrade
        chrome.storage.local.get(['enableContextMenu'], (res) => {
            if (typeof res.enableContextMenu === 'undefined') {
                chrome.storage.local.set({ enableContextMenu: true });
            }
        });
    }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Health check
    if (message.action === 'ping') {
        sendResponse({ status: 'ok', version: chrome.runtime.getManifest().version });
        return true;
    }

    // Download a single file via chrome.downloads
    if (message.action === 'downloadOne') {
        downloadOneFile(message)
            .then((result) => sendResponse(result))
            .catch((err) => {
                console.warn('[CYFOR] downloadOne error:', err);
                sendResponse({
                    success: false,
                    downloadId: null,
                    error: err.message || 'Download failed'
                });
            });
        return true;
    }

    // Fetch Salesforce user identity using session cookie + REST/OAuth
    if (message.action === 'getSalesforceIdentity') {
        getSalesforceIdentity(message.tabId, message.tabUrl)
            .then((result) => sendResponse(result))
            .catch((err) => {
                console.warn('[CYFOR] getSalesforceIdentity error:', err);
                sendResponse({ ok: false, error: err.message || 'Identity fetch failed' });
            });
        return true;
    }

    // Open file explorer showing a specific download
    if (message.action === 'showDownload') {
        try {
            if (message.downloadId) {
                chrome.downloads.show(message.downloadId);
            } else {
                chrome.downloads.showDefaultFolder();
            }
        } catch (e) {
            console.warn('[CYFOR] showDownload error:', e);
        }
        sendResponse({ ok: true });
        return true;
    }
});

/**
 * Read Salesforce user identity by injecting into the page's MAIN world and
 * reading from Salesforce's own JavaScript globals — no network calls needed.
 * Salesforce always exposes window.UserContext, window.$A, or window.sforce.
 */
async function getSalesforceIdentity(tabId, tabUrl) {
    let url;
    try { url = new URL(tabUrl); } catch (e) { throw new Error('Invalid Salesforce tab URL'); }

    if (tabId) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: async () => {
                    const log = (msg, val) => console.log('[CYFOR identity]', msg, val !== undefined ? val : '');
                    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                    const findInShadow = (root, sel, depth) => {
                        if (!root || depth > 20) return null;
                        const els = root.querySelectorAll(sel);
                        for (const el of els) {
                            const text = (el.textContent || '').trim();
                            if (text) return text;
                        }
                        const allEls = root.querySelectorAll('*');
                        for (const el of allEls) {
                            if (el.shadowRoot) {
                                const found = findInShadow(el.shadowRoot, sel, depth + 1);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    const findProfileLinkLabel = (root, depth) => {
                        if (!root || depth > 20) return null;

                        const selectors = [
                            'a.profile-link-label[href*="/lightning/r/User/"]',
                            'a.profile-link-label[href*="/User/"]',
                            'h1.profile-card-name a[href*="/lightning/r/User/"]'
                        ];

                        for (const selector of selectors) {
                            const links = root.querySelectorAll(selector);
                            for (const link of links) {
                                const text = (link.textContent || '').trim();
                                if (text && !/^(view profile|profile)$/i.test(text)) {
                                    return text;
                                }
                            }
                        }

                        const allEls = root.querySelectorAll('*');
                        for (const el of allEls) {
                            if (el.shadowRoot) {
                                const found = findProfileLinkLabel(el.shadowRoot, depth + 1);
                                if (found) return found;
                            }
                        }

                        return null;
                    };
                    const extractProfileName = () => {
                        const profileLinkLabel = findProfileLinkLabel(document, 0);
                        if (profileLinkLabel) {
                            log('Exact profile link label:', profileLinkLabel);
                            return profileLinkLabel;
                        }

                        const profileName = findInShadow(document, 'h1.profile-card-name', 0);
                        if (profileName && !/^(view profile|profile)$/i.test(profileName)) {
                            log('profile-card-name (shadow-aware):', profileName);
                            return profileName;
                        }

                        return null;
                    };
                    const openUserMenuIfNeeded = async () => {
                        const selectors = [
                            '[title^="View profile for "]',
                            '[aria-label^="View profile for "]',
                            'button[title="View profile"]',
                            'button[aria-label="View profile"]',
                            'one-app-nav-bar-user-menu button',
                            'button.slds-global-actions__item-action'
                        ];

                        const findClickable = (root, depth) => {
                            if (!root || depth > 12) return null;
                            for (const selector of selectors) {
                                const matches = root.querySelectorAll(selector);
                                for (const match of matches) {
                                    if (match && typeof match.click === 'function') return match;
                                }
                            }
                            const allEls = root.querySelectorAll('*');
                            for (const el of allEls) {
                                if (el.shadowRoot) {
                                    const found = findClickable(el.shadowRoot, depth + 1);
                                    if (found) return found;
                                }
                            }
                            return null;
                        };

                        const trigger = findClickable(document, 0);
                        if (!trigger) {
                            log('User menu trigger not found');
                            return false;
                        }

                        trigger.click();
                        await wait(350);
                        return true;
                    };
                    const toAbsoluteUrl = (raw) => {
                        const value = (raw || '').toString().trim();
                        if (!value) return '';
                        if (/^https?:\/\//i.test(value)) return value;
                        if (value.startsWith('//')) return location.protocol + value;
                        if (value.startsWith('/')) return location.origin + value;
                        return location.origin + '/' + value.replace(/^\/+/, '');
                    };
                    const pickPhotoUrl = (obj) => {
                        if (!obj || typeof obj !== 'object') return '';
                        const candidates = [
                            obj.profilePhotoUrl,
                            obj.photoUrl,
                            obj.photoURL,
                            obj.smallPhotoUrl,
                            obj.fullPhotoUrl,
                            obj.thumbnailPhotoUrl,
                            obj.PhotoUrl,
                            obj.SmallPhotoUrl,
                            obj.FullPhotoUrl,
                            obj.picture,
                            obj.avatarUrl,
                            obj.userPhotoUrl
                        ];
                        for (const candidate of candidates) {
                            const absolute = toAbsoluteUrl(candidate);
                            if (absolute) return absolute;
                        }
                        return '';
                    };
                    const findProfilePhotoUrl = (root, depth) => {
                        if (!root || depth > 12) return '';
                        const selectors = [
                            'img.profileTrigger.branding-user-profile.circular',
                            'one-app-nav-bar-user-menu img',
                            'button[title^="View profile for "] img',
                            'button[aria-label^="View profile for "] img',
                            'img.profileTriggerAvatar',
                            'img[alt*="profile" i]',
                            'img[class*="avatar" i]'
                        ];
                        for (const selector of selectors) {
                            const matches = root.querySelectorAll(selector);
                            for (const img of matches) {
                                const src = (img.currentSrc || img.src || '').trim();
                                const absolute = toAbsoluteUrl(src);
                                if (absolute) return absolute;
                            }
                        }
                        const allEls = root.querySelectorAll('*');
                        for (const el of allEls) {
                            if (el.shadowRoot) {
                                const nested = findProfilePhotoUrl(el.shadowRoot, depth + 1);
                                if (nested) return nested;
                            }
                        }
                        return '';
                    };

                    // ── 1. window.UserContext ──
                    try {
                        const uc = window.UserContext;
                        log('UserContext:', JSON.stringify(uc));
                        if (uc && (uc.userName || uc.userId)) {
                            const first = uc.firstName || '';
                            const last  = uc.lastName  || '';
                            const full  = (first + ' ' + last).trim() || uc.userName || '';
                            return {
                                ok: true, source: 'UserContext',
                                user: {
                                    id: uc.userId || '',
                                    fullName: full,
                                    username: uc.userName || '',
                                    email: uc.userEmail || '',
                                    profilePhotoUrl: pickPhotoUrl(uc) || findProfilePhotoUrl(document, 0),
                                    organizationId: uc.organizationId || '',
                                    domain: location.hostname,
                                    instanceUrl: location.origin
                                }
                            };
                        }
                    } catch (e) { log('UserContext error:', e.message); }

                    // ── 2. SfdcApp.userPreferences / SfdcApp context ──
                    try {
                        const sfdcCtx = window.SfdcApp && (
                            window.SfdcApp.userContext ||
                            (window.SfdcApp.projectConfigs && window.SfdcApp.projectConfigs.userContext)
                        );
                        log('SfdcApp.userContext:', JSON.stringify(sfdcCtx));
                        if (sfdcCtx && (sfdcCtx.userName || sfdcCtx.userId)) {
                            const first = sfdcCtx.firstName || '';
                            const last  = sfdcCtx.lastName  || '';
                            const full  = (first + ' ' + last).trim() || sfdcCtx.userName || '';
                            return {
                                ok: true, source: 'SfdcApp',
                                user: {
                                    id: sfdcCtx.userId || '',
                                    fullName: full,
                                    username: sfdcCtx.userName || '',
                                    email: sfdcCtx.userEmail || '',
                                    profilePhotoUrl: pickPhotoUrl(sfdcCtx) || findProfilePhotoUrl(document, 0),
                                    organizationId: sfdcCtx.organizationId || '',
                                    domain: location.hostname,
                                    instanceUrl: location.origin
                                }
                            };
                        }
                    } catch (e) { log('SfdcApp error:', e.message); }

                    // ── 3. Aura framework global $A ──
                    try {
                        const aura = window.$A;
                        log('$A defined:', !!aura);
                        if (aura && typeof aura.get === 'function') {
                            const auraFieldName = aura.get('$SObjectType.CurrentUser.Name');
                            const auraFieldId = aura.get('$SObjectType.CurrentUser.Id');
                            const auraFieldUsername = aura.get('$SObjectType.CurrentUser.Username');
                            const auraFieldEmail = aura.get('$SObjectType.CurrentUser.Email');
                            log('$A CurrentUser.Name:', auraFieldName);
                            const ctx = aura.get('$SObjectType.CurrentUser');
                            log('$A CurrentUser:', JSON.stringify(ctx));
                            if (auraFieldName || auraFieldUsername || auraFieldEmail) {
                                return {
                                    ok: true, source: 'AuraFieldProvider',
                                    user: {
                                        id: auraFieldId || '',
                                        fullName: auraFieldName || auraFieldUsername || '',
                                        username: auraFieldUsername || '',
                                        email: auraFieldEmail || '',
                                        profilePhotoUrl: pickPhotoUrl(ctx) || findProfilePhotoUrl(document, 0),
                                        organizationId: '',
                                        domain: location.hostname,
                                        instanceUrl: location.origin
                                    }
                                };
                            }
                            if (ctx) {
                                const name = ctx.Name || ctx.FullName || ctx.Username || '';
                                if (name) {
                                    return {
                                        ok: true, source: 'Aura',
                                        user: {
                                            id: ctx.Id || '',
                                            fullName: name,
                                            username: ctx.Username || '',
                                            email: ctx.Email || '',
                                            profilePhotoUrl: pickPhotoUrl(ctx) || findProfilePhotoUrl(document, 0),
                                            organizationId: '',
                                            domain: location.hostname,
                                            instanceUrl: location.origin
                                        }
                                    };
                                }
                            }
                        }
                    } catch (e) { log('Aura error:', e.message); }

                    // ── 4. sforce global ──
                    try {
                        const sf = window.sforce;
                        log('sforce:', JSON.stringify(sf && sf.one && sf.one.userInfo));
                        if (sf && sf.one && sf.one.userInfo) {
                            const ui = sf.one.userInfo;
                            if (ui.name || ui.userName) {
                                return {
                                    ok: true, source: 'sforce',
                                    user: {
                                        id: ui.userId || '',
                                        fullName: ui.name || ui.userName || '',
                                        username: ui.userName || '',
                                        email: ui.email || '',
                                        profilePhotoUrl: pickPhotoUrl(ui) || findProfilePhotoUrl(document, 0),
                                        organizationId: ui.organizationId || '',
                                        domain: location.hostname,
                                        instanceUrl: location.origin
                                    }
                                };
                            }
                        }
                    } catch (e) { log('sforce error:', e.message); }

                    // ── 5. Exact profile DOM, opening the user menu if needed ──
                    try {
                        var exactProfileName = extractProfileName();
                        if (!exactProfileName) {
                            await openUserMenuIfNeeded();
                            exactProfileName = extractProfileName();
                        }

                        if (exactProfileName) {
                            return {
                                ok: true, source: 'profile-name',
                                user: {
                                    id: '', fullName: exactProfileName, username: '',
                                    email: '', profilePhotoUrl: findProfilePhotoUrl(document, 0), organizationId: '',
                                    domain: location.hostname, instanceUrl: location.origin
                                }
                            };
                        }
                    } catch (e) { log('profile-name extraction error:', e.message); }

                    // ── 6. Profile button with title/aria-label extraction (safe - extracts attribute, not text) ──
                    try {
                        const walk = (root, depth) => {
                            if (depth > 15) return null;
                            const sels = [
                                '[title^="View profile for "]',
                                '[aria-label^="View profile for "]'
                            ];
                            for (const sel of sels) {
                                const found = root.querySelectorAll(sel);
                                for (const el of found) {
                                    const raw = el.getAttribute('title') || el.getAttribute('aria-label') || '';
                                    const name = raw.replace(/^View profile for\s+/i, '').trim();
                                    if (name && name.length > 1) {
                                        log('Profile button extracted:', name);
                                        return name;
                                    }
                                }
                            }
                            const allEls = root.querySelectorAll('*');
                            for (const el of allEls) {
                                if (el.shadowRoot) {
                                    const found = walk(el.shadowRoot, depth + 1);
                                    if (found) return found;
                                }
                            }
                            return null;
                        };
                        const profileButtonName = walk(document, 0);
                        if (profileButtonName) {
                            return {
                                ok: true, source: 'profile-button',
                                user: {
                                    id: '', fullName: profileButtonName, username: '',
                                    email: '', profilePhotoUrl: findProfilePhotoUrl(document, 0), organizationId: '',
                                    domain: location.hostname, instanceUrl: location.origin
                                }
                            };
                        }
                    } catch (e) { log('Profile button error:', e.message); }

                    // ── 7. Broader DOM search: user name in profile links/headers ──
                    try {
                        const walkUserLinks = (root, depth) => {
                            if (depth > 20) return null;
                            const profileLinks = root.querySelectorAll('a[href*="/User/"]');
                            for (const link of profileLinks) {
                                const text = (link.textContent || '').trim();
                                if (text && !/^(view profile|profile)$/i.test(text) && /^[A-Z].*[a-z]/.test(text) && text.length > 2 && text.length < 100) {
                                    log('Found user in profile link:', text);
                                    return text;
                                }
                            }
                            const userEls = root.querySelectorAll('[class*="user"], [class*="profile"], [id*="user"], [id*="profile"]');
                            for (const el of userEls) {
                                const text = (el.textContent || '').trim();
                                if (text && /^[A-Z].*[a-z]/.test(text) && text.length > 2 && text.length < 100 &&
                                    !/^(profile|user|settings|home|menu|help|search|notification|logout|sign|account|view profile)$/i.test(text)) {
                                    log('Found user in profile element:', text);
                                    return text;
                                }
                            }
                            const allEls = root.querySelectorAll('*');
                            for (const el of allEls) {
                                if (el.shadowRoot) {
                                    const found = walkUserLinks(el.shadowRoot, depth + 1);
                                    if (found) return found;
                                }
                            }
                            return null;
                        };
                        const domUserName = walkUserLinks(document, 0);
                        if (domUserName) {
                            return {
                                ok: true, source: 'dom-user-link',
                                user: {
                                    id: '', fullName: domUserName, username: '',
                                    email: '', profilePhotoUrl: findProfilePhotoUrl(document, 0), organizationId: '',
                                    domain: location.hostname, instanceUrl: location.origin
                                }
                            };
                        }
                    } catch (e) { log('DOM user search error:', e.message); }

                    // ── 8. Log all window keys that look user-related for diagnostics ──
                    try {
                        const suspects = Object.keys(window).filter(k =>
                            /user|context|principal|identity|session|account/i.test(k)
                        );
                        log('Suspect window globals:', suspects.join(', '));
                    } catch (e) {}

                    return null;
                }
            });

            const injectedResult = results && results[0] && results[0].result;
            if (injectedResult && injectedResult.ok) {
                return await augmentIdentityWithProfilePhoto(injectedResult);
            }
        } catch (e) {
            console.warn('[CYFOR] executeScript identity failed:', e.message);
        }
    }

    // Fall back to DOM extraction via content script
    if (tabId) {
        try {
            const domResult = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tabId, { action: 'getSalesforceIdentityDom' }, (r) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(r);
                });
            });
            if (domResult && domResult.ok) return await augmentIdentityWithProfilePhoto(domResult);
        } catch (e) { console.warn('[CYFOR] DOM identity fallback failed:', e.message); }
    }

    // Session-only: user is on Salesforce but identity could not be read
    return {
        ok: true, source: 'session', partial: true,
        user: { id: '', fullName: '', username: '', email: '', profilePhotoUrl: '', organizationId: '', domain: url.hostname, instanceUrl: url.origin }
    };
}

async function augmentIdentityWithProfilePhoto(identityResult) {
    if (!identityResult || !identityResult.user) return identityResult;
    const photoUrl = identityResult.user.profilePhotoUrl || '';
    if (!photoUrl) {
        identityResult.user.profilePhotoDataUrl = '';
        return identityResult;
    }

    identityResult.user.profilePhotoDataUrl = await fetchProfilePhotoAsDataUrl(photoUrl);
    return identityResult;
}

const SALESFORCE_CDN_REGEX = /^[a-z0-9-]+\.(file\.force\.com|content\.force\.com|salesforce\.com|documentforce\.com|static\.salesforceusercontent\.com)$/i;

async function fetchProfilePhotoAsDataUrl(photoUrl) {
    try {
        const parsed = new URL(photoUrl);
        if (!/^https:$/i.test(parsed.protocol)) return '';
        if (!SALESFORCE_CDN_REGEX.test(parsed.hostname)) return '';

        const response = await fetch(parsed.toString(), {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) return '';

        const blob = await response.blob();
        if (!blob || !blob.size) return '';

        const mime = blob.type || 'image/jpeg';
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        var binary = '';
        for (var i = 0; i < bytes.length; i += chunkSize) {
            var chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return 'data:' + mime + ';base64,' + btoa(binary);
    } catch (e) {
        console.warn('[CYFOR] fetchProfilePhotoAsDataUrl failed:', e.message || e);
        return '';
    }
}

/**
 * Download a single file using chrome.downloads.download().
 */
async function downloadOneFile(msg) {
    const { url, filename, subfolder } = msg;

    const cleanFolder = (subfolder || '')
        .trim()
        .replace(/^[/\\]+|[/\\]+$/g, '')
        .replace(/[<>:"|?*\x00-\x1F]/g, '_')
        .replace(/[/\\]{2,}/g, '/');

    const options = {
        url: url,
        conflictAction: 'uniquify'
    };

    if (filename) {
        options.filename = cleanFolder ? cleanFolder + '/' + filename : filename;
    } else if (cleanFolder) {
        options.filename = cleanFolder + '/photograph';
    }

    const downloadId = await chrome.downloads.download(options);

    const result = await new Promise((resolve) => {
        setTimeout(async () => {
            try {
                const [item] = await chrome.downloads.search({ id: downloadId });
                if (item && item.error) {
                    resolve({ success: false, downloadId: downloadId, error: item.error });
                } else if (item && item.state === 'interrupted') {
                    resolve({ success: false, downloadId: downloadId, error: item.error || 'Download interrupted' });
                } else {
                    resolve({ success: true, downloadId: downloadId });
                }
            } catch (e) {
                resolve({ success: true, downloadId: downloadId });
            }
        }, 300);
    });

    return result;
}
