// ==================================================
// CYFOR Nucleus Enhancer — Popup Template Management
// Upload, preview, clear, insert, and process mappings.
// ==================================================

var PROCESS_TYPES = [
    'Administration', 'Analysis', 'Archiving', 'Cell Site Analysis',
    'Device Repair', 'eDiscovery', 'Forensic Strategy', 'Grading',
    'Imaging', 'Pre-imaging', 'Processing', 'QA', 'Reporting', 'Submission'
];

function initTemplates(savedMap) {
    bindTemplateEvents();
    renderMappings(PROCESS_TYPES, currentMergedTemplates, savedMap || {});
}

// Official = synced from Salesforce (present in the merged set but not a user
// upload). builtinTemplateKeys is maintained in popup.js.
function isOfficialTemplate(key) {
    return typeof builtinTemplateKeys !== 'undefined' && builtinTemplateKeys.indexOf(key) !== -1;
}

function bindTemplateEvents() {
    // Insert button
    els.insertBtn.addEventListener('click', function () {
        var select = els.templateSelect;
        var text = select.value;
        var name = (select.options[select.selectedIndex] || {}).textContent || 'Template';

        if (!text) {
            setStatus('Select a template first', 'error');
            shakeElement(els.templateSelect);
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs[0];
            if (!tab || !tab.url || tab.url.indexOf('lightning.force.com') === -1) {
                setStatus('Navigate to a Salesforce page first', 'error');
                return;
            }

            chrome.tabs.sendMessage(tab.id, { action: 'insertTemplate', text: text, name: name }, function (response) {
                if (chrome.runtime.lastError) {
                    setStatus('Could not reach content script — refresh the page', 'error');
                } else {
                    setStatus('"' + name + '" sent ✓', 'success');
                    setTimeout(function () { window.close(); }, 800);
                }
            });
        });
    });

    // Template select → enable/disable Edit + Preview
    els.templateSelect.addEventListener('change', function () {
        var hasValue = !!els.templateSelect.value;
        els.previewBtn.disabled = !hasValue;
        els.previewSection.style.display = 'none';
        var editBtn = document.getElementById('btn-edit-template');
        if (editBtn) editBtn.disabled = !hasValue;
    });

    // Template editor (L-9)
    var editBtn = document.getElementById('btn-edit-template');
    var editorSection = document.getElementById('template-editor-section');
    var editorArea = document.getElementById('template-editor-area');
    var editorName = document.getElementById('template-editor-name');
    var editorClose = document.getElementById('btn-editor-close');
    var editorSave = document.getElementById('btn-editor-save');
    var editorCancel = document.getElementById('btn-editor-cancel');
    var editorBuiltinNote = document.getElementById('template-editor-builtin-note');
    var editingKey = null;

    function openEditor(key, content) {
        editingKey = key;
        editorName.textContent = key;
        editorArea.value = content;
        // Official (Salesforce-synced) templates are read-only here — they're
        // managed centrally in Salesforce and a local edit would be ignored.
        var official = isOfficialTemplate(key);
        if (editorBuiltinNote) {
            editorBuiltinNote.textContent = official
                ? 'Official Salesforce template — manage it in Salesforce. Local changes won’t apply.'
                : '';
            editorBuiltinNote.style.display = official ? '' : 'none';
        }
        editorArea.readOnly = official;
        if (editorSave) editorSave.disabled = official;
        editorSection.style.display = '';
        editorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (!official) editorArea.focus();
    }

    function closeEditor() {
        editorSection.style.display = 'none';
        editingKey = null;
    }

    if (editBtn) {
        editBtn.addEventListener('click', function () {
            var select = els.templateSelect;
            var key = (select.options[select.selectedIndex] || {}).textContent || '';
            key = key.replace(/\s*·\s*(Official|built-in)\s*$/i, '').trim();
            var content = select.value;
            if (!key || !content) return;
            openEditor(key, content);
        });
    }

    if (editorClose) editorClose.addEventListener('click', closeEditor);
    if (editorCancel) editorCancel.addEventListener('click', closeEditor);

    if (editorSave) {
        editorSave.addEventListener('click', function () {
            if (!editingKey) return;
            var newContent = editorArea.value;
            currentUserTemplates[editingKey] = newContent;
            currentMergedTemplates = mergeTemplates(currentUserTemplates);
            chrome.storage.local.set({
                nucleusTemplates: currentUserTemplates,
                templateCount: Object.keys(currentUserTemplates).length
            }, function () {
                if (chrome.runtime.lastError) {
                    setStatus('Save error: ' + chrome.runtime.lastError.message, 'error');
                    return;
                }
                chrome.storage.local.get(['processMap'], function (res) {
                    renderMappings(PROCESS_TYPES, currentMergedTemplates, (res || {}).processMap || {});
                    populateDropdown(currentMergedTemplates);
                    updateBadge(Object.keys(currentMergedTemplates).length);
                    updateClearBtn(Object.keys(currentUserTemplates).length);
                    setStatus('"' + editingKey + '" saved', 'success');
                    closeEditor();
                });
            });
        });
    }

    // Preview

    els.previewBtn.addEventListener('click', function () {
        var text = els.templateSelect.value;
        if (!text) return;
        els.previewContent.textContent = text;
        els.previewSection.style.display = '';
        els.previewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    els.previewClose.addEventListener('click', function () {
        els.previewSection.style.display = 'none';
    });

    // Folder loading now happens in a full-page tab (popup/template-files.html)
    // because the OS folder dialog can dismiss the extension popup (common on
    // Linux), which would abort an in-popup file selection.
    var openLoaderBtn = document.getElementById('btn-open-loader');
    if (openLoaderBtn) {
        openLoaderBtn.addEventListener('click', function () {
            chrome.tabs.create({ url: chrome.runtime.getURL('popup/template-files.html') });
        });
    }

    // Legacy in-popup folder input (kept for environments where the popup stays
    // open during folder selection; the element is no longer in the markup by
    // default, so guard it).
    if (els.folderInput) els.folderInput.addEventListener('change', function (e) {
        var files = Array.from(e.target.files);
        if (!files.length) return;

        var txtFiles = files.filter(function (f) { return f.name.endsWith('.txt'); });
        if (txtFiles.length === 0) {
            setStatus('No .txt files found in folder', 'error');
            return;
        }

        setStatus('Reading ' + txtFiles.length + ' files…', 'info');

        Promise.all(txtFiles.map(readFile)).then(function (results) {
            // Official (Salesforce-synced) templates are authoritative — a user
            // upload of the same name is skipped rather than overriding it.
            chrome.storage.local.get(['sfRemoteTemplates', 'processMap'], function (store) {
                var official = store.sfRemoteTemplates || {};
                var templates = {};
                var skipped = [];
                for (var i = 0; i < results.length; i++) {
                    var nm = results[i].name;
                    if (Object.prototype.hasOwnProperty.call(official, nm)) {
                        skipped.push(nm);
                        continue;
                    }
                    templates[nm] = results[i].text;
                }

                var count = Object.keys(templates).length;
                var totalSize = JSON.stringify(templates).length;
                if (totalSize > 8 * 1024 * 1024) {
                    setStatus('Templates too large (' + formatBytes(totalSize) + '). Max ~8MB.', 'error');
                    return;
                }

                currentUserTemplates = templates;
                currentMergedTemplates = mergeTemplates(templates);

                chrome.storage.local.set({ nucleusTemplates: templates, templateCount: count }, function () {
                    if (chrome.runtime.lastError) {
                        setStatus('Storage error: ' + chrome.runtime.lastError.message, 'error');
                        return;
                    }

                    renderMappings(PROCESS_TYPES, currentMergedTemplates, (store || {}).processMap || {});
                    populateDropdown(currentMergedTemplates);
                    updateBadge(Object.keys(currentMergedTemplates).length);
                    updateClearBtn(count);

                    var msg = '✓ ' + count + ' user template' + (count !== 1 ? 's' : '') + ' loaded';
                    if (skipped.length) {
                        msg += ' · ' + skipped.length + ' skipped (an official template owns that name): ' + skipped.join(', ');
                    }
                    setStatus(msg, skipped.length ? 'info' : 'success');
                });
            });
        }).catch(function (err) {
            console.error('[CYFOR] File read error:', err);
            setStatus('Error reading files: ' + err.message, 'error');
        });
    });

    // Drag & drop upload area (folder button only — drop is unsupported)
    els.uploadArea.addEventListener('dragover', function (e) {
        e.preventDefault();
        els.uploadArea.classList.add('drag-over');
    });
    els.uploadArea.addEventListener('dragleave', function () {
        els.uploadArea.classList.remove('drag-over');
    });
    els.uploadArea.addEventListener('drop', function (e) {
        e.preventDefault();
        els.uploadArea.classList.remove('drag-over');
        setStatus('Use the folder button — drag & drop requires folder selection', 'info');
    });

    // Clear templates — two-step confirmation (M-10)
    var clearPending = false;
    var clearResetTimer = null;

    els.clearBtn.addEventListener('click', function () {
        if (!clearPending) {
            clearPending = true;
            els.clearBtn.textContent = 'Are you sure? Click again to confirm';
            els.clearBtn.classList.add('btn-danger-confirm');
            clearResetTimer = setTimeout(function () {
                clearPending = false;
                els.clearBtn.textContent = 'Clear All Templates';
                els.clearBtn.classList.remove('btn-danger-confirm');
            }, 3500);
            return;
        }

        clearTimeout(clearResetTimer);
        clearPending = false;
        els.clearBtn.textContent = 'Clear All Templates';
        els.clearBtn.classList.remove('btn-danger-confirm');

        chrome.storage.local.set({ nucleusTemplates: {}, templateCount: 0, processMap: {} }, function () {
            currentUserTemplates = {};
            currentMergedTemplates = mergeTemplates({});
            renderMappings(PROCESS_TYPES, currentMergedTemplates, {});
            populateDropdown(currentMergedTemplates);
            updateBadge(Object.keys(currentMergedTemplates).length);
            updateClearBtn(0);
            els.previewSection.style.display = 'none';
            setStatus('User templates cleared (built-ins remain)', 'info');
        });
    });
}

function renderMappings(types, templates, savedMap) {
    els.mappingList.innerHTML = '';
    var tplNames = Object.keys(templates).sort();

    if (tplNames.length === 0) {
        els.mappingList.innerHTML = '<div class="empty-state">Upload templates to configure mappings</div>';
        return;
    }

    var fragment = document.createDocumentFragment();

    for (var i = 0; i < types.length; i++) {
        var proc = types[i];
        var row = document.createElement('div');
        row.className = 'mapping-row';

        var label = document.createElement('span');
        label.className = 'process-name';
        label.textContent = proc;

        var select = document.createElement('select');
        select.className = 'map-select';
        select.setAttribute('aria-label', 'Template for ' + proc);

        var defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '—';
        select.appendChild(defaultOpt);

        for (var j = 0; j < tplNames.length; j++) {
            var opt = document.createElement('option');
            opt.value = tplNames[j];
            opt.textContent = tplNames[j];
            if (savedMap[proc] === tplNames[j]) opt.selected = true;
            select.appendChild(opt);
        }

        (function (proc, select) {
            select.addEventListener('change', function () {
                chrome.storage.local.get(['processMap'], function (res) {
                    var map = (res || {}).processMap || {};
                    if (select.value === '') {
                        delete map[proc];
                    } else {
                        map[proc] = select.value;
                    }
                    chrome.storage.local.set({ processMap: map });
                });
            });
        })(proc, select);

        row.appendChild(label);
        row.appendChild(select);
        fragment.appendChild(row);
    }

    els.mappingList.appendChild(fragment);
}

function populateDropdown(templates) {
    els.templateSelect.innerHTML = '<option value="">Select template…</option>';
    els.previewBtn.disabled = true;

    if (!templates) return;

    var keys = Object.keys(templates).sort();
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < keys.length; i++) {
        var opt = document.createElement('option');
        opt.value = templates[keys[i]];
        opt.textContent = keys[i] + (isOfficialTemplate(keys[i]) ? '  ·  Official' : '');
        fragment.appendChild(opt);
    }

    els.templateSelect.appendChild(fragment);
}

function updateBadge(count) {
    els.templateBadge.textContent = count + ' loaded';
    els.templateBadge.className = count > 0 ? 'badge badge-success' : 'badge badge-empty';
}

function updateClearBtn(userCount) {
    els.clearBtn.style.display = userCount > 0 ? '' : 'none';
}
