// ==================================================
// CYFOR Nucleus Enhancer — Toast Notification System
// Non-blocking notifications with optional action buttons.
// Supports undo actions and auto-dismiss.
// ==================================================

Cyfor.toast = {
    _container: null,
    _queue: [],
    _activeToast: null,
    _dismissTimer: null,
    _pendingShowTimer: null,

    // Toast type definitions
    _types: {
        success: { icon: '✓', label: 'Success' },
        error:   { icon: '✕', label: 'Error' },
        info:    { icon: 'ℹ', label: 'Info' },
        warning: { icon: '⚠', label: 'Warning' }
    },

    /**
     * Ensure the toast container exists.
     * Using a fixed container prevents layout thrashing from
     * repeatedly appending/removing elements on document.body.
     */
    _ensureContainer() {
        if (this._container && document.body.contains(this._container)) {
            return this._container;
        }

        this._container = document.createElement('div');
        this._container.id = 'cyfor-toast-container';
        this._container.setAttribute('role', 'status');
        this._container.setAttribute('aria-live', 'polite');
        this._container.setAttribute('aria-atomic', 'true');
        document.body.appendChild(this._container);

        return this._container;
    },

    /**
     * Show a toast notification.
     *
     * @param {string} message - Text to display
     * @param {string} [type='success'] - One of: success, error, info, warning
     * @param {number} [duration=3000] - Auto-dismiss after ms (0 = manual dismiss)
     * @param {object} [action] - Optional action button
     * @param {string} action.label - Button text
     * @param {Function} action.onClick - Callback when clicked
     * @returns {object} Handle with `.dismiss()` method
     */
    show(message, type = 'success', duration = 3000, action = null) {
        // Cancel any pending delayed show
        if (this._pendingShowTimer) {
            Cyfor.cleanup.clearTimeout(this._pendingShowTimer);
            this._pendingShowTimer = null;
        }

        if (this._activeToast) {
            // Grace period: let previous toast fade so Undo button remains reachable (M-9)
            this.dismiss();
            this._pendingShowTimer = Cyfor.cleanup.setTimeout(() => {
                this._pendingShowTimer = null;
                this._createToast(message, type, duration, action);
            }, 200);
            return { dismiss: () => {
                Cyfor.cleanup.clearTimeout(this._pendingShowTimer);
                this._pendingShowTimer = null;
            }};
        }

        return this._createToast(message, type, duration, action);
    },

    _createToast(message, type, duration, action) {
        const container = this._ensureContainer();
        const typeDef = this._types[type] || this._types.info;

        // Build toast element
        const toast = document.createElement('div');
        toast.className = `cyfor-toast cyfor-toast-${type}`;
        toast.setAttribute('role', 'alert');

        // Icon
        const iconEl = document.createElement('span');
        iconEl.className = 'cyfor-toast-icon';
        iconEl.textContent = typeDef.icon;
        iconEl.setAttribute('aria-hidden', 'true');
        toast.appendChild(iconEl);

        // Message
        const msgEl = document.createElement('span');
        msgEl.className = 'cyfor-toast-msg';
        msgEl.textContent = message; // textContent — no innerHTML, no XSS
        toast.appendChild(msgEl);

        // Optional action button (e.g. "Undo")
        if (action && action.label && typeof action.onClick === 'function') {
            const actionBtn = document.createElement('button');
            actionBtn.className = 'cyfor-toast-action';
            actionBtn.textContent = action.label;
            actionBtn.setAttribute('type', 'button');
            actionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                action.onClick();
                this.dismiss();
            });
            toast.appendChild(actionBtn);
        }

        // Dismiss on click (unless clicking the action button)
        toast.addEventListener('click', () => this.dismiss());

        // Accessibility: dismiss on Escape
        toast.setAttribute('tabindex', '-1');
        toast.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.dismiss();
        });

        container.appendChild(toast);
        this._activeToast = toast;

        // Animate in — double rAF ensures the initial state is painted first
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (toast.isConnected) {
                    toast.classList.add('visible');
                }
            });
        });

        // Auto-dismiss
        if (duration > 0) {
            this._dismissTimer = Cyfor.cleanup.setTimeout(() => {
                this.dismiss();
            }, duration);
        }

        // Return handle for programmatic control
        return {
            dismiss: () => this.dismiss(),
            element: toast
        };
    },

    /**
     * Convenience methods
     */
    success(message, duration = 3000, action = null) {
        return this.show(message, 'success', duration, action);
    },

    error(message, duration = 4000, action = null) {
        return this.show(message, 'error', duration, action);
    },

    info(message, duration = 3000, action = null) {
        return this.show(message, 'info', duration, action);
    },

    warning(message, duration = 4000, action = null) {
        return this.show(message, 'warning', duration, action);
    },

    /**
     * Dismiss the active toast with exit animation.
     */
    dismiss() {
        Cyfor.cleanup.clearTimeout(this._dismissTimer);
        this._dismissTimer = null;

        const toast = this._activeToast;
        if (!toast || !toast.isConnected) {
            this._activeToast = null;
            return;
        }

        toast.classList.remove('visible');
        toast.classList.add('dismissing');

        // Remove after animation completes
        Cyfor.cleanup.setTimeout(() => {
            if (toast.isConnected) {
                toast.remove();
            }
            if (this._activeToast === toast) {
                this._activeToast = null;
            }
        }, 300);
    },

    /**
     * Dismiss without animation (used when replacing one toast with another).
     */
    _dismissImmediate() {
        if (this._pendingShowTimer) {
            Cyfor.cleanup.clearTimeout(this._pendingShowTimer);
            this._pendingShowTimer = null;
        }
        Cyfor.cleanup.clearTimeout(this._dismissTimer);
        this._dismissTimer = null;

        if (this._activeToast && this._activeToast.isConnected) {
            this._activeToast.remove();
        }
        this._activeToast = null;
    }
};