// ==================================================
// CYFOR Nucleus Enhancer — Theme applier (content script)
// The injected in-page UI (templates menu, toasts, context menu, etc.) styles
// its dark mode off data-cyfor-theme on the Salesforce page's <html>. This sets
// that attribute from the user's saved Auto/Light/Dark preference (uiTheme in
// chrome.storage.sync — the same key the popup's theme picker writes) and keeps
// it in sync LIVE: changing the theme in the popup updates the page with no
// refresh, and "Auto" follows the OS.
// ==================================================

(function () {
    // Idempotency guard: this file is registered FIRST in content_scripts, i.e.
    // BEFORE utils.js whose `const Cyfor` throws on a same-world double-injection
    // (manifest auto-injection racing the onInstalled re-inject). Without this,
    // the storage/matchMedia listeners below would be registered twice.
    if (window.__cyforThemeApplied) return;
    window.__cyforThemeApplied = true;

    var KEY = 'uiTheme';
    var pref = 'auto';
    var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function resolve(p) {
        if (p === 'light' || p === 'dark') return p;
        return (mql && mql.matches) ? 'dark' : 'light';
    }
    function apply() {
        try { document.documentElement.setAttribute('data-cyfor-theme', resolve(pref)); } catch (e) { /* ignore */ }
    }

    // Apply immediately (resolved from the OS) to avoid a flash, then refine once
    // the stored preference loads.
    apply();
    try {
        chrome.storage.sync.get([KEY], function (res) {
            if (chrome.runtime && chrome.runtime.lastError) return;
            pref = (res && res[KEY]) || 'auto';
            apply();
        });
    } catch (e) { /* storage unavailable — stay on the OS-resolved value */ }

    // Live updates when the user changes the theme in the popup.
    try {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'sync' && changes[KEY]) { pref = changes[KEY].newValue || 'auto'; apply(); }
        });
    } catch (e) { /* ignore */ }

    // Follow the OS while on "auto".
    if (mql) {
        var onOS = function () { if (pref === 'auto') apply(); };
        if (mql.addEventListener) mql.addEventListener('change', onOS);
        else if (mql.addListener) mql.addListener(onOS);
    }
}());
