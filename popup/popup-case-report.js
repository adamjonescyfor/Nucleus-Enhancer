// ==================================================
// CYFOR Nucleus Enhancer — Case Report (popup)
// Enables the "Export Current Case" button when the active
// tab is a Forensic Case record, and delegates the export to
// the content script on that page.
// ==================================================

function loadCaseReportSection() {
    var btn = document.getElementById('btn-export-case');
    var hint = document.getElementById('case-report-hint');
    if (!btn) return;

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        var onCase = false;
        if (tab && tab.url) {
            var m = tab.url.match(/\/lightning\/r\/([^/]+)\/[^/]+\/view/);
            if (m && /forensic.*case/i.test(m[1])) onCase = true;
        }

        btn.disabled = !onCase;
        if (hint) {
            hint.textContent = onCase
                ? 'Generate a sanitised disclosure report for the open case.'
                : 'Open a Forensic Case record in Salesforce to enable.';
        }

        btn.onclick = function () {
            if (!tab) return;
            btn.disabled = true;
            btn.textContent = 'Generating…';
            if (hint) hint.textContent = 'Building report on the case page…';

            chrome.tabs.sendMessage(tab.id, { action: 'caseReport.run' }, function (r) {
                btn.disabled = false;
                btn.textContent = 'Export Current Case';
                if (chrome.runtime.lastError || !r || !r.ok) {
                    if (hint) hint.textContent = 'Could not start the export. Reload the case page and try again.';
                    return;
                }
                // Export runs on the page (toast + download there); close the popup.
                window.close();
            });
        };
    });
}
