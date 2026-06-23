// ==================================================
// CYFOR Nucleus Enhancer — Configuration & State Manager
// Centralises all settings, storage sync, and lifecycle cleanup.
// ==================================================

Cyfor.constants = {
    OBSERVER_THROTTLE_MS: 300,
    COLUMN_SCAN_DEBOUNCE_MS: 400,
    SCRAPE_DEBOUNCE_MS: 1000,
    CONTEXT_CHECK_INTERVAL_MS: 10000,
    EDITOR_ACTIVATE_TIMEOUT_MS: 2400,
    UNDO_STACK_MAX: 20,
    DOWNLOAD_MAX_PASSES: 200,
    DOWNLOAD_SCROLL_WAIT_MS: 500,
    DOWNLOAD_MENU_RENDER_MS: 100,
    DOWNLOAD_FILE_GAP_MS: 150,
    DOWNLOAD_ROW_SCROLL_MS: 50,
    DOWNLOAD_EMPTY_PASS_LIMIT: 5,
    DOWNLOAD_SCROLL_THRESHOLD_PX: 5
};

Cyfor.config = {
    enableDate: true,
    enableNav: true,
    enableFormatNotes: true,
    enableAutoInsert: false,
    enableContextMenu: true,
    enableCaseAlias: true, // Show Forensic Case project/alias where SF doesn't
    tableColumnPrefs: {}, // Context-aware column ordering map
    templates: {},        // merged (built-ins + remote + user)
    userTemplates: {},    // raw user-uploaded only
    sfRemoteTemplates: {},// Salesforce-managed templates { name: { content, category } }
    processMap: {},
    recentTemplates: []   // MRU top 3 (L-3)
};

/**
 * Centralised cleanup registry.
 */
Cyfor.cleanup = {
    _handlers: [],
    _intervals: new Set(),
    _timeouts: new Set(),
    _listeners: [],
    _destroyed: false,

    register: function (fn) {
        if (typeof fn === 'function') {
            this._handlers.push(fn);
        }
    },

    setInterval: function (fn, delay) {
        var self = this;
        var id = setInterval(function () {
            if (Cyfor.utils.isContextInvalid()) {
                self.destroyAll();
                return;
            }
            fn();
        }, delay);
        this._intervals.add(id);
        return id;
    },

    setTimeout: function (fn, delay) {
        var self = this;
        var id = setTimeout(function () {
            self._timeouts.delete(id);
            if (!Cyfor.utils.isContextInvalid()) {
                fn();
            }
        }, delay);
        this._timeouts.add(id);
        return id;
    },

    clearInterval: function (id) {
        if (id != null) {
            clearInterval(id);
            this._intervals.delete(id);
        }
    },

    clearTimeout: function (id) {
        if (id != null) {
            clearTimeout(id);
            this._timeouts.delete(id);
        }
    },

    addEventListener: function (target, event, handler, options) {
        target.addEventListener(event, handler, options);
        this._listeners.push({ target: target, event: event, handler: handler, options: options });
    },

    destroyAll: function () {
        if (this._destroyed) return;
        this._destroyed = true;

        this._intervals.forEach(function (id) { clearInterval(id); });
        this._intervals.clear();

        this._timeouts.forEach(function (id) { clearTimeout(id); });
        this._timeouts.clear();

        for (var i = 0; i < this._listeners.length; i++) {
            var l = this._listeners[i];
            try { l.target.removeEventListener(l.event, l.handler, l.options); } catch (e) {}
        }
        this._listeners.length = 0;

        for (var j = 0; j < this._handlers.length; j++) {
            try { this._handlers[j](); } catch (e) {
                console.warn('[CYFOR] Cleanup error:', e);
            }
        }
        this._handlers.length = 0;

        if (Cyfor.observer) {
            try { Cyfor.observer.disconnect(); } catch (e) {}
        }
    }
};

/**
 * Load settings from storage.
 */
Cyfor.config.load = function (onReady) {
    if (Cyfor.utils.isContextInvalid()) return;

    var keys = [
        'enableDate', 'enableNav', 'enableFormatNotes',
        'enableAutoInsert', 'enableContextMenu', 'enableCaseAlias',
        'tableColumnPrefs',
        'nucleusTemplates', 'processMap', 'recentTemplates',
        'sfRemoteTemplates', 'sfOAuthUser'
    ];

    chrome.storage.local.get(keys, function (result) {
        if (chrome.runtime.lastError) {
            console.warn('[CYFOR] Storage read error:', chrome.runtime.lastError.message);
            return;
        }

        var r = result || {};
        Cyfor.config.enableDate        = r.enableDate !== false;
        Cyfor.config.enableNav         = r.enableNav !== false;
        Cyfor.config.enableFormatNotes = r.enableFormatNotes !== false;
        Cyfor.config.enableAutoInsert  = r.enableAutoInsert === true;
        Cyfor.config.enableContextMenu = r.enableContextMenu !== false;
        Cyfor.config.enableCaseAlias   = r.enableCaseAlias !== false;
        Cyfor.config.tableColumnPrefs  = r.tableColumnPrefs || {};
        Cyfor.config.userTemplates     = r.nucleusTemplates || {};
        Cyfor.config.sfRemoteTemplates = r.sfRemoteTemplates || {};
        Cyfor.config.templates         = Cyfor.getMergedTemplates(Cyfor.config.userTemplates, Cyfor.config.sfRemoteTemplates);
        Cyfor.config.processMap        = r.processMap || {};
        Cyfor.config.recentTemplates   = r.recentTemplates || [];
        Cyfor.config.sfUser            = r.sfOAuthUser || null; // {{examiner}}/{{teamName}} variables

        // Write merged templates to storage so popup can read them without duplicating built-ins
        chrome.storage.local.set({ mergedTemplates: Cyfor.config.templates });

        if (typeof onReady === 'function') onReady(Cyfor.config);
    });

    // Pinned templates live in SYNC storage (shared across the user's devices).
    Cyfor.config.pinnedTemplates = Cyfor.config.pinnedTemplates || [];
    try {
        chrome.storage.sync.get(['pinnedTemplates'], function (res) {
            if (chrome.runtime.lastError) return;
            Cyfor.config.pinnedTemplates = (res && res.pinnedTemplates) || [];
        });
    } catch (e) { /* ignore */ }
};

/**
 * Pub/sub for storage changes.
 */
Cyfor.config.onChange = {
    enableDate: [],
    enableNav: [],
    enableFormatNotes: [],
    enableAutoInsert: [],
    enableContextMenu: [],
    enableCaseAlias: [],
    tableColumnPrefs: [],
    nucleusTemplates: [],
    processMap: [],
    recentTemplates: [],
    sfRemoteTemplates: []
};

Cyfor.config.startListening = function () {
    if (Cyfor.utils.isContextInvalid()) return;

    var storageToConfig = {
        enableDate: 'enableDate',
        enableNav: 'enableNav',
        enableFormatNotes: 'enableFormatNotes',
        enableAutoInsert: 'enableAutoInsert',
        enableContextMenu: 'enableContextMenu',
        enableCaseAlias: 'enableCaseAlias',
        tableColumnPrefs: 'tableColumnPrefs',
        nucleusTemplates: 'userTemplates',
        processMap: 'processMap',
        recentTemplates: 'recentTemplates',
        sfRemoteTemplates: 'sfRemoteTemplates'
    };

    var handler = function (changes, namespace) {
        // Pins live in sync storage; everything else below is local.
        if (namespace === 'sync') {
            if (changes.pinnedTemplates) {
                Cyfor.config.pinnedTemplates = changes.pinnedTemplates.newValue || [];
            }
            return;
        }
        if (namespace !== 'local') return;
        if (changes.sfOAuthUser) Cyfor.config.sfUser = changes.sfOAuthUser.newValue || null;

        var entries = Object.entries(storageToConfig);
        for (var i = 0; i < entries.length; i++) {
            var storageKey = entries[i][0];
            var configKey = entries[i][1];

            if (!(storageKey in changes)) continue;

            var newValue = changes[storageKey].newValue;

            if (storageKey === 'nucleusTemplates') {
                Cyfor.config.userTemplates = newValue || {};
                Cyfor.config.templates = Cyfor.getMergedTemplates(Cyfor.config.userTemplates, Cyfor.config.sfRemoteTemplates);
                chrome.storage.local.set({ mergedTemplates: Cyfor.config.templates });
            } else if (storageKey === 'sfRemoteTemplates') {
                Cyfor.config.sfRemoteTemplates = newValue || {};
                Cyfor.config.templates = Cyfor.getMergedTemplates(Cyfor.config.userTemplates, Cyfor.config.sfRemoteTemplates);
                chrome.storage.local.set({ mergedTemplates: Cyfor.config.templates });
            } else if (storageKey === 'processMap') {
                Cyfor.config.processMap = newValue || {};
            } else {
                Cyfor.config[configKey] = newValue;
            }

            var subscribers = Cyfor.config.onChange[storageKey];
            if (subscribers) {
                for (var j = 0; j < subscribers.length; j++) {
                    try {
                        subscribers[j](newValue, changes[storageKey].oldValue);
                    } catch (e) {
                        console.warn('[CYFOR] onChange error for ' + storageKey + ':', e);
                    }
                }
            }
        }
    };

    chrome.storage.onChanged.addListener(handler);

    Cyfor.cleanup.register(function () {
        try { chrome.storage.onChanged.removeListener(handler); } catch (e) {}
    });
};
