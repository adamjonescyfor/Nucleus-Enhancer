// ==================================================
// CYFOR Nucleus Enhancer — Template Files loader (full-page tab)
// Loads a folder of .txt templates and stores them. Runs in a tab (not the
// popup) so the OS folder chooser can't dismiss it — fixes the popup closing
// when the folder dialog opens (common on Linux).
// Writes the same storage keys the popup/content scripts already read.
// ==================================================

(function () {
    var input   = document.getElementById('tf-input');
    var drop    = document.getElementById('tf-drop');
    var statusEl = document.getElementById('tf-status');
    var listEl  = document.getElementById('tf-list');
    var listItems = document.getElementById('tf-list-items');
    var listTitle = document.getElementById('tf-list-title');

    function setStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = 'tf-status ' + (type || 'info');
    }

    function readFile(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload  = function () { resolve({ name: file.name.replace(/\.txt$/i, ''), text: reader.result }); };
            reader.onerror = function () { reject(new Error('Failed to read ' + file.name)); };
            reader.readAsText(file);
        });
    }

    function formatBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Same shape as content/builtin-templates.js getMergedTemplates: a map of
    // name -> content STRING, with official (Salesforce) templates winning.
    function mergeWithOfficial(userTemplates, official) {
        var merged = {};
        Object.keys(userTemplates || {}).forEach(function (k) { merged[k] = userTemplates[k]; });
        Object.keys(official || {}).forEach(function (k) {
            var e = official[k];
            merged[k] = (e && typeof e === 'object') ? e.content : e;
        });
        return merged;
    }

    input.addEventListener('change', function (e) {
        var files = Array.prototype.slice.call(e.target.files || []);
        if (!files.length) return;

        var txtFiles = files.filter(function (f) { return f.name.toLowerCase().endsWith('.txt'); });
        if (!txtFiles.length) { setStatus('No .txt files found in that folder.', 'err'); return; }

        setStatus('Reading ' + txtFiles.length + ' file' + (txtFiles.length !== 1 ? 's' : '') + '…', 'info');

        Promise.all(txtFiles.map(readFile)).then(function (results) {
            // Official (Salesforce-synced) templates are authoritative — a user
            // upload of the same name is skipped rather than overriding it.
            chrome.storage.local.get(['sfRemoteTemplates'], function (store) {
                var official = (store && store.sfRemoteTemplates) || {};
                var templates = {};
                var loaded = [], skipped = [];
                results.forEach(function (r) {
                    if (Object.prototype.hasOwnProperty.call(official, r.name)) { skipped.push(r.name); return; }
                    templates[r.name] = r.text;
                    loaded.push(r.name);
                });

                var totalSize = JSON.stringify(templates).length;
                if (totalSize > 8 * 1024 * 1024) {
                    setStatus('Templates too large (' + formatBytes(totalSize) + '). Max ~8 MB.', 'err');
                    return;
                }

                var count = Object.keys(templates).length;
                // Merged view (official wins) so it's ready even with no Salesforce tab open.
                var merged = mergeWithOfficial(templates, official);

                chrome.storage.local.set({
                    nucleusTemplates: templates,
                    templateCount: count,
                    mergedTemplates: merged
                }, function () {
                    if (chrome.runtime.lastError) {
                        setStatus('Storage error: ' + chrome.runtime.lastError.message, 'err');
                        return;
                    }
                    var msg = '✓ ' + count + ' template' + (count !== 1 ? 's' : '') + ' loaded.';
                    if (skipped.length) msg += ' ' + skipped.length + ' skipped (an official template owns that name).';
                    setStatus(msg, skipped.length ? 'info' : 'ok');
                    renderList(loaded, skipped);
                });
            });
        }).catch(function (err) {
            setStatus('Error reading files: ' + (err && err.message ? err.message : err), 'err');
        });
    });

    function renderList(loaded, skipped) {
        listItems.innerHTML = '';
        listTitle.textContent = 'Loaded (' + loaded.length + ')' + (skipped.length ? ' · skipped (' + skipped.length + ')' : '');
        loaded.forEach(function (n) {
            var li = document.createElement('li'); li.textContent = n; listItems.appendChild(li);
        });
        skipped.forEach(function (n) {
            var li = document.createElement('li'); li.className = 'tf-skip'; li.textContent = n + ' (official)'; listItems.appendChild(li);
        });
        listEl.style.display = (loaded.length || skipped.length) ? '' : 'none';
    }

    // Folder dialog only — drag/drop of a folder isn't reliable, so nudge.
    ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
            e.preventDefault();
            if (ev === 'dragover') drop.classList.add('drag-over');
            else drop.classList.remove('drag-over');
            if (ev === 'drop') setStatus('Use the “Select Template Folder” button to choose a folder.', 'info');
        });
    });

    document.getElementById('tf-clear').addEventListener('click', function () {
        if (!confirm('Remove all locally loaded templates on this device? Official Salesforce templates are unaffected.')) return;
        chrome.storage.local.get(['sfRemoteTemplates'], function (store) {
            var official = (store && store.sfRemoteTemplates) || {};
            chrome.storage.local.set({
                nucleusTemplates: {},
                templateCount: 0,
                mergedTemplates: mergeWithOfficial({}, official)
            }, function () {
                setStatus('Local templates cleared.', 'ok');
                renderList([], []);
            });
        });
    });

    document.getElementById('tf-close').addEventListener('click', function () {
        window.close();
    });
}());
