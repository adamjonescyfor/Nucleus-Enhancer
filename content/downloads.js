// ==================================================
// CYFOR Nucleus Enhancer — Download All Photographs
//
// The "Hyper-Fast Smart Macro" Approach.
// Because Salesforce uses Virtual DOMs (deleting rows as you scroll) 
// and hides the download URLs behind imperative JavaScript events, 
// we must simulate physical clicks while auto-scrolling the table.
// ==================================================

Cyfor.downloads = {
    _processed: new WeakSet(),
    _downloading: false,

    init: function () {
        this.scan();
    },

    scan: function () {
        if (Cyfor.utils.isContextInvalid()) return;

        var headings = Cyfor.utils.querySelectorAllDeep('h3.slds-text-heading_small');

        for (var i = 0; i < headings.length; i++) {
            var h3 = headings[i];
            if (h3.textContent.trim() !== 'Uploaded Documents') continue;

            var gridDiv = h3.parentElement;
            if (!gridDiv) continue;
            if (this._processed.has(gridDiv)) continue;
            if (gridDiv.querySelector('#cyfor-btn-download-all')) continue;

            this._processed.add(gridDiv);
            this._injectButton(h3, gridDiv);
        }
    },

    _injectButton: function (heading, gridDiv) {
        var refreshBtn = gridDiv.querySelector('lightning-button');
        var self = this;

        var btn = document.createElement('button');
        btn.id = 'cyfor-btn-download-all';
        btn.className = 'slds-button slds-button_neutral';
        btn.type = 'button';
        btn.style.marginLeft = 'auto';
        btn.style.marginRight = '0.5rem';
        btn.textContent = 'Download All';

        var scopeRoot = heading.getRootNode();

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            self._handleClick(btn, scopeRoot);
        });

        if (refreshBtn) {
            gridDiv.insertBefore(btn, refreshBtn);
        } else {
            gridDiv.appendChild(btn);
        }
    },

    _handleClick: async function (btn, scopeRoot) {
        if (this._downloading) {
            Cyfor.toast.warning('Download already in progress', 2000);
            return;
        }

        this._downloading = true;

        try {
            // 1. Locate the scrollable table container
            var tableWrapper = scopeRoot.querySelector('.table-wrapper');
            if (!tableWrapper) {
                var wrappers = Cyfor.utils.querySelectorAllDeep('.table-wrapper', scopeRoot);
                if (wrappers.length > 0) tableWrapper = wrappers[0];
            }
            if (!tableWrapper) throw new Error('Could not find scrollable table container.');

            var tbody = tableWrapper.querySelector('tbody');
            if (!tbody) throw new Error('Table body not found.');

            // Check if there are any images at all
            var initialImages = tbody.querySelectorAll('img.thumbnail-image');
            if (initialImages.length === 0) {
                Cyfor.toast.warning('No photographs found', 2500);
                this._setBtnState(btn, 'Download All', false);
                this._downloading = false;
                return;
            }

            var confirmMsg = 'The script will now rapidly scroll through the table to load all images and download them natively.\n\nIMPORTANT: If Chrome shows a popup near the URL bar asking "Allow multiple downloads?", please click "Allow".';
            if (!confirm(confirmMsg)) {
                this._setBtnState(btn, 'Download All', false);
                this._downloading = false;
                return;
            }

            // 2. THE AUTO-SCROLLING MACRO
            var processedIds = new Set();
            var success = 0;
            var failed = 0;
            var consecutiveEmptyPasses = 0;

            // Reset scroll to top
            tableWrapper.scrollTop = 0;
            await this._delay(300);

            // Loop until we hit the bottom of the table
            while (consecutiveEmptyPasses < 3) {
                var rows = tbody.querySelectorAll('tr.slds-hint-parent');
                var foundNewInThisPass = false;

                // Process all currently visible rows
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    var img = row.querySelector('img.thumbnail-image');
                    if (!img) continue;

                    // Salesforce stores the unique file ID in the image's data-record-id attribute
                    var recordId = img.getAttribute('data-record-id');
                    if (!recordId || processedIds.has(recordId)) continue;

                    // We found a new record that hasn't been downloaded yet!
                    foundNewInThisPass = true;
                    processedIds.add(recordId);

                    this._setBtnState(btn, 'Downloading (' + processedIds.size + ')...', true);

                    // Scroll this specific row into view so the dropdown doesn't clip out of bounds
                    row.scrollIntoView({ behavior: 'instant', block: 'center' });
                    await this._delay(50); 

                    // Find and open the dropdown menu
                    var menuComponent = row.querySelector('lightning-button-menu');
                    if (!menuComponent) { failed++; continue; }

                    var menuBtn = menuComponent.querySelector('button');
                    if (!menuBtn && menuComponent.shadowRoot) {
                        menuBtn = menuComponent.shadowRoot.querySelector('button');
                    }
                    if (!menuBtn) { failed++; continue; }

                    menuBtn.click();
                    await this._delay(100); // Wait for LWC menu to render

                    // Find the "Download File" item
                    var menuItems = menuComponent.querySelectorAll('lightning-menu-item');
                    var clicked = false;

                    for (var j = 0; j < menuItems.length; j++) {
                        var text = (menuItems[j].textContent || '').toLowerCase();
                        if (text.includes('download')) {
                            var link = menuItems[j].querySelector('a');
                            if (!link && menuItems[j].shadowRoot) {
                                link = menuItems[j].shadowRoot.querySelector('a');
                            }

                            // Trigger the native Salesforce download event
                            if (link) {
                                link.click();
                            } else {
                                menuItems[j].click();
                            }
                            clicked = true;
                            break;
                        }
                    }

                    if (clicked) {
                        success++;
                        // Very short delay before moving to the next file (Chrome handles this fast)
                        await this._delay(150); 
                    } else {
                        failed++;
                        menuBtn.click(); // Close menu if we failed to find download button
                    }
                }

                // Scroll down by roughly the height of the visible area to load the next chunk of rows
                var previousScroll = tableWrapper.scrollTop;
                tableWrapper.scrollTop += (tableWrapper.clientHeight - 50); 
                await this._delay(300); // Give Salesforce a moment to inject new rows into the HTML

                // If we didn't find any new IDs AND the scroll bar didn't physically move, we've hit the bottom
                if (!foundNewInThisPass && Math.abs(tableWrapper.scrollTop - previousScroll) < 5) {
                    consecutiveEmptyPasses++;
                } else {
                    consecutiveEmptyPasses = 0;
                }
            }

            // 3. DONE
            if (failed === 0) {
                Cyfor.toast.success('Successfully triggered ' + success + ' downloads.', 6000);
            } else {
                Cyfor.toast.warning('Triggered ' + success + ' downloads (' + failed + ' failed).', 6000);
            }

        } catch (err) {
            console.error('[CYFOR] Download error:', err);
            Cyfor.toast.error('Download process failed — ' + (err.message || 'unknown error'), 5000);
        }

        // Reset button
        this._setBtnState(btn, 'Download All', false);
        this._downloading = false;
    },

    // ========================================
    // HELPERS
    // ========================================

    _setBtnState: function (btn, text, disabled) {
        if (!btn || !btn.isConnected) return;
        btn.textContent = text;
        btn.disabled = disabled;
        btn.style.opacity = disabled ? '0.7' : '';
        btn.style.cursor = disabled ? 'wait' : '';
    },

    _delay: function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }
};