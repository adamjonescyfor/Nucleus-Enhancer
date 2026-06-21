// ==================================================
// CYFOR Nucleus Enhancer — Debug logging (opt-in, off by default)
// Flip it on with  chrome.storage.local.set({ cyforDebug: true })  (e.g. from the
// service-worker console), then refresh the Salesforce tab. Logs then appear in
// THIS page's console, prefixed [Cyfor:<area>]. Turn off with { cyforDebug: false }.
// When off, Cyfor.log is a no-op (one boolean check) — zero behavioural impact.
//   Cyfor.log('insert', 'message', optionalData)
// See docs/Nucleus_Enhancer_Diagnostics.md for the full cheat-sheet.
// ==================================================

Cyfor.debug = { enabled: false };

Cyfor.log = function (area) {
    if (!Cyfor.debug.enabled) return;
    var args = Array.prototype.slice.call(arguments, 1);
    try {
        console.log.apply(console, ['%c[Cyfor:' + area + ']', 'color:#6366f1;font-weight:600'].concat(args));
    } catch (e) { /* console unavailable */ }
    // Forward to the background buffer so it can be downloaded from the popup.
    try {
        var text = args.map(function (a) {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch (e2) { return String(a); }
        }).join(' ');
        chrome.runtime.sendMessage({ action: 'cyforDbg', entry: { t: Date.now(), src: 'content', area: area, text: text } });
    } catch (e) { /* extension context gone — console only */ }
};

(function () {
    try {
        // Console-only confirmation (NOT via Cyfor.log) so it isn't written to the
        // downloadable buffer — each page load would otherwise spam "logging enabled".
        var note = function (m) { try { console.log('%c[Cyfor:debug]', 'color:#6366f1;font-weight:600', m); } catch (e) {} };
        chrome.storage.local.get(['cyforDebug'], function (res) {
            Cyfor.debug.enabled = !!(res && res.cyforDebug);
            if (Cyfor.debug.enabled) note('logging enabled');
        });
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local' && changes.cyforDebug) {
                Cyfor.debug.enabled = !!changes.cyforDebug.newValue;
                if (Cyfor.debug.enabled) note('logging enabled (live)');
            }
        });
    } catch (e) { /* storage unavailable — stay off */ }
}());
