// ==================================================
// CYFOR Nucleus Enhancer — Record Navigation
// Left/right arrows to navigate between Exhibit Process
// records in the order they appeared in the list view.
// ==================================================

Cyfor.navigation = {
    _lastUrl: location.href,
    _scrapeTimeout: null,
    _counterTimeout: null,
    _counterFadeTimeout: null,

    /**
     * Check if the current page is an Exhibit Process record view.
     */
    isOnProcessPage() {
        const href = location.href;
        return href.includes('/view') && href.includes('Exhibit_Process__c');
    },

    /**
     * Extract the 15-char record ID from the current URL.
     * Returns null if not on a process page.
     */
    getCurrentRecordId() {
        const match = location.href.match(/Exhibit_Process__c\/([a-zA-Z0-9]+)\/view/);
        return match ? Cyfor.utils.normalizeId(match[1]) : null;
    },

    /**
     * Scrape process record IDs from a list view table.
     * Stores them in chrome.storage for cross-page navigation.
     */
    scrapeProcessList(rows) {
        if (Cyfor.utils.isContextInvalid()) return;

        const ids = [];
        for (const row of rows) {
            const id = row.getAttribute('data-row-key-value');
            if (id) {
                ids.push(Cyfor.utils.normalizeId(id));
            }
        }

        if (ids.length > 0) {
            // Deduplicate while preserving order
            const unique = [...new Set(ids)];
            chrome.storage.local.set({ processListOrder: unique });
        }
    },

    /**
     * Inject or update navigation buttons on the page.
     */
    injectButtons() {
        if (Cyfor.utils.isContextInvalid()) return;
        if (!Cyfor.config.enableNav) return;
        if (!this.isOnProcessPage()) return;
        if (document.getElementById('cyfor-nav-left')) return;

        const currentId = this.getCurrentRecordId();
        if (!currentId) return;

        chrome.storage.local.get(['processListOrder'], (result) => {
            if (Cyfor.utils.isContextInvalid() || !Cyfor.config.enableNav) return;

            const list = result?.processListOrder || [];
            const idx = list.indexOf(currentId);

            // Remove stale buttons before adding fresh ones
            this.removeButtons();

            const prevId = idx > 0 ? list[idx - 1] : null;
            const nextId = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

            document.body.appendChild(this._createButton('cyfor-nav-left', '&#10094;', prevId));
            document.body.appendChild(this._createButton('cyfor-nav-right', '&#10095;', nextId));

            if (idx >= 0 && list.length > 1) {
                this._showPositionCounter(idx + 1, list.length);
            }
        });
    },

    /**
     * Remove navigation buttons from the page.
     */
    removeButtons() {
        document.getElementById('cyfor-nav-left')?.remove();
        document.getElementById('cyfor-nav-right')?.remove();
        this._removePositionCounter();
    },

    /**
     * Handle page URL changes (SPA navigation).
     */
    handlePageChange() {
        if (Cyfor.utils.isContextInvalid()) return;

        if (this.isOnProcessPage() && Cyfor.config.enableNav) {
            this.injectButtons();
        } else {
            this.removeButtons();
        }
    },

    /**
     * Navigate to a different record by ID.
     */
    navigateTo(id) {
        if (!id) return;
        location.href = location.href.replace(
            /Exhibit_Process__c\/[a-zA-Z0-9]+\/view/,
            `Exhibit_Process__c/${id}/view`
        );
    },

    /**
     * Create a navigation button element.
     */
    _createButton(id, arrowHtml, targetId) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.className = `cyfor-nav-btn ${id.includes('left') ? 'cyfor-nav-btn-left' : 'cyfor-nav-btn-right'}`;
        btn.innerHTML = arrowHtml;
        btn.disabled = !targetId;
        btn.setAttribute('aria-label', id.includes('left') ? 'Previous record' : 'Next record');

        if (targetId) {
            btn.title = 'Go to record';
            btn.addEventListener('click', () => this.navigateTo(targetId));
        }

        return btn;
    },

    /**
     * Show position counter (e.g. "3 / 12").
     */
    _showPositionCounter(current, total) {
        this._removePositionCounter();

        const counter = document.createElement('div');
        counter.id = 'cyfor-nav-counter';
        counter.setAttribute('aria-label', `Record ${current} of ${total}`);
        counter.textContent = `${current} / ${total}`;
        document.body.appendChild(counter);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (counter.isConnected) {
                    counter.classList.add('visible');
                }
            });
        });

        // Fade out after 3 seconds
        Cyfor.cleanup.clearTimeout(this._counterTimeout);
        this._counterTimeout = Cyfor.cleanup.setTimeout(() => {
            if (counter.isConnected) {
                counter.classList.add('fading');
            }

            Cyfor.cleanup.clearTimeout(this._counterFadeTimeout);
            this._counterFadeTimeout = Cyfor.cleanup.setTimeout(() => {
                if (counter.isConnected) counter.remove();
            }, 600);
        }, 3000);
    },

    /**
     * Remove position counter immediately.
     */
    _removePositionCounter() {
        Cyfor.cleanup.clearTimeout(this._counterTimeout);
        Cyfor.cleanup.clearTimeout(this._counterFadeTimeout);
        document.getElementById('cyfor-nav-counter')?.remove();
    },

    /**
     * Initialise navigation: keyboard shortcuts and settings listener.
     */
    init() {
        // Keyboard shortcuts
        const keyHandler = (e) => {
            if (!Cyfor.config.enableNav || !this.isOnProcessPage()) return;

            // Don't capture when user is typing
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault();
                document.getElementById('cyfor-nav-left')?.click();
            } else if (e.altKey && e.key === 'ArrowRight') {
                e.preventDefault();
                document.getElementById('cyfor-nav-right')?.click();
            }
        };

        Cyfor.cleanup.addEventListener(document, 'keydown', keyHandler);

        // React to setting changes
        Cyfor.config.onChange.enableNav.push((enabled) => {
            if (enabled) {
                this.handlePageChange();
            } else {
                this.removeButtons();
            }
        });

        // Initial injection
        this.handlePageChange();
    }
};