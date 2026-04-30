// ==================================================
// CYFOR Nucleus Enhancer — Editor Utilities
// Finding, activating, and inserting into Quill / 
// contenteditable editors within Salesforce Lightning.
// ==================================================

Cyfor.editor = {

    /**
     * Determine the human-readable label of the field that owns this RTF
     * container. Returns lowercased label or null.
     */
    getFieldLabel(container) {
        try {
            // Strategy 1: aria-label on the group wrapper
            const group = container.closest('[role="group"]');
            if (group) {
                const label = (group.getAttribute('aria-label') || '').trim();
                if (label) return label.toLowerCase();
            }

            // Strategy 2: data-target-selection-name attribute (e.g. ".Forensic_Strategy__c")
            const field = container.closest('[data-target-selection-name]');
            if (field) {
                const name = field.getAttribute('data-target-selection-name') || '';
                const m = name.match(/\.([A-Za-z0-9_]+?)(?:__c)?$/);
                if (m) {
                    return m[1].replace(/_/g, ' ').toLowerCase();
                }
            }

            // Strategy 3: walk the shadow root for a label element
            const root = container.getRootNode();
            if (root && root !== document) {
                const labels = root.querySelectorAll('[data-label]');
                for (const labelEl of labels) {
                    const labelGroup = labelEl.closest('[role="group"]');
                    if (labelGroup && labelGroup.contains(container)) {
                        const t = (labelEl.textContent || '').trim();
                        if (t) return t.toLowerCase();
                    }
                }
            }

            // Strategy 4: nearby label element (common in edit modals)
            const formEl = container.closest('.slds-form-element');
            if (formEl) {
                const label = formEl.querySelector('label, .slds-form-element__label');
                if (label) {
                    const t = (label.textContent || '').trim();
                    if (t) return t.toLowerCase();
                }
            }
        } catch {
            // Swallow errors from cross-origin or detached DOM
        }

        return null;
    },

    /**
     * Check whether a rich text editor container is the main "Notes" field.
     */
    isMainNotesField(container) {
        const label = this.getFieldLabel(container);
        return label === 'notes';
    },

    /**
     * Check whether a rich text editor container is the Forensic Strategy field.
     */
    isForensicStrategyField(container) {
        const label = this.getFieldLabel(container);
        if (!label) return false;
        return /forensic\s*strategy/.test(label);
    },

    /**
     * Check whether a rich text editor is one we want to attach a template
     * button + right-click menu to. Currently: Notes, Forensic Strategy.
     */
    isTemplatableField(container) {
        return this.isMainNotesField(container) || this.isForensicStrategyField(container);
    },

    /**
     * Find the active Quill or contenteditable editor inside a container.
     */
    findEditor(container) {
        if (!container) return null;
        return container.querySelector('.ql-editor[contenteditable="true"]')
            || container.querySelector('.ql-editor')
            || container.querySelector('[contenteditable="true"]');
    },

    /**
     * Activate a Quill editor (Salesforce lazy-loads them).
     * Clicks the standin placeholder, then polls for the real editor.
     */
    activate(container) {
        return new Promise((resolve, reject) => {
            const existing = this.findEditor(container);
            if (existing) {
                existing.focus();
                resolve(existing);
                return;
            }

            // Click the placeholder to trigger lazy init
            const standin = container.querySelector('.standin');
            const textarea = container.querySelector('.slds-rich-text-editor__textarea');
            if (standin) {
                standin.click();
            } else if (textarea) {
                textarea.click();
            }

            let attempts = 0;
            const maxAttempts = 12;

            const poll = Cyfor.cleanup.setInterval(() => {
                attempts++;
                const editor = this.findEditor(container);

                if (editor) {
                    Cyfor.cleanup.clearInterval(poll);
                    editor.focus();
                    resolve(editor);
                    return;
                }

                if (attempts >= maxAttempts) {
                    Cyfor.cleanup.clearInterval(poll);
                    reject(new Error('Could not activate editor'));
                }
            }, 200);
        });
    },

    /**
     * Insert text into an editor element.
     * Saves undo state before inserting.
     *
     * NOTE: Does NOT reposition cursor — lets it stay wherever the user/Quill
     * placed it. This matches the original behavior and avoids fighting Quill.
     */
    insertText(editor, text, templateName) {
        if (!editor || !text) return false;

        // Save state for undo BEFORE modifying
        Cyfor.undo.push(editor, templateName);

        editor.focus();

        let inserted = false;

        // Method 1: execCommand (works with Quill's undo stack)
        try {
            inserted = document.execCommand('insertText', false, text);
        } catch {}

        // Method 2: insertHTML with proper paragraph structure
        if (!inserted) {
            try {
                const html = text.split('\n')
                    .map(line => `<p>${Cyfor.utils.escapeHtml(line) || '<br>'}</p>`)
                    .join('');
                inserted = document.execCommand('insertHTML', false, html);
            } catch {}
        }

        // Method 3: Direct DOM manipulation (last resort)
        // Uses innerText += which preserves existing content
        if (!inserted) {
            editor.innerText += text;
            inserted = true;
        }

        // Notify framework of changes
        editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        Cyfor.utils.flashElement(editor);
        return inserted;
    },

    /**
     * Insert text into the active (focused/visible) editor on the page.
     * Used by the Quick Insert popup feature.
     */
    insertIntoActive(text, templateName) {
        const editors = Cyfor.utils.querySelectorAllDeep('.ql-editor');

        const target = editors.find(ed =>
            ed.getAttribute('contenteditable') === 'true' &&
            ed.offsetParent !== null
        );

        if (target) {
            const success = this.insertText(target, text, templateName);
            if (success) {
                Cyfor.toast.success('Template inserted', 2000, {
                    label: 'Undo',
                    onClick: () => Cyfor.undo.undo()
                });
            }
            return success;
        }

        Cyfor.toast.warning(
            'No active editor found — click inside the Notes or Forensic Strategy field first',
            3500
        );
        return false;
    },

    /**
     * Insert text into a specific container's editor.
     * Activates the editor first if needed.
     */
    async insertIntoContainer(container, text, templateName) {
        try {
            const editor = await this.activate(container);
            return this.insertText(editor, text, templateName);
        } catch (e) {
            Cyfor.toast.error('Could not activate editor', 3000);
            return false;
        }
    },

    /**
     * Find the rich text editor container that owns a given DOM node.
     * Walks up through shadow roots if needed.
     */
    findContainerFromTarget(target) {
        let node = target;
        while (node) {
            if (node.classList && node.classList.contains('slds-rich-text-editor')) {
                return node;
            }
            // Walk up, including across shadow roots
            node = node.parentNode || (node.host ? node.host : null);
            if (node && node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                node = node.host || null;
            }
        }
        return null;
    }
};
