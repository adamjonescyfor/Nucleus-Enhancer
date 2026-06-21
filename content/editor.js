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
     * Update the recently-used template list in storage (L-3).
     * Keeps the last 3 unique names in MRU order.
     */
    _trackRecentTemplate(templateName) {
        try {
            chrome.storage.local.get(['recentTemplates'], (res) => {
                let recent = (res.recentTemplates || []).filter(n => n !== templateName);
                recent.unshift(templateName);
                if (recent.length > 3) recent = recent.slice(0, 3);
                chrome.storage.local.set({ recentTemplates: recent });
            });
        } catch {}
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
            if (standin) standin.click();
            else if (textarea) textarea.click();

            const timeoutId = Cyfor.cleanup.setTimeout(() => {
                obs.disconnect();
                reject(new Error('Could not activate editor'));
            }, Cyfor.constants.EDITOR_ACTIVATE_TIMEOUT_MS);

            const obs = new MutationObserver(() => {
                const editor = this.findEditor(container);
                if (editor) {
                    obs.disconnect();
                    Cyfor.cleanup.clearTimeout(timeoutId);
                    editor.focus();
                    resolve(editor);
                }
            });
            obs.observe(container, { subtree: true, childList: true });
        });
    },

    /**
     * Substitute template variables: {{date}}, {{examiner}}, {{caseRef}}.
     * Unresolved variables become [variableName] placeholders.
     */
    substituteVariables(text) {
        // Fast path: most templates have no variables — skip all the work.
        if (text.indexOf('{{') === -1) return text;

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        let result = text
            .replace(/\{\{date\}\}/gi, dateStr)
            .replace(/\{\{time\}\}/gi, timeStr)
            .replace(/\{\{dateTime\}\}/gi, dateStr + ' ' + timeStr);

        if (/\{\{teamName\}\}/i.test(result)) {
            const team = (Cyfor.config && Cyfor.config.sfUser && Cyfor.config.sfUser.teamName) || '[teamName]';
            result = result.replace(/\{\{teamName\}\}/gi, team);
        }

        // Only resolve the examiner / case ref if the template references them —
        // the case-ref lookup does a (relatively costly) shadow-piercing DOM scan,
        // and running it on every insert was a big part of the insert delay.
        if (/\{\{examiner\}\}/i.test(result)) {
            const examiner = (Cyfor.main && Cyfor.main._lastCachedProfileName)
                || ((Cyfor.config && Cyfor.config.sfUser && Cyfor.config.sfUser.fullName))
                || '[examiner]';
            result = result.replace(/\{\{examiner\}\}/gi, examiner);
        }

        if (/\{\{caseRef\}\}/i.test(result)) {
            let caseRef = '[caseRef]';
            try {
                const headerSelectors = [
                    'h1.slds-page-header__title',
                    '.slds-page-header__title .slds-truncate',
                    'lightning-formatted-text.slds-page-header__title'
                ];
                for (const sel of headerSelectors) {
                    const el = document.querySelector(sel) ||
                        (Cyfor.utils.querySelectorAllDeep(sel, document.body, 5)[0]);
                    if (el) {
                        const t = (el.textContent || '').trim();
                        if (t) { caseRef = t; break; }
                    }
                }
            } catch {}
            result = result.replace(/\{\{caseRef\}\}/gi, caseRef);
        }

        return result;
    },

    /**
     * Insert text into an editor element.
     * Saves undo state before inserting.
     *
     * NOTE: Does NOT reposition cursor — lets it stay wherever the user/Quill
     * placed it. This matches the original behavior and avoids fighting Quill.
     */
    /**
     * Insert rich HTML by simulating a paste, which Quill converts through its own
     * clipboard matchers — handling multi-block content that execCommand mangles
     * (it tends to drop everything after the first block). Returns true only if a
     * handler consumed the event; returns false where synthetic clipboard data
     * isn't supported, so the caller falls back to execCommand.
     */
    _pasteRichHtml(editor, html) {
        try {
            const dt = new DataTransfer();
            dt.setData('text/html', html);
            dt.setData('text/plain', window.CyforSanitize ? CyforSanitize.toText(html) : '');
            const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
            // Bail if this platform doesn't carry clipboardData on synthetic events.
            if (!evt.clipboardData || evt.clipboardData.getData('text/html') !== html) return false;
            const notCancelled = editor.dispatchEvent(evt);
            return notCancelled === false || evt.defaultPrevented;
        } catch (e) {
            return false;
        }
    },

    insertText(editor, text, templateName) {
        if (!editor || !text) return false;

        // Rich templates are stored as HTML; detect on the raw content (before
        // variable substitution, which never adds/removes tags).
        const SAN = window.CyforSanitize;
        const isHtml = !!(SAN && SAN.looksLikeHtml(text));

        // Apply variable substitution before inserting (L-1)
        text = this.substituteVariables(text);

        // Track recently used templates (L-3)
        if (templateName) {
            this._trackRecentTemplate(templateName);
        }

        // Save state for undo BEFORE modifying
        Cyfor.undo.push(editor, templateName);

        editor.focus();

        let inserted = false;

        if (isHtml && SAN) {
            // Insert SANITISED HTML so Salesforce keeps the formatting it supports
            // (bold/italic/underline, lists, colour, font, size); tables, scripts
            // and Word junk are stripped (Quill rejects them anyway).
            const clean = SAN.html(text);
            // Quill ingests multi-block rich HTML reliably through its OWN paste
            // pipeline; execCommand('insertHTML') often drops everything after the
            // first block. Try a synthetic paste first, then fall back.
            let method = '';
            inserted = this._pasteRichHtml(editor, clean);
            if (inserted) method = 'paste';
            if (!inserted) {
                try { inserted = document.execCommand('insertHTML', false, clean); if (inserted) method = 'insertHTML'; }
                catch (e) { /* fall through */ }
            }
            if (!inserted) {
                try { inserted = document.execCommand('insertText', false, SAN.toText(text)); if (inserted) method = 'insertText(plain)'; }
                catch (e) { /* fall through */ }
            }
            if (!inserted) { editor.innerHTML += clean; inserted = true; method = 'innerHTML'; }
            Cyfor.log('insert', 'rich template', { name: templateName, method, chars: clean.length });
        } else {
            // Plain text — original behaviour.
            try { inserted = document.execCommand('insertText', false, text); }
            catch (e) { /* fall through to the next insert method */ }
            if (!inserted) {
                try {
                    const html = text.split('\n')
                        .map(line => `<p>${Cyfor.utils.escapeHtml(line) || '<br>'}</p>`)
                        .join('');
                    inserted = document.execCommand('insertHTML', false, html);
                } catch (e) { /* fall through to the next insert method */ }
            }
            if (!inserted) { editor.innerText += text; inserted = true; }
            Cyfor.log('insert', 'plain template', { name: templateName, ok: inserted });
        }

        // Notify framework of changes
        editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        Cyfor.utils.flashElement(editor);

        // Audit trail: log the insertion (best-effort, local-only).
        if (inserted && templateName && Cyfor.usage) {
            try { Cyfor.usage.record(templateName); } catch (e) { /* ignore */ }
        }
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
