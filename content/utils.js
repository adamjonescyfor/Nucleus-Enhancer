// ==================================================
// CYFOR Nucleus Enhancer — Utility Functions
// Pure functions with no dependencies or side effects.
// Creates the global Cyfor namespace.
// ==================================================

const Cyfor = Object.create(null);

Cyfor.utils = {

    /**
     * Returns true when the extension context has been destroyed
     * (e.g. after extension update/reload while page is still open).
     */
    isContextInvalid() {
        try {
            return !chrome.runtime?.id;
        } catch {
            return true;
        }
    },

    /**
     * Debounce — delays execution until `delay` ms after the last call.
     * Returns a function with a `.cancel()` method for cleanup.
     */
    debounce(fn, delay) {
        let timer = null;
        const debounced = (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                fn(...args);
            }, delay);
        };
        debounced.cancel = () => {
            clearTimeout(timer);
            timer = null;
        };
        return debounced;
    },

    /**
     * Throttle — executes at most once every `limit` ms.
     * Trailing call is guaranteed if invoked during cooldown.
     * Returns a function with a `.cancel()` method for cleanup.
     */
    throttle(fn, limit) {
        let waiting = false;
        let pending = null;
        const throttled = (...args) => {
            if (waiting) {
                pending = args;
                return;
            }
            fn(...args);
            waiting = true;
            setTimeout(() => {
                waiting = false;
                if (pending) {
                    fn(...pending);
                    pending = null;
                }
            }, limit);
        };
        throttled.cancel = () => {
            waiting = false;
            pending = null;
        };
        return throttled;
    },

    /**
     * Query selector that traverses open shadow roots.
     * Depth-limited to prevent stack overflow on deeply nested shadow DOMs.
     *
     * @param {string} selector - CSS selector
     * @param {Element|ShadowRoot} root - Starting node
     * @param {number} maxDepth - Maximum shadow root nesting depth
     * @returns {Element[]}
     */
    querySelectorAllDeep(selector, root = document.body, maxDepth = 10) {
        const results = [];
        const seen = new WeakSet();

        function walk(node, depth) {
            if (depth > maxDepth || seen.has(node)) return;
            seen.add(node);

            try {
                const matches = node.querySelectorAll(selector);
                for (let i = 0; i < matches.length; i++) {
                    results.push(matches[i]);
                }
            } catch {
                return;
            }

            if (depth >= maxDepth) return;

            const walker = document.createTreeWalker(
                node,
                NodeFilter.SHOW_ELEMENT,
                {
                    acceptNode(el) {
                        return el.shadowRoot
                            ? NodeFilter.FILTER_ACCEPT
                            : NodeFilter.FILTER_SKIP;
                    }
                }
            );

            while (walker.nextNode()) {
                const sr = walker.currentNode.shadowRoot;
                if (sr && !seen.has(sr)) {
                    walk(sr, depth + 1);
                }
            }
        }

        walk(root, 0);
        return results;
    },

    /**
     * Safely find inputs by name across shadow DOM boundaries.
     * Used by the auto-end feature.
     */
    findInputsByNameDeep(root, name, maxDepth = 10) {
        return Cyfor.utils.querySelectorAllDeep(
            `input[name="${CSS.escape(name)}"]`,
            root,
            maxDepth
        );
    },

    /**
     * Escape HTML entities to prevent XSS.
     *
     * CRITICAL: Uses a <div>, NOT a <template>.
     * On <template> elements, .textContent writes to the element's children
     * but .innerHTML reads from the .content DocumentFragment — they are
     * DIFFERENT subtrees, so innerHTML always returns "" after setting textContent.
     * A detached <div> does not have this problem.
     */
    escapeHtml(text) {
        if (typeof text !== 'string' || !text) return '';
        if (!Cyfor.utils._escapeEl) {
            Cyfor.utils._escapeEl = document.createElement('div');
        }
        Cyfor.utils._escapeEl.textContent = text;
        return Cyfor.utils._escapeEl.innerHTML;
    },

    /**
     * Escape a string for use in a RegExp constructor.
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * Generate a short unique ID for internal tracking.
     */
    uid() {
        return Math.random().toString(36).substring(2, 10);
    },

    /**
     * Normalise a Salesforce record ID to 15 characters.
     */
    normalizeId(id) {
        return id ? id.substring(0, 15) : '';
    },

    /**
     * Set a native input field's value with proper event dispatch
     * so Lightning's framework picks up the change.
     *
     * @param {Element} el - The input element
     * @param {string} value - The value to set
     * @returns {boolean} Whether the value was different (and thus changed)
     */
    setFieldValue(el, value) {
        if (!el) return false;

        const changed = el.value !== value;

        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.blur();

        return changed;
    },

    /**
     * Flash an element with a green highlight to indicate success.
     *
     * Uses INLINE STYLES instead of CSS class + keyframes because
     * the target element is often inside a shadow DOM (e.g. inputs
     * inside lightning-datepicker, editors inside LWC components).
     * Content script CSS cannot reach into shadow roots, but inline
     * styles applied via JavaScript work on any element we have a
     * reference to, regardless of shadow boundary.
     *
     * Saves and restores original styles so the element returns to
     * its exact previous appearance.
     *
     * @param {Element} el - The element to flash
     */
    flashElement(el) {
        if (!el) return;

        // Cancel any in-progress flash on this element
        if (el._cyforFlashTimer) {
            clearTimeout(el._cyforFlashTimer);
            el._cyforFlashTimer = null;
        }
        if (el._cyforFlashFadeTimer) {
            clearTimeout(el._cyforFlashFadeTimer);
            el._cyforFlashFadeTimer = null;
        }

        // Save the original inline styles ONCE per flash cycle. If a flash is
        // already showing when the next one starts (rapid re-clicks), reading the
        // element's current styles would capture the GREEN as the "original" and
        // the fade would restore green permanently — so reuse the stash instead.
        if (!el._cyforFlashOrig) {
            el._cyforFlashOrig = {
                bg:         el.style.backgroundColor,
                shadow:     el.style.boxShadow,
                transition: el.style.transition,
                outline:    el.style.outline
            };
        }
        const orig = el._cyforFlashOrig;

        // Phase 1: Snap to green (fast transition in)
        el.style.transition = 'background-color 0.12s ease, box-shadow 0.12s ease, outline 0.12s ease';
        el.style.backgroundColor = '#d4edda';
        el.style.boxShadow = 'inset 0 0 0 2px #027e46';
        el.style.outline = '2px solid rgba(2, 126, 70, 0.3)';

        // Phase 2: Hold green, then fade back to original
        el._cyforFlashTimer = setTimeout(() => {
            // Slow transition out
            el.style.transition = 'background-color 0.5s ease, box-shadow 0.5s ease, outline 0.5s ease';
            el.style.backgroundColor = orig.bg;
            el.style.boxShadow = orig.shadow;
            el.style.outline = orig.outline;

            // Phase 3: Clean up after the fade completes
            el._cyforFlashFadeTimer = setTimeout(() => {
                el.style.transition = orig.transition;
                el._cyforFlashOrig = null;
                el._cyforFlashTimer = null;
                el._cyforFlashFadeTimer = null;
            }, 500);
        }, 400);
    }
};