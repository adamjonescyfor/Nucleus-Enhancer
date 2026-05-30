// ==================================================
// CYFOR Nucleus Enhancer — Case Report (content script)
// Injects an "Export Case Report" button on Forensic Case
// record pages, fetches the case bundle from the background,
// builds the sanitised disclosure HTML, and downloads it.
// Also handles popup-triggered exports.
// ==================================================

(function () {
    if (window.__cyforCaseReportLoaded) return;
    window.__cyforCaseReportLoaded = true;

    var BTN_ID = 'cyfor-export-case-btn';

    // Parse /lightning/r/<ObjectApiName>/<RecordId>/view and accept Forensic Case pages.
    function parseCasePage() {
        var m = location.href.match(/\/lightning\/r\/([^/]+)\/([^/]+)\/view/);
        if (!m) return null;
        var obj = m[1], id = m[2];
        if (!/forensic.*case/i.test(obj)) return null;
        return { object: obj, id: id };
    }

    // Pierce shadow roots when looking for elements (newer Lightning uses LWC shadow DOM).
    function deepQueryAll(selector) {
        var out = [];
        var stack = [document];
        while (stack.length) {
            var node = stack.pop();
            if (node.querySelectorAll) {
                var found = node.querySelectorAll(selector);
                for (var i = 0; i < found.length; i++) out.push(found[i]);
                var all = node.querySelectorAll('*');
                for (var j = 0; j < all.length; j++) if (all[j].shadowRoot) stack.push(all[j].shadowRoot);
            }
        }
        return out;
    }

    // Only consider elements that are actually laid out (Lightning keeps hidden,
    // cached copies of record views around — ignore those).
    function visible(el) { return !!(el && el.getClientRects && el.getClientRects().length); }

    // Find the highlights action bar (Edit / Delete / Clone row) to dock the button in.
    var HIGHLIGHT_HOSTS = 'records-highlights2, force-highlights2, .forceHighlightsPanel, .slds-page-header, runtime_platform_actions-actions-ribbon, .forceActionsContainer';
    var NOT_RIBBON = 'table, [role="grid"], .forceRelatedListContainer, .forceListViewManager, lightning-datatable, .uiVirtualDataTable';

    function ribbonInHost(lists) {
        for (var i = 0; i < lists.length; i++) {
            var ul = lists[i];
            if (ul.closest && ul.closest(HIGHLIGHT_HOSTS) && visible(ul)) return ul;
        }
        return null;
    }
    function findActionRibbon() {
        // Prefer a visible button group inside the highlights/actions panel.
        var light = document.querySelectorAll('ul.slds-button-group-list');
        var hit = ribbonInHost(light);
        if (hit) return hit;
        // Fallback: a visible group that isn't part of a related list / data table.
        for (var i = 0; i < light.length; i++) {
            if (visible(light[i]) && light[i].closest && !light[i].closest(NOT_RIBBON)) return light[i];
        }
        // Shadow DOM (newer LWC layouts).
        var deep = deepQueryAll('ul.slds-button-group-list');
        var dh = ribbonInHost(deep);
        if (dh) return dh;
        for (var j = 0; j < deep.length; j++) if (visible(deep[j])) return deep[j];
        return null;
    }

    function removeButton() {
        var b = document.getElementById(BTN_ID);
        if (b) { var li = b.closest('li'); (li || b).remove(); }
    }

    function ensureButton() {
        var ctx = parseCasePage();
        if (!ctx) { removeButton(); return; }

        var existing = document.getElementById(BTN_ID);
        if (existing) {
            if (visible(existing)) return;       // already placed in the live bar
            removeButton();                      // stale/hidden copy — drop and re-place
        }

        var ribbon = findActionRibbon();
        if (!ribbon) return; // highlights not rendered yet — retried by observer/poll

        var li = document.createElement('li');
        li.className = 'slds-button-group-item';
        li.setAttribute('data-cyfor-export', '1');

        var btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.className = 'slds-button slds-button_neutral cyfor-export-case-btn';
        btn.title = 'Generate a sanitised disclosure report for this case';
        btn.textContent = 'Export Case Report';
        btn.addEventListener('click', function () { runExport(btn); });

        li.appendChild(btn);
        ribbon.insertBefore(li, ribbon.firstChild); // first action — clean rounded-left join
    }

    function sendMessage(msg) {
        return new Promise(function (resolve) {
            try {
                chrome.runtime.sendMessage(msg, function (r) {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(r);
                    }
                });
            } catch (e) {
                resolve({ ok: false, error: e.message });
            }
        });
    }

    function toast(msg, type) {
        try {
            if (typeof Cyfor !== 'undefined' && Cyfor.toast && Cyfor.toast.show) {
                Cyfor.toast.show(msg, type || 'info', 5000);
                return;
            }
        } catch (e) { /* ignore */ }
        console.log('[CYFOR]', msg);
    }

    function blobToDataUri(blob) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
    }

    async function loadLogo() {
        try {
            var url = chrome.runtime.getURL('report/cyfor-logo.png');
            var res = await fetch(url);
            if (!res.ok) return null;
            var blob = await res.blob();
            if (!blob || !blob.size) return null;
            return await blobToDataUri(blob);
        } catch (e) {
            return null; // builder falls back to a text wordmark
        }
    }

    function downloadHtml(html, filename) {
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    }

    var running = false;

    async function runExport(btn) {
        if (running) return;
        var ctx = parseCasePage();
        if (!ctx) { toast('Open a Forensic Case record first.', 'warning'); return; }

        running = true;
        var original = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
        toast('Building disclosure report…', 'info');

        try {
            var resp = await sendMessage({ action: 'caseReport.fetch', caseObject: ctx.object, caseId: ctx.id });
            if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Fetch failed');

            var data = resp.data || {};
            if (data.meta) {
                console.log('[CYFOR] Resolved objects:', data.meta.resolved);
                console.log('[CYFOR] Case child relationships:', data.meta.childRelationships);
                if (data.meta.warnings && data.meta.warnings.length) {
                    console.log('[CYFOR] Report notes (non-fatal):', data.meta.warnings);
                }
            }

            if (!self.DisclosureReport) throw new Error('Report generator not loaded');

            var logo = await loadLogo();
            var now = new Date();
            var html = self.DisclosureReport.build(Object.assign({}, data, { logoDataUri: logo, generatedDate: now }));
            var filename = self.DisclosureReport.suggestFilename(data.caseRecord, now);

            downloadHtml(html, filename);
            toast('Disclosure report downloaded.', 'success');
        } catch (e) {
            console.error('[CYFOR] Case report error:', e);
            var msg = e.message || String(e);
            if (msg === 'NOT_AUTHENTICATED' || msg === 'NOT_CONFIGURED') {
                msg = 'Connect via Salesforce OAuth in the extension first.';
            }
            toast('Export failed: ' + msg, 'error');
        } finally {
            running = false;
            if (btn) { btn.disabled = false; btn.textContent = original || 'Export Case Report'; }
        }
    }

    // Popup-triggered run + status query
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        if (!message) return;
        if (message.action === 'caseReport.run') {
            var ctx = parseCasePage();
            if (!ctx) { sendResponse({ ok: false, error: 'NOT_CASE_PAGE' }); return true; }
            runExport(document.getElementById(BTN_ID));
            sendResponse({ ok: true });
            return true;
        }
        if (message.action === 'caseReport.status') {
            sendResponse({ ok: true, isCasePage: !!parseCasePage() });
            return true;
        }
    });

    // Re-place the button promptly whenever Lightning re-renders the page
    // (batched to one check per animation frame so it stays cheap).
    var rafPending = false;
    function scheduleEnsure() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () { rafPending = false; ensureButton(); });
    }
    try {
        new MutationObserver(scheduleEnsure).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* observer unavailable — poll still covers it */ }

    // Backstop poll (also handles SPA URL changes with little DOM mutation).
    var lastHref = location.href;
    setInterval(function () {
        if (location.href !== lastHref) lastHref = location.href;
        ensureButton();
    }, 1000);
    ensureButton();
})();
