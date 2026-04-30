// ==================================================
// CYFOR Nucleus Enhancer — Configuration & State Manager
// Centralises all settings, storage sync, and lifecycle cleanup.
// ==================================================

Cyfor.config = {
    enableDate: true,
    enableNav: true,
    enableFormatNotes: true,
    enableAutoInsert: false,
    enableContextMenu: true,
    tableColumnPrefs: {}, // Context-aware column ordering map
    templates: {},        // merged (built-ins + user)
    userTemplates: {},    // raw user-uploaded only
    processMap: {}
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

        console.log('[CYFOR] Cleanup complete');
    }
};

/**
 * Load settings from storage.
 */
Cyfor.config.load = function (onReady) {
    if (Cyfor.utils.isContextInvalid()) return;

    var keys = [
        'enableDate', 'enableNav', 'enableFormatNotes',
        'enableAutoInsert', 'enableContextMenu',
        'tableColumnPrefs',
        'nucleusTemplates', 'processMap'
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
        Cyfor.config.tableColumnPrefs  = r.tableColumnPrefs || {};
        Cyfor.config.userTemplates     = r.nucleusTemplates || {};
        Cyfor.config.templates         = Cyfor.getMergedTemplates(Cyfor.config.userTemplates);
        Cyfor.config.processMap        = r.processMap || {};

        if (typeof onReady === 'function') onReady(Cyfor.config);
    });
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
    tableColumnPrefs: [],
    nucleusTemplates: [],
    processMap: []
};

Cyfor.config.startListening = function () {
    if (Cyfor.utils.isContextInvalid()) return;

    var storageToConfig = {
        enableDate: 'enableDate',
        enableNav: 'enableNav',
        enableFormatNotes: 'enableFormatNotes',
        enableAutoInsert: 'enableAutoInsert',
        enableContextMenu: 'enableContextMenu',
        tableColumnPrefs: 'tableColumnPrefs',
        nucleusTemplates: 'userTemplates',
        processMap: 'processMap'
    };

    var handler = function (changes, namespace) {
        if (namespace !== 'local') return;

        var entries = Object.entries(storageToConfig);
        for (var i = 0; i < entries.length; i++) {
            var storageKey = entries[i][0];
            var configKey = entries[i][1];

            if (!(storageKey in changes)) continue;

            var newValue = changes[storageKey].newValue;

            if (storageKey === 'nucleusTemplates') {
                Cyfor.config.userTemplates = newValue || {};
                Cyfor.config.templates = Cyfor.getMergedTemplates(Cyfor.config.userTemplates);
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
