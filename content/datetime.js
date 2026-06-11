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
            if (!picker) {
                if (this._maybeCycleStatus(e, el)) return;
                this._maybeFillUserLookup(e, el);
                return;
            }

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
    },

    // Status picklist cycle: right-click steps through the working states.
    // Awaiting Start → In Progress → Completed → In Progress → Completed → …
    // Keys are lowercase current values; values are the EXACT option labels.
    _STATUS_CYCLE: {
        'awaiting start': 'In Progress',
        'in progress':    'Completed',
        'completed':      'In Progress'
    },

    /**
     * Right-click on a "Status" picklist cycles its value (see _STATUS_CYCLE) by
     * opening Salesforce's own dropdown and clicking the target option — the
     * exact clicks a user would make, so all framework events fire naturally.
     * Returns true when it handled the event.
     */
    _maybeCycleStatus(e, el) {
        const host = el.closest('lightning-combobox');
        if (!host) return false;

        const labelEl = host.querySelector('label');
        if (!/status/i.test((labelEl && labelEl.textContent) || '')) return false;

        const trigger = host.querySelector('button[role="combobox"], input[role="combobox"]');
        if (!trigger || trigger.disabled) return false;

        const current = (trigger.tagName === 'INPUT' ? trigger.value : trigger.textContent || '').trim();
        const target = this._STATUS_CYCLE[current.toLowerCase()];
        if (!target) return false; // other statuses: leave the native menu alone

        e.preventDefault();
        trigger.click(); // open the picklist dropdown

        let attempts = 0;
        const tryPick = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const options = Cyfor.utils.querySelectorAllDeep('[role="option"]', host, 8);
            const pick = options.find((o) =>
                ((o.textContent || '').trim().toLowerCase() === target.toLowerCase()));
            if (pick) {
                pick.click();
                Cyfor.utils.flashElement(trigger);
                Cyfor.toast.success(`Status set to ${target}`, 1500);
                return;
            }
            attempts++;
            if (attempts < 14) Cyfor.cleanup.setTimeout(tryPick, 150); // ~2s total
            // else: dropdown stays open for a manual pick.
        };
        Cyfor.cleanup.setTimeout(tryPick, 120);
        return true;
    },

    // Field labels eligible for right-click self-fill (user lookups whose first
    // left-click suggestion is the current user). Lowercase substrings.
    _USER_LOOKUP_LABELS: ['completed by', 'sealed by'],

    /**
     * Right-click on a "Completed By" / "Sealed By" user-lookup: open Salesforce's
     * own suggestion dropdown (same as a left-click) and auto-select the current
     * user — the entry a manual left-click would show first. If the suggestions
     * don't appear in time, the dropdown is simply left open for a manual pick.
     */
    _maybeFillUserLookup(e, el) {
        if (el.tagName !== 'INPUT' || el.disabled || el.readOnly) return;

        // Lookup inputs are comboboxes; bail early for ordinary text inputs.
        if ((el.getAttribute('role') || '').toLowerCase() !== 'combobox') return;

        const host = el.closest('lightning-grouped-combobox, lightning-lookup, .slds-form-element');
        if (!host) return;

        const labelEl = host.querySelector('label');
        const label = ((labelEl && labelEl.textContent) || '').trim().toLowerCase();
        if (!this._USER_LOOKUP_LABELS.some((l) => label.indexOf(l) !== -1)) return;

        e.preventDefault();

        // Open the native suggestion dropdown exactly like a left-click would.
        el.focus();
        el.click();

        const userName = (Cyfor.config.sfUser && Cyfor.config.sfUser.fullName) || null;
        let attempts = 0;

        const tryPick = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const options = Cyfor.utils.querySelectorAllDeep('[role="option"]', host, 8)
                .filter((o) => o.getAttribute('aria-disabled') !== 'true');

            if (options.length) {
                // Prefer the option matching the signed-in user; otherwise take the
                // first suggestion (which is the user for these fields anyway).
                // Skip "New User…" creator entries.
                const real = options.filter((o) => !/^\s*new\b/i.test(o.textContent || ''));
                let pick = userName
                    ? real.find((o) => (o.textContent || '').indexOf(userName) !== -1)
                    : null;
                if (!pick) pick = real[0];
                if (pick) {
                    const pickedText = (pick.textContent || '').trim().split('\n')[0].trim();
                    pick.click();
                    Cyfor.utils.flashElement(el);
                    Cyfor.toast.success(`Set to ${pickedText || 'you'}`, 1500);
                    return;
                }
            }

            attempts++;
            if (attempts < 14) Cyfor.cleanup.setTimeout(tryPick, 150); // ~2s total
            // else: leave the dropdown open — one manual click finishes the job.
        };

        Cyfor.cleanup.setTimeout(tryPick, 120); // give the listbox a beat to render
    }
};