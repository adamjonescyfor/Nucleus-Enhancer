// ==================================================
// CYFOR Nucleus Enhancer — popup Diagnostics controls
// A one-toggle capture: flip on → the extension records what it does into a
// buffer (in the background); "Download log" saves it as a .txt to send to
// support. No DevTools needed. Off by default; nothing records when off.
// ==================================================
(function () {
    var toggle = document.getElementById('opt-diagnostics');
    var dl     = document.getElementById('btn-download-diagnostics');
    var clr    = document.getElementById('btn-clear-diagnostics');
    var status = document.getElementById('diagnostics-status');
    if (!toggle || !dl || !clr) return;

    function setStatus(msg) { if (status) status.textContent = msg || ''; }

    function refresh() {
        chrome.storage.local.get(['cyforDebug'], function (r) {
            toggle.checked = !!(r && r.cyforDebug);
            chrome.runtime.sendMessage({ action: 'diag.count' }, function (res) {
                var n = (!chrome.runtime.lastError && res && res.ok) ? res.count : 0;
                dl.disabled = !n;
                clr.disabled = !n;
                setStatus(
                    toggle.checked
                        ? (n ? (n + ' event' + (n === 1 ? '' : 's') + ' captured — recording (auto-off in 24h)…')
                             : 'Recording… reproduce the issue or run your tests, then download. Auto-off after 24h.')
                        : (n ? (n + ' captured event' + (n === 1 ? '' : 's') + ' ready to download.') : 'Off.')
                );
            });
        });
    }

    var DEBUG_TTL_MS = 24 * 60 * 60 * 1000; // mirrors background.js — auto-off after a day

    toggle.addEventListener('change', function () {
        var on = toggle.checked;
        // Stamp an expiry so a forgotten toggle auto-switches off (and clears its
        // buffer) after a day — see background.js _checkDebugExpiry.
        var patch = { cyforDebug: on, cyforDebugExpiry: on ? (Date.now() + DEBUG_TTL_MS) : null };
        chrome.storage.local.set(patch, function () {
            if (on) {
                // Start a fresh log for this session.
                chrome.runtime.sendMessage({ action: 'diag.clear' }, refresh);
            } else {
                refresh();
            }
        });
    });

    dl.addEventListener('click', function () {
        chrome.runtime.sendMessage({ action: 'diag.get' }, function (res) {
            if (chrome.runtime.lastError || !res || !res.ok) { setStatus('Could not read the log.'); return; }
            var entries = res.entries || [];
            var now = new Date();
            var header = 'CYFOR Nucleus Enhancer - diagnostics log\n'
                + 'Generated: ' + now.toLocaleString('en-GB') + '  |  v' + chrome.runtime.getManifest().version + '\n'
                + 'Events: ' + entries.length + '\n'
                + '----------------------------------------\n';
            var lines = entries.map(function (e) {
                var t = new Date(e.t).toLocaleTimeString('en-GB', { hour12: false });
                return '[' + t + '] [' + (e.src || '?') + ':' + (e.area || '') + '] ' + (e.text || '');
            });
            // BOM + explicit charset so any text viewer reads it as UTF-8 (no mojibake).
            var blob = new Blob(['﻿' + header + lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href = url;
            a.download = 'nucleus-enhancer-diagnostics-' + now.toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
            setStatus('Downloaded ' + entries.length + ' events — send the file over.');
        });
    });

    clr.addEventListener('click', function () {
        chrome.runtime.sendMessage({ action: 'diag.clear' }, refresh);
    });

    refresh();
}());
