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
            if (!el || typeof el.closest !== 'function') return;

            // Find the Lightning date/time picker around the click. Forgiving of
            // landing on the calendar icon, the field padding, or a wrapper rather
            // than the <input> itself — the old code required an exact <input> hit,
            // which is why it felt unreliable and "worked on the second try".
            const picker = el.closest('lightning-timepicker, lightning-datepicker');
            if (!picker) return;

            const input = (el.tagName === 'INPUT') ? el : picker.querySelector('input');
            if (!input || input.disabled || input.readOnly) return;

            // We're handling this click — suppress the native context menu.
            e.preventDefault();

            const now = new Date();
            const isTime = picker.tagName.toLowerCase() === 'lightning-timepicker';

            if (isTime) {
                const value = now.toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                Cyfor.utils.setFieldValue(input, value);
                Cyfor.utils.flashElement(input);
                Cyfor.toast.success(`Time set to ${value}`, 1500);
            } else {
                const value = now.toLocaleDateString('en-GB');
                Cyfor.utils.setFieldValue(input, value);
                Cyfor.utils.flashElement(input);
                Cyfor.toast.success(`Date set to ${value}`, 1500);
            }
        };

        Cyfor.cleanup.addEventListener(document, 'contextmenu', handler);
    }
};