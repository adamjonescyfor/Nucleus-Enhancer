// ==================================================
// CYFOR Nucleus Enhancer — Popup Column Management
// Context-aware drag-to-reorder column preferences.
// ==================================================

// Module-level cache to avoid read-modify-write race (M-6)
var columnPrefsMap = {};

// Preset storage helpers (L-7)
// Format: columnPrefsMap[contextId] may be string[] (legacy) or { default: string[], presets: [{name, order}] }
function getContextPrefs(contextId) {
    var stored = columnPrefsMap[contextId];
    if (!stored) return { default: [], presets: [] };
    if (Array.isArray(stored)) return { default: stored, presets: [] }; // legacy
    return { default: stored.default || [], presets: stored.presets || [] };
}

function setContextDefault(contextId, order) {
    var prefs = getContextPrefs(contextId);
    prefs.default = order;
    columnPrefsMap[contextId] = prefs;
}

function addPreset(contextId, name, order) {
    var prefs = getContextPrefs(contextId);
    prefs.presets = prefs.presets.filter(function (p) { return p.name !== name; });
    prefs.presets.push({ name: name, order: order });
    columnPrefsMap[contextId] = prefs;
}

function deletePreset(contextId, name) {
    var prefs = getContextPrefs(contextId);
    prefs.presets = prefs.presets.filter(function (p) { return p.name !== name; });
    columnPrefsMap[contextId] = prefs;
}

function renderPresetBar() {
    var bar = document.getElementById('column-presets-bar');
    var select = document.getElementById('preset-select');
    var deleteBtn = document.getElementById('btn-delete-preset');
    if (!bar || !select || !currentTableContextId) return;

    var prefs = getContextPrefs(currentTableContextId);
    // Always visible (even with no presets yet) so users can save their first one.
    bar.style.display = '';
    select.innerHTML = '<option value="">Load preset…</option>';
    prefs.presets.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
    deleteBtn.style.display = 'none';
    // Assign (not addEventListener) so re-rendering the preset bar replaces the
    // handler instead of stacking a new one each time. Fires for the custom
    // dropdown too (it dispatches a 'change' Event).
    select.onchange = function () {
        deleteBtn.style.display = select.value ? '' : 'none';
        if (select.value) {
            var p = prefs.presets.find(function (x) { return x.name === select.value; });
            if (p) renderColumnList(p.order);
        }
    };

    // Themed custom dropdown (native option lists are unstyleable on Linux).
    if (window.CyforSelect) {
        CyforSelect.enhance(select);
        CyforSelect.sync(select);
    }
}

function initColumns() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs[0];
        if (!tab || !tab.url || tab.url.indexOf('lightning.force.com') === -1) return;
        requestActiveTableColumns(tab.id);
    });
}

function requestActiveTableColumns(tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'getActiveTableColumns' }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok) {
            renderNoTable();
            return;
        }

        currentTableContextId = response.contextId;
        currentTableColumns = response.columns;

        var displayContext = currentTableContextId.replace('__c', '').replace('__r', '').replace(/_/g, ' ');
        if (displayContext.startsWith('Table')) displayContext = 'Custom Table';

        // Build with DOM nodes (not innerHTML) — displayContext is page-derived.
        els.tableContextLbl.textContent = '⚙️ Active Table: ';
        var ctxBold = document.createElement('b');
        ctxBold.textContent = displayContext;
        els.tableContextLbl.appendChild(ctxBold);
        els.btnResetCols.style.display = 'block';

        chrome.storage.local.get(['tableColumnPrefs'], function (res) {
            columnPrefsMap = res.tableColumnPrefs || {};
            var savedOrder = getContextPrefs(currentTableContextId).default;

            var finalOrder = [];
            savedOrder.forEach(function (col) {
                if (currentTableColumns.includes(col)) finalOrder.push(col);
            });
            currentTableColumns.forEach(function (col) {
                if (!finalOrder.includes(col)) finalOrder.push(col);
            });

            renderColumnList(finalOrder);
            renderPresetBar();
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
        // colName is a Salesforce column label (page-derived) — append as text,
        // not innerHTML, so it can never inject markup.
        var handle = document.createElement('span');
        handle.className = 'sortable-handle';
        handle.textContent = '≡';
        li.appendChild(handle);
        li.appendChild(document.createTextNode(' ' + colName));

        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragend', handleDragEnd);

        els.columnList.appendChild(li);
    });
}

var draggedItem = null;

function handleDragStart() {
    draggedItem = this;
    setTimeout(function () { if (draggedItem) draggedItem.classList.add('dragging'); }, 0);
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedItem = null;
    saveColumnOrder();
}

function saveColumnOrder() {
    if (!currentTableContextId) return;

    var items = Array.from(els.columnList.querySelectorAll('.sortable-item'));
    var order = items.map(function (item) { return item.getAttribute('data-name'); });

    // Update in-memory map first, then write once — avoids read-modify-write race (M-6)
    setContextDefault(currentTableContextId, order);
    chrome.storage.local.set({ tableColumnPrefs: columnPrefsMap });
}

function getDragAfterElement(container, y) {
    var draggableElements = Array.from(container.querySelectorAll('.sortable-item:not(.dragging)'));
    return draggableElements.reduce(function (closest, child) {
        var box = child.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function bindColumnEvents() {
    // Preset save (L-7)
    var savePresetBtn = document.getElementById('btn-save-preset');
    var deletePresetBtn = document.getElementById('btn-delete-preset');
    var presetSelect = document.getElementById('preset-select');

    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', function () {
            if (!currentTableContextId) return;
            var name = prompt('Enter a name for this column preset:');
            if (!name) return;
            name = name.trim();
            if (!name) return;
            var items = Array.from(els.columnList.querySelectorAll('.sortable-item'));
            var order = items.map(function (item) { return item.getAttribute('data-name'); });
            addPreset(currentTableContextId, name, order);
            chrome.storage.local.set({ tableColumnPrefs: columnPrefsMap }, function () {
                renderPresetBar();
            });
        });
    }

    if (deletePresetBtn) {
        deletePresetBtn.addEventListener('click', function () {
            if (!currentTableContextId || !presetSelect || !presetSelect.value) return;
            deletePreset(currentTableContextId, presetSelect.value);
            chrome.storage.local.set({ tableColumnPrefs: columnPrefsMap }, function () {
                renderPresetBar();
            });
        });
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

    els.btnResetCols.addEventListener('click', function () {
        if (!currentTableContextId) return;

        setContextDefault(currentTableContextId, []);
        chrome.storage.local.set({ tableColumnPrefs: columnPrefsMap }, function () {
            renderColumnList(currentTableColumns);
            els.columnList.style.backgroundColor = '#f0f7ff';
            setTimeout(function () { els.columnList.style.backgroundColor = ''; }, 300);
        });
    });
}
