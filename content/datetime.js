// ==================================================
// CYFOR Nucleus Enhancer — Right-Click Date/Time
// Right-click on date or time inputs to fill with
// the current date/time value.
// ==================================================

Cyfor.datetime = {
    /**
     * Initialise the right-click date/time feature.
     * Attaches a single contextmenu listener to the document.
     */
    init() {
        const handler = (e) => {
            if (Cyfor.utils.isContextInvalid()) return;
            if (!Cyfor.config.enableDate) return;

            const el = e.target;

            // Only act on enabled, writable input elements
            if (!el || el.tagName !== 'INPUT' || el.disabled || el.readOnly) return;

            // Determine whether this is a Lightning date or time picker
            const isTime = el.closest('lightning-timepicker') !== null;
            const isDate = el.closest('lightning-datepicker') !== null;
            if (!isTime && !isDate) return;

            // Prevent default context menu
            e.preventDefault();

            const now = new Date();

            if (isTime) {
                const value = now.toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                Cyfor.utils.setFieldValue(el, value);
                Cyfor.utils.flashElement(el);
                Cyfor.toast.success(`Time set to ${value}`, 1500);
            } else {
                const value = now.toLocaleDateString('en-GB');
                Cyfor.utils.setFieldValue(el, value);
                Cyfor.utils.flashElement(el);
                Cyfor.toast.success(`Date set to ${value}`, 1500);
            }
        };

        Cyfor.cleanup.addEventListener(document, 'contextmenu', handler);
    }
};