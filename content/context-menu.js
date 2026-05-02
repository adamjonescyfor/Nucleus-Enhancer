// ==================================================
// CYFOR Nucleus Enhancer — Right-Click Template Menu
// Right-click on a Notes / Forensic Strategy RTF box
// to insert templates without hunting for the icon.
// ==================================================

Cyfor.contextMenu = {
    _menuEl: null,
    _activeContainer: null,
    _docHandlersAttached: false,

    init() {
        // Listen for right-clicks across the document
        Cyfor.cleanup.addEventListener(document, 'contextmenu', (e) => {
            if (Cyfor.utils.isContextInvalid()) return;
            if (!Cyfor.config.enableContextMenu) return;

            // Don't hijack right-click on date/time inputs (datetime feature owns that)
            if (e.target && e.target.tagName === 'INPUT') {
                if (e.target.closest('lightning-timepicker') ||
                    e.target.closest('lightning-datepicker')) {
                    return;
                }
            }

            const container = Cyfor.editor.findContainerFromTarget(e.target);
            if (!container) return;
            if (!Cyfor.editor.isTemplatableField(container)) return;

            e.preventDefault();
            e.stopPropagation();

            this._activeContainer = container;
            this._showMenu(e.clientX, e.clientY, container);
        }, true);

        // Close on outside click / escape / scroll / resize — registered ONCE
        if (!this._docHandlersAttached) {
            const closeHandler = (e) => {
                if (this._menuEl && !this._menuEl.contains(e.target)) {
                    this.hide();
                }
            };
            const escHandler = (e) => {
                if (e.key === 'Escape') this.hide();
            };
            const scrollHandler = () => this.hide();

            Cyfor.cleanup.addEventListener(document, 'mousedown', closeHandler, true);
            Cyfor.cleanup.addEventListener(document, 'keydown', escHandler);
            Cyfor.cleanup.addEventListener(window, 'scroll', scrollHandler, true);
            Cyfor.cleanup.addEventListener(window, 'resize', scrollHandler);
            this._docHandlersAttached = true;
        }

        // React to setting changes
        Cyfor.config.onChange.enableContextMenu.push((enabled) => {
            if (!enabled) this.hide();
        });
        Cyfor.config.onChange.nucleusTemplates.push(() => {
            // If menu is open, just close it — user can reopen
            this.hide();
        });
        Cyfor.config.onChange.sfRemoteTemplates.push(() => {
            this.hide();
        });

        Cyfor.cleanup.register(() => this.hide());
    },

    /**
     * Show the context menu near the click point.
     */
    _showMenu(x, y, container) {
        this.hide();

        const fieldLabel = Cyfor.editor.isForensicStrategyField(container)
            ? 'Forensic Strategy'
            : 'Notes';

        const menu = document.createElement('div');
        menu.className = 'cyfor-ctx-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Template menu for ' + fieldLabel);

        // Header
        const header = document.createElement('div');
        header.className = 'cyfor-ctx-menu-header';
        header.textContent = 'Insert into ' + fieldLabel;
        menu.appendChild(header);

        // Search box (only for 4+ templates)
        const templates = Cyfor.config.templates || {};
        const allKeys = Object.keys(templates).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );

        // Pin Forensic Strategy template to the top if this is a Forensic Strategy field
        const sortedKeys = this._sortKeysForField(allKeys, container);

        if (sortedKeys.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'cyfor-ctx-menu-empty';
            empty.textContent = 'No templates loaded — open the extension popup to upload some.';
            menu.appendChild(empty);
        } else {
            // Recently used — shown above search (L-3)
            const recentKeys = (Cyfor.config.recentTemplates || []).filter(k => templates[k]);
            if (recentKeys.length > 0) {
                const recentLabel = document.createElement('div');
                recentLabel.className = 'cyfor-ctx-menu-section-label';
                recentLabel.textContent = 'Recently used';
                menu.appendChild(recentLabel);
                for (const key of recentKeys) {
                    const item = document.createElement('div');
                    item.className = 'cyfor-ctx-menu-item cyfor-ctx-menu-item-recent';
                    item.setAttribute('role', 'menuitem');
                    item.setAttribute('tabindex', '0');
                    item.setAttribute('data-template', key);
                    const label = document.createElement('span');
                    label.className = 'cyfor-ctx-menu-item-label';
                    label.textContent = key;
                    item.appendChild(label);
                    item.addEventListener('mousedown', (e) => e.stopPropagation());
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        this._insertTemplate(container, key, templates[key]);
                    });
                    item.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            this._insertTemplate(container, key, templates[key]);
                        }
                    });
                    menu.appendChild(item);
                }
                const sep = document.createElement('div');
                sep.className = 'cyfor-ctx-menu-separator';
                menu.appendChild(sep);
            }

            // Search
            if (sortedKeys.length >= 4) {
                const search = document.createElement('input');
                search.type = 'text';
                search.className = 'cyfor-ctx-menu-search';
                search.placeholder = 'Search ' + sortedKeys.length + ' templates…';
                search.setAttribute('aria-label', 'Search templates');
                search.addEventListener('input', () => {
                    const q = search.value.trim();
                    const qLow = q.toLowerCase();
                    menu.querySelectorAll('.cyfor-ctx-menu-item[data-template]').forEach(item => {
                        const name = item.getAttribute('data-template') || '';
                        const matches = name.toLowerCase().includes(qLow);
                        item.style.display = matches ? '' : 'none';
                        // Highlight match in label (L-4)
                        const label = item.querySelector('.cyfor-ctx-menu-item-label');
                        if (label) {
                            if (q && matches) {
                                const escaped = Cyfor.utils.escapeHtml(name);
                                const re = new RegExp('(' + Cyfor.utils.escapeRegex(q) + ')', 'gi');
                                label.innerHTML = escaped.replace(re, '<mark>$1</mark>');
                            } else {
                                label.textContent = name;
                            }
                        }
                    });
                });
                search.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.stopPropagation();
                        this.hide();
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const first = menu.querySelector('.cyfor-ctx-menu-item[role="menuitem"]:not([style*="display: none"])');
                        if (first) first.focus();
                    }
                });
                // Stop propagation so document mousedown doesn't close the menu
                search.addEventListener('mousedown', (e) => e.stopPropagation());
                search.addEventListener('click', (e) => e.stopPropagation());
                menu.appendChild(search);
            }

            // Items
            const list = document.createElement('div');
            list.className = 'cyfor-ctx-menu-list';

            // Arrow key navigation (M-7)
            list.addEventListener('keydown', (e) => {
                const items = Array.from(list.querySelectorAll('[role="menuitem"]'))
                    .filter(el => el.style.display !== 'none');
                if (items.length === 0) return;
                const idx = items.indexOf(document.activeElement);
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    items[(idx + 1) % items.length].focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    items[(idx - 1 + items.length) % items.length].focus();
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    items[0].focus();
                } else if (e.key === 'End') {
                    e.preventDefault();
                    items[items.length - 1].focus();
                }
            });

            for (const key of sortedKeys) {
                const item = document.createElement('div');
                item.className = 'cyfor-ctx-menu-item';
                item.setAttribute('role', 'menuitem');
                item.setAttribute('tabindex', '0');
                item.setAttribute('data-template', key);
                item.title = 'Insert "' + key + '"';

                // Mark built-in templates with a small badge
                const isBuiltIn = Cyfor.builtinTemplates &&
                    Object.prototype.hasOwnProperty.call(Cyfor.builtinTemplates, key) &&
                    !Object.prototype.hasOwnProperty.call(Cyfor.config.userTemplates || {}, key);

                const label = document.createElement('span');
                label.className = 'cyfor-ctx-menu-item-label';
                label.textContent = key;
                item.appendChild(label);

                const isRemote = !isBuiltIn &&
                    Cyfor.config.sfRemoteTemplates &&
                    Object.prototype.hasOwnProperty.call(Cyfor.config.sfRemoteTemplates, key) &&
                    !Object.prototype.hasOwnProperty.call(Cyfor.config.userTemplates || {}, key);

                if (isBuiltIn) {
                    const badge = document.createElement('span');
                    badge.className = 'cyfor-ctx-menu-item-badge';
                    badge.textContent = 'Built-in';
                    item.appendChild(badge);
                } else if (isRemote) {
                    const badge = document.createElement('span');
                    badge.className = 'cyfor-ctx-menu-item-badge cyfor-ctx-menu-item-badge--official';
                    badge.textContent = 'Official';
                    item.appendChild(badge);
                }

                item.addEventListener('mousedown', (e) => e.stopPropagation());
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this._insertTemplate(container, key, templates[key]);
                });
                item.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this._insertTemplate(container, key, templates[key]);
                    }
                });

                // Hover preview (L-12)
                let previewTimeout;
                item.addEventListener('mouseenter', () => {
                    previewTimeout = setTimeout(() => {
                        this._showItemPreview(item, key, templates[key]);
                    }, 400);
                });
                item.addEventListener('mouseleave', () => {
                    clearTimeout(previewTimeout);
                    this._hideItemPreview();
                });

                list.appendChild(item);
            }

            menu.appendChild(list);
        }

        // Undo option (if available)
        const undoInfo = Cyfor.undo.peek();
        if (undoInfo) {
            const sep = document.createElement('div');
            sep.className = 'cyfor-ctx-menu-separator';
            menu.appendChild(sep);

            const undoItem = document.createElement('div');
            undoItem.className = 'cyfor-ctx-menu-item cyfor-ctx-menu-undo';
            undoItem.setAttribute('role', 'menuitem');
            undoItem.setAttribute('tabindex', '0');
            undoItem.textContent = '↩ Undo "' + undoInfo.templateName + '" (' + undoInfo.timeSince + ')';

            undoItem.addEventListener('mousedown', (e) => e.stopPropagation());
            undoItem.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                Cyfor.undo.undo();
                this.hide();
            });

            menu.appendChild(undoItem);
        }

        // Position off-screen first to measure
        menu.style.visibility = 'hidden';
        menu.style.left = '0px';
        menu.style.top = '0px';
        document.body.appendChild(menu);
        this._menuEl = menu;

        // Compute final position so the menu stays in viewport
        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const padding = 8;

        let finalX = x;
        let finalY = y;
        if (finalX + rect.width + padding > vw) finalX = vw - rect.width - padding;
        if (finalY + rect.height + padding > vh) finalY = vh - rect.height - padding;
        if (finalX < padding) finalX = padding;
        if (finalY < padding) finalY = padding;

        menu.style.left = finalX + 'px';
        menu.style.top = finalY + 'px';
        menu.style.visibility = '';

        // Focus search if present, else first item
        const search = menu.querySelector('.cyfor-ctx-menu-search');
        const firstItem = menu.querySelector('.cyfor-ctx-menu-item');
        Cyfor.cleanup.setTimeout(() => {
            if (search) {
                search.focus();
            } else if (firstItem) {
                firstItem.focus();
            }
        }, 30);
    },

    /**
     * If we're on a Forensic Strategy field, push the Forensic Strategy
     * template to the top of the menu so it's a one-click action.
     */
    _sortKeysForField(keys, container) {
        if (!Cyfor.editor.isForensicStrategyField(container)) return keys;

        const preferred = keys.filter(k => /forensic\s*strategy/i.test(k));
        const rest = keys.filter(k => !/forensic\s*strategy/i.test(k));
        return [...preferred, ...rest];
    },

    _insertTemplate(container, key, text) {
        if (!text) {
            Cyfor.toast.error('Template "' + key + '" is empty', 2500);
            this.hide();
            return;
        }

        Cyfor.editor.insertIntoContainer(container, text, key)
            .then((success) => {
                if (success) {
                    Cyfor.toast.success('"' + key + '" inserted', 3000, {
                        label: 'Undo',
                        onClick: () => Cyfor.undo.undo()
                    });
                }
            })
            .catch((err) => {
                console.warn('[CYFOR] Context menu insert failed:', err);
                Cyfor.toast.error('Could not insert template', 3000);
            });

        this.hide();
    },

    hide() {
        this._hideItemPreview();
        if (this._menuEl && this._menuEl.parentNode) {
            this._menuEl.remove();
        }
        this._menuEl = null;
        this._activeContainer = null;
    },

    // Template preview overlay on hover (L-12)
    _previewEl: null,

    _showItemPreview(anchorItem, key, text) {
        this._hideItemPreview();
        if (!text) return;

        const preview = document.createElement('div');
        preview.className = 'cyfor-ctx-menu-preview';
        preview.setAttribute('role', 'tooltip');

        const title = document.createElement('div');
        title.className = 'cyfor-ctx-menu-preview-title';
        title.textContent = key;
        preview.appendChild(title);

        const content = document.createElement('pre');
        content.className = 'cyfor-ctx-menu-preview-content';
        content.textContent = text.length > 400 ? text.slice(0, 400) + '…' : text;
        preview.appendChild(content);

        // Position to the right of the menu item
        preview.style.visibility = 'hidden';
        document.body.appendChild(preview);

        const itemRect = anchorItem.getBoundingClientRect();
        const previewRect = preview.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const padding = 8;

        let x = itemRect.right + 8;
        let y = itemRect.top;

        if (x + previewRect.width > vw - padding) {
            x = itemRect.left - previewRect.width - 8;
        }
        if (y + previewRect.height > vh - padding) {
            y = vh - previewRect.height - padding;
        }
        if (y < padding) y = padding;
        if (x < padding) x = padding;

        preview.style.left = x + 'px';
        preview.style.top = y + 'px';
        preview.style.visibility = '';

        this._previewEl = preview;
    },

    _hideItemPreview() {
        if (this._previewEl && this._previewEl.parentNode) {
            this._previewEl.remove();
        }
        this._previewEl = null;
    }
};
