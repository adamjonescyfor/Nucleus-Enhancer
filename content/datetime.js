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

            // Resolve the field the cursor is over. PREFER e.target — it's the
            // browser's accurate hit-test. document.elementFromPoint is coordinate
            // based and display scaling / page zoom can fool it into returning a
            // DIFFERENT element (the "only works with DevTools open" symptom), so
            // use it only as a fallback when e.target is detached (e.g. a re-render
            // from blurring another field), then a geometric field-box hit-test.
            const x = e.clientX, y = e.clientY;
            const inField = (n) => n && typeof n.closest === 'function' && n.isConnected !== false && n.closest('.slds-form-element');
            let el = e.target;
            if (!inField(el)) {
                const atPoint = (x || y) ? document.elementFromPoint(x, y) : null;
                if (inField(atPoint)) el = atPoint;
                else el = ((x || y) && this._fieldAtPoint(x, y)) || atPoint || el;
            }
            // Zoom-proof last resort: the field captured on the right-button press,
            // before any re-render detached it (the coordinate-based fallbacks above
            // are unreliable at non-100% zoom).
            if (!inField(el) && this._downField && (Date.now() - this._downField.at) < 1500) {
                el = (this._downField.host && this._downField.host.isConnected && this._downField.host)
                    || this._fieldByLabel(this._downField.label) || el;
            }
            if (!el || typeof el.closest !== 'function') return;

            // Find the Lightning date/time picker around the click. Forgiving of
            // landing on the calendar icon, the field padding, or a wrapper rather
            // than the <input> itself — the old code required an exact <input> hit,
            // which is why it felt unreliable and "worked on the second try".
            const picker = el.closest('lightning-timepicker, lightning-datepicker');
            if (!picker) {
                if (this._maybeCycleStatus(e, el)) return;
                if (this._maybeFillExhibitType(e, el)) return;
                if (this._maybeFillForensicCase(e, el)) return;
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

        // Capture the field on right-button press, BEFORE Salesforce can re-render
        // and detach the target. e.target is an accurate, zoom-independent hit test,
        // so the context menu can still resolve the field even at non-100% zoom
        // (where elementFromPoint / geometry are unreliable).
        Cyfor.cleanup.addEventListener(document, 'mousedown', (e) => {
            if (e.button !== 2) return;
            const t = e.target;
            const host = (t && typeof t.closest === 'function') ? t.closest('.slds-form-element') : null;
            if (!host) { this._downField = null; return; }
            const l = host.querySelector('label, .slds-form-element__label');
            this._downField = { host: host, label: l ? (l.textContent || '').trim().toLowerCase() : '', at: Date.now() };
        }, true);

        // Capture phase: run BEFORE the event reaches the field, so the first
        // right-click on a lookup (which re-renders/refocuses on interaction) is
        // still caught — otherwise it slipped through to the native menu the first
        // time and only worked on the second.
        Cyfor.cleanup.addEventListener(document, 'contextmenu', handler, true);
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
    _USER_LOOKUP_LABELS: ['completed by', 'sealed by', 'conducted by', 'assigned staff'],

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
                    // textContent glues the option's sub-spans together with no
                    // separator ("Adam JonesDigital Forensic Examiner"), so prefer
                    // the matched user name, then the option's title attribute.
                    const raw = (pick.textContent || '').trim();
                    const pickedText = (userName && raw.indexOf(userName) !== -1)
                        ? userName
                        : ((pick.getAttribute('title') || '').trim() || raw);
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
    },

    // Right-click in an "Exhibit Type" picklist: read the exhibit name/reference on
    // the SAME form and, if a token carries a known marker (e.g. "LM/01-SIM",
    // "…-SD"), auto-select the matching type WITHOUT the user typing anything.
    // To add a type: `marker` = the bit in the name, `search` = what to type so the
    // option appears, `type` = the option label to select. SD is treated as memory.
    _EXHIBIT_TYPE_MARKERS: [
        { marker: 'sim', search: 'SIM',  type: 'SIM Card' },
        { marker: 'mem', search: 'Mem',  type: 'Memory Card' },
        { marker: 'sd',  search: 'Mem',  type: 'Memory Card' },  // SD card = memory card
        { marker: 'usb', search: 'USB',  type: 'USB Drive' },
        { marker: 'hdd', search: 'Hard', type: 'Hard Drive' }
    ],

    // True if any "/-_ space"-delimited token of the name starts with the marker,
    // so "LM/01-SIM", "…-SIM1" and "…-SD" match but a random substring won't.
    _nameHasMarker(name, marker) {
        return String(name || '').toLowerCase().split(/[^a-z0-9]+/)
            .some((t) => t.indexOf(marker) === 0);
    },

    // Find the exhibit name/reference field on the same form and return its value.
    // Priority order, and explicitly NOT the Type / Parent Exhibit / Seal Reference
    // / Forensic Case fields (which would otherwise match "exhibit"/"reference").
    _findExhibitName(typeField) {
        const scope = typeField.closest('.slds-modal, [role="dialog"], form, .slds-form') || document;
        const groups = Array.from(scope.querySelectorAll('.slds-form-element'));
        const labelOf = (g) => {
            const l = g.querySelector('label, .slds-form-element__label');
            return ((l && l.textContent) || '').trim().toLowerCase();
        };
        const wanted = ['exhibit name', 'exhibit reference', 'name', 'reference'];
        for (const w of wanted) {
            for (const g of groups) {
                const label = labelOf(g);
                if (!label || /type|parent|seal|forensic/.test(label)) continue;
                if (label.indexOf(w) !== -1) {
                    const input = g.querySelector('input, textarea');
                    if (input && input.value) return String(input.value);
                }
            }
        }
        return '';
    },

    // Type into a Lightning combobox the way the framework notices (native value
    // setter + input/keyup), so its suggestion list filters as if the user typed.
    _typeInto(el, text) {
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(el, text); else el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: text.slice(-1) || 'a' }));
    },

    // The Salesforce field whose box contains the cursor — purely geometric, so
    // it still finds the field when an overlay covers the input or the original
    // target was detached by a re-render. Returns the innermost matching field.
    _fieldAtPoint(x, y) {
        const groups = document.querySelectorAll('.slds-form-element');
        let best = null, bestArea = Infinity;
        for (const g of groups) {
            const r = g.getBoundingClientRect();
            if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                const area = r.width * r.height;
                if (area < bestArea) { best = g; bestArea = area; } // smallest = innermost
            }
        }
        return best;
    },

    // The .slds-form-element whose label matches — used to re-find a field that was
    // captured on mousedown after a re-render replaced it (zoom-proof, no coords).
    _fieldByLabel(lbl) {
        if (!lbl) return null;
        const groups = document.querySelectorAll('.slds-form-element');
        for (const g of groups) {
            const l = g.querySelector('label, .slds-form-element__label');
            if (l && (l.textContent || '').trim().toLowerCase() === lbl) return g;
        }
        return null;
    },

    // Find the combobox <input> for the field the right-click landed in — from a
    // wrapper, icon, padding or the input itself — so it works WITHOUT focusing
    // first. Anchored on the .slds-form-element wrapper, which holds BOTH the
    // label and the input (narrower combobox containers exclude the label).
    // Returns null if this isn't a (relevant) combobox field.
    _comboFromClick(el) {
        const host = el.closest('.slds-form-element');
        if (!host) return null;
        const labelEl = host.querySelector('label, .slds-form-element__label');
        const label = ((labelEl && labelEl.textContent) || '').trim().toLowerCase();
        if (!label) return null;
        return { host, label }; // input may not exist yet — fetch/activate it later
    },

    _comboInput(host) {
        return host.querySelector('input[role="combobox"]') || host.querySelector('input') || null;
    },

    // Click the field's trigger to activate/expand the lookup — renders the
    // <input> if the field had collapsed (which happens once another field is
    // edited and the form re-renders) and opens its dropdown, like a left-click.
    _openCombobox(host) {
        const trigger = host.querySelector('input[role="combobox"]')
            || host.querySelector('input')
            || host.querySelector('button')
            || host.querySelector('[role="combobox"]')
            || host.querySelector('.slds-combobox__input, .slds-combobox__form-element');
        if (trigger) {
            try { trigger.focus(); } catch (e) { /* ignore */ }
            try { trigger.click(); } catch (e) { /* ignore */ }
        }
    },

    _maybeFillExhibitType(e, el) {
        const f = this._comboFromClick(el);
        if (!f) return false;
        // Must be the exhibit-type picklist (and never a "Record/Case Type" one).
        const isType = f.label.indexOf('exhibit type') !== -1
            || (f.label.indexOf('type') !== -1 && f.label.indexOf('record type') === -1 && f.label.indexOf('case type') === -1);
        if (!isType) return false;

        const name = this._findExhibitName(f.host);
        if (!name) return false;
        const hit = this._EXHIBIT_TYPE_MARKERS.find((m) => this._nameHasMarker(name, m.marker));
        if (!hit) return false;

        e.preventDefault();
        const host = f.host, want = hit.type.toLowerCase();

        const tryPick = () => {
            // Results render in an overlay OUTSIDE the field — search the field
            // first, then the whole document, accepting only visible options.
            let options = Cyfor.utils.querySelectorAllDeep('[role="option"]', host, 8);
            if (!options.length) options = Cyfor.utils.querySelectorAllDeep('[role="option"]', document.body, 10);
            options = options.filter((o) => o.getAttribute('aria-disabled') !== 'true' && o.offsetParent !== null);
            const pick = options.find((o) => (o.textContent || '').trim().toLowerCase() === want)
                || options.find((o) => (o.textContent || '').trim().toLowerCase().indexOf(want) !== -1);
            if (pick) {
                pick.click();
                Cyfor.utils.flashElement(this._comboInput(host) || host);
                Cyfor.toast.success('Exhibit type set to ' + hit.type, 1500);
                return true;
            }
            return false;
        };

        // The lookup only searches once OPEN, so type the text, open it, then pick.
        const doType = (input) => {
            input.focus();
            this._typeInto(input, hit.search);
            Cyfor.cleanup.setTimeout(() => {
                if (Cyfor.utils.isContextInvalid()) return;
                try { input.click(); } catch (e) { /* ignore */ } // open → searches typed text
                let a = 0;
                const poll = () => {
                    if (Cyfor.utils.isContextInvalid()) return;
                    if (tryPick()) return;
                    a++;
                    if (a < 24) Cyfor.cleanup.setTimeout(poll, 150);
                };
                Cyfor.cleanup.setTimeout(poll, 200);
            }, 120);
        };

        const existing = this._comboInput(host);
        if (existing) { doType(existing); return true; }

        // Input not in the DOM yet (the field collapsed after another field was
        // edited) — activate it to render the input, then type.
        this._openCombobox(host);
        let a = 0;
        const wait = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const input = this._comboInput(host);
            if (input) { doType(input); return; }
            if (a === 4) this._openCombobox(host); // nudge again if still collapsed
            a++;
            if (a < 16) Cyfor.cleanup.setTimeout(wait, 150);
        };
        Cyfor.cleanup.setTimeout(wait, 150);
        return true;
    },

    // Right-click a "Forensic Case" lookup to insert the first (top) suggestion.
    // Salesforce shows recent records on activation, so no typing is needed.
    _maybeFillForensicCase(e, el) {
        const f = this._comboFromClick(el);
        if (!f || f.label.indexOf('forensic case') === -1) return false;

        e.preventDefault();
        const host = f.host;
        this._openCombobox(host); // activate + open recents (renders the input if collapsed)

        let attempts = 0;
        const tryPick = () => {
            if (Cyfor.utils.isContextInvalid()) return;
            const options = Cyfor.utils.querySelectorAllDeep('[role="option"]', host, 8)
                .filter((o) => o.getAttribute('aria-disabled') !== 'true');
            // Skip "New …" / "Add …" creator entries; take the first real one.
            const real = options.filter((o) => !/^\s*(new|add)\b/i.test(o.textContent || ''));
            const pick = real[0];
            if (pick) {
                // The option glues the reference to a date ("DP-420/2608/06/2026,…").
                // Prefer the primary text span; else strip a trailing date-time.
                const primary = pick.querySelector('.slds-listbox__option-text, [class*="option-text"]');
                let label = (primary ? (primary.getAttribute('title') || primary.textContent || '') : '').trim();
                if (!label) {
                    label = (pick.getAttribute('title') || pick.textContent || '').trim()
                        .replace(/\s*\d{1,2}\/\d{1,2}\/\d{4}.*$/, '').trim();
                }
                pick.click();
                Cyfor.utils.flashElement(this._comboInput(host) || host);
                Cyfor.toast.success('Forensic case set to ' + (label || 'top match'), 1500);
                return;
            }
            if (attempts === 5) this._openCombobox(host); // nudge open again if needed
            attempts++;
            if (attempts < 18) Cyfor.cleanup.setTimeout(tryPick, 150);
            // else: leave the dropdown open for a manual pick.
        };
        Cyfor.cleanup.setTimeout(tryPick, 180);
        return true;
    }
};