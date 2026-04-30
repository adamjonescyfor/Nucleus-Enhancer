// ==================================================
// CYFOR Nucleus Enhancer — Undo System
// Stack-based undo for template insertions.
// Supports Alt+Z shortcut and toast action buttons.
// ==================================================

Cyfor.undo = {
    _stack: [],
    _maxSize: 20,

    /**
     * Save the current state of an editor before modifying it.
     */
    push(editor, templateName) {
        if (!editor) return;

        const entry = {
            editorRef: new WeakRef(editor),
            previousContent: editor.innerHTML,
            previousText: editor.innerText,
            templateName: templateName || 'Template',
            timestamp: Date.now()
        };

        this._stack.push(entry);

        while (this._stack.length > this._maxSize) {
            this._stack.shift();
        }

        this._prune();
    },

    /**
     * Undo the most recent insertion.
     */
    undo() {
        this._prune();

        if (this._stack.length === 0) {
            Cyfor.toast.warning('Nothing to undo', 2000);
            return false;
        }

        const entry = this._stack.pop();
        const editor = entry.editorRef.deref();

        if (!editor || !editor.isConnected) {
            Cyfor.toast.warning('Editor no longer available — skipping', 2000);
            return this._stack.length > 0 ? this.undo() : false;
        }

        // Restore content
        editor.focus();
        editor.innerHTML = entry.previousContent;

        // Dispatch events so Salesforce picks up the change
        editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        Cyfor.utils.flashElement(editor);

        const timeSince = this._formatTimeSince(entry.timestamp);
        Cyfor.toast.success(
            `Undid "${entry.templateName}" (${timeSince})`,
            3000
        );

        return true;
    },

    /**
     * Check whether an undo is available.
     */
    canUndo() {
        this._prune();
        return this._stack.length > 0;
    },

    /**
     * Get info about the most recent undoable action.
     */
    peek() {
        this._prune();
        if (this._stack.length === 0) return null;

        const entry = this._stack[this._stack.length - 1];
        return {
            templateName: entry.templateName,
            timeSince: this._formatTimeSince(entry.timestamp),
            stackDepth: this._stack.length
        };
    },

    /**
     * Clear the entire undo stack.
     */
    clear() {
        this._stack.length = 0;
    },

    /**
     * Remove entries whose editors have been garbage collected.
     */
    _prune() {
        this._stack = this._stack.filter(entry => {
            const editor = entry.editorRef.deref();
            return editor && editor.isConnected;
        });
    },

    /**
     * Format a timestamp difference as human-readable text.
     */
    _formatTimeSince(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 5) return 'just now';
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        return `${Math.floor(minutes / 60)}h ago`;
    }
};

/**
 * Initialise the undo system.
 * Sets up ONLY the keyboard shortcut (Alt+Z).
 * Message-based undo is handled centrally by main.js.
 */
Cyfor.undo.init = function () {
    // Alt+Z keyboard shortcut (direct, no background relay needed)
    const keyHandler = (e) => {
        if (e.altKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            e.stopPropagation();
            Cyfor.undo.undo();
        }
    };

    Cyfor.cleanup.addEventListener(document, 'keydown', keyHandler, true);

    // Clear stack on teardown
    Cyfor.cleanup.register(() => Cyfor.undo.clear());
};