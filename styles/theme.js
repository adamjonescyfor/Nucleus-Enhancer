// ==================================================
// CYFOR Nucleus Enhancer — Theme controller
// Sets html[data-theme="light|dark"] on the popup and manager pages.
// Preference ('auto' | 'light' | 'dark') is stored in chrome.storage.sync
// so it follows the user across devices. Loaded as the first <head> script
// so the attribute is set before first paint (no flash for "auto").
// Exposes window.CyforTheme = { get, set, resolve }.
// ==================================================

(function () {
    var KEY = 'uiTheme';
    var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var current = 'auto';

    function resolve(pref) {
        if (pref === 'light' || pref === 'dark') return pref;
        return (mql && mql.matches) ? 'dark' : 'light';
    }

    function apply(pref) {
        var el = document.documentElement;
        el.setAttribute('data-theme', resolve(pref));
        el.setAttribute('data-theme-pref', pref || 'auto');
    }

    // First paint: assume 'auto' (resolved synchronously from the OS) until
    // the stored preference loads.
    apply('auto');

    try {
        chrome.storage.sync.get([KEY], function (res) {
            current = (res && res[KEY]) || 'auto';
            apply(current);
        });
    } catch (e) { /* storage unavailable — stay on auto */ }

    // Track OS changes while in auto.
    if (mql) {
        var onChange = function () { if (current === 'auto') apply('auto'); };
        if (mql.addEventListener) mql.addEventListener('change', onChange);
        else if (mql.addListener) mql.addListener(onChange);
    }

    // Live updates when the preference changes in ANOTHER context — e.g. the popup
    // theme picker — so an open manager (or popup) re-themes with no refresh. The
    // guard ignores the echo from our own set(), which has already applied.
    try {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area !== 'sync' || !changes[KEY]) return;
            var next = changes[KEY].newValue || 'auto';
            if (next === current) return;
            current = next;
            apply(current);
        });
    } catch (e) { /* storage unavailable */ }

    window.CyforTheme = {
        get: function () { return current; },
        set: function (pref) {
            current = (pref === 'light' || pref === 'dark') ? pref : 'auto';
            apply(current);
            try {
                var o = {}; o[KEY] = current;
                chrome.storage.sync.set(o);
            } catch (e) { /* ignore */ }
        },
        resolve: resolve
    };
})();
