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

function bindTemplateEvents() {
    // JSON Export (L-2)
    var exportBtn = document.getElementById('btn-export-templates');
    if (exportBtn) {
        exportBtn.addEventListener('click', function () {
            if (Object.keys(currentUserTemplates).length === 0) {
                setStatus('No user templates to export', 'info');
                return;
            }
            var blob = new Blob([JSON.stringify({
                templates: currentUserTemplates,
                exportedAt: new Date().toISOString(),
                version: '1'
            }, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'cyfor-templates-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(url);
            setStatus('Templates exported', 'success');
        });
    }

    // JSON Import (L-2)
    var importInput = document.getElementById('json-import-input');
    if (importInput) {
        importInput.addEventListener('change', function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var data = JSON.parse(reader.result);
                    if (!data.templates || typeof data.templates !== 'object') {
                        setStatus('Invalid template file — missing "templates" object', 'error');
                        return;
                    }
                    var count = Object.keys(data.templates).length;
                    if (count === 0) {
                        setStatus('No templates found in file', 'info');
                        return;
                    }
                    var merged = Object.assign({}, currentUserTemplates, data.templates);
                    currentUserTemplates = merged;
                    currentMergedTemplates = mergeTemplates(merged);
                    chrome.storage.local.set({ nucleusTemplates: merged, templateCount: Object.keys(merged).length }, function () {
                        if (chrome.runtime.lastError) {
                            setStatus('Storage error: ' + chrome.runtime.lastError.message, 'error');
                            return;
                        }
                        chrome.storage.local.get(['processMap'], function (res) {
                            renderMappings(PROCESS_TYPES, currentMergedTemplates, (res || {}).processMap || {});
                            populateDropdown(currentMergedTemplates);
                            updateBadge(Object.keys(currentMergedTemplates).length);
                            updateClearBtn(Object.keys(currentUserTemplates).length);
                            setStatus('✓ Imported ' + count + ' template' + (count !== 1 ? 's' : ''), 'success');
                        });
                    });
                } catch (err) {
                    setStatus('Could not parse JSON: ' + err.message, 'error');
                }
                importInput.value = '';
            };
            reader.readAsText(file);
        });
    }

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
        var isBuiltIn = builtinTemplateKeys.indexOf(key) !== -1 && !currentUserTemplates.hasOwnProperty(key);
        editorBuiltinNote.style.display = isBuiltIn ? '' : 'none';
        editorSection.style.display = '';
        editorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        editorArea.focus();
    }

    function closeEditor() {
        editorSection.style.display = 'none';
        editingKey = null;
    }

    if (editBtn) {
        editBtn.addEventListener('click', function () {
            var select = els.templateSelect;
            var key = (select.options[select.selectedIndex] || {}).textContent || '';
            key = key.replace(/\s*\(built-in\)\s*$/, '').trim();
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

    // Folder upload
    els.folderInput.addEventListener('change', function (e) {
        var files = Array.from(e.target.files);
        if (!files.length) return;

        var txtFiles = files.filter(function (f) { return f.name.endsWith('.txt'); });
        if (txtFiles.length === 0) {
            setStatus('No .txt files found in folder', 'error');
            return;
        }

        setStatus('Reading ' + txtFiles.length + ' files…', 'info');

        Promise.all(txtFiles.map(readFile)).then(function (results) {
            var templates = {};
            for (var i = 0; i < results.length; i++) {
                templates[results[i].name] = results[i].text;
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

                chrome.storage.local.get(['processMap'], function (res) {
                    renderMappings(PROCESS_TYPES, currentMergedTemplates, (res || {}).processMap || {});
                    populateDropdown(currentMergedTemplates);
                    updateBadge(Object.keys(currentMergedTemplates).length);
                    updateClearBtn(count);
                    setStatus('✓ ' + count + ' user template' + (count !== 1 ? 's' : '') + ' loaded', 'success');
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
        var isBuiltIn = builtinTemplateKeys.indexOf(keys[i]) !== -1 &&
            !currentUserTemplates.hasOwnProperty(keys[i]);
        opt.textContent = keys[i] + (isBuiltIn ? '  (built-in)' : '');
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
