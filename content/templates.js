// ==================================================
// CYFOR Nucleus Enhancer — Template Injection
// Floating button and dropdown menu on Notes / Forensic
// Strategy editors. Process-type detection and 
// auto-insert logic.
// ==================================================

Cyfor.templates = {
    _intervalId: null,
    _processed: new WeakSet(),

    /**
     * Start the interval that scans for rich text editors.
     * Event listeners are NOT registered here — they're in init()
     * so they're only registered once, even if start() is called
     * multiple times (e.g. after tab visibility changes).
     */
    start() {
        this._scanEditors();
    },

    stop() {
        // interval removed — _scanEditors is now triggered by _onDomChange
    },

    /**
     * Find all rich text editors and attach template buttons.
     */
    _scanEditors() {
        if (Cyfor.utils.isContextInvalid()) return;

        const containers = Cyfor.utils.querySelectorAllDeep('.slds-rich-text-editor');

        for (const container of containers) {
            if (this._processed.has(container)) continue;
            if (!container.querySelector('.slds-rich-text-editor__toolbar')) continue;

            this._processed.add(container);

            if (!Cyfor.editor.isTemplatableField(container)) continue;

            container.style.position = 'relative';

            this._attachButton(container);
            this._attachMenu(container);

            // Smart suggestions on an empty field:
            //  - Notes: auto-insert (if enabled) the process→template mapping,
            //    otherwise offer it as a one-click suggestion.
            //  - Forensic Strategy: never auto-inserted, but offer the Forensic
            //    Strategy template as a one-click suggestion.
            if (Cyfor.editor.isMainNotesField(container)) {
                if (Cyfor.config.enableAutoInsert) {
                    this._attemptAutoInsert(container);
                } else {
                    this._suggestByType(container);
                }
            } else if (Cyfor.editor.isForensicStrategyField(container)) {
                this._suggestForensicStrategy(container);
            }
        }
    },

    /**
     * Create and attach the floating template icon button.
     */
    _attachButton(container) {
        const count = Object.keys(Cyfor.config.templates).length;
        const fieldLabel = Cyfor.editor.isForensicStrategyField(container)
            ? 'Forensic Strategy'
            : 'Notes';

        const btn = document.createElement('div');
        btn.className = 'cyfor-template-btn';
        btn.title = `Insert Template into ${fieldLabel} (${count} loaded) — also right-click in the box`;
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('contenteditable', 'false');

        btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">` +
            `<path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>` +
            `</svg>`;

        // Prevent editor activation when clicking the button
        btn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            const menu = container.querySelector('.cyfor-template-menu');
            if (!menu) return;

            const wasOpen = menu.classList.contains('visible');
            this._closeAllMenus();

            if (!wasOpen) {
                this._populateMenu(menu, container);
                menu.classList.add('visible');
                btn.setAttribute('aria-expanded', 'true');

                // Focus search box if present
                const search = menu.querySelector('.cyfor-template-search');
                if (search) {
                    Cyfor.cleanup.setTimeout(() => search.focus(), 50);
                }
            }
        });

        // Keyboard: Enter/Space to toggle
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                btn.click();
            }
        });

        container.appendChild(btn);
    },

    /**
     * Create and attach the dropdown menu container.
     */
    _attachMenu(container) {
        const menu = document.createElement('div');
        menu.className = 'cyfor-template-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('contenteditable', 'false');

        this._populateMenu(menu, container);
        container.appendChild(menu);
    },

    /**
     * Populate menu with template items, search box, and undo option.
     */
    _populateMenu(menu, container) {
        menu.innerHTML = '';
        const templates = Cyfor.config.templates;
        const allKeys = Object.keys(templates).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );

        // Pin Forensic Strategy template to top if appropriate
        const keys = (Cyfor.editor.isForensicStrategyField(container))
            ? this._sortKeysForensicFirst(allKeys)
            : allKeys;

        // Recently used (top 3) — rendered above search box (L-3)
        const recentKeys = (Cyfor.config.recentTemplates || []).filter(k => templates[k]);
        if (recentKeys.length > 0) {
            const recentLabel = document.createElement('div');
            recentLabel.className = 'cyfor-template-section-label';
            recentLabel.textContent = 'Recently used';
            menu.appendChild(recentLabel);
            for (const key of recentKeys) {
                const item = document.createElement('div');
                item.className = 'cyfor-template-item cyfor-template-item-recent';
                item.textContent = key;
                item.title = `Insert "${key}"`;
                item.setAttribute('role', 'menuitem');
                item.setAttribute('tabindex', '0');
                item.setAttribute('data-template-key', key);
                item.addEventListener('mousedown', (e) => e.stopPropagation());
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    Cyfor.editor.insertIntoContainer(container, templates[key], key)
                        .then((success) => {
                            if (success) {
                                Cyfor.toast.success(`"${key}" inserted`, 3000, {
                                    label: 'Undo',
                                    onClick: () => Cyfor.undo.undo()
                                });
                            }
                        });
                    this._closeAllMenus();
                });
                menu.appendChild(item);
            }
            const sep = document.createElement('div');
            sep.className = 'cyfor-template-separator';
            menu.appendChild(sep);
        }

        // Search box (4+ templates)
        if (keys.length >= 4) {
            const search = document.createElement('input');
            search.type = 'text';
            search.className = 'cyfor-template-search';
            search.placeholder = `Search ${keys.length} templates\u2026`;
            search.setAttribute('contenteditable', 'false');
            search.setAttribute('role', 'searchbox');

            search.addEventListener('input', () => {
                const q = search.value.trim();
                const qLow = q.toLowerCase();
                menu.querySelectorAll('.cyfor-template-item[role="menuitem"]').forEach(item => {
                    const name = item.getAttribute('data-template-key') || '';
                    const matches = name.toLowerCase().includes(qLow);
                    item.style.display = matches ? '' : 'none';
                    // Highlight match in item text (L-4)
                    if (q && matches) {
                        const escaped = Cyfor.utils.escapeHtml(name);
                        const re = new RegExp('(' + Cyfor.utils.escapeRegex(q) + ')', 'gi');
                        item.innerHTML = escaped.replace(re, '<mark>$1</mark>');
                    } else {
                        item.textContent = name;
                    }
                });
            });

            search.addEventListener('mousedown', (e) => e.stopPropagation());
            search.addEventListener('click', (e) => e.stopPropagation());
            search.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this._closeAllMenus();
                    e.stopPropagation();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const first = menu.querySelector('.cyfor-template-item[role="menuitem"]:not([style*="display: none"])');
                    if (first) first.focus();
                }
            });

            menu.appendChild(search);
        }

        // Undo option (if available)
        const undoInfo = Cyfor.undo.peek();
        if (undoInfo) {
            const undoItem = document.createElement('div');
            undoItem.className = 'cyfor-template-item cyfor-template-undo';
            undoItem.setAttribute('role', 'menuitem');
            undoItem.textContent = `\u21A9 Undo "${undoInfo.templateName}" (${undoInfo.timeSince})`;

            undoItem.addEventListener('mousedown', (e) => e.stopPropagation());
            undoItem.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                Cyfor.undo.undo();
                this._closeAllMenus();
            });

            menu.appendChild(undoItem);

            // Separator
            const sep = document.createElement('div');
            sep.className = 'cyfor-template-separator';
            menu.appendChild(sep);
        }

        // Empty state
        if (keys.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'cyfor-template-item disabled';
            empty.textContent = 'No templates \u2014 upload in extension popup';
            empty.setAttribute('role', 'menuitem');
            empty.setAttribute('aria-disabled', 'true');
            menu.appendChild(empty);
            return;
        }

        // Arrow key navigation across items (M-7)
        menu.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
            const items = Array.from(menu.querySelectorAll('.cyfor-template-item[role="menuitem"]'))
                .filter(el => el.style.display !== 'none');
            if (items.length === 0) return;
            const idx = items.indexOf(document.activeElement);
            e.preventDefault();
            if (e.key === 'ArrowDown') items[(idx + 1) % items.length].focus();
            else if (e.key === 'ArrowUp') items[(idx - 1 + items.length) % items.length].focus();
            else if (e.key === 'Home') items[0].focus();
            else if (e.key === 'End') items[items.length - 1].focus();
        });

        // Template items
        for (const key of keys) {
            const item = document.createElement('div');
            item.className = 'cyfor-template-item';
            item.textContent = key;
            item.title = `Insert "${key}"`;
            item.setAttribute('role', 'menuitem');
            item.setAttribute('tabindex', '0');
            item.setAttribute('data-template-key', key);

            item.addEventListener('mousedown', (e) => e.stopPropagation());
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();

                Cyfor.editor.insertIntoContainer(container, templates[key], key)
                    .then((success) => {
                        if (success) {
                            Cyfor.toast.success(`"${key}" inserted`, 3000, {
                                label: 'Undo',
                                onClick: () => Cyfor.undo.undo()
                            });
                        }
                    });

                this._closeAllMenus();
            });

            menu.appendChild(item);
        }
    },

    _sortKeysForensicFirst(keys) {
        const preferred = keys.filter(k => /forensic\s*strategy/i.test(k));
        const rest = keys.filter(k => !/forensic\s*strategy/i.test(k));
        return [...preferred, ...rest];
    },

    /**
     * Close all open template menus.
     */
    _closeAllMenus() {
        document.querySelectorAll('.cyfor-template-menu.visible').forEach(m => {
            m.classList.remove('visible');
        });
        document.querySelectorAll('.cyfor-template-btn[aria-expanded="true"]').forEach(b => {
            b.setAttribute('aria-expanded', 'false');
        });
    },

    /**
     * Refresh all existing menus (after templates change in storage).
     */
    _refreshAllMenus() {
        document.querySelectorAll('.cyfor-template-menu').forEach(menu => {
            const container = menu.closest('.slds-rich-text-editor');
            if (container) this._populateMenu(menu, container);
        });
        document.querySelectorAll('.cyfor-template-btn').forEach(btn => {
            const count = Object.keys(Cyfor.config.templates).length;
            const container = btn.closest('.slds-rich-text-editor');
            const fieldLabel = container && Cyfor.editor.isForensicStrategyField(container)
                ? 'Forensic Strategy'
                : 'Notes';
            btn.title = `Insert Template into ${fieldLabel} (${count} loaded) — also right-click in the box`;
        });
    },

    // ========================================
    // AUTO-INSERT
    // ========================================

    /**
     * Attempt to auto-insert a template based on the detected process type.
     */
    _attemptAutoInsert(container, retries) {
        retries = retries || 0;
        const maxRetries = 15;

        const editor = Cyfor.editor.findEditor(container);
        if (!editor && retries < maxRetries) {
            Cyfor.cleanup.setTimeout(() => {
                this._attemptAutoInsert(container, retries + 1);
            }, 600);
            return;
        }

        if (!editor) return;

        // Don't insert if editor already has content
        const text = editor.innerText.trim();
        if (text.length > 0 && text !== '\n') return;

        const root = container.closest('.slds-modal') || document.body;
        const processType = this._detectProcessType(root);
        if (!processType) return;

        const templateName = Cyfor.config.processMap[processType];
        if (!templateName) return;

        const templateText = Cyfor.config.templates[templateName];
        if (!templateText) return;

        Cyfor.editor.insertIntoContainer(container, templateText, templateName)
            .then((success) => {
                if (success) {
                    Cyfor.toast.info(`Auto-inserted "${templateName}"`, 3000, {
                        label: 'Undo',
                        onClick: () => Cyfor.undo.undo()
                    });
                }
            });
    },

    /**
     * When auto-insert is off, offer the process-type-mapped template as a
     * single click (non-intrusive toast) for an empty Notes field.
     */
    _suggestByType(container, retries) {
        retries = retries || 0;
        const maxRetries = 15;

        const editor = Cyfor.editor.findEditor(container);
        if (!editor && retries < maxRetries) {
            Cyfor.cleanup.setTimeout(() => {
                this._suggestByType(container, retries + 1);
            }, 600);
            return;
        }
        if (!editor) return;

        const text = editor.innerText.trim();
        if (text.length > 0 && text !== '\n') return;

        const root = container.closest('.slds-modal') || document.body;
        const processType = this._detectProcessType(root);
        if (!processType) return;

        const templateName = Cyfor.config.processMap[processType];
        if (!templateName) return;

        const templateText = Cyfor.config.templates[templateName];
        if (!templateText) return;

        Cyfor.toast.info(`Suggested for "${processType}": ${templateName}`, 6000, {
            label: 'Insert',
            onClick: () => {
                Cyfor.editor.insertIntoContainer(container, templateText, templateName)
                    .then((success) => {
                        if (success) {
                            Cyfor.toast.success(`"${templateName}" inserted`, 2500, {
                                label: 'Undo',
                                onClick: () => Cyfor.undo.undo()
                            });
                        }
                    });
            }
        });
    },

    /**
     * Offer the Forensic Strategy template as a one-click suggestion when an
     * empty Forensic Strategy field is opened (e.g. on the main case page).
     */
    _suggestForensicStrategy(container, retries) {
        retries = retries || 0;
        const maxRetries = 15;

        const editor = Cyfor.editor.findEditor(container);
        if (!editor && retries < maxRetries) {
            Cyfor.cleanup.setTimeout(() => {
                this._suggestForensicStrategy(container, retries + 1);
            }, 600);
            return;
        }
        if (!editor) return;

        const text = editor.innerText.trim();
        if (text.length > 0 && text !== '\n') return;

        const keys = Object.keys(Cyfor.config.templates || {});
        // Prefer an exact "Forensic Strategy" template, else any name containing it.
        let name = keys.find((k) => k.trim().toLowerCase() === 'forensic strategy');
        if (!name) name = keys.find((k) => /forensic\s*strategy/i.test(k));
        if (!name) return;

        const templateText = Cyfor.config.templates[name];
        if (!templateText) return;

        Cyfor.toast.info(`Suggested: ${name}`, 6000, {
            label: 'Insert',
            onClick: () => {
                Cyfor.editor.insertIntoContainer(container, templateText, name)
                    .then((success) => {
                        if (success) {
                            Cyfor.toast.success(`"${name}" inserted`, 2500, {
                                label: 'Undo',
                                onClick: () => Cyfor.undo.undo()
                            });
                        }
                    });
            }
        });
    },

    /**
     * Detect the process type from the current page/modal context.
     */
    _detectProcessType(root) {
        // Strategy 1: Labelled form fields
        const targetLabels = ['record type', 'type', 'process type'];
        const labels = Cyfor.utils.querySelectorAllDeep(
            'span.test-id__field-label, label.slds-form-element__label, .slds-form-element__label',
            root
        );

        for (const label of labels) {
            if (!targetLabels.includes(label.innerText.trim().toLowerCase())) continue;

            const form = label.closest('.slds-form-element');
            if (!form) continue;

            const val = form.querySelector(
                '.test-id__field-value, .slds-form-element__static, .slds-combobox__input, [data-value]'
            );
            if (val) {
                const v = val.getAttribute('data-value') || val.value || val.innerText.trim();
                if (v) return v;
            }
        }

        // Strategy 2: Record type badges
        const badges = Cyfor.utils.querySelectorAllDeep(
            '.slds-page-header [data-target-selection-name*="RecordType"], .test-id__record-type',
            root
        );
        for (const badge of badges) {
            const v = badge.innerText.trim();
            if (v) return v;
        }

        // Strategy 3: Modal header text
        const header = root.querySelector('.slds-modal__header h2, .slds-modal__title');
        if (header) {
            const headerText = header.innerText.trim();
            for (const proc of Object.keys(Cyfor.config.processMap)) {
                if (headerText.includes(proc)) return proc;
            }
        }

        return null;
    },

    /**
     * Handle insertTemplate message from popup (Quick Insert).
     */
    _onMessage(message) {
        if (message.action === 'insertTemplate' && message.text) {
            Cyfor.editor.insertIntoActive(message.text, message.name || 'Template');
        }
    },

    /**
     * Initialise the template system.
     * Event listeners are registered HERE (once only), not in start().
     */
    init() {
        // Close menus when clicking outside — registered ONCE
        Cyfor.cleanup.addEventListener(document, 'click', (e) => {
            if (!e.target.closest('.cyfor-template-btn') &&
                !e.target.closest('.cyfor-template-menu')) {
                this._closeAllMenus();
            }
        }, true);

        // Escape key closes menus — registered ONCE
        Cyfor.cleanup.addEventListener(document, 'keydown', (e) => {
            if (e.key === 'Escape') this._closeAllMenus();
        });

        // React to template changes — subscribed ONCE
        Cyfor.config.onChange.nucleusTemplates.push(() => this._refreshAllMenus());
        Cyfor.config.onChange.sfRemoteTemplates.push(() => this._refreshAllMenus());

        // Listen for Quick Insert messages from popup — registered ONCE
        try {
            const handler = (msg, sender, sendResponse) => {
                if (msg.action === 'insertTemplate') {
                    this._onMessage(msg);
                    sendResponse({ ok: true });
                    return true;
                }
                if (msg.action === 'open-template-menu') {
                    // Click the first visible template button (Alt+T shortcut — L-8)
                    const btn = document.querySelector('.cyfor-template-btn');
                    if (btn) btn.click();
                    sendResponse({ ok: !!btn });
                    return true;
                }
            };
            chrome.runtime.onMessage.addListener(handler);
            Cyfor.cleanup.register(() => {
                try { chrome.runtime.onMessage.removeListener(handler); } catch {}
            });
        } catch {}

        // Start scanning interval
        this.start();

        // Register cleanup
        Cyfor.cleanup.register(() => this.stop());
    }
};
