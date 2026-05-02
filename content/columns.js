// ==================================================
// CYFOR Nucleus Enhancer — Table Column Reordering
// Safely manipulates the DOM of lightning-datatables
// to enforce user-preferred column positioning dynamically
// based on the page context (table type).
// ==================================================

Cyfor.columns = {

    init() {
        // Force a recalculation when the user reorders columns in the popup
        Cyfor.config.onChange.tableColumnPrefs.push(() => this.processAll(true));
        
        this._setupMessageListener();
    },

    /**
     * Listen for the popup asking what columns are on the current page.
     */
    _setupMessageListener() {
        try {
            const handler = (msg, sender, sendResponse) => {
                if (msg.action === 'getActiveTableColumns') {
                    // Get the most relevant visible data table (ignoring hidden tabs)
                    const tables = Cyfor.utils.querySelectorAllDeep('lightning-datatable table.slds-table');
                    const table = tables.find(t => {
                        if (t.closest('.slds-hide, .slds-is-hidden, [hidden]')) return false;
                        const rect = t.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    });
                    
                    if (!table) {
                        sendResponse({ ok: false, error: 'No table active' });
                        return true;
                    }

                    const contextId = this._getTableContextId(table);
                    const ths = Array.from(table.querySelectorAll('thead tr:first-child th'));
                    
                    const columns = ths.map(th => {
                        const key = th.getAttribute('data-col-key-value');
                        let name = (th.getAttribute('aria-label') || th.innerText || '').trim();
                        
                        if (!name) return null;
                        if (key && key.toLowerCase().includes('action')) return null; // Ignore Actions column
                        if (key && (key.includes('rowNumber') || key.includes('CHECKBOX'))) return null; // Ignore checkboxes
                        
                        return name;
                    }).filter(Boolean);

                    sendResponse({ ok: true, contextId, columns });
                    return true;
                }
            };
            chrome.runtime.onMessage.addListener(handler);
            Cyfor.cleanup.register(() => chrome.runtime.onMessage.removeListener(handler));
        } catch(e) {}
    },

    /**
     * Identify the context/type of the table (e.g. "Forensic_Case__c" or "Exhibit_Process__r")
     * Extracts from nearby DOM wrappers to ensure embedded tabs share the same context as full-page list views.
     */
    _getTableContextId(table) {
        // 1. Check if the table is wrapped in a related list card and extract its API name from the View All link
        const card = table.closest('article.slds-card');
        if (card) {
            // Look for a link to the related list (e.g. .../related/Exhibit_Processing__r/view)
            const relatedLink = card.querySelector('a[href*="/related/"]');
            if (relatedLink) {
                const match = relatedLink.getAttribute('href').match(/\/related\/([^\/]+)\//);
                if (match) return match[1]; // e.g. "Exhibit_Processing__r"
            }
            
            // Fallback: aria-label on the card itself (e.g. aria-label="Processes")
            const ariaLabel = card.getAttribute('aria-label');
            if (ariaLabel) {
                return ariaLabel.replace(/[^a-zA-Z0-9]/g, '_');
            }
        }

        // 2. Check URL if it's a dedicated page
        const url = window.location.href;
        const relatedMatch = url.match(/\/related\/([^\/]+)\//);
        if (relatedMatch) return relatedMatch[1]; 

        const objectMatch = url.match(/\/o\/([^\/]+)\//);
        if (objectMatch) return objectMatch[1]; 

        // 3. Fallback: Column headers signature
        const headers = Array.from(table.querySelectorAll('thead tr:first-child th'))
            .map(th => (th.getAttribute('aria-label') || th.innerText || '').trim())
            .filter(n => n && n !== 'Action' && n !== 'Choose a Row' && n !== 'Row Number')
            .join('_');
        
        return "Table_" + headers.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 30);
    },

    /**
     * Triggered continuously by the main.js MutationObserver.
     * Finds SLDS datatables and adjusts their children.
     */
    processAll(force = false) {
        if (Cyfor.utils.isContextInvalid()) return;

        const prefsMap = Cyfor.config.tableColumnPrefs || {};
        if (Object.keys(prefsMap).length === 0) return; // No custom orders saved at all

        const tables = Cyfor.utils.querySelectorAllDeep('lightning-datatable table.slds-table');
        
        for (const table of tables) {
            this._processTable(table, force);
        }
    },

    /**
     * Enforce column sorting on a specific table element.
     */
    _processTable(table, force) {
        const desiredKeys = this._getDesiredOrder(table, force);
        if (!desiredKeys || desiredKeys.length === 0) return;

        // Apply our custom order to all table rows (both <thead> and <tbody>)
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
            this._reorderRow(row, desiredKeys);
        }
    },

    /**
     * Calculate the ideal sorting order of data-col-key-value attributes
     * based on the user-defined array for THIS specific table context.
     */
    _getDesiredOrder(table, force) {
        const contextId = this._getTableContextId(table);
        
        // Invalidate cache if the table's context changed (e.g. LWC recycling rows)
        if (table._cyforContextId !== contextId) {
            table._cyforDesiredOrder = null;
            table._cyforContextId = contextId;
        }

        if (!table._cyforDesiredOrder || force) {
            // Support both legacy string[] and new { default: string[], presets: [] } format (L-7)
            const stored = Cyfor.config.tableColumnPrefs[contextId] || [];
            const orderArr = Array.isArray(stored) ? stored : (stored.default || []);
            const userOrder = orderArr.map(s => s.trim().toLowerCase());
            
            // If the user hasn't customized THIS table type, do nothing.
            if (userOrder.length === 0) {
                table._cyforDesiredOrder = null;
                return null;
            }

            const ths = Array.from(table.querySelectorAll('thead tr:first-child th'));
            if (ths.length === 0) return null;

            const colData = ths.map((th, index) => {
                const key = th.getAttribute('data-col-key-value');
                let name = (th.getAttribute('aria-label') || th.innerText || '').trim().toLowerCase();

                if (key && key.toLowerCase().includes('action')) name = 'action';

                let weight = 5000 + index; // Default: unlisted columns stay in the middle

                // System columns stay strictly pinned to the far left
                if (key && (key.includes('rowNumber') || key.includes('CHECKBOX'))) {
                    weight = index; 
                } 
                // The action dropdown stays pinned strictly to the far right
                else if (name === 'action') {
                    weight = 10000;
                } 
                // Apply the user's custom sort order
                else {
                    const orderIdx = userOrder.indexOf(name);
                    if (orderIdx !== -1) {
                        weight = 100 + orderIdx; 
                    }
                }
                
                return { key, weight };
            });

            // Sort headers by our assigned weights
            colData.sort((a, b) => a.weight - b.weight);
            table._cyforDesiredOrder = colData.map(c => c.key).filter(Boolean);
        }

        return table._cyforDesiredOrder;
    },

    /**
     * Physically re-append the <td> and <th> children of a row 
     * to match the calculated `desiredKeys` order.
     */
    _reorderRow(row, desiredKeys) {
        const cells = Array.from(row.children);
        if (cells.length === 0) return;

        const cellMap = {};
        const unmapped = [];

        // Build a map of the existing cells in this row
        for (const cell of cells) {
            const key = cell.getAttribute('data-col-key-value');
            if (key) {
                cellMap[key] = cell;
            } else {
                unmapped.push(cell);
            }
        }

        // Build the target DOM order array
        const newOrder = [...unmapped];
        for (const key of desiredKeys) {
            if (cellMap[key]) {
                newOrder.push(cellMap[key]);
            }
        }

        // Check if the DOM actually needs updating to prevent infinite MutationObserver loops
        let needsUpdate = false;
        for (let i = 0; i < newOrder.length; i++) {
            if (row.children[i] !== newOrder[i]) {
                needsUpdate = true;
                break;
            }
        }

        // Disconnect observer before DOM mutations to avoid feedback loop
        if (needsUpdate) {
            const obs = Cyfor.observer;
            if (obs) obs.disconnect();
            for (const cell of newOrder) {
                row.appendChild(cell);
            }
            if (obs) obs.observe(
                Cyfor.observerTarget || document.body,
                Cyfor.observerOptions || { subtree: true, childList: true }
            );
        }
    }
};