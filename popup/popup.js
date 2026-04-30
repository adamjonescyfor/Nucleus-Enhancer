// ==================================================
// CYFOR Nucleus Enhancer — Popup Script
// Settings management, template upload, preview,
// mappings, quick insert, and context-aware column dragging.
// ==================================================

// ==================================================
// BUILT-IN TEMPLATES (must mirror content/builtin-templates.js)
// ==================================================
var BUILTIN_TEMPLATES = {
    'Forensic Strategy': [
        'FORENSIC STRATEGY TEMPLATE',
        '',
        'Case Overview',
        'Case Name / URN: ',
        'Case Type (eg Prosecution/Defence/Family/Corporate): ',
        'Police Force: ',
        'Instructing officer/solicitor: ',
        'Parties: ',
        'Alleged Offence(s): ',
        'Background: ',
        'Victim device submitted? (Y|N): ',
        '',
        'Devices & Data Sources',
        'Exhibit References: ',
        'PINs/Passwords: ',
        'Special handling required (eg fingerprints, biohazard): ',
        'USB/HDD exhibit ref: ',
        'Encrypted USB/HDD password: ',
        'Previous work undertaken (eg level 1, EPM): ',
        'Potential Limitations: ',
        '',
        'Objectives',
        'Data required/ points to prove: ',
        'Date range: ',
        '',
        'Acquisition Strategy',
        'Primary tool: ',
        'Secondary tool: ',
        '',
        'Processing Strategy',
        'Primary tool: ',
        'Secondary tool: ',
        'Griffeye required? (Y|N): ',
        'Grading required? (Y|N): ',
        'Keywords to be run? (Y|N): ',
        'CAID/ Hash sets to be run? (Y|N): ',
        '',
        'Analysis Strategy (if applicable)',
        'Timeline analysis? (Y|N): ',
        'User attribution (Y|N): ',
        'IIOC provenance? (Y|N): ',
        'Applications/artefacts to be examined: ',
        '',
        'Data Production Strategy',
        'Report template: ',
        'Generated material format: ',
        'Disclosures: '
    ].join('\n')
};

function mergeTemplates(userTemplates) {
    var merged = {};
    for (var k in BUILTIN_TEMPLATES) merged[k] = BUILTIN_TEMPLATES[k];
    if (userTemplates) {
        for (var key in userTemplates) merged[key] = userTemplates[key];
    }
    return merged;
}

var AUTH_STORAGE_KEY = 'salesforceAuth';

document.addEventListener('DOMContentLoaded', function () {

    // ==========================================
    // ELEMENT REFERENCES
    // ==========================================
    var toggles = {
        enableDate:        document.getElementById('opt-date'),
        enableContextMenu: document.getElementById('opt-context-menu'),
        enableNav:         document.getElementById('opt-nav'),
        enableFormatNotes: document.getElementById('opt-format-notes'),
        enableAutoInsert:  document.getElementById('opt-auto-insert')
    };

    var els = {
        columnList:      document.getElementById('column-list'),
        btnResetCols:    document.getElementById('btn-reset-cols'),
        tableContextLbl: document.getElementById('table-context-label'),
        folderInput:     document.getElementById('folder-input'),
        statusMsg:       document.getElementById('status-msg'),
        mappingList:     document.getElementById('mapping-list'),
        templateSelect:  document.getElementById('template-select'),
        insertBtn:       document.getElementById('btn-insert'),
        previewBtn:      document.getElementById('btn-preview'),
        clearBtn:        document.getElementById('btn-clear'),
        templateBadge:   document.getElementById('template-badge'),
        uploadArea:      document.getElementById('upload-area'),
        versionLabel:    document.getElementById('version-label'),
        connectionBar:   document.getElementById('connection-bar'),
        connectionText:  document.getElementById('connection-text'),
        previewSection:  document.getElementById('preview-section'),
        previewContent:  document.getElementById('preview-content'),
        previewClose:    document.getElementById('btn-preview-close'),
        authBadge:       document.getElementById('auth-badge'),
        authAvatar:      document.getElementById('auth-avatar'),
        authAvatarFallback: document.getElementById('auth-avatar-fallback'),
        authAvatarImg:   document.getElementById('auth-avatar-img'),
        authStatus:      document.getElementById('auth-status'),
        authUser:        document.getElementById('auth-user'),
        authSignInBtn:   document.getElementById('btn-sf-sign-in'),
        authSignOutBtn:  document.getElementById('btn-sf-sign-out')
    };

    var PROCESS_TYPES = [
        "Administration", "Analysis", "Archiving", "Cell Site Analysis",
        "Device Repair", "eDiscovery", "Forensic Strategy", "Grading",
        "Imaging", "Pre-imaging", "Processing", "QA", "Reporting", "Submission"
    ];

    var currentUserTemplates = {};
    var currentMergedTemplates = {};
    var currentTableContextId = null;
    var currentTableColumns = [];

    // ==========================================
    // 1. VERSION & CONNECTION CHECK
    // ==========================================
    els.versionLabel.textContent = 'v' + chrome.runtime.getManifest().version;

    checkConnection();
    bindAuthActions();

    function checkConnection() {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs[0];
            if (!tab || !tab.url || tab.url.indexOf('lightning.force.com') === -1) {
                setConnection('disconnected', 'Not on a Salesforce page');
                renderNoTable();
                return;
            }

            chrome.tabs.sendMessage(tab.id, { action: 'ping' }, function (response) {
                if (chrome.runtime.lastError || !response) {
                    setConnection('disconnected', 'Content script not loaded \u2014 refresh the page');
                    renderNoTable();
                } else {
                    setConnection('connected', 'Connected to Salesforce tab');
                    requestActiveTableColumns(tab.id);
                }
            });
        });
    }

    function setConnection(state, text) {
        els.connectionBar.className = 'connection-bar ' + state;
        els.connectionText.textContent = text;
    }

    // ==========================================
    // 2. LOAD SETTINGS
    // ==========================================
    chrome.storage.local.get(
        ['enableDate', 'enableContextMenu', 'enableNav', 'enableFormatNotes',
         'enableAutoInsert', 'nucleusTemplates', 'processMap', AUTH_STORAGE_KEY],
        function (result) {
            var r = result || {};

            toggles.enableDate.checked        = r.enableDate !== false;
            toggles.enableContextMenu.checked = r.enableContextMenu !== false;
            toggles.enableNav.checked         = r.enableNav !== false;
            toggles.enableFormatNotes.checked = r.enableFormatNotes !== false;
            toggles.enableAutoInsert.checked  = r.enableAutoInsert === true;

            currentUserTemplates  = r.nucleusTemplates || {};
            currentMergedTemplates = mergeTemplates(currentUserTemplates);
            var savedMap     = r.processMap || {};
            var mergedCount  = Object.keys(currentMergedTemplates).length;

            updateBadge(mergedCount);
            populateDropdown(currentMergedTemplates);
            renderMappings(PROCESS_TYPES, currentMergedTemplates, savedMap);
            updateClearBtn(Object.keys(currentUserTemplates).length);

            renderAuthFromState(r[AUTH_STORAGE_KEY]);
            refreshSalesforceAuth(false);

            if (Object.keys(currentUserTemplates).length > 0) {
                var n = Object.keys(currentUserTemplates).length;
                setStatus(n + ' user template' + (n !== 1 ? 's' : '') + ' loaded · ' +
                    Object.keys(BUILTIN_TEMPLATES).length + ' built-in', 'success');
            }
        }
    );

    // ==========================================
    // 3. SAVE TOGGLES
    // ==========================================
    Object.keys(toggles).forEach(function (key) {
        var el = toggles[key];
        el.addEventListener('change', function () {
            var obj = {};
            obj[key] = el.checked;
            chrome.storage.local.set(obj);

            var row = el.closest('.option-row');
            if (row) {
                row.style.backgroundColor = '#f0f7ff';
                setTimeout(function () { row.style.backgroundColor = ''; }, 300);
            }
        });
    });

    // ==========================================
    // 4. DYNAMIC COLUMNS (CONTEXT AWARE)
    // ==========================================
    function requestActiveTableColumns(tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'getActiveTableColumns' }, function(response) {
            if (chrome.runtime.lastError || !response || !response.ok) {
                renderNoTable();
                return;
            }

            currentTableContextId = response.contextId;
            currentTableColumns = response.columns;

            // Make the context ID friendly for display
            let displayContext = currentTableContextId.replace('__c', '').replace('__r', '').replace(/_/g, ' ');
            if (displayContext.startsWith('Table')) displayContext = 'Custom Table';

            els.tableContextLbl.innerHTML = '⚙️ Active Table: <b>' + displayContext + '</b>';
            els.btnResetCols.style.display = 'block';

            // Fetch saved preferences for THIS specific table
            chrome.storage.local.get(['tableColumnPrefs'], function(res) {
                var prefsMap = res.tableColumnPrefs || {};
                var savedOrder = prefsMap[currentTableContextId] || [];

                // Merge: Saved items that exist in current columns FIRST, then new unsaved columns
                var finalOrder = [];
                savedOrder.forEach(function(col) {
                    if (currentTableColumns.includes(col)) {
                        finalOrder.push(col);
                    }
                });
                currentTableColumns.forEach(function(col) {
                    if (!finalOrder.includes(col)) {
                        finalOrder.push(col);
                    }
                });

                renderColumnList(finalOrder);
            });
        });
    }

    function renderNoTable() {
        els.tableContextLbl.textContent = 'Navigate to a list view or related list to reorder its columns.';
        els.columnList.innerHTML = '<div class="empty-state">No table active on page.</div>';
        els.btnResetCols.style.display = 'none';
        currentTableContextId = null;
    }

    function renderColumnList(columns) {
        els.columnList.innerHTML = '';
        columns.forEach(function (colName) {
            var li = document.createElement('li');
            li.className = 'sortable-item';
            li.draggable = true;
            li.setAttribute('data-name', colName);
            li.innerHTML = '<span class="sortable-handle">≡</span> ' + colName;

            li.addEventListener('dragstart', handleDragStart);
            li.addEventListener('dragend', handleDragEnd);

            els.columnList.appendChild(li);
        });
    }

    let draggedItem = null;

    function handleDragStart(e) {
        draggedItem = this;
        setTimeout(function () { draggedItem.classList.add('dragging'); }, 0);
    }

    function handleDragEnd(e) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
        saveColumnOrder();
    }

    els.columnList.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (!currentTableContextId) return;

        var afterElement = getDragAfterElement(els.columnList, e.clientY);
        if (afterElement == null) {
            els.columnList.appendChild(draggedItem);
        } else {
            els.columnList.insertBefore(draggedItem, afterElement);
        }
    });

    function getDragAfterElement(container, y) {
        var draggableElements = Array.from(container.querySelectorAll('.sortable-item:not(.dragging)'));
        return draggableElements.reduce(function (closest, child) {
            var box = child.getBoundingClientRect();
            var offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function saveColumnOrder() {
        if (!currentTableContextId) return;

        var items = Array.from(els.columnList.querySelectorAll('.sortable-item'));
        var order = items.map(function (item) { return item.getAttribute('data-name'); });

        chrome.storage.local.get(['tableColumnPrefs'], function(res) {
            var prefsMap = res.tableColumnPrefs || {};
            prefsMap[currentTableContextId] = order;
            chrome.storage.local.set({ tableColumnPrefs: prefsMap });
        });
    }

    els.btnResetCols.addEventListener('click', function () {
        if (!currentTableContextId) return;

        chrome.storage.local.get(['tableColumnPrefs'], function(res) {
            var prefsMap = res.tableColumnPrefs || {};
            delete prefsMap[currentTableContextId];
            chrome.storage.local.set({ tableColumnPrefs: prefsMap }, function() {
                renderColumnList(currentTableColumns);
                els.columnList.style.backgroundColor = '#f0f7ff';
                setTimeout(function () { els.columnList.style.backgroundColor = ''; }, 300);
            });
        });
    });

    // ==========================================
    // 5. MANUAL INSERT
    // ==========================================
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

            chrome.tabs.sendMessage(tab.id, {
                action: 'insertTemplate',
                text: text,
                name: name
            }, function (response) {
                if (chrome.runtime.lastError) {
                    setStatus('Could not reach content script \u2014 refresh the page', 'error');
                } else {
                    setStatus('"' + name + '" sent \u2713', 'success');
                    setTimeout(function () { window.close(); }, 800);
                }
            });
        });
    });

    // ==========================================
    // 6. TEMPLATE PREVIEW
    // ==========================================
    els.templateSelect.addEventListener('change', function () {
        els.previewBtn.disabled = !els.templateSelect.value;
        els.previewSection.style.display = 'none';
    });

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

    // ==========================================
    // 7. FOLDER UPLOAD
    // ==========================================
    els.folderInput.addEventListener('change', function (e) {
        var files = Array.from(e.target.files);
        if (!files.length) return;

        var txtFiles = files.filter(function (f) { return f.name.endsWith('.txt'); });
        if (txtFiles.length === 0) {
            setStatus('No .txt files found in folder', 'error');
            return;
        }

        setStatus('Reading ' + txtFiles.length + ' files\u2026', 'info');

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

            chrome.storage.local.set({
                nucleusTemplates: templates,
                templateCount: count
            }, function () {
                if (chrome.runtime.lastError) {
                    setStatus('Storage error: ' + chrome.runtime.lastError.message, 'error');
                    return;
                }

                chrome.storage.local.get(['processMap'], function (res) {
                    renderMappings(PROCESS_TYPES, currentMergedTemplates, (res || {}).processMap || {});
                    populateDropdown(currentMergedTemplates);
                    updateBadge(Object.keys(currentMergedTemplates).length);
                    updateClearBtn(count);
                    setStatus('\u2713 ' + count + ' user template' + (count !== 1 ? 's' : '') + ' loaded', 'success');
                });
            });

        }).catch(function (err) {
            console.error('[CYFOR] File read error:', err);
            setStatus('Error reading files: ' + err.message, 'error');
        });
    });

    // ==========================================
    // 8. CLEAR TEMPLATES (user-only; built-ins remain)
    // ==========================================
    els.clearBtn.addEventListener('click', function () {
        if (!confirm('Clear all uploaded templates and mappings? Built-in templates will remain.')) return;

        chrome.storage.local.set({
            nucleusTemplates: {},
            templateCount: 0,
            processMap: {}
        }, function () {
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

    // ==========================================
    // 9. DRAG & DROP FOLDER UPLOAD
    // ==========================================
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
        setStatus('Use the folder button \u2014 drag & drop requires folder selection', 'info');
    });

    // ==========================================
    // HELPER FUNCTIONS
    // ==========================================

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
            defaultOpt.textContent = '\u2014';
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
        els.templateSelect.innerHTML = '<option value="">Select template\u2026</option>';
        els.previewBtn.disabled = true;

        if (!templates) return;

        var keys = Object.keys(templates).sort();
        var fragment = document.createDocumentFragment();

        for (var i = 0; i < keys.length; i++) {
            var opt = document.createElement('option');
            opt.value = templates[keys[i]];
            var isBuiltIn = BUILTIN_TEMPLATES.hasOwnProperty(keys[i]) &&
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

    function setStatus(msg, type) {
        type = type || 'info';
        els.statusMsg.textContent = msg;
        els.statusMsg.className = 'status-msg status-' + type;
    }

    function readFile(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                resolve({
                    name: file.name.replace(/\.txt$/i, ''),
                    text: reader.result
                });
            };
            reader.onerror = function () {
                reject(new Error('Failed to read ' + file.name));
            };
            reader.readAsText(file);
        });
    }

    function shakeElement(el) {
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = 'cyforShake 0.4s ease';
        setTimeout(function () { el.style.animation = ''; }, 450);
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function bindAuthActions() {
        els.authSignInBtn.addEventListener('click', function () {
            refreshSalesforceAuth(true);
        });

        els.authSignOutBtn.addEventListener('click', function () {
            var resetState = {
                isSignedIn: false,
                fullName: '',
                username: '',
                email: '',
                profilePhotoUrl: '',
                profilePhotoDataUrl: '',
                organizationId: '',
                domain: '',
                instanceUrl: '',
                lastVerifiedAt: null
            };
            persistAuthState(resetState);
            renderAuthFromState(resetState);
        });
    }

    function refreshSalesforceAuth(openLoginOnFailure) {
        setAuthLoading(true);

        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs[0];
            if (!tab || !tab.id || !tab.url || tab.url.indexOf('lightning.force.com') === -1) {
                setAuthLoading(false);
                renderAuthDisconnected('Open a Salesforce record tab, then click Sign In.');
                if (openLoginOnFailure) {
                    chrome.tabs.create({ url: 'https://login.salesforce.com/' });
                }
                return;
            }

            // Route through background worker so it can use cookies + avoid CORS
            chrome.runtime.sendMessage({ action: 'getSalesforceIdentity', tabId: tab.id, tabUrl: tab.url }, function (response) {
                setAuthLoading(false);
                console.log('[CYFOR popup] identity response:', JSON.stringify(response));

                if (chrome.runtime.lastError || !response || !response.ok) {
                    var err = (response && response.error) || 'Could not verify Salesforce session. Open an active Lightning record tab and try again.';
                    console.log('[CYFOR popup] auth failed:', err);
                    renderAuthDisconnected(err);
                    if (openLoginOnFailure) {
                        chrome.tabs.create({ url: 'https://login.salesforce.com/' });
                    }
                    return;
                }

                var authState = {
                    isSignedIn: true,
                    fullName: response.user.fullName || '',
                    username: response.user.username || '',
                    email: response.user.email || '',
                    profilePhotoUrl: response.user.profilePhotoUrl || '',
                    profilePhotoDataUrl: response.user.profilePhotoDataUrl || '',
                    organizationId: response.user.organizationId || '',
                    domain: response.user.domain || '',
                    instanceUrl: response.user.instanceUrl || '',
                    partial: response.partial === true,
                    source: response.source || '',
                    lastVerifiedAt: Date.now()
                };
                console.log('[CYFOR popup] storing auth state:', JSON.stringify(authState));

                hydrateAuthState(tab.id, authState, function (finalAuthState) {
                    persistAuthState(finalAuthState);
                    renderAuthFromState(finalAuthState);
                });
            });
        });
    }

    function hydrateAuthState(tabId, authState, callback) {
        if (authState.fullName || authState.username || authState.email) {
            callback(authState);
            return;
        }

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: async function () {
                function wait(ms) {
                    return new Promise(function (resolve) { setTimeout(resolve, ms); });
                }

                function queryDeep(selector, root, depth) {
                    if (!root || depth > 12) return [];
                    var results = [];
                    try {
                        var matches = root.querySelectorAll(selector);
                        for (var i = 0; i < matches.length; i++) results.push(matches[i]);
                    } catch (e) {}

                    var all = [];
                    try { all = root.querySelectorAll('*'); } catch (e) { all = []; }
                    for (var j = 0; j < all.length; j++) {
                        if (all[j].shadowRoot) {
                            results = results.concat(queryDeep(selector, all[j].shadowRoot, depth + 1));
                        }
                    }
                    return results;
                }

                function sanitize(text) {
                    var value = (text || '').replace(/^View profile for\s+/i, '').replace(/\s+/g, ' ').trim();
                    if (!value) return '';
                    if (/^(view profile|profile|user|settings|help|guidance center|guidance)$/i.test(value)) return '';
                    return value;
                }

                var selectors = [
                    'a.profile-link-label[href*="/lightning/r/User/"]',
                    'a.profile-link-label[href*="/User/"]',
                    'h1.profile-card-name a[href*="/lightning/r/User/"]',
                    'h1.profile-card-name'
                ];

                function extractName() {
                    for (var i = 0; i < selectors.length; i++) {
                        var els = queryDeep(selectors[i], document, 0);
                        for (var j = 0; j < els.length; j++) {
                            var text = sanitize(els[j].textContent || '');
                            if (text) {
                                return { fullName: text, source: 'script-dom' };
                            }
                        }
                    }

                    var titled = queryDeep('[title^="View profile for "], [aria-label^="View profile for "]', document, 0);
                    for (var k = 0; k < titled.length; k++) {
                        var raw = titled[k].getAttribute('title') || titled[k].getAttribute('aria-label') || '';
                        var extracted = sanitize(raw);
                        if (extracted) {
                            return { fullName: extracted, source: 'script-dom' };
                        }
                    }

                    return { fullName: '', source: 'script-dom' };
                }

                var initial = extractName();
                if (initial.fullName) return initial;

                var triggers = queryDeep(
                    '[title^="View profile for "], [aria-label^="View profile for "], one-app-nav-bar-user-menu button, button.slds-global-actions__item-action',
                    document,
                    0
                );

                for (var m = 0; m < triggers.length; m++) {
                    if (triggers[m] && typeof triggers[m].click === 'function') {
                        triggers[m].click();
                        break;
                    }
                }

                await wait(450);

                var afterClick = extractName();
                if (afterClick.fullName) return afterClick;

                return { fullName: '', source: 'script-dom' };
            }
        }, function (results) {
            var injected = results && results[0] && results[0].result;
            if (!chrome.runtime.lastError && injected && injected.fullName) {
                authState.fullName = injected.fullName;
                authState.source = injected.source || 'script-dom';
                callback(authState);
                return;
            }

            chrome.tabs.sendMessage(tabId, { action: 'getSalesforceIdentityDom' }, function (response) {
                if (!chrome.runtime.lastError && response && response.ok && response.user && response.user.fullName) {
                    authState.fullName = response.user.fullName || '';
                    authState.username = response.user.username || authState.username;
                    authState.email = response.user.email || authState.email;
                    authState.source = response.source || 'dom';
                    callback(authState);
                    return;
                }

                hydrateAuthStateFromCache(authState, callback);
            });
        });
    }

    function hydrateAuthStateFromCache(authState, callback) {
        if (authState.fullName || authState.username || authState.email) {
            callback(authState);
            return;
        }

        chrome.storage.local.get(['salesforceIdentityCache'], function (res) {
            var cache = (res || {}).salesforceIdentityCache;
            if (cache && cache.fullName && cache.domain === authState.domain) {
                authState.fullName = cache.fullName;
                authState.source = authState.source === 'session' ? 'cached-profile' : authState.source;
            }
            callback(authState);
        });
    }

    function persistAuthState(state) {
        var payload = {};
        payload[AUTH_STORAGE_KEY] = state;
        chrome.storage.local.set(payload);
    }

    function renderAuthDisconnected(message) {
        var state = {
            isSignedIn: false,
            fullName: '',
            username: '',
            email: '',
            profilePhotoUrl: '',
            profilePhotoDataUrl: '',
            organizationId: '',
            domain: '',
            instanceUrl: '',
            lastVerifiedAt: null,
            message: message || 'Not signed in'
        };
        renderAuthFromState(state);
    }

    function renderAuthFromState(state) {
        var s = state || {};
        console.log('[CYFOR popup] renderAuthFromState called with:', JSON.stringify(s));

        function deriveNameFromEmail(email) {
            if (!email) return '';
            var localPart = String(email).split('@')[0] || '';
            var rawParts = localPart.split(/[._]+/).filter(Boolean);
            if (!rawParts.length) return '';
            return rawParts
                .map(function (part) {
                    return part
                        .split('-')
                        .filter(Boolean)
                        .map(function (subPart) {
                            return subPart.charAt(0).toUpperCase() + subPart.slice(1).toLowerCase();
                        })
                        .join('-');
                })
                .join(' ');
        }

        function initialsFromName(name, fallbackEmail) {
            var source = String(name || '').trim();
            if (!source) {
                source = deriveNameFromEmail(fallbackEmail || '');
            }
            if (!source) return '?';
            var words = source.split(/\s+/).filter(Boolean);
            if (!words.length) return '?';
            if (words.length === 1) return words[0].charAt(0).toUpperCase();
            return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
        }

        function setAvatar(initials, photoDataUrl, photoUrl) {
            if (!els.authAvatar) return;
            if (els.authAvatarFallback) {
                els.authAvatarFallback.textContent = initials || '?';
                els.authAvatarFallback.style.display = '';
            }

            if (!els.authAvatarImg) return;
            var sourceUrl = photoDataUrl || photoUrl || '';
            if (!sourceUrl) {
                els.authAvatarImg.style.display = 'none';
                els.authAvatarImg.removeAttribute('src');
                return;
            }

            els.authAvatarImg.onload = function () {
                els.authAvatarImg.style.display = 'block';
                if (els.authAvatarFallback) els.authAvatarFallback.style.display = 'none';
            };
            els.authAvatarImg.onerror = function () {
                els.authAvatarImg.style.display = 'none';
                els.authAvatarImg.removeAttribute('src');
                if (els.authAvatarFallback) els.authAvatarFallback.style.display = '';
            };
            els.authAvatarImg.src = sourceUrl;
        }

        if (s.isSignedIn) {
            els.authBadge.textContent = 'Connected';
            els.authBadge.className = 'badge badge-success';

            var accountEmail = s.email || '';
            var accountName = deriveNameFromEmail(accountEmail) || s.fullName || s.username || 'Connected to Salesforce';
            console.log('[CYFOR popup] accountName computed as:', accountName);

            els.authStatus.textContent = accountName;
            els.authUser.textContent = accountEmail || ('Session active on ' + (s.domain || 'Salesforce'));
            if (els.authAvatar) {
                els.authAvatar.style.display = 'inline-flex';
                setAvatar(
                    initialsFromName(accountName, accountEmail),
                    s.profilePhotoDataUrl || '',
                    s.profilePhotoUrl || ''
                );
            }

            els.authSignInBtn.textContent = 'Refresh Session';
            els.authSignOutBtn.style.display = '';
            els.authSignOutBtn.disabled = false;
            return;
        }

        els.authBadge.textContent = 'Not signed in';
        els.authBadge.className = 'badge badge-empty';
        els.authStatus.textContent = s.message || 'Use an open Salesforce tab to connect.';
        els.authUser.textContent = 'No active Salesforce session detected.';
        if (els.authAvatar) {
            els.authAvatar.style.display = 'none';
            setAvatar('?', '', '');
        }
        els.authSignInBtn.textContent = 'Sign In via Salesforce';
        els.authSignOutBtn.style.display = 'none';
    }

    function setAuthLoading(isLoading) {
        els.authSignInBtn.disabled = isLoading;
        els.authSignOutBtn.disabled = isLoading;
        if (isLoading) {
            els.authStatus.textContent = 'Checking Salesforce session...';
            els.authUser.textContent = 'Please wait';
        }
    }
});
